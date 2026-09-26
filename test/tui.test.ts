// Tests for the `tui` closure: timers, lifecycle and theme switching, driven
// through a fake host API and node:test mock timers.
import assert from "node:assert/strict"
import { test, type TestContext } from "node:test"

import type { TuiPluginApi, TuiPluginMeta, TuiToast } from "@opencode-ai/plugin/tui"

import plugin from "../src/index.ts"

const MIN = 60_000
const DAY = "catppuccin"
const NIGHT = "aura"

interface FakeOptions {
  ready?: boolean
  selected?: string
  installed?: string[]
  setResult?: boolean
}

function fakeApi(opts: FakeOptions = {}) {
  const state = {
    ready: opts.ready ?? true,
    selected: opts.selected ?? "other",
    installed: new Set(opts.installed ?? [DAY, NIGHT, "other"]),
    setResult: opts.setResult ?? true,
    hasThrows: false,
    readyReads: 0,
    sets: [] as string[],
    toasts: [] as TuiToast[],
    disposers: [] as (() => void | Promise<void>)[],
  }
  const controller = new AbortController()
  const api = {
    theme: {
      get ready() {
        state.readyReads++
        return state.ready
      },
      get selected() {
        return state.selected
      },
      has(name: string) {
        if (state.hasThrows) throw new Error("host gone")
        return state.installed.has(name)
      },
      set(name: string) {
        state.sets.push(name)
        if (state.setResult) state.selected = name
        return state.setResult
      },
    },
    ui: {
      toast(input: TuiToast) {
        state.toasts.push(input)
      },
    },
    lifecycle: {
      signal: controller.signal,
      onDispose(fn: () => void | Promise<void>) {
        state.disposers.push(fn)
        return () => {}
      },
    },
  } as unknown as TuiPluginApi
  return { api, state, controller }
}

/** 2026-01-01 hh:mm local time, as epoch ms. */
const local = (hh: number, mm: number) => new Date(2026, 0, 1, hh, mm).getTime()

/** Start the plugin with mocked timers; defaults to 06:30 local (night). */
async function start(
  t: TestContext,
  api: TuiPluginApi,
  options: Record<string, unknown> = {},
  now: number = local(6, 30),
) {
  t.mock.timers.enable({ apis: ["Date", "setInterval", "setTimeout"], now })
  await plugin.tui(api, { checkIntervalMs: MIN, ...options }, {} as TuiPluginMeta)
}

const infoToasts = (s: { toasts: TuiToast[] }) => s.toasts.filter((x) => x.variant === "info")
const warnToasts = (s: { toasts: TuiToast[] }) => s.toasts.filter((x) => x.variant === "warning")

test("tui: startup with the wrong theme switches it and toasts once", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  await start(t, api)
  assert.deepEqual(state.sets, [NIGHT])
  assert.equal(infoToasts(state).length, 1)
  assert.match(infoToasts(state)[0].message, /night theme/)
})

test("tui: daytime startup switches to the day theme", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api, {}, local(12, 0))
  assert.deepEqual(state.sets, [DAY])
  assert.match(infoToasts(state)[0].message, /day theme/)
})

test("tui: startup with the right theme does nothing", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  t.mock.timers.tick(10 * MIN)
  assert.deepEqual(state.sets, [])
  assert.deepEqual(state.toasts, [])
})

test("tui: toast: false switches without an info toast", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  await start(t, api, { toast: false })
  assert.deepEqual(state.sets, [NIGHT])
  assert.equal(infoToasts(state).length, 0)
})

test("tui: a manual theme change survives until the next boundary", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  state.selected = "other" // user runs /theme at 06:30
  t.mock.timers.tick(20 * MIN) // 06:50, still night
  assert.deepEqual(state.sets, [])
  assert.equal(state.selected, "other")
  t.mock.timers.tick(10 * MIN) // 07:00, day starts
  assert.deepEqual(state.sets, [DAY])
  assert.equal(infoToasts(state).length, 1)
})

test("tui: not-ready retries every 250 ms, then applies", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  assert.equal(state.readyReads, 1)
  // Step in 250 ms: mock tick() jumps the clock first, so a timer re-armed
  // inside a callback only fires on a later tick().
  t.mock.timers.tick(249)
  assert.equal(state.readyReads, 1, "retry is 250 ms, not sooner")
  for (let i = 0; i < 4; i++) t.mock.timers.tick(i === 0 ? 1 : 250)
  // One pending retry at a time: exactly 4 retries in the first second.
  assert.equal(state.readyReads, 5)
  assert.deepEqual(state.sets, [])
  state.ready = true
  t.mock.timers.tick(250)
  assert.deepEqual(state.sets, [NIGHT])
  const reads = state.readyReads
  t.mock.timers.tick(1_000)
  assert.equal(state.readyReads, reads, "no retries after success")
})

