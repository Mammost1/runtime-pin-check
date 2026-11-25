# runtime-pin-check

**ไทย** · [English](#english)

หาเวอร์ชัน **Node, Python และ Go** ที่ถูกปักไว้ไม่ตรงกันในไฟล์ต่าง ๆ ของ repository เดียว (`.nvmrc`, `package.json`,
`Dockerfile`, `.python-version`, `pyproject.toml`, `go.mod`, workflow ของ GitHub Actions, `.gitlab-ci.yml`, `mise.toml`,
`.tool-versions`) บอกทุกจุดพร้อม **ไฟล์:บรรทัด** เทียบด้วย semver จริง แยกผลต่อโปรเจกต์ใน monorepo และมี `--fix` ที่แก้เฉพาะ
ตัวเลขเวอร์ชัน ไม่แตะไบต์อื่น ไม่ใช้ AI ไม่ต้องใช้เครือข่าย และไม่ต้องมี API key ตอนรัน

> ติดตั้ง: `npm install -D runtime-pin-check` หรือรันทันที `npx runtime-pin-check`

## ผลลัพธ์จริง

`examples/conflict-demo/` มีไฟล์หกไฟล์ที่ปักเวอร์ชันขัดกัน (`.nvmrc` 20, `Dockerfile` `node:18-alpine`, workflow ใช้ 22,
`package.json` ต้องการ `>=22 <23`, `.python-version` 3.11 แต่ `pyproject.toml` ต้องการ `>=3.12`)

```bash
git clone https://github.com/Mammost1/runtime-pin-check && cd runtime-pin-check
npm ci && npm run build
node dist/cli.js examples/conflict-demo --date 2026-11-25
```

```text
runtime-pin-check: 6 pins in 1 project root, checked on 2026-11-25 (end-of-life data from 2026-11-25)

. (repo root)
  error   VERSION_CONFLICT   node
    node: 3 different versions across 3 files: 22 (.github/workflows/ci.yml:10), 20 (.nvmrc:1), 18 (Dockerfile:1); no version satisfies all of them.
      .github/workflows/ci.yml:10  22
      .nvmrc:1                     20
      Dockerfile:1                 18-alpine
  error   OUTSIDE_RANGE      node
    .nvmrc:1 pins node 20, outside the range >=22.0.0 <23.0.0-0 required by package.json:1.
      .nvmrc:1        20
      package.json:1  >=22 <23
  error   OUTSIDE_RANGE      python
    .python-version:1 pins python 3.11, outside the range >=3.12.0 required by pyproject.toml:4.
      .python-version:1  3.11
      pyproject.toml:4   >=3.12
  error   OUTSIDE_RANGE      node
    Dockerfile:1 pins node 18, outside the range >=22.0.0 <23.0.0-0 required by package.json:1.
      Dockerfile:1    18-alpine
      package.json:1  >=22 <23
  warning EOL_RUNTIME        node
    .nvmrc:1 pins node 20 ("20"): node 20 reached end-of-life on 2026-04-30 (check date 2026-11-25).
      .nvmrc:1  20
  warning EOL_RUNTIME        node
    Dockerfile:1 pins node 18 ("18-alpine"): node 18 reached end-of-life on 2025-04-30 (check date 2026-11-25).
      Dockerfile:1  18-alpine

4 errors, 2 warnings, 0 info
```

ผลข้างบนคือผลจริงทั้งหมดจากคำสั่งนั้น (วางจากการรันจริง) รหัสออกเป็น `1`
เพราะมี finding ระดับ error ส่วน `examples/clean-demo/` ปักเวอร์ชันตรงกันทุกไฟล์ ได้ "No problems found." และรหัสออก `0`

## ต่างจากเครื่องมืออื่นอย่างไร

EOL **ไม่ใช่จุดเด่นของเรา** เครื่องมืออื่นทำให้ Node อยู่แล้ว (ดูตารางด้านล่าง) สิ่งที่เรามีและเครื่องมือที่เรารันเทียบไม่มี:

1. **เทียบข้ามไฟล์ทั้งสามภาษา** (Node, Python, Go) ด้วย semver พร้อม `ไฟล์:บรรทัด` ของทุก source
2. **`--fix` ที่ปลอดภัยกับ range และคงไบต์เดิม** เขียนทับเฉพาะ pin ที่เป็นเลขเวอร์ชันตรง ๆ (`22`, `22.11.0`, `node:22-alpine`) ส่วน range
   (`>=22 <23`) ไม่แตะเว้นแต่สั่ง `--fix-ranges` และไม่แตะ lockfile
3. **แยกผลต่อโปรเจกต์ (project root) ใน monorepo** ไม่เอาเวอร์ชันของ `packages/a` มาเทียบกับ `packages/b`

เทียบกับ **engines-gauge 1.1.0** และ **conflic 1.1.6** ข้อมูลในตารางมาจากการรันจริงบน fixture ของ recon (`docs/recon.md`) และบน repo 40
ตัวของ corpus (`bench/corpus.md`, ตาราง head-to-head) เท่านั้น เรื่องที่ไม่ได้ตรวจ เขียนว่า "ไม่ได้ตรวจ"

| | runtime-pin-check | engines-gauge 1.1.0 | conflic 1.1.6 |
|---|---|---|---|
| ภาษาที่เทียบ | Node, Python, Go | Node เท่านั้น | Node, Python, Go |
| แยกผลต่อโปรเจกต์ใน monorepo | มี | ไม่มี | ไม่มี |
| `ไฟล์:บรรทัด` ของทุก source | มี | มี | มี |
| `mise.toml`, `.gitlab-ci.yml` | อ่าน | ไม่อ่านทั้งสอง | ไม่อ่านทั้งสอง |
| `volta`, `go.mod toolchain`, matrix ของ CI | อ่าน | volta และ matrix อ่าน | ไม่อ่านทั้งสามอย่าง |
| `ARG NODE_VERSION=24` ใน `FROM` | อ่านค่า | พลาด (เห็นแค่ 22.11.0) | อ่านเป็นข้อความดิบ `node:${NODE_VERSION}-alpine` |
| `--fix` | แก้ pin ตรง ๆ คงไบต์เดิม | `--save` แก้ช่องเดียว (`engines`) | ในการรันของ recon เสนอแก้ `engines ">=22 <23"` เป็น `"20"` |
| EOL | มี (offline, Node/Python/Go) | มีสำหรับ Node | ไม่มี |
| GitHub Action | ไม่มี (รัน CLI ใน workflow ได้) | มี | ไม่ได้ตรวจ |
| 40 repo จริง: จำนวน finding | 139 | 29 | 1,397 |
| ใน 26 จุดขัดกันจริงของเรา เครื่องมือนั้นอ้างไฟล์:บรรทัดเดียวกันกี่จุด | — | 5 | 24 |

อ่านตารางนี้อย่างระวัง: (1) "อ้างไฟล์:บรรทัดเดียวกัน" เป็นเกณฑ์หลวม ไม่ได้ตรวจว่า finding ถูกความหมาย (2) **ไม่ได้ติดป้ายความถูกต้องของ finding ของคู่แข่ง**
จึงไม่มี precision ของเขามาเทียบ (3) conflic จับจุดขัดกันจริงได้มากกว่าเราในเกณฑ์นี้ (24 ต่อ 26) แต่รายงานมากกว่าเราราว 10 เท่า และ 220 จาก 1,397
อยู่ใต้โฟลเดอร์ test/fixtures/testdata (4) ตลาดนี้แน่นเร็ว: recon พบเครื่องมือใหม่ 7 ตัวใน 6 เดือน ทุกตัวมีดาวไม่เกิน 3 และดาวน์โหลดไม่เกิน 28 ต่อสัปดาห์

## ใช้งาน

ต้องใช้ Node 22 ขึ้นไป:

```bash
npx runtime-pin-check [dir] [options]
# หรือติดตั้งในโปรเจกต์: npm install -D runtime-pin-check แล้วรัน npx runtime-pin-check
```

จากซอร์ส (สำหรับพัฒนาโปรเจกต์นี้): `git clone https://github.com/Mammost1/runtime-pin-check && cd runtime-pin-check && npm ci && npm run build` แล้วรัน `node dist/cli.js [dir] [options]`

| ตัวเลือก | ความหมาย |
|---|---|
| `[dir]` | โฟลเดอร์ที่สแกน (ค่าเริ่มต้น `.`) |
| `--json` | พิมพ์ผลเป็น JSON (คีย์ระดับบนสุดดู "รูปแบบ `--json`" ด้านล่าง) |
| `--runtime node,python,go` | ตรวจเฉพาะบางภาษา |
| `--fail-on error\|warning\|info` | รหัสออก `1` เมื่อมี finding ระดับนี้ขึ้นไป (ค่าเริ่มต้น `error`) |
| `--date YYYY-MM-DD` | ตรวจ EOL และ alias `lts/*` ณ วันนั้น (ค่าเริ่มต้น วันนี้ตาม UTC) ใช้ทำผลซ้ำได้ |
| `--include-fixtures` | สแกนโฟลเดอร์ fixture ด้วย (ปกติข้ามโฟลเดอร์ชื่อ `fixtures`, `fixture`, `__fixtures__`, `test_fixtures`, `test-fixtures`, `testdata`, `test_data`, `_testdata` ทุกระดับ แต่ไม่ข้าม `test/` หรือ `tests/`) |
| `--version` | พิมพ์เวอร์ชัน |
| `--exclude <glob>` | ข้ามพาธที่ตรง (ใส่ซ้ำได้ เช่น `examples`, `docs/**`) |
| `--fix --to <version>` | แก้ pin เป็นเวอร์ชันนี้ (ใช้ร่วมกับ `--runtime <หนึ่งภาษา>`, `--dry-run`, `--fix-ranges`) |

รหัสออก: `0` ไม่มี finding ระดับที่สั่ง · `1` มี finding · `2` ใช้คำสั่งผิดหรืออ่านไฟล์ไม่ได้ ใน GitHub Actions (`GITHUB_ACTIONS=true`) จะพิมพ์
annotation `::error file=…,line=…::` ให้ด้วย

### รูปแบบ `--json`

คีย์ระดับบนสุดของ `--json`: `schema`, `directory`, `date`, `eolDataDate`, `roots`, `sources`, `summary`, `diagnostics`, `findings` `schema`: `1` คือเลขรุ่นของรูปแบบนี้
(จะเพิ่มเมื่อรูปแบบเปลี่ยนแบบไม่เข้ากันย้อนหลัง) `findings` แต่ละรายการมี `code`, `severity`, `runtime`, `sources`, `scopes`, `message` และแต่ละ source มี
`runtime`, `file`, `line`, `raw`, `kind`, `constraint`, `column`, `boundTo`, `constraintText`

สแกน repository ตัวเองต้องตัด `examples/` ออก เพราะมีความขัดแย้งที่ตั้งใจใส่ไว้: `node dist/cli.js . --exclude examples`

### `--fix`

```bash
# ถ้ายังไม่ได้ clone ให้ทำสองบรรทัดนี้ก่อน (ถ้าอยู่ใน clone แล้วข้ามได้)
git clone https://github.com/Mammost1/runtime-pin-check && cd runtime-pin-check
npm ci && npm run build
node dist/cli.js examples/conflict-demo --fix --to 22 --runtime node --dry-run
```

```text
--- a/.nvmrc
+++ b/.nvmrc
@@ -1 +1 @@
-20
+22
--- a/Dockerfile
+++ b/Dockerfile
@@ -1,2 +1,2 @@
-FROM node:18-alpine
+FROM node:22-alpine
 RUN node -v
runtime-pin-check --fix --to 22 (dry run: nothing written)
would change 2 pins in 2 files:
  .nvmrc:1  20 -> 22
  Dockerfile:1  18-alpine -> 22-alpine
already at 22: 1 pin
left alone (1); nothing is guessed:
  package.json:1  ">=22 <23" (range): ">=22 <23" is a range; pass --fix-ranges to rewrite it
```

`--dry-run` พิมพ์ diff แล้วไม่เขียนไฟล์ ถ้าไม่ใส่ จะเขียนจริง เฉพาะบรรทัดที่เปลี่ยน ไบต์อื่นของไฟล์คงเดิม (รวม BOM ถ้ามี) pin ที่โปรแกรมไม่เข้าใจ
ถูกข้าม พร้อมบอกเหตุผล ไม่เดา

`--fix` คงความละเอียดของแต่ละ pin: `--to 26.13.0` เปลี่ยน `node:16-alpine` เป็น `node:26-alpine` (ไม่ใช่ `26.13.0-alpine`) และ pin ที่เขียนสั้นกว่า `--to` (เช่น `1.27-alpine3.24` เมื่อ `--to 1.27.4`) จะไม่ถูกเขียนทับ แต่ถูกระบุชื่อในบรรทัด "kept at their own precision"

### ใช้ใน CI

ไม่มี GitHub Action แยก ให้รัน CLI เป็น step ธรรมดา (ต้องใช้ Node 22 ขึ้นไป):

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx runtime-pin-check .
```

ใน GitHub Actions (`GITHUB_ACTIONS=true`) จะพิมพ์ annotation ให้ด้วย และ step จะล้มตามรหัสออกด้านบน

## รหัส finding

| รหัส | ระดับ | เมื่อไหร่ |
|---|---|---|
| `VERSION_CONFLICT` | error | source ของภาษาเดียวกันในโปรเจกต์เดียวกันไม่มีเวอร์ชันที่ซ้อนทับกัน (รายงานหนึ่งรายการต่อภาษาต่อโปรเจกต์ แสดงทุก source จัดกลุ่มตามค่า) |
| `OUTSIDE_RANGE` | error | pin ตรง ๆ อยู่นอก range ของอีก source (เช่น `.nvmrc` 18 เทียบ `engines >=20`) |
| `PRECISION_MISMATCH` | info | เห็นตรงกันแต่เขียนละเอียดไม่เท่ากัน (`22` กับ `22.11.0`) |
| `EOL_RUNTIME` | warning | ทุกเวอร์ชันที่ source อนุญาตหมดอายุแล้ว ณ วันที่ตรวจ |
| `EOL_SOON` | info | หมดอายุภายใน 90 วัน |
| `FLOATING_ALIAS` | info | `latest`, `node`, `stable` ที่เปลี่ยนไปเรื่อย ๆ (ไม่นำไปเทียบ) |
| `UNPARSEABLE` | info | เจอช่องนั้นแต่ตีความไม่ได้ (เช่น `${VAR}`) พร้อมไฟล์:บรรทัด ไม่ข้ามเงียบและไม่ล้ม |

ไฟล์ที่เป็น YAML, TOML หรือ JSON ที่พังจริงจะถูกรายงานเป็น diagnostic ระดับไฟล์ (ใน `--json` และใน report) ไม่ทำให้โปรแกรมล้ม

## อ่านไฟล์อะไร

- **Node:** `.nvmrc`, `.node-version`, `package.json` (`engines.node`, `volta.node`, `devEngines.runtime`), `.tool-versions`, `mise.toml`,
  `Dockerfile*` (`FROM node:` รวม multi-stage และ `ARG` ที่ใช้ใน `FROM`), `.github/workflows/*.yml` (`actions/setup-node`, ค่าใน matrix เป็น source แยก),
  `.gitlab-ci.yml` (`image: node:` ระดับบนสุด, `default:` และของแต่ละ job)
- **Python:** `.python-version`, `pyproject.toml` (`project.requires-python`, `tool.poetry.dependencies.python`), `.tool-versions`, `mise.toml`,
  `Dockerfile*`, `.gitlab-ci.yml` (`image: python:`), `actions/setup-python`, `runtime.txt` ยังไม่อ่าน `Pipfile`, `setup.py`/`setup.cfg`, `tox.ini` และ action อื่นเช่น `astral-sh/setup-uv`
- **Go:** `go.mod` (`go` และ `toolchain`), `.tool-versions`, `mise.toml`, `Dockerfile*` (`FROM golang:`), `.gitlab-ci.yml` (`image: golang:`), `actions/setup-go` ยังไม่อ่าน `go.work` และ `GOTOOLCHAIN`
- Docker image: ตีความเป็นภาษาก็ต่อเมื่อเป็น image ทางการและ mirror ที่รู้จัก ถ้าเป็น image อื่นจะไม่เดา

## ผูกไฟล์กับโปรเจกต์อย่างไร (สำคัญใน monorepo)

โปรเจกต์ (project root) คือ root ของ repository บวกทุกโฟลเดอร์ที่มี `package.json`, `pyproject.toml` หรือ `go.mod` (ไม่นับ `node_modules`, `.git`, `dist`,
`build`, `vendor`, `.venv`) กติกาหลัก:

- ไฟล์ในโปรเจกต์ผูกกับโปรเจกต์ที่ใกล้ที่สุดที่ครอบมัน
- ไฟล์ pin ระดับ root (`.nvmrc`, `.node-version`, `.python-version`, `.tool-versions`, `mise.toml`) ใช้กับ root และกับทุกโปรเจกต์ย่อยที่ไม่มีไฟล์ชนิดเดียวกัน
  (ค้นขึ้นไปเหมือนที่ nvm, pyenv, asdf, mise ทำ)
- step ของ CI ระดับ root และ `Dockerfile` ที่ root: ถ้ามี `working-directory` (ของ step หรือ `defaults.run` ของ job) ผูกกับโปรเจกต์นั้น มิฉะนั้นถ้า root มี manifest ของ
  ภาษานั้นผูกกับ root อย่างเดียว มิฉะนั้นผูกกับโปรเจกต์ที่ step/job ระบุพาธไว้ (`cache-dependency-path`, `node-version-file` ฯลฯ) และถ้าไม่มีเลย
  จะเป็น **UNBOUND** (ไม่ผูกกับโปรเจกต์ใด)
- source ที่ UNBOUND ยังได้ `EOL_*`, `FLOATING_ALIAS`, `UNPARSEABLE` และถูกนับในสรุปว่า "not tied to a project" แต่ **ไม่เข้า** `VERSION_CONFLICT`,
  `OUTSIDE_RANGE`, `PRECISION_MISMATCH` นี่คือการเลือก "precision ก่อน recall": พลาดความขัดแย้งข้ามโปรเจกต์ยอมรับได้ รายงานความขัดแย้งปลอมไม่ได้

## ความแม่นยำที่วัดได้

วัดบน **repository สาธารณะ 40 ตัว** (SHA ตายตัวใน `bench/repos.txt`) ด้วย CLI commit `483d4fb` และ `--date 2026-11-25` ติดป้ายทุก finding ด้วยมือเป็น T (ถูกต้อง),
TI (ถูกตามข้อเท็จจริงแต่ผู้ดูแลของ repository นั้นน่าจะตั้งใจ เช่น matrix ที่ทดสอบเวอร์ชันต่ำสุด) หรือ F (เท็จ) โดยผู้ติดป้ายคนแรก แล้วผู้ติดป้ายอีกคนติดซ้ำแบบ blind ครบทั้ง 139 รายการ (เห็นตรงกัน 98.6%, kappa 0.954; ผลคือเปลี่ยน 1 รายการจาก T เป็น TI)

**strict** นับเฉพาะ T ส่วน **factual** นับ T และ TI รวมกัน (TI เป็นเรื่องจริงที่ไฟล์ขัดกันจริง เพียงแต่ผู้ดูแลของ repository นั้นน่าจะตั้งใจ) เกณฑ์ปล่อยของโปรเจกต์ใช้ factual: ไม่มี F ที่เกิดจากผูกไฟล์ผิดโปรเจกต์ (F-scope)
หรืออ่านไฟล์ fixture (F-fixture) เลย, factual ≥ 95%, และ F ที่เหลือทุกรายการต้องบอกเป็นข้อจำกัด ตัวเลขทั้งสองแบบแสดงไว้ด้านล่างโดยไม่ปัดขึ้น

| | ผล |
|---|---|
| finding ทั้งหมด | 139 (T 111 · TI 27 · F 1) |
| precision แบบเข้ม (strict, นับเฉพาะ T) | **79.9%** (111/139) |
| precision ตามข้อเท็จจริง (factual, T+TI) | **99.3%** (138/139) |
| F-scope / F-fixture | 0 / 0 |
| `OUTSIDE_RANGE` | 4 รายการ: T 2, TI 2, F 0 (strict 50.0%, factual 100%, n = 4) |
| F ที่เหลือ | 1 (`cypress-io/cypress-docker-images`: Dockerfile แยกตามเวอร์ชันของ Node แต่ละรุ่นยังถูกเทียบกับ pin ที่ root) |

ตัวเลขทั้งหมดมาจาก `bench/corpus.md` ส่วน "Rerun @ 483d4fb" ทำซ้ำได้ด้วยคำสั่งในส่วน "Repro" ของไฟล์นั้น (`node bench/corpus.mjs clone|run|report`)

ข้อจำกัดที่ต้องรู้ ไม่ปิดบัง:

- **strict ต่ำกว่าเป้าเดิม 80% อยู่ 1 รายการ** (79.9%; ต้องมี T อย่างน้อย 112 จาก 139) เกณฑ์ปล่อยถูกปรับให้ใช้ factual precision เพราะ TI เป็นความขัดแย้งจริง
  และการปรับกฎต่อบน 40 repo ชุดเดิมจะทำให้ตัวเลขเข้ากับชุดนี้เกินจริง การอ้าง precision ครั้งต่อไปต้องใช้ชุด repo ใหม่ที่ไม่เคยเห็น
- **`OUTSIDE_RANGE` มีตัวอย่างน้อย (n = 4)** strict 50.0% เพราะ 2 ใน 4 เป็น TI (เช่น การทดสอบ "ปฏิเสธ runtime ที่ไม่รองรับ" โดยตั้งใจ) ไม่มี finding เท็จ แต่ตัวอย่างน้อยเกินกว่าจะสรุปอะไร
- **recall ลดลงโดยเจตนา:** เมื่อเทียบกับรอบก่อนใช้กติกาผูกโปรเจกต์ มี finding ที่เคยเป็นของจริง 24 รายการ (T 14 + TI 10 ที่หายเพราะกติกา) ไม่ถูกรายงานอีก source 77 ตัวใน 18 จาก 40 repo เป็น UNBOUND
  ส่วนใหญ่เป็นขั้นตอน CI ที่ root ซึ่งไม่มี manifest และไม่มีพาธบอกว่าเป็นของโปรเจกต์ไหน ตัวอย่างความขัดแย้งจริงที่เราพลาดเพราะเรื่องนี้ เช่น node 18 เทียบ 20 ใน workflow สองไฟล์ที่ root ที่ไม่มี manifest ของ Node
- **ขีดจำกัดที่ยังมี:** repository ที่มี Dockerfile หนึ่งไฟล์ต่อ runtime หนึ่งรุ่น (เช่น cypress-docker-images) ยังเทียบกับ pin ที่ root และให้ finding เท็จ
  เช่นเดียวกับ Dockerfile ของ image ช่วยงานที่ไม่เกี่ยวกับโปรเจกต์ (เช่น sidecar สำหรับพัฒนาใน `devenv/docker/blocks/*/Dockerfile` ของ grafana ที่ใช้ node 16/18 และ go 1.17) ซึ่งถูกเทียบกับ pin ที่ root
- **job ที่ประกาศ `defaults.run.working-directory` แต่ override บาง step กลับไปที่ root** ถูกผูกกับโฟลเดอร์ default ทั้ง job (ตั้งใจ: นี่คือวิธีที่ monorepo ประกาศว่า job รับใช้โปรเจกต์ไหน)
- **pin ที่ root ซึ่งโปรเจกต์ลูกทุกตัวรับต่อ อาจถูกรายงานซ้ำหนึ่งครั้งต่อโปรเจกต์** เช่น `.nvmrc` ที่ root เทียบกับ Dockerfile ใน `examples/*` แต่ละตัว
  แต่ละรายการถูกต้องตามกติกา แต่ใน monorepo ที่มีโปรเจกต์ตัวอย่างหลายสิบตัวจะยาว ใช้ `--exclude examples` ถ้าไม่ต้องการตรวจโฟลเดอร์ตัวอย่าง
- **GitLab `include:` ไม่ถูกตามไปอ่าน** อ่านเฉพาะ `.gitlab-ci.yml` ที่พบในโฟลเดอร์ที่สแกน ถ้า `image:` อยู่ในไฟล์ที่ include (`local:`, `project:`, `remote:`) จะไม่ถูกเทียบ และเครื่องมือจะรายงาน "No problems found." ได้ ทั้งที่ไฟล์นั้นปักเวอร์ชันขัดกัน
- **Dockerfile หลาย stage ที่ใช้ Node คนละรุ่นโดยตั้งใจ** (เช่น build ด้วย 24 แล้วรันด้วย 22) ถูกรายงานเป็น `VERSION_CONFLICT` "across 1 file" ตามกติกา
- **`mise.toml` และ `.tool-versions` ที่ระบุหลายเวอร์ชัน** (`python = ["3.12", "3.11"]`) อ่านเฉพาะตัวแรก ซึ่งเป็นตัวที่ใช้จริง ตัวที่เหลือไม่ถูกเทียบ
- แถว source ในรายงานแสดงค่าตามที่เขียนในไฟล์ เช่น `${{ env.PYTHON_VERSION }}` แม้ข้อความหัวเรื่องจะแสดงค่าที่แปลงแล้ว
- PyPy และ GraalPy (`pypy-3.11` ใน `actions/setup-python`) ไม่ถูกเทียบกับ pin ของ CPython ระบบรายงานเป็น `UNPARSEABLE` พร้อมเหตุผล
- ไม่มี precision ของเครื่องมืออื่นให้เทียบ เพราะไม่ได้ติดป้าย finding ของเขา
- diagnostic ที่เป็นเท็จ 2 รายการใน 1 จาก 40 repo (YAML หลายเอกสารใต้ `.github/workflows/resources/` ที่ไม่ใช่ workflow) ถูกแก้ใน `f80ed6e` วัดซ้ำบน 40 repo เดิมแล้ว: finding เหมือน `483d4fb` ทุก repo และ diagnostic เหลือ 0
  แต่ยังไม่มี diagnostic จริง (ไฟล์พังจริง) ใน 40 repo นี้ จึงยังไม่มีหลักฐานจาก repo จริงว่า diagnostic จับไฟล์พังได้ (มีเฉพาะ unit test)
- ไม่มีตัวเลขเวลา (ms) ใน README นี้ เพราะขึ้นกับเครื่อง ทุกตัวเลขในส่วนนี้ซ้ำได้ด้วยคำสั่งที่ระบุ

## ข้อมูล EOL

`data/eol.json` เป็น snapshot ของ endoflife.date (MIT) สร้างด้วย `node scripts/update-eol.mjs` ซึ่งเป็นที่เดียว (นอกจากการสำรวจ) ที่ใช้เครือข่าย ตัว CLI และไลบรารีไม่ใช้เครือข่ายเลย
snapshot เก็บเฉพาะสายรุ่น วันหมดอายุ วัน LTS และรุ่นล่าสุด ไม่เก็บคำอธิบายสินค้า ส่วนชื่อ codename ของ Node LTS (เช่น `lts/iron`) ได้มาจากดัชนีรุ่นของ nodejs.org เฉพาะคู่ "เมเจอร์ → ชื่อ" และถ้าอ่านดัชนีนี้
ไม่ได้ตอนอัปเดต สคริปต์จะเก็บคู่เดิมไว้และแจ้งเตือน ไม่ล้างทิ้ง

workflow `.github/workflows/update-eol.yml` รันทุกวันจันทร์: ดึงข้อมูลใหม่ ถ้าสิ่งที่เกี่ยวกับ EOL เปลี่ยน (สายรุ่น วันหมดอายุ วัน LTS หรือ codename; การเปลี่ยนเฉพาะเลขรุ่นย่อยล่าสุดไม่นับ)
จะรัน typecheck, test, build แล้วเปิด pull request ให้ตรวจ ต้องเปิดการตั้งค่า "Allow GitHub Actions to create and approve pull requests" ของ repository

## เครดิตและสัญญาอนุญาต

โค้ดใช้สัญญาอนุญาต MIT (`LICENSE`) ข้อมูล EOL จาก endoflife.date (MIT, © endoflife.date contributors) และ codename จากดัชนีรุ่นของ Node.js รายละเอียดและข้อความสัญญาอนุญาตอยู่ใน [`NOTICE`](NOTICE)

## พัฒนา

```bash
npm run typecheck && npm test && npm run build
```

---

## English

Finds **Node, Python and Go** versions that are pinned inconsistently across one repository's files (`.nvmrc`, `package.json`, `Dockerfile`,
`.python-version`, `pyproject.toml`, `go.mod`, GitHub Actions workflows, `.gitlab-ci.yml`, `mise.toml`, `.tool-versions`), with **file and line** for every
pin, real semver comparison, results per project in a monorepo, and a `--fix` that changes only the version digits and no other byte. No AI, no network, no API key at run time.

> Install: `npm install -D runtime-pin-check`, or run `npx runtime-pin-check`.

### What it looks like

`examples/conflict-demo/` has files that pin conflicting versions. The Thai section above shows the full output of

```bash
git clone https://github.com/Mammost1/runtime-pin-check && cd runtime-pin-check
npm ci && npm run build
node dist/cli.js examples/conflict-demo --date 2026-11-25
```

(4 errors, 2 warnings, exit code 1: `VERSION_CONFLICT` across `.github/workflows/ci.yml:10` (22), `.nvmrc:1` (20) and `Dockerfile:1` (18-alpine); `OUTSIDE_RANGE` for `.nvmrc`
and `Dockerfile` against `package.json` `>=22 <23`, and for `.python-version` 3.11 against `pyproject.toml` `>=3.12`; `EOL_RUNTIME` for node 20 and 18.)
`examples/clean-demo/` is consistent: "No problems found.", exit code 0.

### How it differs

End-of-life checks are **not** what sets this apart: other tools already provide them for Node. What this adds, and the tools we ran against lack:

1. **Cross-file comparison for all three runtimes** with semver and `file:line` for every source.
2. **A `--fix` that is safe with ranges and byte-preserving**: it rewrites only plain version pins (`22`, `22.11.0`, `node:22-alpine`); ranges (`>=22 <23`) are
   left alone unless you pass `--fix-ranges`; lockfiles are never touched.
3. **Per-project-root results in a monorepo**: `packages/a` is never compared with `packages/b`.

Compared with **engines-gauge 1.1.0** and **conflic 1.1.6**. Every cell comes from our runs on the recon fixture (`docs/recon.md`) and on the 40-repository corpus
(`bench/corpus.md`, head-to-head table); what we did not check says "not checked".

| | runtime-pin-check | engines-gauge 1.1.0 | conflic 1.1.6 |
|---|---|---|---|
| Runtimes compared | Node, Python, Go | Node only | Node, Python, Go |
| Per-project results in a monorepo | yes | no | no |
| `file:line` for every source | yes | yes | yes |
| `mise.toml`, `.gitlab-ci.yml` | read | neither read | neither read |
| `volta`, `go.mod toolchain`, CI matrix | read | volta and matrix read | none of the three read |
| `ARG NODE_VERSION=24` used in `FROM` | value resolved | missed (saw only 22.11.0) | raw text `node:${NODE_VERSION}-alpine` |
| `--fix` | rewrites plain pins, bytes preserved | `--save` edits one field (`engines`) | in the recon run it proposed `engines ">=22 <23"` -> `"20"` |
| End-of-life | yes (offline; Node, Python, Go) | yes, for Node | no |
| GitHub Action | no (run the CLI in a workflow) | yes | not checked |
| 40 real repos: findings | 139 | 29 | 1,397 |
| Of our 26 true drift findings, how many the tool reports at the same file:line | — | 5 | 24 |

Read this table with care: (1) "same file:line" is a loose measure, not a check that the finding is right; (2) **we did not label the competitors' findings**, so there is
no precision for them to compare; (3) conflic reaches more of our true drift on this measure (24 of 26) but reports about ten times as many findings, and 220 of its 1,397 sit under
test/fixtures/testdata folders; (4) the space is crowded and moving fast: recon found 7 new tools in 6 months, each with at most 3 stars and 28 downloads a week.

### Use

Node 22 or newer:

```bash
npx runtime-pin-check [dir] [options]
# or install it in a project: npm install -D runtime-pin-check, then npx runtime-pin-check
```

From source (to work on this project): `git clone https://github.com/Mammost1/runtime-pin-check && cd runtime-pin-check && npm ci && npm run build`, then `node dist/cli.js [dir] [options]`.

`--json` prints one object with these top-level keys: `schema`, `directory`, `date`, `eolDataDate`, `roots`, `sources`, `summary`, `diagnostics`, `findings`. `schema`: `1` is the format version
(it changes only when the format changes incompatibly). Each entry of `findings` has `code`, `severity`, `runtime`, `sources`, `scopes`, `message`; each source has `runtime`, `file`, `line`, `raw`, `kind`, `constraint`, `column`, `boundTo`, `constraintText`.

Options are listed in the Thai table above and in `--help`: `--json`, `--runtime node,python,go`, `--fail-on error|warning|info` (default `error`), `--date YYYY-MM-DD`,
`--include-fixtures` (fixture folders such as `fixtures`, `__fixtures__`, `test_fixtures`, `testdata`, `test_data` are skipped by default; `test/` and `tests/` are not), `--exclude <glob>` (repeatable), `--version`, and `--fix --to <version>` with `--runtime <one>`, `--dry-run`, `--fix-ranges`. Exit codes: `0` nothing at or above `--fail-on`,
`1` findings, `2` usage or I/O error. With `GITHUB_ACTIONS=true` it also prints `::error file=…,line=…::` annotations. To scan this repository itself leave out the deliberate
conflicts: `node dist/cli.js . --exclude examples`.

`--fix` demo (`--dry-run` prints the diff and writes nothing): the Thai section shows `node dist/cli.js examples/conflict-demo --fix --to 22 --runtime node --dry-run` changing
`.nvmrc` 20 -> 22 and `Dockerfile` `node:18-alpine` -> `node:22-alpine`, and leaving `package.json`'s `">=22 <23"` alone because it is a range.

`--fix` keeps the precision of each pin: `--to 26.13.0` turns `node:16-alpine` into `node:26-alpine` (not `26.13.0-alpine`), and a pin written with fewer parts than `--to` (`1.27-alpine3.24` for `--to 1.27.4`) is not rewritten but named on the "kept at their own precision" line.

#### In CI

There is no separate GitHub Action; run the CLI as a plain step (Node 22 or newer):

```yaml
- uses: actions/checkout@v4
- uses: actions/setup-node@v4
  with:
    node-version: 22
- run: npx runtime-pin-check .
```

Under GitHub Actions (`GITHUB_ACTIONS=true`) it also prints annotations, and the step fails by the exit codes above.

### Finding codes

`VERSION_CONFLICT` (error: sources of one runtime in one project have no common version; one finding per runtime per project listing every source), `OUTSIDE_RANGE` (error: a plain pin outside another source's range),
`PRECISION_MISMATCH` (info: agree at different precision), `EOL_RUNTIME` (warning: every version a source allows is past end-of-life on the check date), `EOL_SOON` (info: end-of-life within 90 days),
`FLOATING_ALIAS` (info: `latest`, `node`, `stable`; not compared), `UNPARSEABLE` (info: the field was found but cannot be read, with file and line; never skipped silently, never a crash).
Broken YAML, TOML or JSON is reported as a file-level diagnostic (in `--json` and in the report), not as a crash.

### What it reads

- **Node:** `.nvmrc`, `.node-version`, `package.json` (`engines.node`, `volta.node`, `devEngines.runtime`), `.tool-versions`, `mise.toml`, `Dockerfile*` (`FROM node:`, multi-stage, `ARG` used in `FROM`),
  `.github/workflows/*.yml` (`actions/setup-node`; each matrix value is its own source), `.gitlab-ci.yml` (`image: node:` at the top level, under `default:` and in each job).
- **Python:** `.python-version`, `pyproject.toml` (`project.requires-python`, `tool.poetry.dependencies.python`), `.tool-versions`, `mise.toml`, `Dockerfile*`, `.gitlab-ci.yml` (`image: python:`), `actions/setup-python`, `runtime.txt`.
  Not read: `Pipfile`, `setup.py`/`setup.cfg`, `tox.ini`, other actions such as `astral-sh/setup-uv`.
- **Go:** `go.mod` (`go` and `toolchain`), `.tool-versions`, `mise.toml`, `Dockerfile*` (`FROM golang:`), `.gitlab-ci.yml` (`image: golang:`), `actions/setup-go`. Not read: `go.work`, `GOTOOLCHAIN`.
- Docker images count as a runtime only when they are official images or well-known mirrors; other images are ignored, not guessed.

### How files are tied to projects

A project root is the repository root plus every folder with a `package.json`, `pyproject.toml` or `go.mod` (not under `node_modules`, `.git`, `dist`, `build`, `vendor`, `.venv`).
A file inside a project binds to the nearest enclosing project. Root-level tool pin files (`.nvmrc`, `.node-version`, `.python-version`, `.tool-versions`, `mise.toml`) apply to the root and to every
sub-project without a file of the same kind (looked up the way nvm, pyenv, asdf and mise do). A root-level CI setup step or root `Dockerfile` binds to the project named by its `working-directory` (the step's or
the job's `defaults.run`); otherwise to the root if the root has a manifest for that runtime; otherwise to the sub-projects named by a path in the same step or job (`cache-dependency-path`, `node-version-file`, ...);
and if none of that applies it is **UNBOUND**. UNBOUND sources still get `EOL_*`, `FLOATING_ALIAS` and `UNPARSEABLE` and are listed in the summary as "not tied to a project", but never take part in
`VERSION_CONFLICT`, `OUTSIDE_RANGE` or `PRECISION_MISMATCH`: precision over recall. Missing a cross-project drift is acceptable; reporting a false one is not.

### Measured precision

Measured on **40 public repositories** (pinned SHAs in `bench/repos.txt`) with CLI commit `483d4fb` and `--date 2026-11-25`. Every finding was labelled by hand as T (true), TI (true but probably intentional, e.g. a matrix that tests the lowest version) or
F (false), by a first labeller; a second labeller then re-labelled all 139 findings blind (98.6% agreement, kappa 0.954; one finding changed from T to TI).

**Strict** counts T only; **factual** counts T and TI together (a TI is a real disagreement between files that the repository's maintainers probably intended). The release gate is factual: zero false findings caused by binding a file to the
wrong project (F-scope) or reading a fixture (F-fixture), factual precision of at least 95%, and every remaining F listed as a known limit. Both figures are shown below, not rounded up.

| | Result |
|---|---|
| All findings | 139 (T 111 · TI 27 · F 1) |
| Strict precision (T only) | **79.9%** (111/139) |
| Factual precision (T + TI) | **99.3%** (138/139) |
| F-scope / F-fixture | 0 / 0 |
| `OUTSIDE_RANGE` | 4 findings: T 2, TI 2, F 0 (strict 50.0%, factual 100%, n = 4) |
| Remaining F | 1 (`cypress-io/cypress-docker-images`: one Dockerfile per Node release line is still compared with the root pin) |

All figures come from the "Rerun @ 483d4fb" part of `bench/corpus.md` and can be reproduced with the commands in its "Repro" section (`node bench/corpus.mjs clone|run|report`).

Known limits, stated plainly:

- **Strict precision is one finding short of the original 80% target** (79.9%; 112 of 139 would be needed). The release gate was revised to factual precision, because a TI is a real conflict and another tuning round on the same 40 repositories
  would overfit the metric to this corpus. A future precision claim needs a fresh corpus of repositories nobody has looked at.
- **`OUTSIDE_RANGE` has few samples (n = 4).** Strict 50.0% because 2 of the 4 are TI (for example a deliberate "reject an unsupported runtime" test); there is no false finding, but four is too few to conclude anything.
- **Recall was traded away on purpose.** Compared with the run before the project-binding rules, 24 findings that had been real (14 T and 10 TI lost to the rules) are no longer reported, and 77 sources in 18 of the 40 repositories are UNBOUND,
  mostly root-level CI steps in repositories whose root has no manifest and where nothing names the project. A real conflict we miss because of this: node 18 against 20 in two workflows at the root of a repository with no Node manifest.
- **A Dockerfile per runtime release** (for example cypress-docker-images) still compares with the root pin and produces a false finding.
  The same holds for Dockerfiles for unrelated helper images (for example the dev sidecars under grafana's `devenv/docker/blocks/*/Dockerfile`, which use node 16/18 and go 1.17): they are compared with the root pin.
- **A job that declares `defaults.run.working-directory` but overrides one step back to the root** is bound to the default folder for the whole job. This is deliberate: it is how a monorepo says which project a job serves.
- **A root pin that every child project inherits can be reported once per project.** For example a root `.nvmrc` against the Dockerfile of each `examples/*` project:
  each finding is correct under the rules, but a monorepo with dozens of example projects gets a long list. Use `--exclude examples` to leave example folders out.
- **GitLab `include:` is not followed.** Only the `.gitlab-ci.yml` files found in the scanned folder are read; an `image:` inside an included file (`local:`, `project:`, `remote:`) is not compared, so the tool can report "No problems found." while that file pins a conflicting version.
- **A multi-stage Dockerfile that uses different Node versions on purpose** (build on 24, run on 22) is reported as a `VERSION_CONFLICT` "across 1 file", as the rules say.
- **`mise.toml` and `.tool-versions` entries that list several versions** (`python = ["3.12", "3.11"]`) are read for the first one only, the one that is used; the others are not compared.
- A source row shows the value as written in the file, for example `${{ env.PYTHON_VERSION }}`, even where the headline shows the resolved value.
- PyPy and GraalPy (`pypy-3.11` in `actions/setup-python`) are not compared with CPython pins; they are reported as `UNPARSEABLE` with that reason.
- No precision for other tools: we did not label their findings.
- Two false diagnostics in 1 of the 40 repositories (multi-document YAML under `.github/workflows/resources/` that is not a workflow) were fixed in `f80ed6e` and re-measured on the same 40 repositories: the findings are identical to `483d4fb` in every repository and the diagnostics dropped to 0. There is still no real diagnostic (a genuinely broken file) among the 40, so no evidence from real repositories that diagnostics catch broken files (unit tests only).
- This README quotes no timings (milliseconds); they depend on the machine. Every figure here can be reproduced with the stated command.

### End-of-life data

`data/eol.json` is a snapshot of endoflife.date (MIT), built by `node scripts/update-eol.mjs`, the only place (besides research) that uses the network; the CLI and the library never do. It keeps release lines, end-of-life dates, LTS dates and
latest releases, and no product descriptions. Node LTS codenames (`lts/iron`) come from the nodejs.org release index, as major-version-to-name pairs only; if that index cannot be read during an update, the script keeps the previous pairs and warns.

`.github/workflows/update-eol.yml` runs every Monday: it fetches new data and, when something relevant to end-of-life changed (a release line, an end-of-life date, an LTS date or a codename; a new latest patch release alone does not count),
it runs typecheck, tests and build and opens a pull request. The repository setting "Allow GitHub Actions to create and approve pull requests" must be on.

### Credits and license

Code: MIT (`LICENSE`). End-of-life data from endoflife.date (MIT, © endoflife.date contributors) and Node.js LTS codenames from the Node.js release index; details and license text in [`NOTICE`](NOTICE).

### Development

```bash
npm run typecheck && npm test && npm run build
```
