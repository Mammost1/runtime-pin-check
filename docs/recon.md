# rpc-recon — รายงานสำรวจ (2026-11-25)

ตอบ 6 คำถามใน `docs/TASKS.md` หัวข้อ Recon ทุกข้อมีคำสั่งให้รันซ้ำ ข้อความเป็นไทยปน English technical terms
ทุกเลขมาจากคำสั่งที่ระบุ ณ 2026-11-25; scratch ทั้งหมดอยู่ที่ a scratch directory (not committed) (ไม่ commit)
ไม่ push/publish, ไม่ใช้บัญชี/API key (ใช้ `gh` ที่ login อยู่แล้วแบบ read-only)

## Verdict: **GO — แคบลง: เฉพาะ multi-runtime + `--fix` ที่ปลอดภัยกับ range + scope ต่อ project root** (แก้หลังรีวิวรอบสอง)

ฉบับแรกของผมบอกว่า "EOL ไม่มีใครทำ" และ "Action UX ว่าง" — **ผิด** (พลาดคู่แข่ง 2 ราย, ดู R1/R2 ด้านล่าง) ผมรันซ้ำแล้วยืนยัน

กฎ: GO เมื่ออย่างน้อย 2 จาก {EOL, --fix, Action UX, monorepo scopes, python/go} **ไม่ถูกครอบคลุมโดยคู่แข่งที่ยังดูแลอยู่**

| ฟีเจอร์ | ใครทำแล้ว (ที่ผมรันจริง) | ครอบคลุมโดยคู่แข่งที่ "ดูแลอยู่"? |
|---|---|---|
| EOL | **engines-gauge 1.1.0** (Node: ตรวจ EOL ในตัว, offline, resolve `lts/*`/`22.x`; "CI tests Node 20, which reached end-of-life on 2026-04-30"); **@endoflife-ai/eol-check 1.0.3** (EOL ต่อ pin รวม Python/Go แต่ต้องใช้ API key ที่ขอทางอีเมล — ผมรันไม่ได้ ดูข้อจำกัด) | **Node: ครอบคลุมแล้ว** ; Python/Go: เฉพาะเครื่องมือที่ต้องมี key → ช่องว่างเหลือ "EOL python/go แบบ offline ไม่ต้องมี key" |
| Action UX | engines-gauge มี `action.yml` (composite, job summary, SARIF, JSON, Markdown, allowlist) — **ฟรี สำหรับ Node**; nodedrift-ci ฟรีแค่ .nvmrc+engines (Dockerfile/CI = Pro) | **Node: ครอบคลุมแล้ว** ; multi-runtime: ไม่มี |
| `--fix` | conflic `--fix` (เลือกค่าด้วย "authority winner": ผมเห็นมันเสนอแก้ `engines ">=22 <23"` เป็น `"20"` และแก้ Dockerfile FROM — **ไม่ปลอดภัยกับ range**, ต้นทางหาย); engines-gauge `--save` (แก้ได้ช่องเดียว: ยกค่า `engines.node` ขึ้นอย่างเดียว); pre-commit-version-drift (Python อย่างเดียว) | **ไม่ครอบคลุม** → ช่องว่างจริง |
| monorepo scopes (ต่อ project root) | node-drift สแกน recursive แต่เทียบรวมทั้ง repo; engines-gauge รองรับ package เดียว | **ไม่มีใครทำ** → ช่องว่างจริง |
| python/go เทียบข้ามไฟล์ + ไฟล์:บรรทัด + semver | conflic (ถูกต้องแต่ crate ร้าง), toolchain-version-doctor (เทียบสตริงดิบ ไม่มีไฟล์:บรรทัด) | **ไม่มีตัวที่ดูแลอยู่และถูกต้อง** → ช่องว่างจริง |

