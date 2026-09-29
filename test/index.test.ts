import assert from "node:assert/strict"
import { test } from "node:test"

import {
  describeError,
  nextPeriodChange,
  periodFor,
  resolveConfig,
  sunTimesFor,
  toHour,
  toLatitude,
  toLongitude,
  toTheme,
} from "../src/index.ts"

function at(hour: number): Date {
  const d = new Date(2026, 0, 1, hour, 30, 0) // local time, minute 30
  return d
}

test("toHour accepts valid integer hours", () => {
  assert.equal(toHour(0, 7), 0)
  assert.equal(toHour(23, 7), 23)
  assert.equal(toHour(12, 7), 12)
})

test("toHour floors valid fractional hours", () => {
  assert.equal(toHour(7.9, 0), 7)
})

test("toHour rejects out-of-range, negative, -0.x, NaN, non-numbers", () => {
  assert.equal(toHour(-1, 7), 7)
  assert.equal(toHour(24, 7), 7)
  assert.equal(toHour(-0.5, 7), 7) // Math.trunc(-0.5) === -0 pitfall guarded
  assert.equal(toHour(Number.NaN, 7), 7)
  assert.equal(toHour(Number.POSITIVE_INFINITY, 7), 7)
  assert.equal(toHour("7", 7), 7) // string is not coerced
  assert.equal(toHour(null, 7), 7)
  assert.equal(toHour(undefined, 7), 7)
})

test("toTheme trims and rejects empty/whitespace/non-strings", () => {
  assert.equal(toTheme("everforest", "catppuccin"), "everforest")
  assert.equal(toTheme("  everforest  ", "catppuccin"), "everforest")
  assert.equal(toTheme("", "catppuccin"), "catppuccin")
  assert.equal(toTheme("   ", "catppuccin"), "catppuccin")
  assert.equal(toTheme(123, "catppuccin"), "catppuccin")
  assert.equal(toTheme(undefined, "catppuccin"), "catppuccin")
})

test("resolveConfig applies defaults for undefined options", () => {
  const c = resolveConfig(undefined)
  assert.deepEqual(c, {
    mode: "fixed",
    dayTheme: "catppuccin",
    nightTheme: "aura",
    dayStartHour: 7,
    nightStartHour: 19,
    checkIntervalMs: 60_000,
    toast: true,
  })
})

test("resolveConfig clamps checkIntervalMs to [MIN, MAX] and floors it", () => {
  assert.equal(resolveConfig({ checkIntervalMs: 0 }).checkIntervalMs, 1_000)
  assert.equal(resolveConfig({ checkIntervalMs: -5 }).checkIntervalMs, 1_000)
  assert.equal(resolveConfig({ checkIntervalMs: 0.5 }).checkIntervalMs, 1_000)
  assert.equal(resolveConfig({ checkIntervalMs: 1_500.9 }).checkIntervalMs, 1_500)
  assert.equal(resolveConfig({ checkIntervalMs: 3_000_000_000 }).checkIntervalMs, 86_400_000)
  assert.equal(resolveConfig({ checkIntervalMs: Number.NaN }).checkIntervalMs, 60_000)
})

test("resolveConfig falls back on hostile theme/hour/toast inputs", () => {
  const c = resolveConfig({
    dayTheme: "",
    nightTheme: 123,
    dayStartHour: -1,
    nightStartHour: 24,
    toast: "yes",
  })
  assert.equal(c.dayTheme, "catppuccin")
  assert.equal(c.nightTheme, "aura")
  assert.equal(c.mode, "fixed")
  assert.ok(c.mode === "fixed")
  assert.equal(c.dayStartHour, 7)
  assert.equal(c.nightStartHour, 19)
  assert.equal(c.toast, true)
})

test("periodFor: normal boundaries (day 7 -> night 19)", () => {
  const cfg = resolveConfig({ dayStartHour: 7, nightStartHour: 19 })
  assert.equal(periodFor(at(6), cfg), "night") // before day start
  assert.equal(periodFor(at(7), cfg), "day") // exactly day start -> day
  assert.equal(periodFor(at(12), cfg), "day")
  assert.equal(periodFor(at(18), cfg), "day") // just before night
  assert.equal(periodFor(at(19), cfg), "night") // exactly night start -> night
  assert.equal(periodFor(at(23), cfg), "night")
})

