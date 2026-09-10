/**
 * dsh-money-meter — usage accrual.
 *
 * The Host half folds every `usage` chunk of the `llm/stream` waterfall into
 * four independent views of the same spend:
 *
 *   - `life`     — since this Host plugin was mounted;
 *   - `today`    — since local midnight, reset lazily on the first call of a
 *                  new day (no timer, so a suspended machine cannot skip it);
 *   - `sessions` — per session id, because the dock meter is session-scoped;
 *   - `models`   — per `provider/model` route, for the cost breakdown.
 *
 * Everything here is plain data: the meter never retains a live Session, a
 * stream chunk, or any other runtime object.
 *
 * @module dsh-money-meter/usage
 */

import { DEFAULT_PRICES, costOf } from './pricing.js'

/** A fresh all-zero accumulator. */
function bucket() {
  return { cost: 0, calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
}

/** Add one priced call into an accumulator. */
function add(target, cost, usage) {
  target.cost += cost
  target.calls += 1
  target.input += Number(usage.inputTokens) || 0
  target.output += Number(usage.outputTokens) || 0
  target.cacheRead += Number(usage.cacheReadTokens) || 0
  target.cacheWrite += Number(usage.cacheWriteTokens) || 0
  target.reasoning += Number(usage.reasoningTokens) || 0
}

/** Local calendar day as `YYYY-MM-DD`. */
export function dayKey(now = new Date()) {
  const pad = (value) => (value < 10 ? `0${value}` : String(value))
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** Public shape of one accumulator, with no internal references. */
function view(source) {
  return {
    cost: source.cost,
    calls: source.calls,
    input: source.input,
    output: source.output,
    cacheRead: source.cacheRead,
    cacheWrite: source.cacheWrite,
    reasoning: source.reasoning,
  }
}

/** Usage accrued since the meter was created. */
export class UsageMeter {
  /**
   * @param prices - price table override; merged over {@link DEFAULT_PRICES}.
   */
  constructor(prices = DEFAULT_PRICES) {
    this.prices = prices
    /** @type {Record<string, ReturnType<bucket> & { at: number }>} */
    this.sessions = Object.create(null)
    /** @type {Record<string, ReturnType<bucket> & { key: string, provider: string, model: string }>} */
    this.models = Object.create(null)
    this.today = { ...bucket(), day: '' }
    this.life = bucket()
  }

  /**
   * Fold one model call into every view.
   * @param provider - provider route from the call header.
   * @param model - exact model id from the call header.
   * @param sessionId - owning session, or `''` when the caller named none.
   * @param usage - the `usage` stream chunk's `TokenUsage`.
   */
  record(provider, model, sessionId, usage) {
    const cost = costOf(model, usage, this.prices)

    const day = dayKey()
    if (this.today.day !== day) this.today = { ...bucket(), day }
    add(this.today, cost, usage)
    add(this.life, cost, usage)

    const modelKey = `${provider}/${model}`
    if (this.models[modelKey] === undefined) {
      this.models[modelKey] = { ...bucket(), key: modelKey, provider, model }
    }
    add(this.models[modelKey], cost, usage)

    const sessionKey = sessionId === '' || sessionId === undefined ? 'unknown' : String(sessionId)
    if (this.sessions[sessionKey] === undefined) {
      this.sessions[sessionKey] = { ...bucket(), at: 0 }
    }
    add(this.sessions[sessionKey], cost, usage)
    this.sessions[sessionKey].at = Date.now()
  }

  /**
   * Detached, lossless-JSON snapshot for the browser half.
   * @param sessionId - session whose row the caller wants.
   */
  snapshot(sessionId) {
    const key = sessionId === undefined || sessionId === null || sessionId === '' ? '' : String(sessionId)
    const session = this.sessions[key] ?? { ...bucket(), at: 0 }
    return {
      session: { id: key, ...view(session), at: session.at },
      today: { day: this.today.day, cost: this.today.cost, calls: this.today.calls },
      life: { cost: this.life.cost, calls: this.life.calls },
      models: Object.keys(this.models).map((key0) => {
        const row = this.models[key0]
        return { key: row.key, provider: row.provider, model: row.model, ...view(row) }
      }),
    }
  }
}
