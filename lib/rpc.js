/**
 * dsh-money-meter — Host side of the browser bridge.
 *
 * The browser half needs two Host-owned facts it cannot obtain itself: the
 * per-call token usage (accrued from the `llm/stream` waterfall) and the DeepSeek
 * account balance (which requires the API key). Both are served over a single
 * loopback channel, `/dsh-money-meter`.
 *
 * The channel is an ordinary `ctx.webServer` prefix route speaking the envelope
 * the browser transport already understands — a POSTed
 * `{ type: 'client-request', rpcId, method, payload }` answered with
 * `{ type: 'server-response', rpcId, result }` where `result` is
 * `{ ok: true, value }` or `{ ok: false, error: { code, message, details } }`.
 * Connection's Host/Origin fence is applied through
 * `connection.requestRejection` when the profile mounts that service.
 *
 * @module dsh-money-meter/rpc
 */

/** Logical channel owned by this plugin. */
export const MONEY_RPC_CHANNEL = '/dsh-money-meter'

/** Endpoints this channel answers. */
const ENDPOINTS = new Set(['snapshot', 'refresh'])

/** Every payload here is a session id, so the cap sits far below the bridge's. */
const MAX_BODY_BYTES = 64 * 1024

/** Success branch. */
export function ok(value) {
  return { ok: true, value }
}

/** Error branch (internal code; details stay empty for this channel). */
export function err(message) {
  return { ok: false, error: { code: 'internal', message, details: {} } }
}

/** Write one JSON response. */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/** Buffer the request body, returning `undefined` past the cap. */
async function readBody(req) {
  const chunks = []
  let received = 0
  for await (const chunk of req) {
    received += chunk.byteLength
    if (received > MAX_BODY_BYTES) return undefined
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** The endpoint segment of one request below the channel prefix, if any. */
function endpointFrom(url) {
  const pathname = new URL(url ?? '/', 'http://dsh.internal').pathname
  if (!pathname.startsWith(`${MONEY_RPC_CHANNEL}/`)) return undefined
  const endpoint = pathname.slice(MONEY_RPC_CHANNEL.length + 1)
  return endpoint.includes('/') ? undefined : endpoint
}

/**
 * Answer one channel request: apply the fence, decode the `client-request`
 * envelope, dispatch, and encode the `server-response`.
 */
async function serve(req, res, handler, requestRejection) {
  const rejection = requestRejection?.(req)
  if (rejection !== undefined) {
    res.writeHead(rejection)
    res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' })
    res.end('method not allowed')
    return
  }
  const endpoint = endpointFrom(req.url)
  if (endpoint === undefined || !ENDPOINTS.has(endpoint)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const raw = await readBody(req)
  if (raw === undefined) {
    res.writeHead(413)
    res.end('request body too large')
    return
  }
  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch {
    res.writeHead(400)
    res.end('body is not JSON')
    return
  }
  if (typeof envelope !== 'object' || envelope === null || envelope.type !== 'client-request' || typeof envelope.rpcId !== 'string') {
    res.writeHead(400)
    res.end('invalid client-request message')
    return
  }
  if (envelope.method !== endpoint) {
    writeJson(res, 200, {
      type: 'server-response',
      rpcId: envelope.rpcId,
      result: err(`method ${JSON.stringify(String(envelope.method))} does not match endpoint ${JSON.stringify(endpoint)}`),
    })
    return
  }
  const result = await handler(endpoint, envelope.payload, new AbortController().signal)
  writeJson(res, 200, { type: 'server-response', rpcId: envelope.rpcId, result })
}

/**
 * Mount the plugin's channel.
 *
 * `webServer` is injected rather than read with `ctx.get`, so a profile without
 * a browser carrier (a headless CLI, say) simply never mounts the route while
 * the Host meter keeps accruing.
 *
 * @param ctx - Host plugin context.
 * @param deps - `snapshot(payload)` and `refresh(payload)` implementations.
 */
export function registerMoneyRpc(ctx, deps) {
  ctx.inject(['webServer'], (scope) => {
    const webServer = scope.webServer
    // Optional: a profile without the connection service still serves the
    // route, but then the Host/Origin fence cannot be applied.
    const connection = scope.get('connection')

    const handler = async (endpoint, payload) => {
      try {
        switch (endpoint) {
          case 'snapshot':
            return ok(deps.snapshot(payload))
          case 'refresh':
            return ok(await deps.refresh(payload))
          default:
            return err(`unknown endpoint: ${String(endpoint)}`)
        }
      } catch (error) {
        return err(String(error?.message ?? error))
      }
    }

    scope.effect(() => {
      const dispose = webServer.register({
        kind: 'prefix',
        path: MONEY_RPC_CHANNEL,
        handler: (req, res) =>
          serve(req, res, handler, connection === undefined ? undefined : (request) => connection.requestRejection(request)),
      })
      return () => {
        dispose()
      }
    }, 'money-meter: rpc route')
  })
}
