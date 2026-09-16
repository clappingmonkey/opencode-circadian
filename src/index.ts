/**
 * opencode-circadian
 *
 * Automatically switches the opencode TUI theme based on the time of day:
 * one theme during the day, another at night. It supports two modes:
 *   - "fixed"  — day/night boundaries are configured hours (default).
 *   - "solar"  — boundaries follow the actual sunrise/sunset computed from a
 *                configured latitude/longitude (day between sunrise and sunset).
 * Mode, boundaries, and themes are configurable via plugin options in
 * `tui.json`.
 *
 * Behavior:
 *   - Applies the correct theme once on load (so it's right at launch).
 *   - Checks on an interval; only re-asserts the theme when the day/night
 *     BOUNDARY is crossed. Manual `/theme` changes made mid-period are
 *     respected until the next boundary ("gentle" override behavior).
 *   - Shows a toast whenever it actually SWITCHES the theme — this includes a
 *     startup correction (when the selected theme was wrong for the current
 *     time of day) and live boundary crossings. Stays silent when the theme is
 *     already correct.
 *
 * Configuration (all optional; defaults shown):
 *   Fixed mode (default):
 *   ["opencode-circadian@latest", {
 *     "mode": "fixed",            // "fixed" (default) or "solar"
 *     "dayTheme": "catppuccin",   // theme applied during the day
 *     "nightTheme": "aura",       // theme applied at night
 *     "dayStartHour": 7,          // hour (0-23) the day period begins
 *     "nightStartHour": 19,       // hour (0-23) the night period begins
 *     "checkIntervalMs": 60000,   // how often to re-evaluate (>= 1000)
 *     "toast": true               // show a toast when the theme switches
 *   }]
 *
 *   Solar mode (sunrise -> day, sunset -> night):
 *   ["opencode-circadian@latest", {
 *     "mode": "solar",
 *     "dayTheme": "catppuccin",
 *     "nightTheme": "aura",
 *     "latitude": 42.7,           // degrees, [-90, 90]
 *     "longitude": 23.32,         // degrees, [-180, 180]
 *     "checkIntervalMs": 60000,
 *     "toast": true
 *   }]
 *
 * Solar mode needs no timezone: sunrise/sunset are computed as absolute UTC
 * instants and compared against the absolute current time. If solar mode is
 * requested but latitude/longitude are missing or invalid, it falls back to
 * fixed mode with default hours so the plugin never dead-ends.
 *
 * Requirements:
 *   - opencode with the TUI plugin API (api.theme.set / has / selected).
 *   - The configured theme names must exist (built-in or installed).
 *   - A truecolor terminal for correct theme rendering.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

export type Mode = "fixed" | "solar"

export interface CircadianOptions {
  mode?: Mode
  dayTheme?: string
  nightTheme?: string
  dayStartHour?: number
  nightStartHour?: number
  latitude?: number
  longitude?: number
  checkIntervalMs?: number
  toast?: boolean
}

const DEFAULTS = {
  mode: "fixed",
  dayTheme: "catppuccin",
  nightTheme: "aura",
  dayStartHour: 7,
  nightStartHour: 19,
  checkIntervalMs: 60_000,
  toast: true,
} as const

const MIN_INTERVAL_MS = 1_000
// 24h, safely under setInterval's 32-bit signed max (2_147_483_647 ms).
const MAX_INTERVAL_MS = 86_400_000
// Short retry used at boot while the theme catalog is still indexing, so the
// correct theme lands promptly instead of after a full check interval.
const READY_RETRY_MS = 250

export type Period = "day" | "night"

/** Fields common to every mode. */
interface BaseConfig {
  dayTheme: string
  nightTheme: string
  checkIntervalMs: number
  toast: boolean
}

export interface FixedConfig extends BaseConfig {
  mode: "fixed"
  dayStartHour: number
  nightStartHour: number
}

export interface SolarConfig extends BaseConfig {
  mode: "solar"
  latitude: number
  longitude: number
}

export type ResolvedConfig = FixedConfig | SolarConfig

/** Coerce a value to an integer hour in [0, 23], or return the fallback. */
export function toHour(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value >= 24) {
    return fallback
  }
  return Math.floor(value)
}

/** Coerce a non-empty string (trimmed), or return the fallback. */
export function toTheme(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback
}

/**
 * Coerce a finite latitude in [-90, 90], or return the fallback. Unlike hours
 * these are kept as full-precision floats (no flooring) since fractions matter.
 */
export function toLatitude(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -90 || value > 90) {
    return fallback
  }
  return value
}

