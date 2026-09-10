/**
 * dsh-money-meter — DeepSeek account balance reader.
 *
 * The balance endpoint (`GET /user/balance`) authenticates with a bearer token,
 * so the browser half cannot call it: `ctx.web.fetch` in this deployment takes a
 * URL only, and a direct `fetch()` from the page would be blocked by CORS
 * anyway. The Host therefore reads the key from `ctx.credentials` and performs
 * the request through `ctx.subprocess`.
 *
 * curl is invoked with `-K -` and a curl config file on **stdin**, never with
 * `-H` on the command line: argv is visible to every process on the machine,
 * stdin is not.
 *
 * @module dsh-money-meter/balance
 */

import { tmpdir } from 'node:os'
import process from 'node:process'

/** curl exit status is the only failure signal we need to distinguish. */
const CURL_TIMEOUT_SECONDS = '20'
const STDOUT_CAP = 256 * 1024
const STDERR_CAP = 64 * 1024
const GRACE_MS = 5_000

/** An initial, not-yet-resolved balance state. */
export function pendingBalance() {
  return {
    status: 'loading',
    currency: null,
    total: null,
    toppedUp: null,
    granted: null,
    at: null,
    error: null,
  }
}

/**
 * Strip characters that could break out of the curl config `header = "…"`
 * line. Real API keys never contain them, but the key is interpolated into a
 * config file and a stray quote would otherwise corrupt the request.
 */
function sanitizeToken(value) {
  return String(value).replace(/["\\\r\n]/g, '')
}

/** Candidate working directories for the spawned curl, most specific first. */
function candidateCwds() {
  const list = []
  try {
    list.push(process.cwd())
  } catch {
    /* cwd may be unreadable in exotic deployments */
  }
  try {
    list.push(tmpdir())
  } catch {
    /* no temp dir */
  }
  list.push('/')
  return [...new Set(list)]
}

/**
 * Spawn one curl process, retrying with the next candidate cwd when the
 * current one is rejected.
 * @returns exit code plus the captured streams.
 */
async function runCurl(subprocess, argv, config) {
  const executable = await subprocess.resolveExecutable('curl')
  let lastError
  for (const cwd of candidateCwds()) {
    try {
      const handle = subprocess.spawn({
        argv: [executable, ...argv],
        cwd,
        stdio: {
          stdin: { data: config },
          stdout: { maxBytes: STDOUT_CAP },
          stderr: { maxBytes: STDERR_CAP },
        },
        graceMs: GRACE_MS,
      })
      const outcome = await handle.done
      const read = (reader) => (reader === undefined ? '' : reader.readFrom(0).text)
      return {
        exitCode: outcome.exitCode,
        stdout: read(handle.collected?.stdout),
        stderr: read(handle.collected?.stderr),
      }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError ?? new Error('curl could not be started')
}

/** Pick the CNY row when present, otherwise the first reported currency. */
function pickBalance(infos) {
  return infos.find((info) => info?.currency === 'CNY') ?? infos[0]
}

/**
 * Create a balance reader with its own in-memory state.
 *
 * @param ctx - the Host plugin context, used to resolve services lazily.
 * @param options - credential name and API base URL overrides.
 * @returns `refresh()` to force a read and `current()` to read the cache.
 */
export function createBalanceReader(ctx, options = {}) {
  const credentialName = options.credentialName ?? 'DEEPSEEK_API_KEY'
  const baseUrl = String(options.baseUrl ?? 'https://api.deepseek.com').replace(/\/+$/, '')

  let state = pendingBalance()
  let busy = false

  const setState = (patch) => {
    state = { ...state, ...patch }
  }

  async function refresh() {
    if (busy) return state
    busy = true
    try {
      const credentials = ctx.get('credentials')
      if (credentials === undefined) {
        setState({ status: 'error', error: 'credentials service unavailable' })
        return state
      }
      const subprocess = ctx.get('subprocess')
      if (subprocess === undefined) {
        setState({ status: 'error', error: 'subprocess service unavailable' })
        return state
      }

      const resolved = await credentials.resolve(credentialName)
      if (resolved === undefined || resolved.value === undefined || resolved.value === '') {
        setState({ status: 'error', error: `credential ${credentialName} is not configured` })
        return state
      }

      const config =
        `url = "${baseUrl}/user/balance"\n` +
        `header = "Authorization: Bearer ${sanitizeToken(resolved.value)}"\n`

      const outcome = await runCurl(subprocess, ['-sS', '--max-time', CURL_TIMEOUT_SECONDS, '-K', '-'], config)
      if (outcome.exitCode !== 0) {
        setState({
          status: 'error',
          error: String(outcome.stderr || `curl exited with ${outcome.exitCode}`).slice(0, 300),
        })
        return state
      }

      let payload
      try {
        payload = JSON.parse(outcome.stdout)
      } catch {
        setState({ status: 'error', error: 'balance response is not JSON' })
        return state
      }

      const infos = Array.isArray(payload?.balance_infos) ? payload.balance_infos : []
      if (infos.length === 0) {
        setState({ status: 'error', error: 'balance response carried no balance_infos' })
        return state
      }

      const picked = pickBalance(infos)
      setState({
        status: 'ok',
        currency: String(picked.currency ?? ''),
        total: Number(picked.total_balance),
        toppedUp: Number(picked.topped_up_balance),
        granted: Number(picked.granted_balance),
        at: Date.now(),
        error: null,
      })
      return state
    } catch (error) {
      setState({ status: 'error', error: String(error?.message ?? error).slice(0, 300) })
      return state
    } finally {
      busy = false
    }
  }

  /**
   * Read the cached balance, kicking off a background refresh when the cache is
   * older than `maxAgeMs`. Never blocks the caller.
   */
  function current(maxAgeMs = 60_000) {
    const stale = state.at === null || Date.now() - state.at > maxAgeMs
    if (stale && !busy) void refresh()
    return state
  }

  return { refresh, current }
}
