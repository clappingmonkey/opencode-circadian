// Tests for the `tui` closure: timers, lifecycle and theme switching, driven
// through a fake host API and node:test mock timers.
import assert from "node:assert/strict"
import { type TestContext, test } from "node:test"

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
  logRejects?: boolean
}

function fakeApi(opts: FakeOptions = {}) {
  const state = {
    ready: opts.ready ?? true,
    selected: opts.selected ?? "other",
    installed: new Set(opts.installed ?? [DAY, NIGHT, "other"]),
    setResult: opts.setResult ?? true,
    hasThrows: false as boolean | string,
    thrown: undefined as unknown,
    abortOnHas: false,
    toastThrows: false,
    readyReads: 0,
    logs: [] as { service?: string; level?: string; message?: string }[],
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
        if (state.abortOnHas) controller.abort()
        if (state.thrown !== undefined) throw state.thrown
        if (state.hasThrows)
          throw new Error(state.hasThrows === true ? "host gone" : state.hasThrows)
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
        if (state.toastThrows) throw new Error("toast down")
        state.toasts.push(input)
      },
    },
    client: {
      app: {
        log(input: { service?: string; level?: string; message?: string }) {
          state.logs.push(input)
          return opts.logRejects ? Promise.reject(new Error("log down")) : Promise.resolve({})
        },
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

test("tui: not-ready retries back off from 250 ms", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  assert.equal(state.readyReads, 1)
  // Mock tick() jumps the clock first, so a timer re-armed inside a callback
  // only fires on a later tick(). Step to each expected retry.
  let reads = 1
  for (const ms of [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000]) {
    t.mock.timers.tick(ms - 1)
    assert.equal(state.readyReads, reads, `not before ${ms} ms`)
    t.mock.timers.tick(1)
    assert.equal(state.readyReads, ++reads, `retry after ${ms} ms`)
  }
  assert.deepEqual(state.sets, [])
  state.ready = true
  t.mock.timers.tick(32_000)
  assert.deepEqual(state.sets, [NIGHT])
  reads = state.readyReads
  t.mock.timers.tick(10_000)
  assert.equal(state.readyReads, reads, "no retries after success")
})

test("tui: the ready backoff resets once the theme system is ready", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api)
  for (const ms of [250, 500, 1_000, 2_000]) t.mock.timers.tick(ms)
  state.ready = true
  t.mock.timers.tick(4_000) // ready: applies night
  assert.deepEqual(state.sets, [NIGHT])
  // At 07:00 the host is indexing again: the first retry is 250 ms again.
  state.ready = false
  t.mock.timers.setTime(local(7, 0) - 1)
  t.mock.timers.tick(1)
  const reads = state.readyReads
  t.mock.timers.tick(250)
  assert.equal(state.readyReads, reads + 1)
})

test("tui: interval ticks don't stack extra ready retries", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  await start(t, api, { checkIntervalMs: 1_000 })
  for (let i = 0; i < 40; i++) t.mock.timers.tick(250)
  const before = state.readyReads
  for (let i = 0; i < 40; i++) t.mock.timers.tick(250)
  // Backoff is capped at 1 s: one retry + one interval tick per second.
  // Stacked retries would grow this.
  assert.ok(state.readyReads - before <= 20, `${state.readyReads - before} reads in 10 s`)
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
  await start(
    t,
    api,
    { mode: "solar", latitude: 51.5, longitude: -0.1 },
    Date.UTC(2026, 5, 21, 3, 0),
  )
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

test("tui: unexpected errors are logged once each, with one toast", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  state.hasThrows = true
  await start(t, api)
  t.mock.timers.tick(5 * MIN) // same error on every tick
  state.hasThrows = "other failure"
  t.mock.timers.tick(MIN)
  assert.deepEqual(
    state.logs.map((l) => [l.service, l.level, l.message]),
    [
      ["opencode-circadian", "error", "Error: host gone"],
      ["opencode-circadian", "error", "Error: other failure"],
    ],
  )
  assert.equal(warnToasts(state).length, 1)
  assert.match(warnToasts(state)[0].message, /opencode log/)
})

test("tui: a failing logger never throws into the host", async (t) => {
  const { api, state } = fakeApi({ selected: DAY, logRejects: true })
  state.hasThrows = true
  await start(t, api)
  await new Promise((resolve) => setImmediate(resolve)) // let the rejection settle
  assert.equal(state.logs.length, 1)
  state.hasThrows = false
  t.mock.timers.tick(MIN)
  assert.deepEqual(state.sets, [NIGHT])
})