test("periodFor: wrapped boundaries (day 20 -> night 6, spans midnight)", () => {
  const cfg = resolveConfig({ dayStartHour: 20, nightStartHour: 6 })
  assert.equal(periodFor(at(20), cfg), "day") // day starts
  assert.equal(periodFor(at(23), cfg), "day")
  assert.equal(periodFor(at(0), cfg), "day") // past midnight, still day
  assert.equal(periodFor(at(5), cfg), "day") // just before night
  assert.equal(periodFor(at(6), cfg), "night") // night starts
  assert.equal(periodFor(at(12), cfg), "night")
  assert.equal(periodFor(at(19), cfg), "night") // just before day
})

test("periodFor: equal hours degenerate to day", () => {
  const cfg = resolveConfig({ dayStartHour: 9, nightStartHour: 9 })
  for (let h = 0; h < 24; h++) {
    assert.equal(periodFor(at(h), cfg), "day")
  }
})

// ---------------------------------------------------------------------------
// Solar mode
// ---------------------------------------------------------------------------

test("toLatitude accepts finite values in [-90, 90], rejects the rest", () => {
  assert.equal(toLatitude(42.7, 0), 42.7)
  assert.equal(toLatitude(-90, 99), -90)
  assert.equal(toLatitude(90, 99), 90)
  assert.equal(toLatitude(0, 99), 0)
  assert.equal(toLatitude(-0, 99), -0) // signed zero is a valid latitude
  assert.equal(toLatitude(90.0001, 99), 99)
  assert.equal(toLatitude(-91, 99), 99)
  assert.equal(toLatitude(Number.NaN, 99), 99)
  assert.equal(toLatitude(Number.POSITIVE_INFINITY, 99), 99)
  assert.equal(toLatitude("42.7", 99), 99) // strings are not coerced
  assert.equal(toLatitude(null, 99), 99)
  assert.equal(toLatitude(undefined, 99), 99)
})

test("toLongitude accepts finite values in [-180, 180], rejects the rest", () => {
  assert.equal(toLongitude(23.32, 0), 23.32)
  assert.equal(toLongitude(-180, 99), -180)
  assert.equal(toLongitude(180, 99), 180)
  assert.equal(toLongitude(-74.006, 99), -74.006)
  assert.equal(toLongitude(180.0001, 99), 99)
  assert.equal(toLongitude(-181, 99), 99)
  assert.equal(toLongitude(Number.NaN, 99), 99)
  assert.equal(toLongitude("23", 99), 99)
  assert.equal(toLongitude(undefined, 99), 99)
})

test("resolveConfig: solar mode with valid coordinates", () => {
  const c = resolveConfig({
    mode: "solar",
    latitude: 42.7,
    longitude: 23.32,
    dayTheme: "everforest",
    nightTheme: "tokyonight",
  })
  assert.equal(c.mode, "solar")
  assert.ok(c.mode === "solar")
  assert.equal(c.latitude, 42.7)
  assert.equal(c.longitude, 23.32)
  assert.equal(c.dayTheme, "everforest")
  assert.equal(c.nightTheme, "tokyonight")
  // No fixed-hour fields leak into a solar config.
  assert.ok(!("dayStartHour" in c))
})

test("resolveConfig: solar mode falls back to fixed when coords missing/invalid", () => {
  // Missing longitude.
  const a = resolveConfig({ mode: "solar", latitude: 42.7 })
  assert.equal(a.mode, "fixed")
  assert.ok(a.mode === "fixed")
  assert.equal(a.dayStartHour, 7)
  assert.equal(a.nightStartHour, 19)

  // Out-of-range latitude.
  const b = resolveConfig({ mode: "solar", latitude: 999, longitude: 23.32 })
  assert.equal(b.mode, "fixed")

  // Both missing.
  const d = resolveConfig({ mode: "solar" })
  assert.equal(d.mode, "fixed")
})

test("resolveConfig: solar fallback uses DEFAULT hours, ignoring caller hours", () => {
  // Contract: invalid solar coords fall back to fixed mode with the *default*
  // hours (7/19), not any caller-supplied dayStartHour/nightStartHour.
  const c = resolveConfig({
    mode: "solar",
    latitude: 999,
    longitude: 0,
    dayStartHour: 12,
    nightStartHour: 13,
  })
  assert.equal(c.mode, "fixed")
  assert.ok(c.mode === "fixed")
  assert.equal(c.dayStartHour, 7)
  assert.equal(c.nightStartHour, 19)
})

test("resolveConfig: mode defaults to fixed; unknown mode coerces to fixed", () => {
  assert.equal(resolveConfig({}).mode, "fixed")
  assert.equal(resolveConfig(undefined).mode, "fixed")
  assert.equal(resolveConfig({ mode: "twilight" }).mode, "fixed")
})

