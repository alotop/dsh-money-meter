#!/usr/bin/env node
/**
 * Static verification for dsh-money-meter.
 *
 * `node --check` cannot be used from here: it would require spawning a child
 * process, which the confined shell forbids. Importing the modules instead is a
 * strictly better check — it proves every file parses AND that its exports are
 * actually constructible.
 *
 * The browser half is not importable as written (it talks to
 * `window.__ModuleLoader__` at top level), so a minimal loader stub records the
 * bundle spec and then factory-executes it against a stub `react`, which proves
 * the bundle is well-formed, needs no bundler, and still exports `apply` and
 * `inject`.
 *
 * @module dsh-money-meter/scripts/check
 */

import assert from 'node:assert/strict'

const failures = []

/** Run one labelled check, collecting rather than throwing. */
async function check(label, run) {
  try {
    await run()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures.push(`${label}: ${error?.message ?? error}`)
    console.log(`  FAIL ${label}`)
  }
}

console.log('dsh-money-meter — static check')

await check('lib/pricing.js imports and prices a call', async () => {
  const { costOf } = await import('../lib/pricing.js')
  assert.equal(costOf('deepseek-v4-pro', { inputTokens: 1_000_000 }), 4.5)
})

await check('lib/usage.js imports and records a call', async () => {
  const { UsageMeter } = await import('../lib/usage.js')
  const meter = new UsageMeter()
  meter.record('p', 'deepseek-v4-flash', 's', { inputTokens: 1_000_000 })
  assert.equal(meter.snapshot('s').session.cost, 1.5)
})

await check('lib/balance.js imports', async () => {
  const { createBalanceReader } = await import('../lib/balance.js')
  assert.equal(typeof createBalanceReader, 'function')
})

await check('lib/rpc.js imports and exposes its channel', async () => {
  const { MONEY_RPC_CHANNEL, registerMoneyRpc } = await import('../lib/rpc.js')
  assert.equal(MONEY_RPC_CHANNEL, '/dsh-money-meter')
  assert.equal(typeof registerMoneyRpc, 'function')
})

await check('index.js declares the plugin contract', async () => {
  const host = await import('../index.js')
  assert.equal(host.name, 'money-meter')
  assert.ok(Array.isArray(host.inject))
  assert.equal(typeof host.apply, 'function')
})

await check('client.js is a loadable module-loader bundle', async () => {
  let spec
  globalThis.window = { __ModuleLoader__: { load: (value) => { spec = value } } }
  try {
    await import('../client.js')
  } finally {
    delete globalThis.window
  }
  assert.ok(spec, 'the bundle never called window.__ModuleLoader__.load')
  assert.equal(spec.id, 'dsh-money-meter')
  assert.equal(typeof spec.factory, 'function')

  let captured
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    Fragment: 'Fragment',
  }
  const exportsObject = spec.factory((name) => {
    assert.equal(name, 'react', `the bundle required an unexpected module: ${name}`)
    return reactStub
  })
  captured = exportsObject
  assert.equal(typeof captured.apply, 'function')
  assert.deepEqual(captured.inject, ['slots', 'connection'])
})

await check('cordis.patch.yml names this package', async () => {
  const { readFile } = await import('node:fs/promises')
  const yaml = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(yaml, /id:\s*money-meter/)
  assert.match(yaml, /name:\s*'dsh-money-meter'/)
})

await check('package.json declares the dsh bundle and client halves', async () => {
  const { readFile } = await import('node:fs/promises')
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'], './client.js')
})

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nall checks passed')
