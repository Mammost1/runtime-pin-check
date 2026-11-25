/**
 * Finds project roots and walks repo files (docs/TASKS.md, Domain model: Scope).
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Runtime } from './types'

/** Directories never entered: dependencies, VCS data, build output, virtualenvs. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.venv'])

/** Manifests that say which runtime a directory's project uses (A12 root-CI rule). */
const MANIFEST_RUNTIME: Readonly<Record<string, Runtime>> = {
  'package.json': 'node',
  'pyproject.toml': 'python',
  'setup.py': 'python',
  'setup.cfg': 'python',
  'go.mod': 'go',
}

/**
 * For every directory that has one, the runtimes whose manifest it holds (`package.json` → node,
 * `pyproject.toml`/`setup.py`/`setup.cfg` → python, `go.mod` → go). Keys are relative dirs, `.` = root.
 */
export function manifestRuntimesOf(files: readonly string[]): Map<string, Set<Runtime>> {
  const out = new Map<string, Set<Runtime>>()
  for (const file of files) {
    const i = file.lastIndexOf('/')
    const runtime = MANIFEST_RUNTIME[file.slice(i + 1)]
    if (!runtime) continue
    const dir = i < 0 ? '.' : file.slice(0, i)
    let set = out.get(dir)
    if (!set) out.set(dir, (set = new Set()))
    set.add(runtime)
  }
  return out
}

/** Files whose presence makes a directory a project root. */
export const ROOT_MARKERS: ReadonlySet<string> = new Set(['package.json', 'pyproject.toml', 'go.mod'])

/**
 * Directory names skipped by default because they hold test fixtures, not the project's own pins
 * (docs/TASKS.md A12): `fixtures`, `fixture`, `__fixtures__`, `testdata`, `test_data`, `_testdata`,
 * `test-fixtures`, `test_fixtures`, `testfixtures`, any letter case. Matched per directory segment.
 */
export const FIXTURE_DIR = /^(_?test[-_]?data|test[-_]?fixtures?|__fixtures__|fixtures?|testdata)$/i

/** True when a directory name is a fixture folder (see `FIXTURE_DIR`). */
export function isFixtureDir(name: string): boolean {
  return FIXTURE_DIR.test(name)
}

/** Options of `scanFiles` / `walkFiles`. */
export interface ScanOptions {
  /** Also scan fixture folders (`FIXTURE_DIR`; default false). */
  includeFixtures?: boolean
  /**
   * Extra paths to skip, as globs relative to the scanned directory: `*` and `?` stay inside one
   * path segment, `**` crosses segments. A pattern without `/` matches a file or directory name at
   * any depth (`examples`, `*.Dockerfile`); a pattern with `/` matches the whole relative path
   * (`docs/**`, `services/legacy`). A matching directory is skipped with everything under it.
   */
  exclude?: readonly string[]
}

/** What a scan found, and how many files it skipped because of fixture or `exclude` rules. */
export interface ScanResult {
  files: string[]
  /** Files under directories or matching paths skipped by the fixture rule or `exclude`. */
  excluded: number
}

function escapeRegex(text: string): string {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

/** Converts one exclude glob to a test on a relative path (see `ScanOptions.exclude`). */
export function globMatcher(glob: string): (path: string) => boolean {
  const pattern = glob.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
  let re = ''
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++
        if (pattern[i + 1] === '/') {
          i++
          re += '(?:.*/)?'
        } else {
          re += '.*'
        }
      } else {
        re += '[^/]*'
      }
    } else if (c === '?') {
      re += '[^/]'
    } else {
      re += escapeRegex(c)
    }
  }
  const regex = new RegExp(`^${re}$`)
  if (!pattern.includes('/')) return (path) => regex.test(path.slice(path.lastIndexOf('/') + 1))
  return (path) => regex.test(path)
}

async function countFiles(abs: string): Promise<number> {
  let n = 0
  for (const entry of await readdir(abs, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) n += await countFiles(join(abs, entry.name))
    else if (entry.isFile()) n++
  }
  return n
}

/**
 * Every file under `dir`, as a path relative to `dir` with '/' separators, sorted, and the number
 * of files skipped by the fixture rule and `exclude`. Never enters `IGNORED_DIRS` (not counted) or
 * symbolic links (so a link cycle cannot hang the walk).
 */
export async function scanFiles(dir: string, options: ScanOptions = {}): Promise<ScanResult> {
  const files: string[] = []
  let excluded = 0
  const matchers = (options.exclude ?? []).filter((g) => g.trim() !== '').map(globMatcher)
  const skip = (path: string) => matchers.some((m) => m(path))
  async function visit(rel: string): Promise<void> {
    const abs = rel === '' ? dir : join(dir, rel)
    const entries = await readdir(abs, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const path = rel === '' ? entry.name : `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue
        if ((!options.includeFixtures && isFixtureDir(entry.name)) || skip(path)) {
          excluded += await countFiles(join(abs, entry.name))
          continue
        }
        await visit(path)
      } else if (entry.isFile()) {
        if (skip(path)) excluded++
        else files.push(path)
      }
    }
  }
  await visit('')
  return { files: files.sort(), excluded }
}

/** The files `scanFiles` keeps (fixtures and `exclude` matches left out unless asked for). */
export async function walkFiles(dir: string, options: ScanOptions = {}): Promise<string[]> {
  return (await scanFiles(dir, options)).files
}

/**
 * The project roots of a repo: `.` (the repo root, always) plus every directory that contains a
 * `package.json`, `pyproject.toml` or `go.mod` outside the `IGNORED_DIRS`. Relative paths with
 * '/' separators, sorted.
 *
 * @param files - Optional result of `walkFiles(dir)`, to avoid walking twice.
 */
export async function findProjectRoots(dir: string, files?: readonly string[]): Promise<string[]> {
  const list = files ?? (await walkFiles(dir))
  return projectRootsOf(list)
}

/** The project roots implied by a list of relative file paths (see `findProjectRoots`). */
export function projectRootsOf(files: readonly string[]): string[] {
  const roots = new Set<string>(['.'])
  for (const file of files) {
    const i = file.lastIndexOf('/')
    const base = file.slice(i + 1)
    if (!ROOT_MARKERS.has(base)) continue
    const parts = file.split('/').slice(0, -1)
    if (parts.some((p) => IGNORED_DIRS.has(p))) continue
    roots.add(i < 0 ? '.' : file.slice(0, i))
  }
  return [...roots].sort()
}
