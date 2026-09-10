/**
 * dsh-money-meter — Host half.
 *
 * Contributes three things and no UI:
 *
 *   1. USAGE ACCRUAL — a listener on the `llm/stream` waterfall that passes
 *      every chunk through untouched while folding each `usage` chunk into a
 *      {@link UsageMeter}. Because it wraps the returned async iterable, the
 *      listener is transparent to the agent loop even when it throws.
 *
 *   2. BALANCE — a reader that resolves the DeepSeek API key through
 *      `ctx.credentials` and performs `GET /user/balance` through
 *      `ctx.subprocess` (see `lib/balance.js` for why it cannot be done in the
 *      browser).
 *
 *   3. BRIDGE — the `/dsh-money-meter` loopback channel the browser half polls
 *      (see `lib/rpc.js`).
 *
 * The browser half lives in `./client` and is declared by the `dsh.client`
 * block in package.json.
 *
 * @module dsh-money-meter
 */

import { createBalanceReader } from './lib/balance.js'
import { DEFAULT_PRICES } from './lib/pricing.js'
import { registerMoneyRpc } from './lib/rpc.js'
import { UsageMeter } from './lib/usage.js'

/** Stable cordis plugin name (matches the cordis.patch.yml insert id). */
export const name = 'money-meter'

/**
 * No hard service dependencies: `credentials`, `subprocess`, and `webServer`
 * are each resolved lazily, so a profile lacking any of them still mounts the
 * plugin (with a degraded meter) instead of failing to boot.
 */
export const inject = []

/** First balance read after mount; short, so the pill is populated by first paint. */
const INITIAL_DELAY_MS = 1_200

/** Steady-state balance refresh period. */
const BALANCE_POLL_MS = 180_000

/**
 * Plugin entry.
 * @param ctx - plugin context.
 * @param config - composition-layer overrides (`prices`, `credentialName`, `baseUrl`).
 */
export function apply(ctx, config = {}) {
  const prices = { ...DEFAULT_PRICES, ...(config.prices ?? {}) }
  const meter = new UsageMeter(prices)
  const balance = createBalanceReader(ctx, {
    credentialName: config.credentialName,
    baseUrl: config.baseUrl,
  })

  ctx.on('llm/stream', (options, next) => {
    const provider = String(options?.provider ?? 'unknown')
    const model = String(options?.model ?? 'unknown')
    const sessionId = options?.sessionId === undefined ? '' : String(options.sessionId)
    const inner = next()
    return (async function* accrue() {
      for await (const chunk of inner) {
        if (chunk?.type === 'usage' && chunk.usage) {
          // Accrual is bookkeeping: a malformed usage record must never break
          // the model stream it is riding on.
          try {
            meter.record(provider, model, sessionId, chunk.usage)
          } catch {
            /* ignore */
          }
        }
        yield chunk
      }
    })()
  })

  const snapshot = (payload) => ({
    ok: true,
    generatedAt: Date.now(),
    ...meter.snapshot(payload?.sessionId),
    balance: balance.current(),
  })

  registerMoneyRpc(ctx, {
    snapshot,
    refresh: async (payload) => {
      await balance.refresh()
      const payloadSession = payload ?? {}
      return {
        ok: true,
        generatedAt: Date.now(),
        ...meter.snapshot(payloadSession.sessionId),
        balance: balance.current(0),
      }
    },
  })

  ctx.effect(() => {
    const timer = setTimeout(() => {
      void balance.refresh()
    }, INITIAL_DELAY_MS)
    return () => clearTimeout(timer)
  }, 'money-meter: initial balance read')

  ctx.effect(() => {
    const timer = setInterval(() => {
      void balance.refresh()
    }, BALANCE_POLL_MS)
    return () => clearInterval(timer)
  }, 'money-meter: balance poll')
}
