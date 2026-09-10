/**
 * Price-table regression tests.
 *
 * `LEDGER` reproduces a real usage ledger written by an independent
 * usage-tracking plugin under `$DSH_HOME/dsh-usage/`: a handful of historical
 * days whose `cost` column was produced by that plugin, not by this one.
 * Reproducing it from token counts alone is what pins the table in
 * `lib/pricing.js` to reality.
 *
 * Calendar dates and any account-identifying detail are deliberately omitted —
 * they carry no mathematical weight here, and the point of the fixture is the
 * token-to-cost relationship, not when it was observed.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { DEFAULT_PRICES, FALLBACK_PRICE, costOf, priceFor } from '../lib/pricing.js'
import { UsageMeter, dayKey } from '../lib/usage.js'

/** Independent observation: provider-reported cost per (model, tokens). */
const LEDGER = [
  { label: 'flash sample 1', model: 'deepseek-v4-flash', input: 16122, output: 1398, cacheRead: 0, cost: 0.030474 },
  { label: 'flash sample 2', model: 'deepseek-v4-flash', input: 214, output: 485, cacheRead: 38272, cost: 0.004417 },
  { label: 'pro sample 1', model: 'deepseek-v4-pro', input: 32505, output: 7598, cacheRead: 470272, cost: 0.319389 },
  { label: 'flash sample 3', model: 'deepseek-v4-flash', input: 106760, output: 180608, cacheRead: 20285696, cost: 1.987164 },
  { label: 'flash sample 4', model: 'deepseek-v4-flash', input: 724676, output: 816261, cacheRead: 394848128, cost: 24.502624 },
  { label: 'pro sample 2', model: 'deepseek-v4-pro', input: 12153, output: 4997, cacheRead: 7168, cost: 0.123223 },
]

/** Relative tolerance: the ledger's own float accumulation drifts at ~1e-6. */
const RELATIVE_TOLERANCE = 1e-4

test('reproduces every historical ledger row', () => {
  for (const row of LEDGER) {
    const actual = costOf(row.model, {
      inputTokens: row.input,
      outputTokens: row.output,
      cacheReadTokens: row.cacheRead,
    })
    const relative = Math.abs(actual - row.cost) / row.cost
    assert.ok(
      relative < RELATIVE_TOLERANCE,
      `${row.label}: expected ${row.cost}, computed ${actual} (relative error ${relative})`,
    )
  }
})

test('fallback price applies to an unknown model', () => {
  assert.deepEqual(priceFor('some-unreleased-model'), FALLBACK_PRICE)
  assert.equal(
    costOf('some-unreleased-model', { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }),
    1.5,
  )
})

test('reasoning tokens are not charged twice', () => {
  const withoutReasoning = costOf('deepseek-v4-pro', { inputTokens: 0, outputTokens: 1000 })
  const withReasoning = costOf('deepseek-v4-pro', { inputTokens: 0, outputTokens: 1000, reasoningTokens: 5000 })
  assert.equal(withReasoning, withoutReasoning)
})

test('missing or malformed usage prices to zero, never NaN', () => {
  assert.equal(costOf('deepseek-v4-pro', undefined), 0)
  assert.equal(costOf('deepseek-v4-pro', null), 0)
  assert.equal(costOf('deepseek-v4-pro', {}), 0)
  assert.equal(costOf('deepseek-v4-pro', { inputTokens: 'x', outputTokens: null }), 0)
})

test('every model in the shipped settings has a real entry, not the fallback', () => {
  for (const model of ['deepseek-v4-flash', 'deepseek-flash', 'deepseek-v4-pro', 'deepseek-v4-flash-vision-exp']) {
    assert.ok(Object.hasOwn(DEFAULT_PRICES, model), `${model} has no explicit price row`)
  }
})

test('the meter fans one call out into session, day, lifetime and model views', () => {
  const meter = new UsageMeter()
  const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0 }
  meter.record('deepseek-official', 'deepseek-v4-flash', 'session-a', usage)

  const snapshot = meter.snapshot('session-a')
  assert.equal(snapshot.session.cost, 6)
  assert.equal(snapshot.session.calls, 1)
  assert.equal(snapshot.today.cost, 6)
  assert.equal(snapshot.today.day, dayKey())
  assert.equal(snapshot.life.cost, 6)
  assert.deepEqual(
    snapshot.models.map((row) => row.key),
    ['deepseek-official/deepseek-v4-flash'],
  )

  // A different session has its own row and does not inherit session-a's spend.
  const other = meter.snapshot('session-b')
  assert.equal(other.session.cost, 0)
  assert.equal(other.today.cost, 6)

  // A session-less call lands in the 'unknown' bucket rather than throwing.
  meter.record('deepseek-official', 'deepseek-v4-pro', undefined, usage)
  assert.equal(meter.snapshot('unknown').session.calls, 1)
  assert.equal(meter.snapshot('session-a').session.calls, 1)
})

test('snapshots are detached plain data', () => {
  const meter = new UsageMeter()
  meter.record('deepseek-official', 'deepseek-v4-pro', 's', { inputTokens: 10 })
  const snapshot = meter.snapshot('s')
  assert.doesNotThrow(() => JSON.stringify(snapshot))
  snapshot.session.cost = 999
  assert.notEqual(meter.snapshot('s').session.cost, 999)
})
