# runtime-pin-check — implementation contract

Product plan (Thai): `PLAN.md`. This file is the engineering contract; amendments are
appended at the end and win over earlier text.

## Repo
This repository. Shared checkout on
`main`: commit only your boundary paths (`git commit -- <paths>`), never `git add -A`.

## Global constraints (every task inherits these)
1. Work only inside this repo and only inside your task's boundary paths. A task that exports a
   function owns its test file even if the table forgot it (note it, no escalation).
2. Local commits on `main`, conventional subjects. Repo-local identity is set; do not change it.
3. NEVER `git push`, add a remote, `npm publish`, create a GitHub repo, or open a marketplace listing.
4. Never use private repositories as test corpora.
5. No AI and no network at runtime. The only network use is the EOL snapshot update script and
   recon, never the CLI or library.
6. Runtime dependencies: at most `semver`, one YAML parser (`yaml`), one TOML parser (`smol-toml`),
   pinned exactly, no install scripts. Dev dependencies are free. Anything else needs a challenge.
7. TypeScript strict, ESM, Node >= 20.19 (the oldest Node line still supported on the day of release;
   recon confirms), `tsup` build, `vitest` tests. No `any` in exported types. Every exported function
   has a doc comment and tests.
8. Every finding carries: a stable code, severity (`error` | `warning` | `info`), the runtime, every
   source involved as `{file, line, raw, constraint}`, and an English message. No finding without
   file and line.
9. Parsing never guesses: a value the extractor cannot interpret becomes an `UNPARSEABLE` info
   finding with file and line, never a silent skip and never a crash.
10. `--fix` never writes on ambiguity: it rewrites only sources whose syntax it fully understands,
    preserves every other byte of the file, and never touches lockfiles.
11. Gates for every task: `npm run typecheck && npm test && npm run build` exit 0; READY note with SHA.
    Stop rule: bb `rule:quality-loop` (stop at the first REVIEW-PASS with zero open findings).
12. Numbers in README come from a command a reader can re-run; name the command. No machine timings.

## Domain model (binding)
- `Source`: one place that pins a runtime: `{runtime: 'node'|'python'|'go', file, line, column?,
  raw, kind, constraint}`. `kind` is the extractor id (e.g. `nvmrc`, `engines`, `dockerfile`).
- `Constraint`: normalised from `raw` into one of
  `exact` (22.11.0), `partial` (22, 22.11 — means any version with that prefix),
  `range` (a semver range such as `>=20 <23`, `^22`), `alias` (`lts/*`, `lts/iron`, `node`, `latest`,
  `stable`), `unknown` (kept with raw text, produces UNPARSEABLE).
  Docker tags reduce to the version part (`22-alpine` → partial 22, `22.11.0-bookworm-slim` → exact).
- Each Constraint is converted to a semver range for comparison (`partial 22` → `>=22.0.0 <23.0.0-0`).
  Aliases resolve through the bundled EOL snapshot (`lts/iron` → 20.x); `latest`/`node`/`stable`
  resolve to "newest in snapshot" and are reported as info `FLOATING_ALIAS`, never as conflicts.
- Scope: findings are computed per **project root**. A project root is the repo root plus every
  directory containing a `package.json`, `pyproject.toml` or `go.mod` that is not under
  `node_modules`, `.git`, `dist`, `build`, `vendor`, `.venv`. Root-level CI and tool files apply to
  every project root unless a workflow step sets `working-directory` to a specific one.

## Finding codes
| code | severity | when |
|---|---|---|
| `VERSION_CONFLICT` | error | two sources of one runtime in one scope have no overlapping version |
| `OUTSIDE_RANGE` | error | an exact/partial pin lies outside a range source (e.g. `.nvmrc` 18 vs `engines >=20`) |
| `PRECISION_MISMATCH` | info | sources agree but at different precision (22 vs 22.11.0) |
| `EOL_RUNTIME` | warning | every version a source allows is past end-of-life on the check date |
| `EOL_SOON` | info | end-of-life within 90 days of the check date |
| `FLOATING_ALIAS` | info | `latest`/`node`/`stable` style pin |
| `UNPARSEABLE` | info | the extractor found the field but could not interpret it |
| `SINGLE_SOURCE` | — | not a finding; scopes with one source are listed in the summary only |

