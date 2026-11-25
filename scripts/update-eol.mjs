#!/usr/bin/env node
/**
 * Rebuilds data/eol.json from endoflife.date. This script and recon are the only places that use the
 * network; the CLI and the library never do.
 *
 *   node scripts/update-eol.mjs                     fetch and write data/eol.json
 *   node scripts/update-eol.mjs --out some.json     write somewhere else
 *   node scripts/update-eol.mjs --from-dir <dir>    no network: read nodejs.json, python.json, go.json
 *                                                   (endoflife responses) and node-index.json from <dir>
 *   node scripts/update-eol.mjs --fetched-at 2026-11-25   record that date instead of today (UTC)
 *
 * Sources and terms (docs/recon.md, section 4):
 *   - https://endoflife.date/api/v1/products/{nodejs,python,go}/  MIT, (c) endoflife.date contributors.
 *     The v1 API is in beta; the legacy /api/<product>.json shape is accepted too. Product descriptions
 *     are NOT copied (they derive from Wikipedia, CC BY-SA): only cycle, eolFrom, ltsFrom, latest.
 *   - https://nodejs.org/download/release/index.json  only for the Node.js LTS codenames (`lts/iron`).
 *     Node.js is MIT-licensed; no separate terms page for this index was found, so only the
 *     major-version -> codename pairs are taken.
 * The file is written only when every product parsed and has at least one release line.
 * If the nodejs.org index cannot be fetched or is malformed, the codename pairs already in the
 * output file are kept and the script says so; it never empties them. With no previous file to
 * keep (a first run) it stops without writing, rather than write Node lines with no codenames.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const USER_AGENT = 'runtime-pin-check eol-snapshot-updater (weekly, one request per product)'
const PRODUCTS = { node: 'nodejs', python: 'python', go: 'go' }
const DATE = /^\d{4}-\d{2}-\d{2}$/

function realDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false
  const d = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

function dateOrNull(value, where) {
  if (value === null || value === undefined || value === false) return null
  if (!realDate(value)) throw new Error(`${where}: expected YYYY-MM-DD or null, got ${JSON.stringify(value)}`)
  return value
}

/** Release lines from one endoflife.date response (v1 or legacy). */
function cyclesOf(runtime, body) {
  const where = `endoflife.date ${PRODUCTS[runtime]}`
  const rows = []
  if (Array.isArray(body)) {
    // Legacy: [{ cycle, eol: date|false|true, lts: date|false|true, latest }]
    for (const [i, r] of body.entries()) {
      if (typeof r?.cycle !== 'string') throw new Error(`${where}: legacy row ${i} has no cycle`)
      if (r.eol === true || r.lts === true) throw new Error(`${where}: cycle ${r.cycle} has a boolean date this script cannot place; use the v1 API`)
      rows.push({ cycle: r.cycle, eolFrom: dateOrNull(r.eol, `${where} ${r.cycle} eol`), ltsFrom: dateOrNull(r.lts, `${where} ${r.cycle} lts`), latest: typeof r.latest === 'string' ? r.latest : null })
    }
  } else if (Array.isArray(body?.result?.releases)) {
    for (const [i, r] of body.result.releases.entries()) {
      if (typeof r?.name !== 'string') throw new Error(`${where}: release ${i} has no name`)
      rows.push({
        cycle: r.name,
        eolFrom: dateOrNull(r.eolFrom, `${where} ${r.name} eolFrom`),
        ltsFrom: dateOrNull(r.ltsFrom, `${where} ${r.name} ltsFrom`),
        latest: typeof r.latest?.name === 'string' ? r.latest.name : null,
      })
    }
  } else {
    throw new Error(`${where}: unexpected response shape (neither v1 result.releases nor the legacy array)`)
  }
  if (rows.length === 0) throw new Error(`${where}: no release lines`)
  for (const r of rows) if (!/^\d+(\.\d+)?$/.test(r.cycle)) throw new Error(`${where}: unexpected cycle name "${r.cycle}"`)
  return rows
}

/** Node.js LTS codenames by major version, from the official release index. */
function codenamesOf(index) {
  if (!Array.isArray(index)) throw new Error('nodejs.org release index: expected an array')
  const names = new Map()
  for (const r of index) {
    const m = /^v(\d+)\./.exec(r?.version ?? '')
    if (m && typeof r.lts === 'string' && !names.has(m[1])) names.set(m[1], r.lts.toLowerCase())
  }
  return names
}

/** Major -> codename pairs recorded in an earlier snapshot (the parsed JSON), or an empty map. */
export function previousCodenames(snapshot) {
  const names = new Map()
  const rows = snapshot?.products?.node
  if (Array.isArray(rows)) for (const r of rows) if (typeof r?.cycle === 'string' && typeof r.codename === 'string' && r.codename !== '') names.set(r.cycle, r.codename)
  return names
}

