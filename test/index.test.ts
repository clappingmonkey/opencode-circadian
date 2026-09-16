import assert from "node:assert/strict"
import { test } from "node:test"

import { periodFor, resolveConfig, toHour, toTheme } from "../src/index.ts"

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
  assert.equal(
    resolveConfig({ checkIntervalMs: 3_000_000_000 }).checkIntervalMs,
    86_400_000,
  )
  assert.equal(resolveConfig({ checkIntervalMs: Number.NaN }).checkIntervalMs, 60_000)
})

test("resolveConfig falls back on hostile theme/hour/toast inputs", () => {
  const c = resolveConfig({
    dayTheme: "" as unknown as string,
    nightTheme: 123 as unknown as string,
    dayStartHour: -1,
    nightStartHour: 24,
    toast: "yes" as unknown as boolean,
  })
  assert.equal(c.dayTheme, "catppuccin")
  assert.equal(c.nightTheme, "aura")
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