test("tui: errors during teardown are not reported", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  state.abortOnHas = true // host shuts down mid-tick
  state.hasThrows = true
  await start(t, api)
  assert.deepEqual(state.logs, [])
  assert.deepEqual(state.toasts, [])
})

test("tui: an abort during the first tick leaves no timers running", async (t) => {
  const { api, state } = fakeApi({ ready: false, selected: DAY })
  state.abortOnHas = true
  state.ready = true
  await start(t, api)
  const reads = state.readyReads
  t.mock.timers.tick(24 * 60 * MIN)
  assert.equal(state.readyReads, reads)
})

test("tui: a throwing toast while reporting never escapes", async (t) => {
  const { api, state } = fakeApi({ selected: DAY })
  state.hasThrows = true
  state.toastThrows = true
  await start(t, api) // must not reject
  t.mock.timers.tick(MIN)
  assert.equal(state.logs.length, 1)
})

test("tui: hostile thrown values never escape", async (t) => {
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  const badName = new Error("x")
  Object.defineProperty(badName, "name", {
    get() {
      throw new Error("no name")
    },
  })
  const hostile: unknown[] = [
    revoked.proxy,
    {
      toString() {
        throw new Error("no string")
      },
    },
    Object.create(null),
    Symbol("s"),
    null,
    badName,
  ]
  for (const thrown of hostile) {
    const { api, state } = fakeApi({ selected: DAY })
    state.thrown = thrown
    t.mock.timers.reset()
    await start(t, api) // must not reject
    t.mock.timers.tick(MIN) // must not throw from a timer
    assert.equal(state.logs.length, 1)
    assert.equal(warnToasts(state).length, 1)
  }
})

// Sleep: the clock jumps without timers firing, then overdue timers run.
function sleepUntil(t: TestContext, when: number) {
  t.mock.timers.setTime(when)
  t.mock.timers.tick(0)
}

test("tui: waking after crossing two boundaries re-applies the theme", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  state.selected = "other" // manual /theme at 06:30
  sleepUntil(t, local(6, 30) + 24 * 60 * MIN) // next day 06:30, night again
  assert.deepEqual(state.sets, [NIGHT])
  assert.equal(state.selected, NIGHT)
})

test("tui: a failed apply after waking is still retried", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  state.selected = "other"
  state.setResult = false
  sleepUntil(t, local(6, 30) + 24 * 60 * MIN)
  assert.ok(state.sets.length > 0 && state.sets.every((s) => s === NIGHT))
  state.setResult = true
  t.mock.timers.tick(MIN)
  assert.equal(state.selected, NIGHT)
})

test("tui: waking after crossing one boundary switches", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  sleepUntil(t, local(12, 0))
  assert.deepEqual(state.sets, [DAY])
})

test("tui: a short sleep inside a period keeps a manual theme", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api)
  state.selected = "other"
  sleepUntil(t, local(6, 50))
  t.mock.timers.tick(MIN)
  assert.deepEqual(state.sets, [])
  assert.equal(state.selected, "other")
})

test("tui: switches on time with a 24h check interval", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api, { checkIntervalMs: 24 * 60 * MIN })
  t.mock.timers.tick(30 * MIN - 1) // 06:59:59.999
  assert.deepEqual(state.sets, [])
  t.mock.timers.tick(1) // 07:00
  assert.deepEqual(state.sets, [DAY])
  state.selected = "other" // manual change during the day
  t.mock.timers.tick(12 * 60 * MIN - 1) // 18:59:59.999
  assert.equal(state.selected, "other")
  t.mock.timers.tick(1) // 19:00
  assert.deepEqual(state.sets, [DAY, NIGHT])
})

test("tui: a 13h check interval doesn't skip a period", async (t) => {
  const { api, state } = fakeApi({ selected: NIGHT })
  await start(t, api, { checkIntervalMs: 13 * 60 * MIN })
  for (let i = 0; i < 3 * 24; i++) t.mock.timers.tick(60 * MIN)
  assert.deepEqual(state.sets, [DAY, NIGHT, DAY, NIGHT, DAY, NIGHT])
})

test("tui: solar mode switches at sunset with a 24h check interval", async (t) => {
  // London, 2026-06-21: sunset ~20:22Z.
  const { api, state } = fakeApi({ selected: DAY })
  await start(
    t,
    api,
    { mode: "solar", latitude: 51.5, longitude: -0.1, checkIntervalMs: 24 * 60 * MIN },
    Date.UTC(2026, 5, 21, 12, 0),
  )
  t.mock.timers.tick(8 * 60 * MIN + 20 * MIN) // 20:20Z
  assert.deepEqual(state.sets, [])
  t.mock.timers.tick(5 * MIN) // 20:25Z
  assert.deepEqual(state.sets, [NIGHT])
})
