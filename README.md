# dsh-money-meter

A DeepSeek Harness plugin that shows **what this conversation has cost** and **how
much is left in the account**, on the composer's stats row.

```
  [¥ 消耗 ¥0.0568 · 剩余 ¥85.04]        [2 轮 40 步 · 242 tok/s] [4.1M tok · 缓存命中 97%]
```

Clicking the pill opens a detail card **upward** — the same interaction the built-in
「会话统计」pill uses — so neither mounting nor expanding moves the composer.

## What it shows

| Row | Meaning |
| --- | --- |
| 本次会话消耗 | Cost of the current session, accrued while the plugin has been mounted |
| 今日消耗 | Cost since local midnight |
| 运行以来 | Cost since the plugin mounted |
| 输入 / 输出 / 缓存读 tokens | The session's token split |
| 账户余额 | `total_balance` from `GET /user/balance`, in CNY when the account reports it |
| 余额更新 | Wall-clock time of the last successful balance read |
| per-model rows | Top five `provider/model` routes by cost |

The pill turns amber when the balance is at or below ¥10.

## Install

```bash
dsh plugin --profile web add <path-or-git-url>
```

Then restart DSH. `dsh plugin` forwards to pnpm inside the profile and reconciles
`dsh.profile.bundles` on success; the bundle patch in `cordis.patch.yml` mounts both
halves from the single `money-meter` row.

For a local checkout:

```bash
dsh plugin --profile web add <path-to-this-checkout>
```

## How it works

```
Host  index.js
  ├─ llm/stream waterfall ──▶ lib/usage.js   (one usage chunk → session/day/life/model views)
  ├─ lib/balance.js        ──▶ ctx.credentials + ctx.subprocess (curl -K -)
  └─ lib/rpc.js            ──▶ POST /dsh-money-meter  {snapshot, refresh}
                                    ▲
Client  client.js                   │ connection.rpc.call(...)
  └─ conversation.composer.dock ────┘
```

Three details worth knowing:

- **The balance cannot be read from the browser.** The endpoint needs a bearer
  token, `ctx.web.fetch` takes a URL only, and a page-initiated request would hit
  CORS. The Host reads the key from `ctx.credentials` and shells out to curl with
  the credential on **stdin** (`curl -K -`), never on argv — argv is visible to
  every process on the machine.
- **The pill rides the stats row instead of adding one.** Its root is a zero-height
  flex item alongside the stats row; the pill is absolutely positioned onto that
  row's left edge true to the row's own box model. The row then reserves space with
  `[data-composer-stats]:has(+ .dsh-mm)`, using a `--dsh-mm-reserve` value measured
  from the rendered pill — so the reservation tracks the real number width instead
  of a hard-coded guess.
- **The panel is an overlay, not a layout child.** It is absolutely positioned
  above the pill, mirroring the built-in dialog's tokens
  (`--dsw-specific-menu`, `--dsw-elevation-prominent`, 12 px radius, 16 px padding,
  `dt`/`dd` grid).

## Pricing

Costs are CNY per **one million** tokens:

| model | input | output | cache read |
| --- | --- | --- | --- |
| `deepseek-v4-flash`, `deepseek-flash`, `deepseek-v4-flash-vision-exp` | 1.5 | 4.5 | 0.05 |
| `deepseek-v4-pro`, `deepseek-pro` | 4.5 | 13.5 | 0.15 |
| anything else | 1.5 | 4.5 | 0.05 |

Reasoning tokens are **not** charged separately: providers bill them inside
`outputTokens`, and `tests/pricing.test.js` pins that behaviour.

Override the table through the composition row:

```yaml
- id: money-meter
  name: 'dsh-money-meter'
  config:
    prices:
      some-model: { input: 2, output: 8, cacheRead: 0.5 }
    credentialName: MY_API_KEY
    baseUrl: https://api.deepseek.com
```

## Verify

```bash
npm run verify     # static check + regression tests
```

`scripts/check.mjs` imports every module and factory-executes the browser bundle
against a stub `react`, so a bundle that would fail in the page fails here first.
`tests/pricing.test.js` replays six historical ledger rows written by an
independent usage plugin and asserts the price table reproduces each to a relative
error below 1e-4.

## Caveats

- **Session spend is scoped to the plugin's lifetime.** DSH exposes no
  account-level spend API, so 本次会话/今日/运行以来 all begin at zero when the Host
  plugin mounts and reset when DSH restarts.
- The meter counts calls made **through the agent loop**. Compaction and
  session-title calls also emit usage and are included.
- `剩余` reads whatever currency the endpoint reports, preferring CNY.

## License

MIT