// Reference values from api.sunrise-sunset.org (UTC), matched within 5 minutes.
function assertClose(actual: Date | null, expectedIso: string, label: string): void {
  assert.ok(actual !== null, `${label}: expected a Date, got null`)
  const diffMs = Math.abs(actual.getTime() - new Date(expectedIso).getTime())
  assert.ok(
    diffMs <= 5 * 60_000,
    `${label}: ${actual.toISOString()} not within 5 min of ${expectedIso}`,
  )
}

test("sunTimesFor: matches reference sunrise/sunset (Sofia, London, NYC)", () => {
  const sofia = sunTimesFor(new Date(Date.UTC(2026, 8, 16, 12)), 42.6977, 23.3219)
  assertClose(sofia.sunrise, "2026-09-16T04:06:10Z", "Sofia sunrise")
  assertClose(sofia.sunset, "2026-09-16T16:36:59Z", "Sofia sunset")
  assert.equal(sofia.alwaysUp, false)
  assert.equal(sofia.alwaysDown, false)

  const london = sunTimesFor(new Date(Date.UTC(2026, 5, 21, 12)), 51.5074, -0.1278)
  assertClose(london.sunrise, "2026-06-21T03:40:56Z", "London sunrise")
  assertClose(london.sunset, "2026-06-21T20:23:44Z", "London sunset")

  // Western longitude: sunrise/sunset land on the same UTC calendar day.
  const nyc = sunTimesFor(new Date(Date.UTC(2026, 2, 20, 12)), 40.7128, -74.006)
  assert.equal(nyc.sunrise?.getUTCDate(), 20)
  assert.equal(nyc.sunset?.getUTCDate(), 20)
})

test("sunTimesFor: hostile/invalid inputs never yield an Invalid Date", () => {
  // Non-finite date, non-finite or out-of-range coords -> safe polar-night
  // result (never an Invalid Date, so no NaN boundary can propagate).
  const cases: Array<[Date, number, number]> = [
    [new Date(Number.NaN), 42.7, 23.32],
    [new Date(Date.UTC(2026, 2, 20, 12)), Number.NaN, 0],
    [new Date(Date.UTC(2026, 2, 20, 12)), 0, Number.POSITIVE_INFINITY],
    [new Date(Date.UTC(2026, 2, 20, 12)), 999, 0],
    [new Date(Date.UTC(2026, 2, 20, 12)), 0, -999],
  ]
  for (const [d, lat, lon] of cases) {
    const r = sunTimesFor(d, lat, lon)
    assert.equal(r.sunrise, null)
    assert.equal(r.sunset, null)
    assert.equal(r.alwaysUp, false)
    assert.equal(r.alwaysDown, true)
  }
})

test("sunTimesFor: polar day and polar night", () => {
  const summer = sunTimesFor(new Date(Date.UTC(2026, 5, 21, 12)), 69.65, 18.96)
  assert.equal(summer.alwaysUp, true)
  assert.equal(summer.alwaysDown, false)
  assert.equal(summer.sunrise, null)
  assert.equal(summer.sunset, null)

  const winter = sunTimesFor(new Date(Date.UTC(2026, 11, 21, 12)), 69.65, 18.96)
  assert.equal(winter.alwaysDown, true)
  assert.equal(winter.alwaysUp, false)
  assert.equal(winter.sunrise, null)
  assert.equal(winter.sunset, null)
})

test("periodFor: solar mode is day between sunrise and sunset, night otherwise", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 42.6977, longitude: 23.3219 })
  // Sofia 2026-09-16: sunrise ~04:06Z, sunset ~16:37Z.
  const before = new Date(Date.UTC(2026, 8, 16, 3, 0)) // before sunrise
  const morning = new Date(Date.UTC(2026, 8, 16, 5, 0)) // after sunrise
  const noon = new Date(Date.UTC(2026, 8, 16, 12, 0)) // midday
  const evening = new Date(Date.UTC(2026, 8, 16, 18, 0)) // after sunset
  assert.equal(periodFor(before, cfg), "night")
  assert.equal(periodFor(morning, cfg), "day")
  assert.equal(periodFor(noon, cfg), "day")
  assert.equal(periodFor(evening, cfg), "night")
})

test("periodFor: solar mode forces day/night in polar regions", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 69.65, longitude: 18.96 })
  assert.equal(periodFor(new Date(Date.UTC(2026, 5, 21, 2, 0)), cfg), "day") // polar day
  assert.equal(periodFor(new Date(Date.UTC(2026, 11, 21, 12, 0)), cfg), "night") // polar night
})

