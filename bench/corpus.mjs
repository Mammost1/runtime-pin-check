#!/usr/bin/env node
// Corpus benchmark for runtime-pin-check (task rpc-corpus). No dependencies; Node >= 22.
//
//   node bench/corpus.mjs clone  <workdir>                 clone every repo in bench/repos.txt at its pinned sha
//   node bench/corpus.mjs run    <workdir> <outdir>        run the BUILT CLI (dist/cli.js --json --date 2026-11-25) on each clone
//                                                          (CORPUS_DATE overrides the check date; the labels were made for 2026-11-25)
//   node bench/corpus.mjs report <workdir> <outdir> [h2h] [--labels rerun|baseline]
//                                                          check labels + citations, print precision tables;
//                                                          h2h = directory with <name>.eg.json (engines-gauge -f json)
//                                                          and <name>.cf.json (conflic --format json <dir>)
//   node bench/corpus.mjs lost   <baselineOutdir> <rerunOutdir>
//                                                          every baseline T/TI finding that is gone from the rerun, with the reason
//                                                          (D still reported, R lost by A12 rule: UNBOUND or bound to another project, X source no longer extracted)
//
// Finding ids are "<owner>_<repo>#<n>", n = 1-based position in the CLI's `findings` array.
// Labels live in bench/corpus.md as JSON objects id -> [label, reason?]: the 389c91f baseline between
// labels:begin / labels:end, the rerun between labels-rerun:begin / labels-rerun:end, so a reviewer can
// re-label a sample and diff against it.
// Label values: T (true), TI (true but plausibly intentional), F-<class> (false positive).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const name = (slug) => slug.replace('/', '_')

function readRepos() {
  return readFileSync(join(here, 'repos.txt'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const [slug, sha] = l.split(/\s+/)
      return { slug, sha, dir: name(slug) }
    })
}

function readLabels(set = 'rerun') {
  const md = readFileSync(join(here, 'corpus.md'), 'utf8')
  const tag = set === 'baseline' ? 'labels' : 'labels-rerun'
  const fence = '`'.repeat(3)
  const re = new RegExp(`<!-- ${tag}:begin -->\\s*${fence}json\\n([\\s\\S]*?)\\n${fence}\\s*<!-- ${tag}:end -->`)
  const m = md.match(re)
  if (!m) throw new Error(`labels block "${tag}" not found in bench/corpus.md`)
  return JSON.parse(m[1])
}

function clone(workdir) {
  mkdirSync(workdir, { recursive: true })
  for (const r of readRepos()) {
    const dir = join(workdir, r.dir)
    if (existsSync(join(dir, '.git'))) continue
    execFileSync('git', ['init', '-q', dir])
    execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', `https://github.com/${r.slug}`])
    execFileSync('git', ['-C', dir, 'fetch', '-q', '--depth', '1', 'origin', r.sha])
    execFileSync('git', ['-C', dir, 'checkout', '-q', 'FETCH_HEAD'])
    console.log('cloned', r.slug, r.sha.slice(0, 12))
  }
}