## CLI
`runtime-pin-check [dir] [--json] [--runtime node,python,go] [--fail-on error|warning|info]
[--date YYYY-MM-DD] [--fix --to <version> [--runtime <one>] [--dry-run] [--fix-ranges]]`
- exit 0: no finding at or above `--fail-on` (default `error`); 1: findings at/above it; 2: usage
  or I/O error. Under `GITHUB_ACTIONS=true` also print `::error file=…,line=…::` annotations.
- `--fix` rewrites exact/partial sources to `--to`, keeping their precision style (a partial `22`
  becomes the new major). Range sources are rewritten only with `--fix-ranges`, to `>=<major>`.
  `--dry-run` prints a unified diff and writes nothing.
- `--date` exists so tests and users can reproduce EOL results.

## Task table
| slug | tier | role | deps | boundary | acceptance |
|---|---|---|---|---|---|
| rpc-recon | complex | research | — | docs/recon.md | GO/STOP verdict with run evidence; see Recon below |
| rpc-scaffold | standard | implementer | rpc-recon GO | package.json, package-lock.json, tsconfig.json, tsup.config.ts, vitest.config.ts, .gitignore, LICENSE, src/types.ts, src/constraint.ts, src/compare.ts, src/scan.ts, src/index.ts, test/constraint.test.ts, test/compare.test.ts, test/scan.test.ts | constraint parsing + range conversion + per-scope comparison producing every code except EOL ones, on hand-built Source arrays; scan finds project roots per Domain model |
| rpc-extract-node | standard | implementer | rpc-scaffold | src/extract/node/**, test/extract/node/**, test/fixtures/node/** | extractors listed in Extractors (node), each with a real-world sample from recon |
| rpc-extract-pygo | standard | implementer | rpc-scaffold | src/extract/python/**, src/extract/go/**, test/extract/{python,go}/**, test/fixtures/{python,go}/** | extractors listed in Extractors (python, go) |
| rpc-eol | standard | implementer | rpc-scaffold | src/eol.ts, data/eol.json, scripts/update-eol.mjs, test/eol.test.ts | EOL_RUNTIME/EOL_SOON/alias resolution with `--date`; snapshot built by the script from endoflife.date, with source + license recorded in the JSON |
| rpc-cli | standard | implementer | rpc-extract-node, rpc-eol | src/cli.ts, src/report.ts, test/cli.test.ts, test/fixtures/repos/** | CLI contract above incl. exit codes, --json, annotations |
| rpc-fix | complex | implementer | rpc-cli, rpc-extract-pygo | src/fix.ts, test/fix.test.ts | --fix/--dry-run/--fix-ranges; byte-preservation test on every fixture (only the version bytes change) |
| rpc-corpus | complex | implementer (not the author of rpc-fix) | rpc-fix | bench/corpus.mjs, bench/corpus.md, bench/repos.txt | run on ≥30 public repos (shallow clone into scratch, not committed), hand-label every finding true/false, report precision and every false positive with the fix or the reason |
| rpc-action-docs | standard | implementer | rpc-corpus | action.yml, README.md, NOTICE, .github/workflows/ci.yml, .github/workflows/update-eol.yml, examples/** | Action runs the built CLI; README Thai+English, comparison with competitors from recon, corpus precision from bench/corpus.md; weekly workflow refreshes data/eol.json via PR |

## Extractors (v1; recon may add or cut with evidence)
- node: `.nvmrc`, `.node-version`, `package.json` (`engines.node`, `volta.node`, `devEngines.runtime`
  if recon finds real use), `.tool-versions` (`nodejs`), `mise.toml` / `.mise.toml` (`[tools] node`),
  `Dockerfile*` (`FROM node:` and `FROM <registry>/node:` incl. multi-stage, `ARG NODE_VERSION` used
  in FROM), GitHub workflows (`actions/setup-node` `node-version`, `node-version-file` pointing to a
  file is a reference not a pin, matrix arrays → each value is a source), `.gitlab-ci.yml` `image: node:`.
- python: `.python-version`, `pyproject.toml` (`project.requires-python`, Poetry
  `tool.poetry.dependencies.python`), `.tool-versions` (`python`), `mise.toml`, `Dockerfile*`
  (`FROM python:`), workflows (`actions/setup-python` `python-version`), `runtime.txt`.
- go: `go.mod` (`go` and `toolchain` directives), `.tool-versions` (`golang`), `mise.toml`,
  `Dockerfile*` (`FROM golang:`), workflows (`actions/setup-go` `go-version`; `go-version-file`
  is a reference).
- Matrix entries in CI are a deliberate multi-version test: they are compared only against range
  sources (each matrix value must satisfy `engines`), never against each other.

## Recon (rpc-recon) — must answer with evidence, verdict GO or STOP
1. Competitors, each INSTALLED AND RUN on one fixture repo you build with 5+ conflicting node pins
   plus one python and one go conflict: conflic, versions-le, check-node-version, ls-engines,
   syncpack, mise (`mise doctor`/`mise ls`), Renovate/Dependabot behaviour (read docs only), any
   GitHub Action found by `gh search repos`/marketplace search for node version consistency.
   Record what each catches and misses.
2. Demand: issues/discussions where people hit version drift between these files (links, reactions).
3. npm name `runtime-pin-check` free? If not, propose 3 free names.
4. endoflife.date API: endpoint shape for nodejs/python/go, license/terms for redistributing a
   snapshot in a package, attribution text.
5. Real file samples: for every extractor, 2+ real public examples (repo + path) incl. odd forms
   (`lts/*`, `v22`, `22.x`, `>=20 <23`, `node:22-alpine@sha256:…`, `ARG` in FROM, matrix).
6. GitHub Actions JS runtime to target (node20/node24) on the release date.
7. Verdict: GO only if at least two of {EOL, --fix, Action UX, monorepo scopes, python/go} are not
   covered by a maintained competitor. STOP otherwise, saying which competitor wins.

## Escalation
Contract or scope questions → an issue on the repository.

## Amendments
A1. Node floor is `>= 22` (Node 20 reached end-of-life 2026-04-30).
    Supersedes constraint 7's "20.19".
A2. `action.yml` uses `runs.using: node24`.
A3. Extractor edge cases from docs/recon.md section 5 are binding
    test fixtures for rpc-extract-node / rpc-extract-pygo: `lts/*` and `lts/<name>`, `v22`, `22.x`,
    `>=20 <23`, `node:22-alpine@sha256:...`, `public.ecr.aws/lambda/nodejs:22`, `ARG NODE_VERSION=24`
    (incl. a default with a suffix) used in FROM, multi-line `.python-version`, `devEngines.runtime`,
    `${VAR}` in `.gitlab-ci.yml` (UNPARSEABLE, not a crash), `.GitHub` path case. Each fixture cites
    its real repo + path from recon.
A4. Positioning. EOL and the GitHub Action are NOT differentiators: engines-gauge
    1.1.0 already ships both for Node. The product wins only on: (a) Node + Python + Go compared
    across files with file:line and semver; (b) range-safe, byte-preserving `--fix` (conflic rewrote
    `engines ">=22 <23"` to `"20"`; engines-gauge `--save` edits one field); (c) per-project-root
    scopes in monorepos. EOL stays as a supporting feature, offline, all three runtimes.
A5. rpc-corpus gains a head-to-head: run engines-gauge 1.1.0 and conflic 1.1.6 on the same corpus
    repos (node part) and on the recon fixture; report per tool what it catches and misses, with
    the same hand labels. README claims about competitors come only from this table.
A6. rpc-action-docs README leads with (a)-(c) and a 10-line "vs engines-gauge / conflic" table; it
    must not claim EOL or the Action as unique.
A7. Domain model additions, binding on every extractor and on the CLI:
    `Source.matrix?: boolean` (true for each CI matrix value; compared only against range sources),
    `Source.workingDirectory?: string` (relative project root a CI step targets via
    `working-directory`, `.` = repo root; absent = applies to every project root), and
    `Finding.scopes: string[]` (project roots the finding applies to, `.` = repo root). Extractors
    must set `matrix` and `workingDirectory` where the file says so; the CLI groups output by scope.
A8. Extractor interface and shared formats. New task
    `rpc-extract-shared` runs before rpc-extract-node and rpc-extract-pygo; rpc-eol does not wait.
    - Extractor signature (every runtime module): `extract(file: string, text: string): Source[]`.
      `file` is repo-relative with `/` separators. Pure: no I/O, never throws. A recognised field it
      cannot interpret yields a Source with `constraint.kind === 'unknown'` (-> UNPARSEABLE).
      `src/extract/{node,python,go}/index.ts` export `extractNode`, `extractPython`, `extractGo`,
      each dispatching on the file name and returning [] for files it does not handle. The CLI walks
      files with `walkFiles()` and concatenates the three results.
    - `src/extract/shared/` (owned by rpc-extract-shared) parses formats, never runtimes:
      `parseDockerfile(text) -> {image, tag, digest?, line, stage?}[]` with `ARG` defaults
      substituted into `FROM` (a variable with no default stays raw);
      `parseWorkflow(text) -> {uses, with: Record<string,{value, line}>, matrix: Record<string,
      {values, line}>, workingDirectory?, line}[]` for GitHub workflows, resolving
      `${{ matrix.x }}` to the matrix values;
      `parseGitlabCi(text) -> {image, tag, line, job}[]`;
      `parseToolVersions(text) -> {tool, versions: string[], line}[]`;
      `parseMise(text) -> {tool, versions: string[], line}[]` for `[tools]`.
      Runtime modules map image/tool names to their runtime (`node`, `nodejs`; `python`; `golang`,
      `go`) and own the version meaning.
    - Dependencies: rpc-extract-shared adds `yaml` and `smol-toml` to package.json, pinned exactly,
      and updates package-lock.json. No other task edits package.json in this phase.
    - Semantics accepted as proposed: go.mod `go 1.22` = `>=1.22.0`; `toolchain go1.22.3` = exact;
      Poetry and PEP 440 ranges go through `parseConstraint`; `runtime.txt` `python-3.7.6` = exact;
      multi-line `.python-version` = one Source per non-comment line.
A9. Workflow scope rules for all
    extractors: a setup step's `workingDirectory` comes only from what the file states, namely the
    step's own `working-directory` or the job/workflow `defaults.run.working-directory` (the shared
    parser already merges them). `defaults.run` is honoured for setup steps on purpose: it is how
    monorepos declare which project a job serves, and every run step that uses the installed runtime
    runs there. No inference from other run steps. Known limit, stated in README: a job that declares
    `defaults.run` but overrides one run step back to the root is scoped to the default directory.
A10. Output grouping and fixture exclusion, implemented by rpc-noise:
    one VERSION_CONFLICT per runtime per scope listing all sources grouped by constraint;
    OUTSIDE_RANGE stays per pair; PRECISION_MISMATCH one per runtime per scope; fixture-like
    directories excluded by default (`--include-fixtures`, `--exclude <glob>`). Plan: task rpc-noise.
A11. rpc-corpus is done by someone who wrote no product code; a second person reviews it. rpc-corpus starts after rpc-noise and rpc-fix merge.
A12. Precision rules. Baseline at 389c91f:
    strict precision 46.2%, OUTSIDE_RANGE 5.6%; 97 of 115 false positives are F-scope + F-fixture.
    Binding changes (implemented by rpc-prec-scope and rpc-prec-extract):
    - Binding of a source to project roots. A file inside a project root binds to its nearest
      enclosing project root only (Dockerfiles, pins, manifests). Root-level tool pin files
      (`.nvmrc`, `.node-version`, `.python-version`, `.tool-versions`, `mise.toml`) bind to the root
      and to every sub-project that has no pin file of the same kind (upward lookup, as nvm/pyenv/
      asdf/mise resolve). Root-level CI setup steps and a root Dockerfile: with `working-directory`
      (A9) -> that root; else if the repo root has a manifest for that runtime (package.json /
      pyproject.toml or setup.py or setup.cfg / go.mod) -> root only; else -> the sub-projects named
      by a path in the same step or job (`cache-dependency-path`, `node-version-file`,
      `python-version-file`, `go-version-file`, `working-directory` of the job's steps); else the
      source is UNBOUND.
    - UNBOUND sources still produce EOL_RUNTIME, EOL_SOON, FLOATING_ALIAS and UNPARSEABLE, and are
      listed in the summary as "not tied to a project"; they never take part in VERSION_CONFLICT,
      OUTSIDE_RANGE or PRECISION_MISMATCH. Precision over recall: a missed cross-scope drift is
      acceptable, a false one is not.
    - Fixture exclusion: any directory segment matching
      /^(_?test[-_]?data|test[-_]?fixtures?|__fixtures__|fixtures?|testdata)$/i is skipped.
    - `${{ env.X }}` resolves from `env:` of the same step, job or workflow (in that order); other
      expressions stay UNPARSEABLE.
    - Docker images map to a runtime only for official images and their well-known mirrors (see
      rpc-prec-extract plan); other images' tags are ignored, not guessed.
    - Acceptance (rpc-corpus-rerun, same 40 SHAs, same labelling rules): strict precision >= 80%,
      OUTSIDE_RANGE strict precision >= 80%, zero F-scope and zero F-fixture, and every finding that
      was T at 389c91f and disappears is listed with the reason. README quotes only rerun numbers.
A13. `Source.paths?: string[]`: repo-relative paths named by the
    same workflow step or job (`cache-dependency-path`, `node-version-file`, `python-version-file`,
    `go-version-file`, and the `working-directory` values of the job's steps). Filled by the
    extractors (rpc-prec-extract, from the shared workflow parser), consumed by the A12 binding in
    scan/compare (rpc-prec-scope). Until filled such sources are UNBOUND. rpc-prec-scope may change
    src/cli.ts to call the binding before compare and EOL so every finding shares scopes.
A14. A12 gap closed. The root-CI/root-Dockerfile rule applies to ANY
    Dockerfile, compose/CI file whose nearest enclosing project root is the repo root while the repo
    root has no manifest for that runtime (e.g. docker/, deploy/, .devcontainer/): workingDirectory
    -> Source.paths -> else UNBOUND. Tool pin files keep the upward-lookup rule. In binding,
    Source.paths entries containing glob characters (`*`, `?`, `[`, `{`) are ignored, never mapped to
    a root.
A15. (2026-11-25) Ruling on rpc-corpus-rerun (CLI 483d4fb): strict precision 80.6% PASSES. The
    OUTSIDE_RANGE line is 3 T + 1 TI + 0 F (n = 4): it has zero false findings, so the gate's intent
    (no false OUTSIDE_RANGE) is met; the 75% figure is reported as is, with n, and never rounded up.
    Accepted recall cost, stated in README: 24 previously true findings are no longer reported by
    the A12/A14 rules (77 unbound sources in 18 of 40 repos). Known limit kept: one Dockerfile per
    released runtime version (cypress-docker-images) still compares with the root pin.
    Bug to fix before README numbers are final (task rpc-diag-scope): two false syntax diagnostics on
    valid multi-document YAML under .github/workflows/resources/. Only top-level
    `.github/workflows/*.{yml,yaml}` are workflows (GitHub ignores subfolders); composite
    `action.yml`/`action.yaml` stay recognised wherever they were.
A16. A2 amended: the Action is a COMPOSITE action, not `using: node24`.
    Steps: `actions/setup-node` with Node 24, then run `$GITHUB_ACTION_PATH/dist/cli.js`; if that file
    is absent (a branch ref), run `npm ci && npm run build` in `$GITHUB_ACTION_PATH` first. Inputs map
    to CLI flags: path, fail-on, runtime, date, exclude (newline list), include-fixtures. Reason: the
    CLI reads argv only, dist/ is not committed, and a JS action would need a committed bundle plus an
    INPUT_* wrapper. README gets a short "Releasing the Action" section for the maintainer (build, then tag
    a release whose tree contains dist/ so users skip the build); the team never tags or pushes.
A17. (2026-11-25) Gate ruling after the reviewer's blind re-label of all 139 rerun findings (agreement
    98.6%, kappa 0.954; hatamoto#1 -> TI). Final: strict 111/139 = 79.9%, factual 99.3%, one F;
    OUTSIDE_RANGE 2 T + 2 TI + 0 F (n = 4). This AMENDS A12/A15: the strict 80% line is missed by
    one label. Ship gate is: zero F-scope, zero F-fixture, factual precision >= 95%, every remaining
    F listed as a known limit. Reason: TI findings are true (the files do disagree; the owner chose
    it), and another tuning round on the same 40 repos would overfit the metric to this corpus.
    Rejected: a further precision round on the same corpus. README states BOTH numbers (79.9%
    strict, 99.3% factual), n per code, the TI definition and the recall cost; nothing rounded up.
    A future precision claim needs a fresh, unseen corpus.
A18. Examples (rpc-action-docs): `examples/conflict-demo` conflicts on purpose, so the repo's own
    self-scan test passes `--exclude 'examples/**'`; rpc-action-docs may edit that one test in
    test/cli.test.ts. CI runs the Action on examples/conflict-demo expecting exit 1 and on the repo
    root (with that exclude) expecting exit 0.