test("periodFor: solar mode is correct across the UTC-midnight rollover (east/west)", () => {
  // The day/night decision must follow the LOCAL solar day, not the UTC
  // calendar day — otherwise far-east/far-west longitudes flip at 00:00 UTC.

  // Tokyo (UTC+9). 2026-03-20 05:48 local == 2026-03-19T20:48:00Z, just after
  // sunrise: before the fix this was misclassified as "night".
  const tokyo = resolveConfig({ mode: "solar", latitude: 35.6762, longitude: 139.6503 })
  assert.equal(periodFor(new Date("2026-03-19T20:48:00Z"), tokyo), "day")
  // Local 02:00 (deep night) == 2026-03-19T17:00:00Z.
  assert.equal(periodFor(new Date("2026-03-19T17:00:00Z"), tokyo), "night")

  // San Francisco (UTC-7 PDT). 2026-09-16 17:30 local == 2026-09-17T00:30:00Z,
  // just after the UTC rollover but still before sunset: must stay "day".
  const sf = resolveConfig({ mode: "solar", latitude: 37.7749, longitude: -122.4194 })
  assert.equal(periodFor(new Date("2026-09-17T00:30:00Z"), sf), "day")

  // Fiji (UTC+12, near the date line). 2026-06-20 06:39 local ==
  // 2026-06-20T18:39:00Z, just after sunrise: must be "day".
  const fiji = resolveConfig({ mode: "solar", latitude: -18.1248, longitude: 178.4501 })
  assert.equal(periodFor(new Date("2026-06-20T18:39:00Z"), fiji), "day")
})

const H = 3_600_000
const DAY_MS = 24 * H

/** Asserts `change` is the exact first millisecond where the period flips. */
function assertIsBoundary(from: Date, change: Date | null, cfg: ReturnType<typeof resolveConfig>) {
  assert.ok(change, "expected a change")
  assert.ok(change.getTime() > from.getTime())
  assert.notEqual(periodFor(change, cfg), periodFor(from, cfg))
  assert.equal(periodFor(new Date(change.getTime() - 1), cfg), periodFor(from, cfg))
}

test("nextPeriodChange: fixed hours land on the local hour boundary", () => {
  const cfg = resolveConfig({})
  const from = new Date(2026, 0, 1, 6, 30)
  const change = nextPeriodChange(from, cfg, DAY_MS)
  assertIsBoundary(from, change, cfg)
  assert.equal(change?.getHours(), 7)
  assert.ok(change && change.getMinutes() === 0 && change.getSeconds() === 0)
  // From 07:00 exactly, the next change is 19:00.
  assert.equal(nextPeriodChange(change!, cfg, DAY_MS)?.getHours(), 19)
})

test("nextPeriodChange: wrapped hours cross midnight", () => {
  const cfg = resolveConfig({ dayStartHour: 20, nightStartHour: 6 })
  const change = nextPeriodChange(new Date(2026, 0, 1, 22, 0), cfg, DAY_MS)
  assert.equal(change?.getHours(), 6)
  assert.equal(change?.getDate(), 2)
})

test("nextPeriodChange: equal hours never change", () => {
  const cfg = resolveConfig({ dayStartHour: 9, nightStartHour: 9 })
  assert.equal(nextPeriodChange(new Date(2026, 0, 1, 12), cfg, 7 * DAY_MS), null)
})

test("nextPeriodChange: huge horizons stay fast", () => {
  const started = performance.now()
  const now = new Date("2026-06-21T12:00:00Z")
  assert.equal(
    nextPeriodChange(now, resolveConfig({ dayStartHour: 9, nightStartHour: 9 }), Number.MAX_VALUE),
    null,
  )
  assert.ok(nextPeriodChange(now, resolveConfig({}), Number.MAX_VALUE))
  const polar = resolveConfig({ mode: "solar", latitude: 90, longitude: 0 })
  assert.ok(nextPeriodChange(now, polar, Number.MAX_VALUE))
  assert.ok(performance.now() - started < 1_000)
})

test("nextPeriodChange: null when no change within the horizon", () => {
  const cfg = resolveConfig({})
  const from = new Date(2026, 0, 1, 6, 30)
  assert.equal(nextPeriodChange(from, cfg, 29 * 60_000), null)
  assert.ok(nextPeriodChange(from, cfg, 30 * 60_000), "boundary exactly at the horizon counts")
  const at0628 = new Date(2026, 0, 1, 6, 28)
  assert.equal(nextPeriodChange(at0628, cfg, 32 * 60_000)?.getHours(), 7)
  assert.equal(nextPeriodChange(at0628, cfg, 31 * 60_000), null)
  assert.equal(nextPeriodChange(from, cfg, 0), null)
  assert.equal(nextPeriodChange(new Date(Number.NaN), cfg, DAY_MS), null)
})

