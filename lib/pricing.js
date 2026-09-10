/**
 * dsh-money-meter — price table and cost math.
 *
 * Costs are expressed in CNY per **one million** tokens, the unit every
 * provider quotes. The table below was reverse-engineered from a real usage
 * ledger written by an independent tracking plugin under
 * `$DSH_HOME/dsh-usage/`, and reproduces every historical row to a relative
 * error below 1e-4 (see `tests/pricing.test.js`).
 *
 * @module dsh-money-meter/pricing
 */

/** Fallback price used for any model this table does not name. */
export const FALLBACK_PRICE = Object.freeze({ input: 1.5, output: 4.5, cacheRead: 0.05 })

/** Default CNY-per-million-token prices, keyed by exact model id. */
export const DEFAULT_PRICES = Object.freeze({
  'deepseek-v4-flash': { input: 1.5, output: 4.5, cacheRead: 0.05 },
  'deepseek-flash': { input: 1.5, output: 4.5, cacheRead: 0.05 },
  'deepseek-v4-flash-vision-exp': { input: 1.5, output: 4.5, cacheRead: 0.05 },
  'deepseek-v4-pro': { input: 4.5, output: 13.5, cacheRead: 0.15 },
  'deepseek-pro': { input: 4.5, output: 13.5, cacheRead: 0.15 },
})

/**
 * Resolve the price row for one model id.
 * @param model - exact model id from the call header.
 * @param prices - price table to consult; defaults to {@link DEFAULT_PRICES}.
 * @returns the model's price row, or {@link FALLBACK_PRICE} when unknown.
 */
export function priceFor(model, prices = DEFAULT_PRICES) {
  const row = prices[model]
  return row === undefined ? FALLBACK_PRICE : row
}

/**
 * Price one usage record.
 *
 * Reasoning tokens are deliberately excluded: providers bill them inside
 * `outputTokens`, and adding them again would double-charge every reasoning
 * step.
 * @param model - exact model id from the call header.
 * @param usage - a `TokenUsage` object as delivered by the `usage` stream chunk.
 * @param prices - price table to consult; defaults to {@link DEFAULT_PRICES}.
 * @returns the call's cost in CNY.
 */
export function costOf(model, usage, prices = DEFAULT_PRICES) {
  if (usage === null || usage === undefined || typeof usage !== 'object') return 0
  const price = priceFor(model, prices)
  const input = Number(usage.inputTokens) || 0
  const output = Number(usage.outputTokens) || 0
  const cacheRead = Number(usage.cacheReadTokens) || 0
  return (input * price.input + output * price.output + cacheRead * price.cacheRead) / 1_000_000
}