/** Coerce a finite longitude in [-180, 180], or return the fallback. */
export function toLongitude(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < -180 || value > 180) {
    return fallback
  }
  return value
}

export function resolveConfig(options: CircadianOptions | undefined): ResolvedConfig {
  const o = options ?? {}

  let checkIntervalMs: number = DEFAULTS.checkIntervalMs
  if (typeof o.checkIntervalMs === "number" && Number.isFinite(o.checkIntervalMs)) {
    // Clamp within [MIN, MAX]; the upper bound keeps setInterval under the
    // 32-bit signed limit (values above it silently reset the timer to 1ms).
    checkIntervalMs = Math.min(
      MAX_INTERVAL_MS,
      Math.max(MIN_INTERVAL_MS, Math.trunc(o.checkIntervalMs)),
    )
  }

  const base: BaseConfig = {
    dayTheme: toTheme(o.dayTheme, DEFAULTS.dayTheme),
    nightTheme: toTheme(o.nightTheme, DEFAULTS.nightTheme),
    checkIntervalMs,
    toast: typeof o.toast === "boolean" ? o.toast : DEFAULTS.toast,
  }

  // Solar mode requires valid coordinates. Any default coordinate would be a
  // real (if arbitrary) location, so instead of coercing to a default we detect
  // missing/invalid input via a NaN sentinel and fall back to fixed mode — the
  // plugin must never dead-end on a typo'd config.
  if (o.mode === "solar") {
    const latitude = toLatitude(o.latitude, Number.NaN)
    const longitude = toLongitude(o.longitude, Number.NaN)
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { ...base, mode: "solar", latitude, longitude }
    }
    // Invalid/missing coordinates: fall back to fixed mode with DEFAULT hours
    // (not any caller-supplied hours). Solar users typically won't have set
    // sensible fixed hours, and the documented contract is "default hours".
    return {
      ...base,
      mode: "fixed",
      dayStartHour: DEFAULTS.dayStartHour,
      nightStartHour: DEFAULTS.nightStartHour,
    }
  }

  return {
    ...base,
    mode: "fixed",
    dayStartHour: toHour(o.dayStartHour, DEFAULTS.dayStartHour),
    nightStartHour: toHour(o.nightStartHour, DEFAULTS.nightStartHour),
  }
}

/**
 * Determine the period for a fixed-hour config. Handles both the normal case
 * (dayStart < nightStart, e.g. 07 -> 19) and the wrapped case
 * (dayStart > nightStart, e.g. day 20 -> night 06). When the two hours are
 * equal the period is always "day" (degenerate config -> pick one).
 */
function periodForFixed(date: Date, cfg: FixedConfig): Period {
  const hour = date.getHours()
  const { dayStartHour: d, nightStartHour: n } = cfg
  if (d === n) return "day"
  if (d < n) {
    return hour >= d && hour < n ? "day" : "night"
  }
  // Wrapped: day spans across midnight (e.g. d=20, n=6 -> day 20:00-05:59).
  return hour >= d || hour < n ? "day" : "night"
}

const DEG = Math.PI / 180
const RAD = 180 / Math.PI

/** Normalize an angle in degrees into [0, 360), including for negative inputs. */
function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360
}

/** Result of a sunrise/sunset computation for a single calendar day. */
export interface SunTimes {
  /** UTC instant of sunrise, or null on a polar day/night. */
  sunrise: Date | null
  /** UTC instant of sunset, or null on a polar day/night. */
  sunset: Date | null
  /** The sun is above the horizon all day (polar day). */
  alwaysUp: boolean
  /** The sun is below the horizon all day (polar night). */
  alwaysDown: boolean
}

/**
 * Compute sunrise and sunset for the local solar day containing `date` at the
 * given latitude/longitude, using the low-precision NOAA / Meeus solar-position
 * algorithm. Returns absolute UTC instants (no timezone needed by the caller).
 * The returned sunrise/sunset bracket the given instant's local day, so a
 * simple `sunrise <= now < sunset` check is correct at any longitude.
 *
 * On polar days the sun never crosses the horizon: when that happens the hour
 * angle is undefined (its cosine falls outside [-1, 1]) and we report
 * `alwaysUp` (sun up all day) or `alwaysDown` (sun down all day) with null
 * sunrise/sunset, so callers can force a single period.
 *
 * Invalid inputs (a non-finite `date`, or coordinates outside their valid
 * ranges) are reported as `alwaysDown` (no sunrise/sunset) rather than
 * returning `Invalid Date`, so direct callers can never get a NaN boundary.
 * The plugin path never hits this — `resolveConfig` validates coords first.
 *
 * Accuracy is on the order of a minute or two — ample for theme switching.
 */