test("nextPeriodChange: solar sunset in London", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 51.5, longitude: -0.1 })
  const from = new Date("2026-06-21T12:00:00Z")
  const change = nextPeriodChange(from, cfg, DAY_MS)
  assertIsBoundary(from, change, cfg)
  assertClose(change, "2026-06-21T20:22:00Z", "London sunset")
})

test("nextPeriodChange: finds a 12-minute night near polar day (Tromsø)", () => {
  // Shortest period of 2026 at 69.65°N: night 22:34–22:45Z on 2026-05-18.
  const cfg = resolveConfig({ mode: "solar", latitude: 69.65, longitude: 18.96 })
  const from = new Date("2026-05-18T22:20:00Z")
  const dusk = nextPeriodChange(from, cfg, DAY_MS)
  assertIsBoundary(from, dusk, cfg)
  const dawn = nextPeriodChange(dusk!, cfg, DAY_MS)
  assertIsBoundary(dusk!, dawn, cfg)
  assert.ok(dawn!.getTime() - dusk!.getTime() < 15 * 60_000)
})

test("nextPeriodChange: finds a 2-minute night (66.34°N)", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 66.34, longitude: 18.96 })
  const from = new Date("2026-06-08T22:43:00Z")
  const dusk = nextPeriodChange(from, cfg, DAY_MS)
  assertIsBoundary(from, dusk, cfg)
  const dawn = nextPeriodChange(dusk!, cfg, DAY_MS)
  assertIsBoundary(dusk!, dawn, cfg)
  assert.ok(dawn!.getTime() - dusk!.getTime() < 3 * 60_000)
})

test("nextPeriodChange: polar night finds sunrise months ahead", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 78.2, longitude: 15.6 })
  const from = new Date("2026-01-01T12:00:00Z")
  const change = nextPeriodChange(from, cfg, 365 * DAY_MS)
  assertIsBoundary(from, change, cfg)
  assert.equal(change!.getUTCMonth(), 1) // mid-February
})

test("nextPeriodChange: polar day has no change within a day", () => {
  const cfg = resolveConfig({ mode: "solar", latitude: 78.2, longitude: 15.6 })
  assert.equal(nextPeriodChange(new Date("2026-06-21T12:00:00Z"), cfg, DAY_MS), null)
})

test("nextPeriodChange: every boundary in a year matches a minute-by-minute scan", () => {
  for (const options of [
    {},
    { mode: "solar" as const, latitude: 51.5, longitude: -0.1 },
    { mode: "solar" as const, latitude: 69.65, longitude: 18.96 },
    { mode: "solar" as const, latitude: 66.34, longitude: 18.96 },
  ]) {
    const cfg = resolveConfig(options)
    const start = Date.UTC(2026, 0, 1)
    let t = start
    let prev = periodFor(new Date(t), cfg)
    let found = new Date(start)
    let expected = 0
    let got = 0
    for (; t < start + 365 * DAY_MS; t += 60_000) {
      const p = periodFor(new Date(t), cfg)
      if (p === prev) continue
      prev = p
      expected++
      // The helper, stepping from the previous boundary, must find this one.
      // 90-day horizon: Tromsø has ~7 weeks of polar night and ~10 of polar day.
      const next = nextPeriodChange(found, cfg, 90 * DAY_MS)
      assert.ok(next, `missing change before ${new Date(t).toISOString()}`)
      // Within the scan's minute.
      assert.ok(
        t - 60_000 < next.getTime() && next.getTime() <= t,
        `wrong change at ${next.toISOString()}, scan saw ${new Date(t).toISOString()}`,
      )
      found = next
      got++
    }
    assert.equal(got, expected)
  }
})

test("describeError: formats errors and survives hostile values", () => {
  const e = new TypeError("bad")
  assert.equal(describeError(e).message, "TypeError: bad")
  assert.equal(describeError(e).stack, e.stack)
  assert.equal(describeError("plain").message, "plain")
  assert.equal(describeError(Symbol("s")).message, "Symbol(s)")
  assert.equal(describeError(Object.create(null)).message, "Unknown error (could not be described)")
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  assert.equal(describeError(revoked.proxy).message, "Unknown error (could not be described)")
})