test("tui: interval ticks don't stack extra ready retries", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api, { checkIntervalMs: 1_000 })
  const reads: number[] = []
  for (let i = 0; i < 12; i++) {
    t.mock.timers.tick(250)
    reads.push(state.readyReads)
  }
  // Per second: 4 retries + 1 interval tick. Stacked retries would grow this.
  assert.equal(reads[11] - reads[7], 5)
})

test("tui: a failed set is retried on the next interval", async (t) => {
  const { api, state } = fakeApi({ selected: DAY, setResult: false })
  await start(t, api)
  assert.deepEqual(state.sets, [NIGHT])
  t.mock.timers.tick(MIN - 1)
  assert.equal(state.sets.length, 1, "no fast retry for failed")
  t.mock.timers.tick(1)
  assert.deepEqual(state.sets, [NIGHT, NIGHT])
  state.setResult = true
  t.mock.timers.tick(MIN)
  assert.equal(state.selected, NIGHT)
  t.mock.timers.tick(5 * MIN)
  assert.equal(state.sets.length, 3, "stops once applied")
})

test("tui: a missing theme warns once per period", async (t) => {
  const { api, state } = fakeApi({ installed: [DAY, "other"] })
  await start(t, api)
  assert.equal(warnToasts(state).length, 1)
  assert.match(warnToasts(state)[0].message, /"aura" is not installed/)
  t.mock.timers.tick(20 * MIN) // 06:50
  assert.equal(warnToasts(state).length, 1)
  assert.deepEqual(state.sets, [])
  t.mock.timers.tick(10 * MIN) // 07:00
  assert.deepEqual(state.sets, [DAY])
})

test("tui: solar mode without coordinates warns and uses fixed hours", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  await start(t, api, { mode: "solar" })
  assert.equal(warnToasts(state).length, 1)
  assert.match(warnToasts(state)[0].message, /Solar mode needs valid latitude\/longitude/)
  assert.deepEqual(state.sets, [NIGHT]) // 06:30 is night under the 7-19 defaults
})

test("tui: solar mode switches at sunrise", async (t) => {
  // London, 2026-06-21: sunrise ~03:44Z. Absolute instants, so TZ-independent.
  const { api, state } = fakeApi({ selected: DAY })
  await start(t, api, { mode: "solar", latitude: 51.5, longitude: -0.1 }, Date.UTC(2026, 5, 21, 3, 0))
  assert.equal(warnToasts(state).length, 0)
  assert.deepEqual(state.sets, [NIGHT])
  t.mock.timers.tick(30 * MIN) // 03:30Z, still night
  assert.deepEqual(state.sets, [NIGHT])
  t.mock.timers.tick(30 * MIN) // 04:00Z, after sunrise
  assert.deepEqual(state.sets, [NIGHT, DAY])
})

test("tui: an already-aborted signal starts nothing", async (t) => {
  const { api, state, controller } = fakeApi({ selected: DAY })
  controller.abort()
  await start(t, api)
  t.mock.timers.tick(24 * 60 * MIN)
  assert.deepEqual(state.sets, [])
  assert.deepEqual(state.toasts, [])
  assert.equal(state.readyReads, 0)
})

test("tui: abort clears the interval and a pending retry", async (t) => {
  const { api, state, controller } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  controller.abort()
  const reads = state.readyReads
  state.ready = true
  t.mock.timers.tick(24 * 60 * MIN)
  assert.equal(state.readyReads, reads)
  assert.deepEqual(state.sets, [])
})

test("tui: dispose clears the interval and a pending retry", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  assert.equal(state.disposers.length, 1)
  await state.disposers[0]()
  const reads = state.readyReads
  state.ready = true
  t.mock.timers.tick(24 * 60 * MIN)
  assert.equal(state.readyReads, reads)
  assert.deepEqual(state.sets, [])
})

test("tui: abort then dispose is safe", async (t) => {
  const { api, state, controller } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  controller.abort()
  await state.disposers[0]()
  t.mock.timers.tick(24 * 60 * MIN)
  assert.deepEqual(state.sets, [])
})

// Host errors must never crash opencode; the next tick retries.
test("tui: a throwing host API is swallowed and the next tick retries", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  state.hasThrows = true
  await start(t, api)
  assert.deepEqual(state.sets, [])
  state.hasThrows = false
  t.mock.timers.tick(MIN)
  assert.deepEqual(state.sets, [NIGHT])
})