export function sunTimesFor(date: Date, latitude: number, longitude: number): SunTimes {
  // Guard hostile direct inputs so the returned instants are never Invalid Date
  // and no NaN can propagate downstream. Treated as polar night (force "night").
  if (
    !Number.isFinite(date.getTime()) ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { sunrise: null, sunset: null, alwaysUp: false, alwaysDown: true }
  }

  // Continuous Julian date of the exact instant. 2440587.5 is the Julian date
  // of the Unix epoch (1970-01-01T00:00Z). We must NOT quantize this to a UTC
  // calendar day: the Julian cycle below has to be anchored to the instant so
  // it selects the solar transit nearest `date`. Quantizing to a UTC day would
  // step the cycle at 00:00 UTC (which is midday/evening for far-east/far-west
  // longitudes) and misclassify day/night there.
  const julianDate = date.getTime() / 86_400_000 + 2_440_587.5

  // Julian cycle (integer count of solar days since 2000-01-01) for the transit
  // nearest this instant. Rounding puts the cycle boundary at local solar
  // midnight, so the recomputed sunrise/sunset always bracket the local day.
  // Geographic (east-positive) longitude is used directly.
  const nCycle = Math.round(julianDate - 2_451_545.0 - 0.0009 + longitude / 360)
  // Approximate mean solar noon as a Julian date.
  const jStar = 2_451_545.0 + 0.0009 - longitude / 360 + nCycle
  // Solar mean anomaly (degrees). Normalize into [0, 360) so it stays valid for
  // pre-J2000 dates where the raw value would be negative.
  const M = normalizeDeg(357.5291 + 0.985_600_28 * (jStar - 2_451_545.0))
  const Mrad = M * DEG
  // Equation of the center (degrees).
  const C =
    1.9148 * Math.sin(Mrad) +
    0.02 * Math.sin(2 * Mrad) +
    0.0003 * Math.sin(3 * Mrad)
  // Ecliptic longitude (degrees).
  const lambda = normalizeDeg(M + C + 180 + 102.9372)
  const lambdaRad = lambda * DEG
  // Julian date of true solar transit (solar noon).
  const jTransit =
    jStar + 0.0053 * Math.sin(Mrad) - 0.0069 * Math.sin(2 * lambdaRad)
  // Sun's declination. cos(dec) = sqrt(1 - sin²(dec)) by the Pythagorean
  // identity (dec ∈ [-90°, 90°], so its cosine is non-negative) — avoids a
  // round-trip through asin.
  const sinDec = Math.sin(lambdaRad) * Math.sin(23.44 * DEG)
  const cosDec = Math.sqrt(1 - sinDec * sinDec)

  const latRad = latitude * DEG
  // Hour angle for the standard sunrise/sunset altitude (-0.833°, accounting
  // for atmospheric refraction and the sun's apparent radius).
  const cosOmega =
    (Math.sin(-0.833 * DEG) - Math.sin(latRad) * sinDec) /
    (Math.cos(latRad) * cosDec)

  if (cosOmega < -1) {
    // Sun never sets: it's above the horizon the whole day.
    return { sunrise: null, sunset: null, alwaysUp: true, alwaysDown: false }
  }
  if (cosOmega > 1) {
    // Sun never rises: below the horizon the whole day.
    return { sunrise: null, sunset: null, alwaysUp: false, alwaysDown: true }
  }

  const omega = Math.acos(cosOmega) * RAD // degrees
  const jSet = jTransit + omega / 360
  const jRise = jTransit - omega / 360

  // Convert Julian dates back to absolute instants.
  const toDate = (j: number): Date => new Date((j - 2_440_587.5) * 86_400_000)

  return {
    sunrise: toDate(jRise),
    sunset: toDate(jSet),
    alwaysUp: false,
    alwaysDown: false,
  }
}

/**
 * Determine the period for a solar config: day between sunrise and sunset,
 * night otherwise. Polar day forces "day", polar night forces "night". Uses
 * absolute-instant comparison, so no timezone handling is required.
 */
function periodForSolar(date: Date, cfg: SolarConfig): Period {
  const { sunrise, sunset, alwaysUp, alwaysDown } = sunTimesFor(
    date,
    cfg.latitude,
    cfg.longitude,
  )
  if (alwaysUp) return "day"
  // Polar night, or a defensive null (should not happen once alwaysUp is ruled
  // out) — treat the absence of a sunrise/sunset window as night.
  if (alwaysDown || sunrise === null || sunset === null) return "night"
  const now = date.getTime()
  return now >= sunrise.getTime() && now < sunset.getTime() ? "day" : "night"
}