function run(workdir, outdir) {
  mkdirSync(outdir, { recursive: true })
  const cli = join(root, 'dist', 'cli.js')
  if (!existsSync(cli)) throw new Error('dist/cli.js missing: run `npm run build` first')
  const sha = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  writeFileSync(join(outdir, 'CLI_SHA'), sha + '\n')
  for (const r of readRepos()) {
    const res = spawnSync('node', [cli, join(workdir, r.dir), '--json', '--date', process.env.CORPUS_DATE ?? '2026-11-25'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    writeFileSync(join(outdir, `${r.dir}.json`), res.stdout)
    console.log(r.dir, 'exit', res.status)
  }
}

function loadRun(outdir) {
  const rows = []
  for (const r of readRepos()) {
    const d = JSON.parse(readFileSync(join(outdir, `${r.dir}.json`), 'utf8'))
    d.findings.forEach((f, i) => rows.push({ id: `${r.dir}#${i + 1}`, repo: r.dir, f }))
  }
  return rows
}

function pct(a, b) {
  return b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a'
}

function report(workdir, outdir, h2h, set) {
  const labels = readLabels(set)
  const rows = loadRun(outdir)
  let problems = 0
  const bad = (msg) => { problems++; console.log('PROBLEM', msg) }

  // 1. every finding labelled exactly once, no stale labels
  const ids = new Set(rows.map((r) => r.id))
  for (const r of rows) if (!labels[r.id]) bad(`unlabelled ${r.id}`)
  for (const id of Object.keys(labels)) if (!ids.has(id)) bad(`label for unknown finding ${id}`)

  // 2. citation check: every cited file:line really contains the raw text
  let cited = 0
  for (const r of rows) {
    for (const s of r.f.sources) {
      cited++
      let line = ''
      try {
        const text = readFileSync(join(workdir, r.repo, s.file), 'utf8').replace(/^﻿/, '')
        line = text.split('\n')[s.line - 1] ?? ''
      } catch { /* unreadable */ }
      if (!line.includes(s.raw)) bad(`${r.id} cites ${s.file}:${s.line} but line is "${line.trim().slice(0, 60)}"`)
    }
  }

  // 3. precision tables
  const tally = (key) => {
    const t = new Map()
    for (const r of rows) {
      const lab = labels[r.id][0]
      const k = key(r)
      const e = t.get(k) ?? { n: 0, T: 0, TI: 0, F: 0 }
      e.n++
      if (lab === 'T') e.T++
      else if (lab === 'TI') e.TI++
      else e.F++
      t.set(k, e)
    }
    return t
  }
  const show = (title, t) => {
    console.log(`\n${title}\n| key | findings | T | TI | F | strict (T) | factual (T+TI) |\n|---|---|---|---|---|---|---|`)
    for (const [k, e] of [...t.entries()].sort())
      console.log(`| ${k} | ${e.n} | ${e.T} | ${e.TI} | ${e.F} | ${pct(e.T, e.n)} | ${pct(e.T + e.TI, e.n)} |`)
  }
  show('by code', tally((r) => r.f.code))
  show('all', tally(() => 'all'))
  const fclass = new Map()
  for (const r of rows) {
    const lab = labels[r.id][0]
    if (lab.startsWith('F')) fclass.set(lab, (fclass.get(lab) ?? 0) + 1)
  }
  console.log('\nfalse-positive classes:', Object.fromEntries(fclass))
  const withF = new Set(rows.map((r) => r.repo))
  console.log(`repos with >=1 finding: ${withF.size} of ${readRepos().length}`)
  let diag = 0, unbound = 0
  for (const r of readRepos()) {
    const d = JSON.parse(readFileSync(join(outdir, `${r.dir}.json`), 'utf8'))
    for (const x of d.diagnostics ?? []) {
      diag++
      console.log(`diagnostic ${r.dir}: ${x.file}:${x.line} ${x.message.slice(0, 90)}`)
    }
    unbound += d.summary?.unbound?.length ?? 0
  }
  console.log(`file diagnostics: ${diag}; sources not tied to a project (unbound): ${unbound}`)
  console.log(`citations checked: ${cited}; problems: ${problems}`)

  // 4. head-to-head on the findings we labelled true (drift only: conflict/outside-range)
  if (h2h) headToHead(rows, labels, h2h)
  if (problems) process.exitCode = 1
}

function headToHead(rows, labels, dir) {
  const norm = (p, repo) => {
    const abs = p.startsWith('/') ? relative(resolve(dir, '..', 'repos', repo), p) : p
    return abs
  }
  const tools = {
    eg: (repo) => {
      const p = join(dir, `${repo}.eg.json`)
      if (!existsSync(p)) return null
      const d = JSON.parse(readFileSync(p, 'utf8') || 'null')
      return { n: d && d.findings ? d.findings.length : 0, cites: d && d.findings ? d.findings.map((f) => `${f.file}:${f.line}`) : [] }
    },
    cf: (repo) => {
      const p = join(dir, `${repo}.cf.json`)
      if (!existsSync(p)) return null
      const d = JSON.parse(readFileSync(p, 'utf8') || 'null')
      if (!d) return { n: 0, cites: [] }
      const out = []
      let n = 0
      for (const c of d.concepts ?? []) {
        if (!/^(node|python|go)-version$/.test(c.id)) continue
        for (const f of c.findings ?? []) {
          n++
          for (const side of [f.left, f.right]) if (side) out.push(`${norm(side.file, repo)}:${side.line}`)
        }
      }
      return { n, cites: out }
    },
  }
  console.log('\nhead-to-head (engines-gauge 1.1.0 = eg, conflic 1.1.6 = cf): our labelled-true drift findings')
  console.log('| tool | findings total | catches our true drift (shares >=1 file:line) | of | repos with >=1 finding |')
  console.log('|---|---|---|---|---|')
  const repos = readRepos().map((r) => r.dir)
  const drift = rows.filter(
    (r) => ['VERSION_CONFLICT', 'OUTSIDE_RANGE'].includes(r.f.code) && ['T', 'TI'].includes(labels[r.id][0]),
  )
  for (const [tool, fn] of Object.entries(tools)) {
    let total = 0, repoHits = 0, caught = 0
    const cites = new Map()
    for (const repo of repos) {
      const c = fn(repo)
      if (c === null) continue
      cites.set(repo, new Set(c.cites))
      total += c.n
      if (c.n) repoHits++
    }
    for (const r of drift) {
      const set = cites.get(r.repo)
      if (set && r.f.sources.some((s) => set.has(`${s.file}:${s.line}`))) caught++
    }
    console.log(`| ${tool} | ${total} | ${caught} | ${drift.length} | ${repoHits} |`)
  }
}

function lost(baseOut, newOut) {
  const sig = (code, rt, srcs) => `${code}|${rt}|` + srcs.map((x) => `${x.file}:${x.line}:${x.raw}`).sort().join(';')
  const labels = readLabels('baseline')
  let n = 0
  const tally = {}
  for (const r of readRepos()) {
    const oldD = JSON.parse(readFileSync(join(baseOut, `${r.dir}.json`), 'utf8'))
    const newD = JSON.parse(readFileSync(join(newOut, `${r.dir}.json`), 'utf8'))
    const newSig = new Set(newD.findings.map((f) => sig(f.code, f.runtime, f.sources)))
    const srcKey = (x) => `${x.file}:${x.line}:${x.raw}`
    const newSrc = new Map(newD.sources.map((x) => [srcKey(x), x]))
    const unbound = new Set((newD.summary.unbound ?? []).map((u) => `${u.file}:${u.line}`))
    oldD.findings.forEach((f, i) => {
      const id = `${r.dir}#${i + 1}`
      const lab = labels[id]?.[0]
      if (lab !== 'T' && lab !== 'TI') return
      if (newSig.has(sig(f.code, f.runtime, f.sources))) return
      const mine = new Set(f.sources.map(srcKey))
      const same = newD.findings
        .map((g, j) => ({ id: `${r.dir}#${j + 1}`, set: new Set(g.sources.map(srcKey)), g }))
        .filter((e) => e.g.code === f.code && e.g.runtime === f.runtime)
      const union = new Set(same.flatMap((e) => [...e.set]))
      const missing = [...mine].filter((k) => !union.has(k))
      const sharing = same.filter((e) => [...mine].some((k) => e.set.has(k))).map((e) => e.id.split('#')[1])
      let cls, why
      if (missing.length === 0) { cls = 'D'; why = `same drift still reported in #${sharing.join(', #')}` }
      else if (missing.some((k) => !newSrc.has(k))) { cls = 'X'; why = `source no longer extracted: ${missing.find((k) => !newSrc.has(k)).split(':')[0]}` + (sharing.length ? `; rest still reported in #${sharing.join(', #')}` : '') }
      else {
        const ub = missing.filter((k) => unbound.has(k.split(':').slice(0, 2).join(':')))
        cls = 'R'
        why = ub.length
          ? `UNBOUND by A12: ${ub.length} of ${mine.size} sources not tied to any project`
          : `bound to a different project by A12: ${missing.slice(0, 2).map((k) => `${k.split(':')[0]}:${k.split(':')[1]} -> ${JSON.stringify(newSrc.get(k).boundTo)}`).join('; ')}`
        if (sharing.length) why += `; rest still reported in #${sharing.join(', #')}`
      }
      tally[`${lab}/${cls}`] = (tally[`${lab}/${cls}`] ?? 0) + 1
      console.log(`${id} [${lab}] ${f.code} ${cls}: ${why}`)
      n++
    })
  }
  console.log(`\nbaseline T/TI findings not present unchanged in the rerun: ${n}`, tally)
}

const argv = process.argv.slice(2)
const li = argv.indexOf('--labels')
const labelSet = li >= 0 ? argv.splice(li, 2)[1] : 'rerun'
const [cmd, a, b, c] = argv
if (cmd === 'clone' && a) clone(resolve(a))
else if (cmd === 'run' && a && b) run(resolve(a), resolve(b))
else if (cmd === 'report' && a && b) report(resolve(a), resolve(b), c ? resolve(c) : undefined, labelSet)
else if (cmd === 'lost' && a && b) lost(resolve(a), resolve(b))
else {
  console.error('usage: corpus.mjs clone <workdir> | run <workdir> <outdir> | report <workdir> <outdir> [h2hdir] [--labels rerun|baseline] | lost <baseOut> <newOut>')
  process.exit(2)
}