→ **ผ่านเกณฑ์ 3 ข้อ** (`--fix` ปลอดภัย/คงไบต์, per-project scopes, python/go ข้ามไฟล์ถูกต้อง) ส่วน **EOL และ Action ไม่ใช่จุดต่างอีกต่อไป** (เหลือเป็นฟีเจอร์ประกอบ: EOL offline สำหรับ python/go + Node) ถ้าวางตำแหน่งเป็น "Node-only / EOL / Action" จะแพ้ engines-gauge

**ต้องรู้ 3 อย่าง:**
1. **ตลาดแน่นเร็วมาก**: พบคู่แข่งใหม่ **7 ราย** ใน 6 เดือน (toolchain-version-doctor 2026-06, eol-check 2026-06, node-drift 2026-07, lockstep 2026-09, engines-gauge 2026-10, nodedrift-ci 2026-10, pre-commit-version-drift 2026-10) ทุกตัว ≤3★, ดาวน์โหลด ≤28/สัปดาห์ — ยังไม่มีใครเด่น แต่คูเมืองบาง ต้องชนะด้วยความถูกต้อง (corpus precision) และ `--fix` ที่ไม่ทำลาย range
2. `conflic` ทำสิ่งที่ PLAN.md บอก ("แทบไม่มีคนใช้ ต้นทางหาย") จริง และมี `--fix`, SARIF, `--diff`, 34 extractors — "อ่านครบ + เทียบ" ไม่ใช่จุดต่าง
3. demand ตรง ๆ **อ่อน**: ไม่มี issue โหวตสูงที่ขอ "linter drift ข้ามไฟล์" (ข้อ 2)

**สิ่งที่ต้อง amend ใน TASKS.md (หลักฐานด้านล่าง):** (A1) Node ขั้นต่ำควรเป็น **>= 22** ไม่ใช่ 20.19 เพราะ Node 20 EOL 2026-04-30; (A2) Action ต้องเป็น `using: node24`; (A3) เพิ่ม extractor/กรณีขอบจากข้อ 5; (A4) PLAN.md/TASKS.md: เลิกอ้าง "EOL/Action ไม่มีใครทำ" เป็นจุดต่าง — ตำแหน่งที่ถูก = multi-runtime + `--fix` ปลอดภัยกับ range + scope ต่อ project root (EOL เป็นฟีเจอร์ประกอบแบบ offline)

---
## 1) คู่แข่ง — ติดตั้งและรันบน fixture เดียว

### Fixture (สร้างด้วยสคริปต์ท้ายไฟล์; node 10 pins, python 6, go 5)
| runtime | pins (ไฟล์ → ค่า) |
|---|---|
| node | `.nvmrc` 18 · `.node-version` v20.11.0 · `package.json engines` `>=22 <23` · `volta.node` 16.20.2 · `.tool-versions` 21.7.3 · `mise.toml` lts/iron · `Dockerfile` `ARG NODE_VERSION=24`+`FROM node:${NODE_VERSION}-alpine` และ `node:22.11.0-bookworm-slim` · CI `setup-node` 20 + matrix [18,20,22] · `.gitlab-ci.yml` `node:19` |
| python | `.python-version` 3.8.10 · `pyproject requires-python >=3.12` · `.tool-versions` 3.9.18 · `mise` 3.12 · `Dockerfile python:3.11-slim` · CI `3.10` |
| go | `go.mod` `go 1.24.0` + `toolchain go1.24.2` · `.tool-versions` 1.20.14 · `mise` 1.23 · `Dockerfile golang:1.22` · CI `1.21` |

