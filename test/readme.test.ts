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

  it('states the limits the tester found instead of hiding them (rpc-harden F6, F8, F9)', () => {
    // F9: multi-stage Dockerfile with different Node versions on purpose.
    expect(README).toContain('A multi-stage Dockerfile that uses different Node versions on purpose')
    expect(README).toContain('Dockerfile หลาย stage ที่ใช้ Node คนละรุ่นโดยตั้งใจ')
    // F8: mise / .tool-versions lists are read for the first version only.
    expect(README).toContain('are read for the first one only')
    expect(README).toContain('อ่านเฉพาะตัวแรก')
    // F6: source rows show the value as written (an env expression), not the resolved one.
    expect(README).toContain('A source row shows the value as written in the file')
  })

  it('names .gitlab-ci.yml python and golang images only because they are read (rpc-harden F7)', () => {
    expect(README).toContain('`.gitlab-ci.yml` (`image: python:`)')
    expect(README).toContain('`.gitlab-ci.yml` (`image: golang:`)')
  })

  it('bash blocks that run the repo build or examples say they start from a clone (rpc-night R2-1)', () => {
    // The npm package ships only dist/ + README: `npm ci` or `examples/...` in an empty dir fails.
    const blocks = [...README.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1] as string)
    const fromClone = blocks.filter((b) => /npm ci|node dist\/cli\.js|examples\//.test(b))
    expect(fromClone.length).toBeGreaterThanOrEqual(3)
    for (const b of fromClone) {
      expect(b, `block needs a clone step:\n${b}`).toMatch(/git clone https:\/\/github\.com\/Mammost1\/runtime-pin-check|cd runtime-pin-check/)
    }
  })

  it('inline "from source" instructions mention git clone (rpc-night R2-1)', () => {
    for (const line of README.split('\n').filter((l) => /npm ci && npm run build/.test(l) && !l.startsWith('npm ci'))) {
      expect(line).toContain('git clone')
    }
  })

  it('says GitLab include: files are not followed (rpc-night R2-2)', () => {
    expect(README).toContain('GitLab `include:` is not followed')
    expect(README).toContain('GitLab `include:` ไม่ถูกตามไปอ่าน')
  })

  it('documents every top-level key of --json output (rpc-night R2-4)', () => {
    for (const key of ['schema', 'directory', 'date', 'eolDataDate', 'roots', 'sources', 'summary', 'diagnostics', 'findings']) {
      expect(README, `--json key ${key}`).toContain('`' + key + '`')
    }
    expect(README).toContain('`schema`: `1`')
  })

  it('limit names Dockerfiles for unrelated helper images, not only cypress-docker-images (rpc-night R2-6)', () => {
    expect(README).toContain('Dockerfiles for unrelated helper images')
    expect(README).toContain('Dockerfile ของ image ช่วยงานที่ไม่เกี่ยวกับโปรเจกต์')
  })

  it("says --fix keeps each pin's own precision (rpc-night R2-5)", () => {
    expect(README).toContain('keeps the precision of each pin')
    expect(README).toContain('คงความละเอียดของแต่ละ pin')
  })

  it('says when --fix needs --runtime and what it prints with no pins (rpc-night R2-8)', () => {
    expect(README).toContain('`--runtime` is required only when pins of more than one runtime exist')
    expect(README).toContain('ต้องใส่ `--runtime` เฉพาะเมื่อมี pin ของมากกว่าหนึ่งภาษา')
    expect(README).toContain('"nothing to change"')
  })
})
