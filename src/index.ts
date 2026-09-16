/**
 * opencode-circadian
 *
 * Automatically switches the opencode TUI theme based on the time of day:
 * one theme during the day, another at night. Boundaries and themes are
 * configurable via plugin options in `tui.json`.
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
 *   ["opencode-circadian@latest", {
 *     "dayTheme": "catppuccin",   // theme applied during the day
 *     "nightTheme": "aura",       // theme applied at night
 *     "dayStartHour": 7,          // hour (0-23) the day period begins
 *     "nightStartHour": 19,       // hour (0-23) the night period begins
 *     "checkIntervalMs": 60000,   // how often to re-evaluate (>= 1000)
 *     "toast": true               // show a toast when the theme switches
 *   }]
 *
 * TODO: switch based on actual sunrise/sunset (e.g. via latitude/longitude +
 * a solar-calculation helper) instead of fixed hour boundaries.
 *
 * Requirements:
 *   - opencode with the TUI plugin API (api.theme.set / has / selected).
 *   - The configured theme names must exist (built-in or installed).
 *   - A truecolor terminal for correct theme rendering.
 */

import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"

export interface CircadianOptions {
  dayTheme?: string
  nightTheme?: string
  dayStartHour?: number
  nightStartHour?: number
  checkIntervalMs?: number
  toast?: boolean
}

const DEFAULTS = {
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

export interface ResolvedConfig {
  dayTheme: string
  nightTheme: string
  dayStartHour: number
  nightStartHour: number
  checkIntervalMs: number
  toast: boolean
}

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

export function resolveConfig(options: CircadianOptions | undefined): ResolvedConfig {
  const o = options ?? {}
  const dayStartHour = toHour(o.dayStartHour, DEFAULTS.dayStartHour)
  const nightStartHour = toHour(o.nightStartHour, DEFAULTS.nightStartHour)

  let checkIntervalMs: number = DEFAULTS.checkIntervalMs
  if (typeof o.checkIntervalMs === "number" && Number.isFinite(o.checkIntervalMs)) {
    // Clamp within [MIN, MAX]; the upper bound keeps setInterval under the
    // 32-bit signed limit (values above it silently reset the timer to 1ms).
    checkIntervalMs = Math.min(
      MAX_INTERVAL_MS,
      Math.max(MIN_INTERVAL_MS, Math.trunc(o.checkIntervalMs)),
    )
  }

  return {
    dayTheme: toTheme(o.dayTheme, DEFAULTS.dayTheme),
    nightTheme: toTheme(o.nightTheme, DEFAULTS.nightTheme),
    dayStartHour,
    nightStartHour,
    checkIntervalMs,
    toast: typeof o.toast === "boolean" ? o.toast : DEFAULTS.toast,
  }
}

/**
 * Determine the period for a given time. Handles both the normal case
 * (dayStart < nightStart, e.g. 07 -> 19) and the wrapped case
 * (dayStart > nightStart, e.g. day 20 -> night 06). When the two hours are
 * equal the period is always "day" (degenerate config -> pick one).
 */
export function periodFor(date: Date, cfg: ResolvedConfig): Period {
  const hour = date.getHours()
  const { dayStartHour: d, nightStartHour: n } = cfg
  if (d === n) return "day"
  if (d < n) {
    return hour >= d && hour < n ? "day" : "night"
  }
  // Wrapped: day spans across midnight (e.g. d=20, n=6 -> day 20:00-05:59).
  return hour >= d || hour < n ? "day" : "night"
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