### ผลรัน (คำสั่งใน "Repro" ท้ายไฟล์) — ติดตั้งจริงทุกตัว ยกเว้นที่ระบุ
| เครื่องมือ (เวอร์ชัน, ยอดนิยม) | คำสั่ง | จับได้ | พลาด/ข้อจำกัด |
|---|---|---|---|
| **conflic 1.1.6** (crate; 172 dl รวม; ต้นทาง GitHub 404) | `conflic .` (exit 1) | 3 ERROR/5 WARN/13 INFO; Node/Python/Go ข้ามไฟล์, ไฟล์:บรรทัด, semver; มี `--fix` (ดู diff), `--format sarif` | **ไม่อ่าน**: `volta`, `mise.toml`, `.gitlab-ci.yml`, `go.mod toolchain`, matrix; ไม่มี EOL; ไม่แยก project root; `${NODE_VERSION}` อ่านเป็นสตริงดิบ (`node:${NODE_VERSION}-alpine`) |
| **node-drift 0.1.0** (npm; 6 dl/สัปดาห์; repo 0★ สร้าง+push 2026-07-15 วันเดียว) | `nodrift .` (exit 0 ตาม default = report-only; ใช้ `--fail-on drift` เพื่อให้ fail) | 10 declarations จาก 8 ไฟล์: อ่านครบ node ทุกไฟล์รวม mise, volta, gitlab, ARG; สรุป "7 versions"; มี `--fail-on`, `--expect`, `--json` | **Node อย่างเดียว**; ไม่มี EOL; `--fix` ยังเป็น roadmap; รายงานเทียบกับ "anchor" (volta) ไม่ใช่คู่ขัดกันทีละไฟล์ |
| **toolchain-version-doctor** (pip จาก source, 0★, 2026-06-25) | `toolchain-version-doctor .` | เตือน `DRIFT: node declares multiple versions: ...` ราย runtime (node/python/go) | เทียบ **สตริงดิบ** (`20` vs `21.7.3` ฯลฯ) ไม่มี semver; **ไม่แสดงไฟล์:บรรทัด**; ไม่เห็น `.nvmrc` 18, `.node-version`, volta, `.python-version`, go.mod; ไม่มี fix/EOL |
| **versions-le 1.3.0** (npm; 15 dl) | `versions-le .` | 0 findings, 3 refusals "cross_ecosystem" | รายงานว่าตรงกัน ทั้งที่ขัดหมด — ไม่อ่าน .nvmrc/Dockerfile/mise/tool-versions |
| **nodedrift-ci 1.0.0** (GitHub clone; 0★ 2026-10-20) | `node cli.js check .` | free mode: `DRIFT [enginesMismatch] .nvmrc pins Node 18, which does not satisfy package.json engines.node ">=22 <23"` (ผมแก้แล้ว — ฉบับแรกผมบันทึกว่า "no drift found" ซึ่งรันซ้ำไม่ได้ผลนั้น; ผู้ตรวจรอบสอง และผมรันซ้ำได้ DRIFT) | ข้อจำกัดจริงคือที่มันพิมพ์เอง: Dockerfile + workflows ต้อง **Pro (จ่ายเงิน)**; free ตรวจแค่ .nvmrc+engines |
| **engines-gauge 1.1.0** (npm; 14 dl/สัปดาห์; MIT; 3★; สร้าง 2026-10-14) | `engines-gauge` (exit 1) | 2 high/4 medium/1 low/1 info พร้อมไฟล์:บรรทัดและคำแนะนำแก้ต่อรายการ; อ่าน engines, .nvmrc, .node-version, .tool-versions, volta, Dockerfile FROM, setup-node (+matrix); **EOL ในตัว** (`ci-eol`); มี Action + SARIF + JSON + `--save` | **Node เท่านั้น**; ไม่มี Python/Go; ไม่อ่าน mise.toml, .gitlab-ci.yml; พลาด `ARG NODE_VERSION=24` (เห็น 22.11.0 ตัวเดียว); ไม่มี scope ต่อ project; `--save` แก้ได้ช่องเดียว (engines) |
| **@endoflife-ai/eol-check 1.0.3** (npm; 28 dl/สัปดาห์; MIT) | `eol-check scan` | (จาก README/source ไม่ใช่ผลรัน) อ่าน .nvmrc/.node-version/.python-version/.tool-versions/engines/go.mod/Dockerfile FROM แล้วรายงาน EOL ต่อ pin รวม Python/Go | **ผมรันได้แค่ "An API key is required. Nothing was checked."** (key ฟรีแต่ต้องใช้อีเมลคน — ผมไม่สมัคร; มีแพ็กเกจเสียเงิน) ; ไม่เทียบ pin กันเอง; ไม่อ่าน mise/workflow/gitlab |
| **pre-commit-version-drift** (0★, push ล่าสุด 2026-11-24; ต้อง Python ≥3.11) | `version-drift --toolchain python` และ `--toolchain node` (ใน venv 3.11) | เป็น hook แบบ "source-of-truth file" (`.python-version`/`.nvmrc`) ; มี `--fix` | **fixture: exit 0 ไม่มี finding เลยทั้ง python และ node** (ทั้งที่ Dockerfile 3.11, CI 3.10, pyproject >=3.12 ขัดกับ .python-version 3.8.10) — จับเฉพาะรูปแบบที่มันรู้จัก; `--toolchain go` = error "unknown toolchain"; พิมพ์เตือนว่า `.nvmrc` `18` มีแค่ 1 component |
| check-node-version 4.2.1 (372k/สัปดาห์) | `check-node-version --package` | เทียบ **node ที่ติดตั้ง** กับ `engines` (ตอบ "want >=22 <23, have 24.21.0") | ทำงานคนละงาน: ไม่เทียบไฟล์ pin กันเอง |
| ls-engines 0.10.1 (23k/สัปดาห์) | `ls-engines` | เทียบ engines ของ package กับ dependency graph | คนละงาน (ไม่อ่าน .nvmrc/Dockerfile/CI) |
| syncpack 15.3.4 (4.7M/สัปดาห์) | `syncpack lint` | "No issues found" | ตรวจ dependency version ใน monorepo ไม่ใช่ runtime pin (คนละงาน) |
| mise 2026.11.14 | `mise ls`, `mise doctor` | อ่าน `mise.toml` เหนือ `.tool-versions`; doctor เตือนแค่ "tool not installed" | ไม่เทียบกับ Dockerfile/CI/.nvmrc เลย |
| Renovate / Dependabot | **อ่านเอกสาร/issue เท่านั้น ไม่ได้รัน** | Renovate มี manager `nvm`; Dependabot ยังไม่ bump `.nvmrc` (dependabot-core #4808 open) | ทำหน้าที่ "bump" ไม่ใช่ตรวจความขัดแย้งข้ามไฟล์ |
| `lockstep` (srivtx, 0★) | clone แล้วอ่าน README เท่านั้น | Node/Bun/package-manager drift | ไม่ได้รัน (ใช้ Bun) |

**GitHub Action ที่ค้นเจอ** (`gh api search/repositories`): `growaleaf/nodedrift-ci` (ข้างบน), `spotship/pre-commit-version-drift` (pre-commit hook), `Booyaka101/runner-drift` (คนละงาน: runner image drift). **Node-only ฟรี: `engines-gauge` (มี `action.yml`); multi-runtime ข้ามไฟล์ฟรี: ไม่มี Action**

---
## 2) Demand (ลิงก์, reactions ณ 2026-11-25)
ไม่มี issue โหวตสูงที่ขอ "ตัวตรวจ drift" ตรง ๆ — มีเฉพาะความต้องการข้างเคียง:
- nvm-sh/nvm#651 "Use package.json engines version?" — 234 reactions, 175 comments, open ตั้งแต่ 2015 (ต้องการ single source)
- actions/setup-node#32 "Support .nvmrc" — 187 reactions (ปิดหลังเพิ่ม `node-version-file`)
- dependabot/dependabot-core#4808 "Dependabot to handle .nvmrc" — 24 reactions, open (reopened) ; #4234 "Auto update node version on .nvmrc" — 17 reactions
- renovatebot/renovate#9739 "Sync versions within a group" — 26 reactions, open (ใกล้เคียง: ให้ค่าที่เกี่ยวข้องขยับพร้อมกัน)
- volta-cli/volta#282 — 40 reactions (จาก pass ก่อน)
- หลักฐานทางอ้อม: repo เล็ก ๆ ที่เพิ่งเปิดเรื่องเดียวกัน เช่น Chulilee/InterChangableTrade-Core#243 "Align the Node version across CI, Docker, and add engines plus .nvmrc", MythologIQ-Labs-LLC/FailSafe#592 "Reconcile Node 20 .nvmrc, Node 22 CI" — เป็นเคสจริงของปัญหา (0 reactions)
สรุป: ปัญหามีจริงและเกิดซ้ำ แต่ "ขอเครื่องมือตรวจ" ยังไม่มีเสียงรวมกลุ่ม

## 3) ชื่อ npm
`curl -s -o /dev/null -w "%{http_code}" https://registry.npmjs.org/runtime-pin-check` → **404 = ว่าง**. (ตรวจ 404 ด้วย: `runtime-pins`, `pincheck`, `node-pin-check`, `toolchain-pin-check`, `runtime-drift`, `pin-drift` — ว่างทั้งหมดเป็นชื่อสำรอง)

## 4) endoflife.date
- Endpoint: `GET https://endoflife.date/api/v1/products/{nodejs|python|go}/` → `{schema_version, generated_at, last_modified, result:{name, releases:[{name:"22", isLts, ltsFrom, isEol, eolFrom:"2027-04-30", isMaintained, latest:{name,date}}]}}` (v1 อยู่ใน **Beta**: README บอก "breaking changes can happen") ; legacy `GET /api/nodejs.json` → `[{cycle, eol, lts, latest, ...}]`
- Go: รุ่นล่าสุด 1.27/1.26 มี `eolFrom: null` (ยังไม่ประกาศ); 1.25 → 2026-08-19 — โค้ดต้องรับ null
- **สถานะ Node ณ 2026-11-25** (จาก API): 26 ok (EOL 2029-04-30), 25 EOL 2026-06-01, 24 ok (2028-04-30), 23 EOL, 22 ok (**2027-04-30**), 21 EOL, **20 EOL 2026-04-30**
- License: repo `endoflife-date/endoflife.date` เป็น **MIT** (`gh api repos/endoflife-date/endoflife.date --jq .license.spdx_id`; LICENSE: "Copyright 2020 endoflife.date contributors") → redistribute snapshot ได้ถ้าคงประกาศลิขสิทธิ์/ข้อความ MIT; README ระบุว่า **คำอธิบายสินค้าดัดจาก Wikipedia (CC BY-SA 3.0)** → **อย่านำ description มาไว้ใน snapshot** เก็บเฉพาะ `cycle/eolFrom/ltsFrom/latest`
- Attribution ที่แนะนำใน `data/eol.json` และ NOTICE: "EOL data from endoflife.date (https://endoflife.date), MIT License, © endoflife.date contributors, fetched <date>"
- **ที่ตรวจไม่ได้:** ไม่พบหน้า "terms of use" ของ API แยกต่างหาก และเอกสาร API ไม่ระบุ rate limit ที่ผมอ่านเจอ — ตัวสคริปต์ update ควร fetch สัปดาห์ละครั้ง (ตาม workflow ในแผน) พร้อม User-Agent ที่ระบุตัวตนโปรเจกต์ (ไม่ใส่ข้อมูลส่วนตัว)

## 5) ตัวอย่างไฟล์จริง (repo + path + บรรทัด; ดึงด้วย `gh api search/code` + `gh api repos/.../contents`, สคริปต์ `samples.py`)
**Node**
- `.nvmrc`: `lts/*` — kodu-ai/claude-coder `extension/.nvmrc` L1, Kotlin/kotlin-lsp `kotlin-vscode/.nvmrc` L1 · `v22.22.3` — goharbor/harbor `src/portal/.nvmrc` L1 · `v22.4.3` — BrainJS/brain.js `.nvmrc`
- `.node-version`: `22.22.1` — nomcopter/react-mosaic · `24.22.2` — mountain-loop/yaak `packages/plugin-runtime/.node-version`
- `.tool-versions`: `nodejs 22.23.1` gitlabhq/gitlabhq L2 · **`nodejs        22.12.0`** (หลายช่องว่าง) smartcontractkit/chainlink L3 (และ `golang        1.27.3` L1, `python        3.10.5` L9)
- `mise.toml`: `node = "lts"` butlerx/wetty `.mise.toml` L2 · `node = "22"` conventional-changelog/commitlint `.mise.toml` L2 · `node = "24.16.0"` DevExpress/DevExtreme · **`idiomatic_version_file_enable_tools = ["bun","node"]`** metabase/metabase `mise.toml` L39 (= ตัวชี้ไปยัง `.nvmrc`; ไม่ใช่ pin)
- `package.json engines`: `">=20 <23 || >=24 <25"` bofandra/satusehat-integration-sdk `sdks/node/package.json` L17 (range แบบ `||`) · `">=20 <23"` auth0-samples/auth0-ai-samples L11
- `volta.node`: `"22.22.2"` preactjs/preact `package.json` L225 · `"14.21.3"` streamich/react-use L160
- `devEngines.runtime` **มีใช้จริง**: pure-css/pure `package.json` L36-38, style-dictionary/style-dictionary L34-40 (`"runtime": {"name":"node", ...}`) → ควรเพิ่มเข้า extractor (ใช้ได้ตามเงื่อนไข "if recon finds real use")
- Dockerfile: `FROM node:22.23.1-bookworm-slim@sha256:813a...` nearai/ironclaw L16 · **`FROM node:lts-alpine@sha256:...`** raineorshine/npm-check-updates L1 · `ARG NODE_VERSION=22.17.0` + `FROM node:${NODE_VERSION}-bullseye-slim AS build` botpress/botpress L6/L9 · **`ARG NODE_VERSION=18.18.2-slim`** (ค่า default มี suffix) eritislami/evobot L1-2 · `FROM public.ecr.aws/docker/library/node:26-alpine AS web` DefGuard/defguard L1 · **`FROM public.ecr.aws/lambda/nodejs:24`** humanmade/tachyon L1 (ชื่อ image ต่าง: `nodejs` ไม่ใช่ `node`)
- Workflows: `node-version-file: '.nvmrc'` Fillo001/greenledger `.GitHub/workflows/Ci.Yml` L14/L28 (ชื่อไดเรกทอรีตัวพิมพ์ผสม!) · `node-version: [18.x, 20.x]` m-7labs/discord-ai-moderator L15 · `node-version: [20.x]` + `${{ matrix.node-version }}` Ibraah2/LEOPARD L18/L27 · `node-version: lts/*` VickyNovarese/Playwright-Proyectos L15 · `node-version: 14.x` Fortuna0006/ono-tebe-nado L20
- `.gitlab-ci.yml`: `image: node:${NODE_VERSION}` manfredsteger/polly `.gitlab-ci.yml.restored` L11 (ตัวแปร → UNPARSEABLE/resolve ไม่ได้)
**Python**
- `.python-version`: `3.12` Zyphra/Zonos · **หลายบรรทัด** `3.14.0 / 3.13.7 / 3.12.11` Mindwerks/worldengine L1-3 (pyenv multi-version)
- `pyproject requires-python`: `">=3.8"` PyO3/maturin template · `">=3.10"`; Poetry `python = ">=3.10,<3.14"` EttusResearch/uhd L20 · `"^3.10"` QIN2DIM/hcaptcha-challenger L35 · `">=3.9, <=3.13"` (ช่องว่างหลังคอมมา) noclocks/NoClocksVault L82
- `runtime.txt`: `python-3.7.6` CodeForPhilly/chime L1 · `python-3.7` stefmolin/Hands-On-Data-Analysis-with-Pandas L1
- `.tool-versions`: `python 3.12.1` authgear/authgear-server L3; `FROM python:slim` / `python:slim-buster` (ไม่มีเวอร์ชัน → floating) Spiker1992/python-event-sourcing L1
- workflows: `python-version: ["3.9","3.10","3.11"]` DailyInvestors/The-Guardian-Angel L17 + `${{ matrix.python-version }}` L31
**Go**
- `go.mod`: `go 1.24.0` + `toolchain go1.24.4` RoaringBitmap/roaring L3/L5
- `.tool-versions`: `golang 1.26.11` authgear/authgear-server L1 ; chainlink `golang        1.27.3`
- Dockerfile: `FROM golang:alpine as builder` genuinetools/weather L1 (ไม่มีเวอร์ชัน, `as` ตัวเล็ก)
- workflows: `go-version-file: go.mod` wiz-sec-public/opentelemetry-ebpf-profiler `.github/workflows/env/action.yml` L28 (composite action ใน subfolder) ; mise `go = "latest"` replicate/cog `mise.toml` L35

**กรณีขอบที่ต้องมี test**: `lts/*`, `lts`, `v22.22.3`, หลายช่องว่างใน `.tool-versions`, `||` range, ARG default ที่มี suffix (`18.18.2-slim`), `@sha256:` digest, `public.ecr.aws/lambda/nodejs`, ชื่อโฟลเดอร์ `.GitHub/Workflows` (case ต่าง — บนไฟล์ระบบ case-insensitive/Windows), `.python-version` หลายบรรทัด, unquoted `3.10` ใน YAML = ตัวเลข 3.1 (คำเตือนใน node-drift README ยืนยัน), `FROM python:slim` ไม่มีเวอร์ชัน, `${{ matrix.* }}`, `${VAR}` ใน gitlab

## 6) GitHub Actions JS runtime
- `actions/checkout`, `setup-node`, `setup-python`, `setup-go` ล่าสุดทั้งหมด `using: node24` (`gh api repos/actions/<name>/contents/action.yml --jq .content | base64 -d | grep using`)
- actions/runner v2.338.2 (2026-10-26) release note: "Update Node.js 20 removal date to September 23rd, 2026" → **ถึงกำหนดแล้ว** → Action ของเราต้อง `using: node24`
- **Amendment A1:** `engines.node` ของแพ็กเกจเอง: สัญญาเขียน "Node >= 20.19 (oldest line still supported)" แต่ endoflife.date บอก Node 20 **EOL 2026-04-30** → oldest supported = 22 (EOL 2027-04-30) ; ผมเสนอ `>=22` (สอดคล้องกฎในสัญญาเอง)

---
## ความเสี่ยง/สิ่งที่ตรวจไม่ได้
- `@endoflife-ai/eol-check` ทำงานจริงไม่ได้ถ้าไม่มี key; ผลจาก README/source เท่านั้น
- `lockstep`, Renovate, Dependabot: ไม่ได้รันจริง (ระบุแล้วในตาราง)
- ผลของ conflic ขึ้นกับ binary ที่ build จาก crates.io (ต้นทาง 404)
- demand ตรง ๆ อ่อน; คู่แข่งใหม่ออกมาเรื่อย ๆ (อาจมีเพิ่มภายในสัปดาห์) — ถ้าจะ GO ควรทำเร็ว
- ไม่มีหน้า terms ของ endoflife API ให้อ่าน; ใช้ MIT ของ repo เป็นฐาน
- ยอดดาวน์โหลดเป็นสัปดาห์ 2026-11-17..23 (`api.npmjs.org/downloads/point/last-week/<pkg>`)

## Repro (2nd agent: รันตามลำดับ; ต้อง node, npm, cargo, python3, gh)
```sh
S=$(mktemp -d); cd $S
# 1) fixture
sh make-fixture.sh fixture      # สคริปต์อยู่ท้ายไฟล์นี้ (บันทึกเป็น make-fixture.sh)
# 2) competitors
mkdir tools && cd tools && npm init -y >/dev/null && npm i versions-le check-node-version ls-engines syncpack node-drift engines-gauge @endoflife-ai/eol-check
cargo install conflic --locked --root cf
git clone --depth 1 https://github.com/growaleaf/nodedrift-ci
git clone --depth 1 https://github.com/Naviepoo22/toolchain-version-doctor && python3 -m venv v && v/bin/pip install ./toolchain-version-doctor
git clone --depth 1 https://github.com/spotship/pre-commit-version-drift && python3.11 -m venv v311 && v311/bin/pip install ./pre-commit-version-drift   # ต้อง Python >=3.11
gh release download -R jdx/mise -p '*macos-arm64.tar.gz' -D . && tar xzf mise-*.tar.gz   # mise/bin/mise
cd ../fixture
../tools/cf/bin/conflic .                     # 3 ERROR / 5 WARN / 13 INFO
../tools/cf/bin/conflic --fix --dry-run .     # proposed edits
../tools/node_modules/.bin/nodrift .          # 10 declarations, 9 errors 1 warning, node only
../tools/node_modules/.bin/versions-le .      # consistent / 0 findings
node ../tools/nodedrift-ci/cli.js check .     # "no drift found" (free mode)
../tools/v/bin/toolchain-version-doctor .     # 3 DRIFT lines, no file:line
../tools/v311/bin/version-drift --toolchain python   # exit 0, no output (miss)
../tools/node_modules/.bin/engines-gauge               # exit 1, 8 findings, node only
../tools/node_modules/.bin/eol-check scan              # needs email-gated API key; not runnable here
../tools/node_modules/.bin/check-node-version --package ; ../tools/node_modules/.bin/ls-engines ; ../tools/node_modules/.bin/syncpack lint
MISE_YES=1 MISE_DATA_DIR=$S/md MISE_CONFIG_DIR=$S/mc ../tools/mise/bin/mise trust . && ../tools/mise/bin/mise ls && ../tools/mise/bin/mise doctor
# 3) npm name
curl -s -o /dev/null -w "%{http_code}\n" https://registry.npmjs.org/runtime-pin-check     # 404
# 4) EOL
curl -s https://endoflife.date/api/v1/products/nodejs/ | python3 -c "import json,sys;[print(x['name'],x['isEol'],x['eolFrom']) for x in json.load(sys.stdin)['result']['releases'][:7]]"
gh api repos/endoflife-date/endoflife.date --jq .license.spdx_id    # MIT
# 6) GHA runtime
for a in checkout setup-node setup-python setup-go; do gh api repos/actions/$a/contents/action.yml --jq .content | base64 -d | grep using:; done
```
### make-fixture.sh
```sh
#!/bin/sh
# Builds the recon fixture in $1 (default ./fixture). 9 node pins, 6 python pins, 5 go pins.
D=${1:-fixture}; mkdir -p "$D/.github/workflows" && cd "$D" || exit 1
printf '18\n' > .nvmrc; printf 'v20.11.0\n' > .node-version
printf '{\n  "name": "fx",\n  "version": "1.0.0",\n  "engines": { "node": ">=22 <23" },\n  "volta": { "node": "16.20.2" }\n}\n' > package.json
printf 'nodejs 21.7.3\npython 3.9.18\ngolang 1.20.14\n' > .tool-versions
printf '[tools]\nnode = "lts/iron"\npython = "3.12"\ngo = "1.23"\n' > mise.toml
printf 'ARG NODE_VERSION=24\nFROM node:${NODE_VERSION}-alpine AS build\nFROM node:22.11.0-bookworm-slim\nFROM python:3.11-slim AS py\nFROM golang:1.22 AS go\n' > Dockerfile
cat > .github/workflows/ci.yml <<'Y'
name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node: [18, 20, 22]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: actions/setup-python@v5
        with:
          python-version: '3.10'
      - uses: actions/setup-go@v5
        with:
          go-version: '1.21'
Y
printf 'test:\n  image: node:19\n  script: [npm test]\n' > .gitlab-ci.yml
printf '[project]\nname = "fx"\nversion = "0.1.0"\nrequires-python = ">=3.12"\n' > pyproject.toml
printf '3.8.10\n' > .python-version
printf 'module example.com/fx\n\ngo 1.24.0\n\ntoolchain go1.24.2\n' > go.mod
```