/**
 * Builds the snapshot object from already-fetched responses. Pure: no I/O, so it can be tested with
 * recorded responses. A pair missing from a good index (or every pair, when `nodeIndex` is
 * undefined or malformed) falls back to `previous`; the second element of the result is then true
 * so the caller can say so.
 *
 * @param {{ nodejs: unknown, python: unknown, go: unknown, nodeIndex: unknown, fetchedAt: string, previous?: Map<string, string> }} input
 * @returns the snapshot, or `{ snapshot, codenamesKept }` when `withInfo` is set
 */
export function buildSnapshot({ nodejs, python, go, nodeIndex, fetchedAt, previous = new Map() }, withInfo = false) {
  if (!realDate(fetchedAt)) throw new Error(`fetchedAt must be YYYY-MM-DD, got ${JSON.stringify(fetchedAt)}`)
  let names
  let indexProblem
  try {
    names = codenamesOf(nodeIndex)
    if (names.size === 0) throw new Error('the index lists no LTS codenames')
  } catch (err) {
    indexProblem = err.message
    names = new Map()
  }
  if (indexProblem !== undefined && previous.size === 0) {
    throw new Error(`Node.js codenames unavailable (${indexProblem}) and there are no earlier codenames to keep; nothing written`)
  }
  let kept = false
  const node = cyclesOf('node', nodejs).map((c) => {
    const fresh = names.get(c.cycle)
    const old = previous.get(c.cycle)
    if (fresh === undefined && old !== undefined) kept = true
    return { ...c, codename: fresh ?? old ?? null }
  })
  const snapshot = {
    schema: 1,
    fetchedAt,
    attribution: `EOL data from endoflife.date (https://endoflife.date), MIT License, © endoflife.date contributors, fetched ${fetchedAt}. Node.js LTS codenames from https://nodejs.org/download/release/index.json (Node.js, MIT License).`,
    sources: [
      {
        name: 'endoflife.date',
        url: 'https://endoflife.date/api/v1/products/',
        license: 'MIT',
        copyright: '© 2020 endoflife.date contributors (https://github.com/endoflife-date/endoflife.date)',
        usedFor: 'release lines, end-of-life dates, LTS start dates and latest releases of nodejs, python and go',
      },
      {
        name: 'Node.js release index',
        url: 'https://nodejs.org/download/release/index.json',
        license: 'MIT (Node.js project; no separate terms page for the index was found)',
        copyright: '© Node.js contributors',
        usedFor: 'LTS codenames (major version to name) only',
      },
    ],
    products: { node, python: cyclesOf('python', python), go: cyclesOf('go', go) },
  }
  return withInfo ? { snapshot, codenamesKept: kept, indexProblem } : snapshot
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return res.json()
}

function parseArgs(argv) {
  const opts = { out: join(root, 'data', 'eol.json'), fromDir: undefined, fetchedAt: new Date().toISOString().slice(0, 10) }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const value = () => {
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} needs a value`)
      return v
    }
    if (a === '--out') opts.out = resolve(value())
    else if (a === '--from-dir') opts.fromDir = resolve(value())
    else if (a === '--fetched-at') opts.fetchedAt = value()
    else throw new Error(`unknown argument ${a}`)
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  let nodejs, python, go, nodeIndex
  if (opts.fromDir) {
    const read = (name) => JSON.parse(readFileSync(join(opts.fromDir, name), 'utf8'))
    ;[nodejs, python, go] = [read('nodejs.json'), read('python.json'), read('go.json')]
    try {
      nodeIndex = read('node-index.json')
    } catch (err) {
      console.warn(`update-eol: could not read node-index.json (${err.message})`)
    }
  } else {
    ;[nodejs, python, go] = await Promise.all([
      fetchJson('https://endoflife.date/api/v1/products/nodejs/'),
      fetchJson('https://endoflife.date/api/v1/products/python/'),
      fetchJson('https://endoflife.date/api/v1/products/go/'),
    ])
    // The codename index is the one optional source: an outage must not stop the EOL update.
    nodeIndex = await fetchJson('https://nodejs.org/download/release/index.json').catch((err) => {
      console.warn(`update-eol: could not fetch the Node.js release index (${err.message})`)
      return undefined
    })
  }
  let previous = new Map()
  try {
    previous = previousCodenames(JSON.parse(readFileSync(opts.out, 'utf8')))
  } catch {
    // No earlier file, or not readable: nothing to keep.
  }
  const { snapshot, codenamesKept, indexProblem } = buildSnapshot({ nodejs, python, go, nodeIndex, fetchedAt: opts.fetchedAt, previous }, true)
  if (indexProblem !== undefined) console.warn(`update-eol: Node.js codenames not refreshed (${indexProblem}); kept the ${previous.size} previous pairs`)
  else if (codenamesKept) console.warn('update-eol: some Node.js lines are missing from the release index; kept their previous codenames')
  mkdirSync(dirname(opts.out), { recursive: true })
  const tmp = `${opts.out}.tmp`
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`)
  renameSync(tmp, opts.out)
  const counts = Object.entries(snapshot.products).map(([k, v]) => `${k} ${v.length}`).join(', ')
  console.log(`wrote ${opts.out} (${counts} release lines, fetched ${snapshot.fetchedAt})`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(`update-eol: ${err.message}`)
    process.exit(1)
  })
}
