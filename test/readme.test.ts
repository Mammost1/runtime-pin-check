import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { USAGE } from '../src/cli'

// README claims that must stay true (rpc-harden: every sentence checkable).
const README = readFileSync(resolve(__dirname, '../README.md'), 'utf8')

describe('README', () => {
  it('does not say the package is missing from npm (rpc-harden F2)', () => {
    expect(README).not.toMatch(/not on npm yet/i)
    expect(README).not.toContain('ยังไม่อยู่บน npm')
    expect(README).toContain('npx runtime-pin-check')
  })

  it('does not promise a GitHub Action', () => {
    expect(README).not.toMatch(/uses: [\w-]+\/runtime-pin-check@/)
    expect(README).not.toContain('action.yml')
  })

  it('documents only flags the CLI accepts', () => {
    // `--save` is engines-gauge's flag, quoted in the comparison table.
    const otherTools = new Set(['--save'])
    const flags = new Set([...README.matchAll(/`(--[a-z][a-z-]+)/g)].map((m) => m[1] as string).filter((f) => !otherTools.has(f)))
    for (const flag of flags) expect(USAGE, `${flag} is in README`).toContain(flag)
  })
})