/**
 * Determine the period ("day" | "night") for a given time under the resolved
 * config, dispatching on mode.
 */
export function periodFor(date: Date, cfg: ResolvedConfig): Period {
  return cfg.mode === "solar" ? periodForSolar(date, cfg) : periodForFixed(date, cfg)
}

const tui: TuiPlugin = async (api, options) => {
  const cfg = resolveConfig(options as CircadianOptions | undefined)

  const themeFor = (period: Period): string =>
    period === "day" ? cfg.dayTheme : cfg.nightTheme

  // Track the last period we acted on so we only switch at boundary crossings,
  // leaving manual /theme changes alone within a period.
  let lastPeriod: Period | null = null

  type ApplyResult = "applied" | "already" | "missing" | "not-ready" | "failed"

  // Reports what happened so the caller can decide whether to toast and whether
  // to advance state:
  //   "applied"   — we actually switched the theme (toast-worthy).
  //   "already"   — desired theme was already active; nothing to do (silent).
  //   "missing"   — theme isn't installed; warned once, period is acknowledged.
  //   "not-ready" — theme catalog still indexing; retry soon.
  //   "failed"    — set() returned false; retry on the next tick.
  const applyForPeriod = (period: Period): ApplyResult => {
    // Theme catalog may still be indexing at plugin init — retry soon.
    if (!api.theme.ready) return "not-ready"

    const desired = themeFor(period)

    if (!api.theme.has(desired)) {
      api.ui.toast({
        variant: "warning",
        title: "circadian",
        message: `Theme "${desired}" is not installed; skipping switch.`,
      })
      return "missing"
    }

    // Already on it (e.g. set in tui.json, or user picked it) — nothing to do.
    if (api.theme.selected === desired) return "already"

    if (!api.theme.set(desired)) return "failed"
    return "applied"
  }

  const tick = () => {
    try {
      const period = periodFor(new Date(), cfg)
      // On the first apply, and afterwards only when the period actually
      // changes (a boundary crossing), attempt to apply. Toast whenever we
      // genuinely switched — this covers both a startup correction (wrong
      // theme -> right) and a live boundary crossing.
      if (lastPeriod === null || period !== lastPeriod) {
        const result = applyForPeriod(period)

        if (result === "applied" && cfg.toast) {
          api.ui.toast({
            variant: "info",
            message: period === "day" ? "\u2600 day theme" : "\u263e night theme",
          })
        }

        // "not-ready" / "failed" are transient — leave lastPeriod so we retry.
        // "applied" / "already" / "missing" mean the period is handled (a
        // missing theme was warned once; don't spam it every tick).
        if (result !== "not-ready" && result !== "failed") {
          lastPeriod = period
        }

        // If the theme system wasn't ready yet, retry quickly instead of
        // waiting a full interval, so the correct theme lands promptly at boot.
        if (result === "not-ready" && !api.lifecycle.signal.aborted) {
          scheduleReadyRetry()
        }
      }
    } catch {
      // Swallow: transient API errors during teardown must not crash the host.
    }
  }

  let timer: ReturnType<typeof setInterval> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null

  const scheduleReadyRetry = () => {
    if (retryTimer !== null) return
    retryTimer = setTimeout(() => {
      retryTimer = null
      tick()
    }, READY_RETRY_MS)
  }

  // If the plugin is initialized already-aborted, do nothing (no orphan timer).
  if (api.lifecycle.signal.aborted) return

  // If solar mode was requested but coordinates were missing/invalid,
  // resolveConfig fell back to fixed mode. Surface that once so a typo'd
  // latitude/longitude isn't silently ignored.
  if ((options as CircadianOptions | undefined)?.mode === "solar" && cfg.mode === "fixed") {
    api.ui.toast({
      variant: "warning",
      title: "circadian",
      message:
        "Solar mode needs valid latitude/longitude; using fixed hours " +
        `(${DEFAULTS.dayStartHour}:00\u2013${DEFAULTS.nightStartHour}:00).`,
    })
  }

  // Initial application at launch. Toasts only if it actually corrects the
  // theme (i.e. the selected theme was wrong for the current time of day).
  tick()

  // Periodic boundary checks.
  timer = setInterval(tick, cfg.checkIntervalMs)

  const stop = () => {
    if (timer !== null) {
      clearInterval(timer)
      timer = null
    }
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
  }
  api.lifecycle.onDispose(stop)
  api.lifecycle.signal.addEventListener("abort", stop, { once: true })
}

// `id` is intentionally omitted: for npm packages opencode uses the package
// name ("opencode-circadian") as the runtime identity, which avoids collisions.
export default { tui } satisfies TuiPluginModule
