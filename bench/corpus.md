# rpc-corpus — วัด precision บน repo จริง 40 ตัว (2026-11-25)

มี 2 รอบในไฟล์นี้: **Rerun 483d4fb** (ด้านล่าง, รอบสุดท้ายหลัง A12–A14 และ rpc-read-diag) และ **Baseline 389c91f** (รายงานเดิม, เก็บไว้เปรียบเทียบ, ท้ายไฟล์)
README ควรอ้างเฉพาะตัวเลขของ Rerun

# Rerun @ `483d4fb` (rpc-corpus-rerun)

CLI: **`483d4fb`** (`git rev-parse HEAD` ของ main; build ด้วย `npm run build`) · `node dist/cli.js <dir> --json --date 2026-11-25` · repo 40 ตัว SHA เดิมจาก `bench/repos.txt` · labelling rules เดิม
เทียบกับ A12: `docs/TASKS.md` "Acceptance (rpc-corpus-rerun)"

## ผลเทียบเกณฑ์ A12
| เกณฑ์ A12 | ผล | ผ่าน? |
|---|---|---|
| strict precision ≥ 80% | **79.9%** (111 T / 139) · factual (T+TI) **99.3%** (138/139) | **ไม่ผ่านแบบเข้ม ขาด 1 ตัว (ต้อง ≥112 จาก 139)** ; ผ่านแบบ factual. แก้หลัง reviewer C1: `hatamoto#1` T→TI (ฉบับก่อนหน้าผมรายงาน 80.6%). gate ที่ใช้คือ factual (ดูหัวข้อ Gate ด้านล่าง) |
| OUTSIDE_RANGE strict ≥ 80% | **50.0%** (2 T + 2 TI / 4; factual 100%) | **ไม่ผ่านแบบเข้ม** : 2 ตัวที่เป็น TI คือ `yepanywhere#2` (`sqlite.yml:67` node 20.12.2 — ทดสอบ "reject unsupported runtime" โดยตั้งใจ; review เปลี่ยนจาก F-negtest เป็น TI) และ `hatamoto#1` (matrix leg go 1.26 ถูก gate "Does this leg apply?" ใน `ci.yml:440-454` ข้ามเองเมื่อ go.mod ประกาศ 1.27 — reviewer C1). ถ้านับ TI = 100% |
| F-scope = 0 | **0** | ผ่าน |
| F-fixture = 0 | **0** | ผ่าน |
| ทุก T ที่หายไปมีเหตุผล | 22 T + 11 TI รายตัวด้านล่าง | ผ่าน |

### Gate ที่ใช้ตัดสิน (A17, ตัดสินหลังรีวิว) และนิยามตัวเลข
- **strict precision** = T / ทุก finding (นับเฉพาะ finding ที่ถูกต้องและเจ้าของควรแก้) · **factual precision** = (T + TI) / ทุก finding (TI = จริงตามข้อเท็จจริง เจ้าของตั้งใจ เช่น matrix ที่ทดสอบ version ต่ำสุด, ขั้นตอนทดสอบ "reject unsupported runtime", job ที่ข้ามเองด้วย gate)
- **Ship gate (A17):** F-scope = 0, F-fixture = 0, factual ≥ 95%, และ F ที่เหลือทุกตัวถูกระบุเป็นข้อจำกัดที่รู้แล้ว → **ผ่านทั้งหมด** (F-scope 0, F-fixture 0, factual **99.3%**, F ที่เหลือ 1 ตัวคือ `cypress-docker-images#1` ระบุข้างล่าง)
- **strict** พลาดเส้น 80% ไปหนึ่ง label (**79.9%**, ต้อง ≥112/139) และ OUTSIDE_RANGE strict **50%** (2 T + 2 TI, **n = 4** เล็กมาก) — ไม่ปัดขึ้น; A17 ไม่ทำรอบปรับ precision เพิ่มบน 40 repo ชุดเดิม (กัน overfit); ข้ออ้าง precision ครั้งต่อไปต้องใช้ corpus ใหม่ที่ไม่เคยเห็น
- read-diag: บน `f80ed6e` diagnostics = 0 (chronograf 2 → 0) ดูหัวข้อ read-diag

**F ที่เหลือ 1 ตัว:** `cypress-io_cypress-docker-images#1` (F-image): Dockerfile ต่อ-version ใต้ `base-internal/releases/node-20/*/Dockerfile` ยังถูกผูกกับ root project (root มี `package.json` → กฎ A12 "ไฟล์ใน project root ผูกกับ root ที่ใกล้ที่สุด") แล้วขัดกับ `.node-version`/`.nvmrc`. วิธีแก้ที่เสนอ: Dockerfile ที่อยู่ในไดเรกทอรีย่อยที่ไม่มี manifest ของตัวเอง และมี Dockerfile พี่น้องหลายตัวต่างเวอร์ชัน ให้ถือเป็น image แยก (ไม่เทียบกับ pin ของ root) หรืออย่างน้อยลดระดับเป็น info

## ก่อน/หลัง (ชุดเดียวกัน 40 repo)
| | Baseline 389c91f (label แก้ตาม review) | Rerun 483d4fb |
|---|---|---|
| findings | 275 | **139** |
| T / TI / F | 127 / 36 / 112 | **111 / 27 / 1** |
| strict (T) | 46.2% | **79.9%** |
| factual (T+TI) | 59.3% | **99.3%** |
| OUTSIDE_RANGE | 71 findings, strict 4.2% | **4 findings, strict 50.0%** |
| F-scope / F-fixture | 61 / 35 | **0 / 0** |
| F-resolvable / F-misparse / F-negtest | 13 / 1 / 0 | 0 / 0 / 0 |
| repo ที่มี finding | 31 | 30 |
Label ที่แก้ใน baseline: `fabriziosalmi_certmate#1` F-scope→T; `kzahel_yepanywhere#3/#4` F-negtest→TI (ตามที่ review ขอ) และ `Zen-Labs-Corp_hatamoto#1` T→TI (reviewer C1) — baseline จาก T 127/TI 33/F 115 (ฉบับแรกของผม) เป็น **127/36/112** (strict 46.2% เท่าเดิมโดยบังเอิญ: certmate +1, hatamoto −1; factual 59.3%)

## ผลต่อชนิด finding (Rerun)
| code | findings | T | TI | F | เข้ม | ข้อเท็จจริง |
|---|---|---|---|---|---|---|
| EOL_RUNTIME | 70 | 51 | 19 | 0 | 72.9% | 100.0% |
| FLOATING_ALIAS | 18 | 18 | 0 | 0 | 100.0% | 100.0% |
| OUTSIDE_RANGE | 4 | 2 | 2 | 0 | 50.0% | 100.0% |
| PRECISION_MISMATCH | 8 | 8 | 0 | 0 | 100.0% | 100.0% |
| UNPARSEABLE | 16 | 16 | 0 | 0 | 100.0% | 100.0% |
| VERSION_CONFLICT | 23 | 16 | 6 | 1 | 69.6% | 95.7% |
| **ทั้งหมด** | 139 | 111 | 27 | 1 | 79.9% | 99.3% |
(อ่านค่าตรง ๆ: `node bench/corpus.mjs report <workdir> <outdir>`; citations ตรวจ 384 รายการ ผิด 0)

## Finding ที่เคยเป็น T/TI แล้วไม่อยู่ตามเดิม (33 = T 22 + TI 11) — เหตุผลทุกตัว
ตัวเลขนี้คำนวณด้วย `node bench/corpus.mjs lost <baselineOut> <rerunOut>` (baselineOut = ผลของ `389c91f`)
ชนิด: **D** = drift เดิมยังถูกรายงานอยู่ (รวม/ย้ายไปอยู่ใน finding อื่น, ไม่มีข้อมูลหาย) · **R** = หายตามกฎ A12 (source ไม่ผูกกับ project ใดหรือผูกคนละ project จึงไม่ถูกเทียบกัน — "precision over recall") · **X** = source ไม่ถูกอ่านแล้ว (fixture) แต่ส่วนที่เหลือยังรายงาน
**หายเพราะ bug: ไม่พบ (0 ตัว)** — เกณฑ์ที่ใช้: source ที่ขาดไปต้องอยู่ในรายการ unbound ของ CLI หรือมี `boundTo` เป็นคนละ project (ตรวจจาก JSON ของ CLI เอง) ; นี่คือการตรวจว่า "สอดคล้องกับกฎ A12" ไม่ใช่การพิสูจน์ว่ากฎถูกต้อง

| สรุป | T | TI | รวม |
|---|---|---|---|
| D — ยังรายงานอยู่ | 7 | 1 | 8 |
| X — fixture ไม่อ่านแล้ว (ส่วนจริงยังอยู่) | 1 | 0 | 1 |
| R — หายตามกฎ A12 | 14 | 10 | 24 |
| รวม | 22 | 11 | 33 |

| id (baseline) | label | code | ชนิด | เหตุผล |
|---|---|---|---|---|
| DRYTRIX_TimeTracker#1 | T | VERSION_CONFLICT | D | same drift still reported in #1 |
| DRYTRIX_TimeTracker#2 | TI | VERSION_CONFLICT | D | same drift still reported in #2 |
| SourceWeft_SourceWeft#2 | T | VERSION_CONFLICT | D | same drift still reported in #1 |
| SourceWeft_SourceWeft#4 | T | OUTSIDE_RANGE | R | bound to a different project by A12: apps/backend/package.json:162 -> ["apps/backend"]; rest still reported in #2 |
| agentrq_agentrq#1 | T | VERSION_CONFLICT | R | UNBOUND by A12: 3 of 8 sources not tied to any project; rest still reported in #1, #2 |
| agentrq_agentrq#2 | T | VERSION_CONFLICT | R | UNBOUND by A12: 3 of 9 sources not tied to any project; rest still reported in #1, #2 |
| boxlite-ai_boxlite#2 | T | VERSION_CONFLICT | D | same drift still reported in #1, #2 |
| boxlite-ai_boxlite#3 | T | VERSION_CONFLICT | R | bound to a different project by A12: apps/image-service/Dockerfile:1 -> ["apps/image-service"]; rest still reported in #1 |
| boxlite-ai_boxlite#4 | T | VERSION_CONFLICT | R | bound to a different project by A12: apps/proxy/Dockerfile:1 -> ["apps/proxy"]; rest still reported in #1 |
| boxlite-ai_boxlite#5 | T | VERSION_CONFLICT | R | bound to a different project by A12: apps/runner/Dockerfile:1 -> ["apps/runner"]; rest still reported in #1 |
| caura-ai_caura#2 | T | VERSION_CONFLICT | R | bound to a different project by A12: .github/workflows/publish-npm-caura-client.yml:88 -> ["clients/npm-caura-client"]; rest still reported in #1 |
| caura-ai_caura#3 | T | VERSION_CONFLICT | R | bound to a different project by A12: .github/workflows/publish-npm-caura-sdk.yml:88 -> ["clients/npm-caura-sdk"]; rest still reported in #1 |
| caura-ai_caura#4 | T | VERSION_CONFLICT | R | bound to a different project by A12: .github/workflows/publish-npm-sdk.yml:87 -> ["clients/npm-sdk"]; rest still reported in #1 |
| caura-ai_caura#5 | T | VERSION_CONFLICT | R | bound to a different project by A12: .github/workflows/publish-npm-client.yml:86 -> ["clients/typescript"]; rest still reported in #1 |
| caura-ai_caura#6 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 10 sources not tied to any project |
| caura-ai_caura#7 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 14 sources not tied to any project |
| caura-ai_caura#8 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 14 sources not tied to any project |
| caura-ai_caura#9 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 14 sources not tied to any project |
| caura-ai_caura#10 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 14 sources not tied to any project |
| ccfos_huatuo#1 | T | VERSION_CONFLICT | R | UNBOUND by A12: 2 of 2 sources not tied to any project |
| fabriziosalmi_certmate#1 | T | VERSION_CONFLICT | R | bound to a different project by A12: .github/workflows/ci.yml:81 -> ["."]; .github/workflows/ci.yml:1013 -> ["."] |
| fabriziosalmi_certmate#2 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 16 of 16 sources not tied to any project |
| fabriziosalmi_certmate#3 | TI | VERSION_CONFLICT | R | UNBOUND by A12: 14 of 14 sources not tied to any project |
| frederikemmer_MediaLyze#1 | T | VERSION_CONFLICT | R | UNBOUND by A12: 1 of 3 sources not tied to any project |
| kzahel_yepanywhere#2 | T | VERSION_CONFLICT | D | same drift still reported in #1 |
| kzahel_yepanywhere#4 | TI | OUTSIDE_RANGE | R | bound to a different project by A12: packages/server/package.json:72 -> ["packages/server"]; rest still reported in #2 |
| kzahel_yepanywhere#7 | T | PRECISION_MISMATCH | D | same drift still reported in #4 |
| openenv_OpenEnv#3 | T | VERSION_CONFLICT | D | same drift still reported in #1 |
| openenv_OpenEnv#58 | TI | PRECISION_MISMATCH | R | bound to a different project by A12: envs/helium_browser_env/server/Dockerfile:1 -> ["envs/helium_browser_env"]; rest still reported in #5 |
| openenv_OpenEnv#59 | TI | PRECISION_MISMATCH | R | bound to a different project by A12: tests/validation_runtime/.python-version:1 -> ["tests/validation_runtime"]; rest still reported in #5 |
| terralist_terralist#2 | T | PRECISION_MISMATCH | R | UNBOUND by A12: 2 of 3 sources not tied to any project |
| terralist_terralist#5 | T | PRECISION_MISMATCH | D | same drift still reported in #3 |
| updatecli_updatecli#1 | T | VERSION_CONFLICT | X | source no longer extracted: pkg/plugins/resources/dockerfile/simpletextparser/test_fixtures/ARG.Dockerfile; rest still reported in #1 |

**ต้นทุน recall ที่ต้องรู้ (R ที่เป็น T จริง):** `ccfos_huatuo#1` (node 18 vs 20 — ทั้งสอง workflow UNBOUND เพราะ root ไม่มี manifest node และ step ไม่ระบุ path), `MediaLyze#1` (root Dockerfile `node:24-alpine` UNBOUND เทียบกับ CI 22), `certmate#1` (CI node 20 ผูก root, publish-mcp 22 ผูก `mcp` → คนละ project), `terralist#2` (python `3.x` unbound), และ `caura#2–#5`/`boxlite#3–#5`/`SourceWeft#4` (สำเนาต่อ-project ของ drift เดิมที่ root ยังรายงานอยู่ หรือ Dockerfile/CI ของ project นั้นตอนนี้ไม่มีคู่เทียบ) ตามกฎ A12 ("a missed cross-scope drift is acceptable, a false one is not") ไม่ใช่ bug แต่เป็นราคาของ precision
**Source ที่ไม่ผูก project: 77 ตัวใน 18 repo** (python 50, node 22, go 5) — ส่วนใหญ่คือ CI `setup-*` ที่ root ที่ไม่มี manifest และไม่มี path hint (UniClipboard 18, certmate 18, AVA 11); ยัง ได้ EOL/FLOATING/UNPARSEABLE แต่ไม่เข้า conflict

## read-diag: diagnostics ของไฟล์
รวม **2 diagnostics ใน 1 repo จาก 40** (`influxdata/chronograf`; unreadable 2; repo อื่น 0):
- `.github/workflows/resources/kind-config.yaml:13` และ `.github/workflows/resources/test-resources.yaml:9` — "YAML syntax error: Source contains multiple documents; please use YAML.parseAllDocuments()"
- **ทั้ง 2 ตัวเป็น diagnostic เท็จ**: ไฟล์เป็น Kubernetes manifest ที่เป็น YAML หลายเอกสารที่ถูกต้อง (ตรวจด้วย `yaml.safe_load_all`: 2 เอกสาร) ไม่ใช่ workflow และไม่ใช่ syntax error. วิธีแก้ที่เสนอ: อ่านเฉพาะ `.github/workflows/*.y(a)ml` ระดับบนสุด (ไม่ลงโฟลเดอร์ `resources/`) และ/หรือใช้ `parseAllDocuments` แล้วเลือกเอกสารที่มี `jobs`/`steps` ; ข้อความควรไม่เรียกว่า "syntax error" เมื่อเป็น multi-document
- ไม่มี diagnostic จริง (ไฟล์พังจริง) ใน 40 repo นี้ — จึงยังไม่มีหลักฐานเชิงบวกว่า read-diag จับไฟล์พังได้ใน repo จริง (มีเฉพาะ unit test)

### read-diag บน `f80ed6e` (rpc-diag-scope, A15)
รัน CLI `f80ed6e` (build จาก `git archive f80ed6e`) บน 40 repo เดิม: **findings เหมือน 483d4fb ทุก repo (0 repo ที่ต่างกัน)** และ **diagnostics = 0 (unreadable 0)**; chronograf 2 → 0 — diagnostic เท็จสองตัวหายแล้ว ตัวเลข precision ในรายงานนี้ยังอ้าง **483d4fb** (CLI sha ของ label)

## Head-to-head (A5) — ตารางใหม่
| tool | findings (conflic นับเฉพาะ node/python/go) | ครอบคลุม true-drift ของเรา (VERSION_CONFLICT/OUTSIDE_RANGE ที่ T/TI = 26) | repo ที่มี finding |
|---|---|---|---|
| engines-gauge 1.1.0 | 29 | 5 / 26 (Node เท่านั้น) | 12 |
| conflic 1.1.6 | 1,397 | 24 / 26 | 28 |
| runtime-pin-check 483d4fb | 139 | — (strict 79.9%, factual 99.3%) | 30 |
ข้อควรระวังเดิมยังใช้: "ครอบคลุม" = มี finding ที่อ้าง `file:line` เดียวกับ ≥1 source ของเรา (หลวม); ไม่ได้ hand-label finding ของคู่แข่ง (ไม่มี precision ของคู่แข่ง); conflic 220/1,397 อ้างไฟล์ใต้ path test/fixtures/testdata. ฐาน "true drift" ลดจาก 45 เป็น 26 เพราะ finding ที่เคยนับหายตามกฎ A12 (ข้างบน) ดังนั้นสัดส่วนที่คู่แข่งจับได้ลดลงเพราะส่วนที่เหลือคือคู่ที่ผูก project เดียวกัน

## Repro (Rerun)
```sh
git rev-parse HEAD   # 483d4fb82ff95eb1f96ae61eec199f19324a0ec2
npm run build
W=$(mktemp -d)
node bench/corpus.mjs clone $W/repos
node bench/corpus.mjs run   $W/repos $W/out3                # passes --date 2026-11-25 (override with CORPUS_DATE)
node bench/corpus.mjs report $W/repos $W/out3               # --labels rerun (default): precision, FP classes, diagnostics, unbound
# baseline for `lost`: build 389c91f (git archive 389c91f | tar -x -C $B; ln -s node_modules; npm run build) and run it the same way into $W/out
node bench/corpus.mjs lost $W/out $W/out3
node bench/corpus.mjs report $W/repos $W/out --labels baseline
```
**reviewer blind re-label (A12):** อย่าดู reason ใน labels block; ใช้เกณฑ์เดียวกับท้ายไฟล์ (T/TI/F). แนะนำตัวอย่าง: ทั้ง 27 TI, F ทั้ง 1 ตัว, 8 finding ที่เปลี่ยน/ใหม่ (`DRYTRIX_TimeTracker#1–#4`, `agentrq_agentrq#1–#2`, `boxlite-ai_boxlite#2`, `updatecli_updatecli#1`) และ T สุ่มทุก 5 ตัว

## Per-repo (Rerun)
| repo | findings | T | TI | F |
|---|---|---|---|---|
| DRYTRIX/TimeTracker | 6 | 5 | 1 | 0 |
| GoogleCloudPlatform/buildpacks | 0 | 0 | 0 | 0 |
| LesnyRumcajs/grpc_bench | 9 | 8 | 1 | 0 |
| NVIDIA/gpu-operator | 9 | 9 | 0 | 0 |
| Nimbleway/webrouter | 0 | 0 | 0 | 0 |
| SourceWeft/SourceWeft | 4 | 4 | 0 | 0 |
| TauricResearch/Trading-R1 | 0 | 0 | 0 | 0 |
| UniClipboard/UniClipboard | 0 | 0 | 0 | 0 |
| Xe/x | 15 | 15 | 0 | 0 |
| Zen-Labs-Corp/hatamoto | 3 | 2 | 1 | 0 |
| agentrq/agentrq | 5 | 4 | 1 | 0 |
| authorizerdev/authorizer | 1 | 1 | 0 | 0 |
| boxlite-ai/boxlite | 9 | 8 | 1 | 0 |
| caura-ai/caura | 9 | 5 | 4 | 0 |
| ccfos/huatuo | 6 | 6 | 0 | 0 |
| cloudbase/garm | 2 | 2 | 0 | 0 |
| crc-org/crc | 0 | 0 | 0 | 0 |
| cypress-io/cypress-docker-images | 12 | 0 | 11 | 1 |
| ducktors/turborepo-remote-cache | 1 | 1 | 0 | 0 |
| fabriziosalmi/caddy-waf | 1 | 1 | 0 | 0 |
| fabriziosalmi/certmate | 3 | 3 | 0 | 0 |
| frappe/press | 10 | 10 | 0 | 0 |
| frederikemmer/MediaLyze | 0 | 0 | 0 | 0 |
| hkjarral/AVA-AI-Voice-Agent-for-Asterisk | 4 | 4 | 0 | 0 |
| imagegenius/docker-immich | 0 | 0 | 0 | 0 |
| influxdata/chronograf | 0 | 0 | 0 | 0 |
| kzahel/yepanywhere | 4 | 2 | 2 | 0 |
| lynx-family/lynx-stack | 2 | 2 | 0 | 0 |
| monperrus/crawler-user-agents | 2 | 2 | 0 | 0 |
| openGemini/openGemini | 1 | 1 | 0 | 0 |
| openenv/OpenEnv | 5 | 5 | 0 | 0 |
| openupm/openupm | 4 | 4 | 0 | 0 |
| rome-os/rome | 0 | 0 | 0 | 0 |
| sno-ai/sno-station | 1 | 0 | 1 | 0 |
| team-reflect/reflect-open | 0 | 0 | 0 | 0 |
| terralist/terralist | 3 | 3 | 0 | 0 |
| umputun/revdiff | 1 | 1 | 0 | 0 |
| updatecli/updatecli | 2 | 2 | 0 | 0 |
| voidzero-dev/void | 2 | 0 | 2 | 0 |
| yoheimuta/protolint | 3 | 1 | 2 | 0 |

# Baseline @ `389c91f` — รายงานเดิม (เก็บไว้เปรียบเทียบ)
> ตัวเลขใน section นี้เป็นของ 389c91f; label 3 ตัวถูกแก้ตามที่ review ขอ (certmate#1, yepanywhere#3/#4) ดูตารางก่อน/หลังด้านบน

CLI ที่ใช้: **`389c91f`** (`git rev-parse HEAD`; main หลัง rpc-bom) build ด้วย `npm run build` แล้วรัน `node dist/cli.js <dir> --json`
Repo ทั้ง 40 ตัวถูก shallow clone ที่ SHA ที่ระบุใน `bench/repos.txt` (ไม่ commit clone) ไม่มี repo ส่วนตัว ไม่ใช้เครือข่ายตอนรัน CLI (clone/ค้นหา/head-to-head ใช้เครือข่ายเท่านั้น)

## สรุป Baseline
| ตัวชี้วัด | ค่า |
|---|---|
| repo ที่รัน / มี finding อย่างน้อย 1 | 40 / 31 |
| findings ทั้งหมด (hand-label ครบทุกตัว) | **275** |
| ตรวจ citation อัตโนมัติ (`file:line` มี `raw` จริง) | 965 citations, **0 ผิด** |
| **T** (จริงและควรแก้) | 127 |
| **TI** (จริงตามข้อเท็จจริง แต่เจ้าของน่าจะตั้งใจ) | 33 |
| **F** (false positive) | 115 |
| **precision แบบเข้ม (T / ทั้งหมด)** | **46.2%** |
| precision แบบข้อเท็จจริง ((T+TI) / ทั้งหมด) | 58.2% |
| ไม่นับ 3 repo ที่ทำให้เพี้ยนที่สุด (OpenEnv 59, updatecli 37, boxlite 22 = 118 findings) | เข้ม 68.2% / ข้อเท็จจริง 87.9% (157 findings) |
| ค่ากลางของ precision แบบเข้มต่อ repo (31 repo) | 100% ; 17 repo ได้ 100% |

**ข้อสรุปตรง ๆ:** precision รวมต่ำเพราะ finding กระจุกใน monorepo ใหญ่ และ **สาเหตุหลัก 2 อย่างแก้ได้** (F-scope 62 + F-fixture 35 = 97 จาก 115 FP) — ชนิด finding ที่แย่ที่สุดคือ `OUTSIDE_RANGE` (71 ตัว, T เพียง 4 = 5.6%) เพราะเอา CI ที่ root ไปเทียบกับ `engines`/`requires-python` ของ sub-project ที่ job นั้นไม่ได้ build README **ไม่ควรอ้าง precision ตัวเลขเดียวเกินกว่า "46% เข้ม / 58% ข้อเท็จจริง บน 40 repo นี้" จนกว่าจะแก้ 2 ข้อนี้แล้วรันซ้ำ**

## วิธีทำ และนิยาม label (reviewer ใช้ re-label ตัวอย่างอิสระได้)
- Finding id = `<owner>_<repo>#<n>` โดย n = ลำดับ (เริ่ม 1) ใน `findings` ของ CLI; ตาราง labels อยู่ท้ายไฟล์นี้ (บล็อก JSON ระหว่าง `labels:begin/end`) และ `corpus.mjs report` อ่านบล็อกนี้
- วิธี label ทุกตัว: เปิดไฟล์ที่ finding อ้าง (ตรวจ `file:line` อัตโนมัติ) แล้วอ่านบริบทใน workflow/Dockerfile ว่า (1) ค่าที่ parse ถูกจริงไหม (2) pin นั้นเกี่ยวกับ project/scope ที่ finding ระบุจริงไหม (3) เจ้าของน่าจะตั้งใจไหม
- **T** = ข้อความของ finding ถูกต้อง ไฟล์ที่อ้างเกี่ยวข้องกัน เจ้าของควรสนใจ · **TI** = ถูกตามข้อเท็จจริงแต่ตั้งใจ (matrix ที่ทดสอบ version ต่ำสุด, image แยกต่างหาก, job ที่ปล่อยลอย `lts/*`) · **F-<class>** = ผิด (parse ผิด, เทียบข้าม scope ที่ไม่เกี่ยวกัน, อ่านไฟล์ที่ควรข้าม, ค่าหาได้ในไฟล์เดียวกันแต่ไม่ resolve)
- `UNPARSEABLE` ถือว่าถูก (T) เมื่อค่า resolve จากไฟล์ไม่ได้จริง (composite input, `needs.*.outputs`, `fromJson(...)`, `$GITHUB_ENV`) และผิด (F-resolvable) เมื่อ `${ env.X }` ถูกกำหนดใน `env:` ของ workflow เดียวกัน
- EOL ตัดสินจากข้อมูลที่ติดมากับ CLI ณ 2026-11-25 (Node 18/20/21/23/25, Python ≤3.10, Go ≤1.25 = EOL)
- ข้อจำกัดของ label: ผมคนเดียวทำ label (ไม่ใช่เจ้าของ repo) → "TI" เป็นการประเมิน ไม่ใช่ข้อเท็จจริง reviewer ควร re-label ตัวอย่าง (แนะนำ: OpenEnv #1–#60 ทุก 5 ตัว, ทุก F-fixture/F-image/F-negtest, ทุก TI ของ caura/void/sno-station)

### Repro
```sh
npm run build
W=$(mktemp -d)
node bench/corpus.mjs clone $W/repos                       # 40 repo ที่ SHA ใน bench/repos.txt
node bench/corpus.mjs run $W/repos $W/out                  # รัน dist/cli.js --json; เขียน $W/out/CLI_SHA
node bench/corpus.mjs report $W/repos $W/out               # ตรวจ labels+citations, พิมพ์ตาราง precision
# head-to-head (ต้องติดตั้ง engines-gauge@1.1.0 และ conflic 1.1.6 แล้วเก็บผลไว้ $W/h2h):
#   (cd $W/repos/<name> && engines-gauge -f json > $W/h2h/<name>.eg.json)
#   conflic --format json $W/repos/<name> > $W/h2h/<name>.cf.json
node bench/corpus.mjs report $W/repos $W/out $W/h2h
```
หมายเหตุ: ผลขึ้นกับ CLI sha และข้อมูล EOL ณ วันที่รัน (ใช้ `--date` ใน CLI ถ้าจะตรึงวัน; corpus นี้ใช้ 2026-11-25) และ repo ที่ SHA ตรึงไว้

## ผลต่อชนิด finding
| code | findings | T | TI | F | เข้ม | ข้อเท็จจริง |
|---|---|---|---|---|---|---|
| EOL_RUNTIME | 82 | 49 | 19 | 14 | 59.8% | 82.9% |
| FLOATING_ALIAS | 25 | 18 | 0 | 7 | 72.0% | 72.0% |
| OUTSIDE_RANGE | 71 | 4 | 0 | 67 | 5.6% | 5.6% |
| PRECISION_MISMATCH | 13 | 11 | 2 | 0 | 84.6% | 100.0% |
| UNPARSEABLE | 29 | 16 | 0 | 13 | 55.2% | 55.2% |
| VERSION_CONFLICT | 55 | 29 | 12 | 14 | 52.7% | 74.5% |
| **ทั้งหมด** | 275 | 127 | 33 | 115 | 46.2% | 58.2% |

## False positive ทุกกลุ่ม (115) พร้อมสาเหตุและวิธีแก้ที่เสนอ
| class | จำนวน | ตัวอย่าง (id) | สาเหตุ | วิธีแก้ที่เสนอ |
|---|---|---|---|---|
| **F-scope** | 62 | OpenEnv #1, #4–#52; boxlite #6–#15; certmate #1; press #2 | CI ที่อยู่ root (ไม่มี `working-directory`) ถูกเทียบกับ `engines`/`requires-python` ของ sub-project ทุกตัว (กฎใน Domain model: "root-level CI applies to every project root") แต่ job จริง ๆ build/ทดสอบอีกอย่าง เช่น `package-ci.yml` ทำ `python -m build` ที่ root แล้วถูกเทียบกับ `envs/*/pyproject.toml` ; boxlite `node-version: '20'` เป็นงานของ `sdks/node` (cache-dependency-path ชี้ไป `sdks/node/package-lock.json`) แต่ไปขัดกับ `apps/*` | (ก) ถ้า repo root เป็น project root เอง (มี manifest) ให้ผูก CI ราก กับ root เท่านั้น ; (ข) ถ้าไม่มี manifest ที่ root ให้ผูกกับ sub-project ก็ต่อเมื่อ step/`defaults.run` ระบุ `working-directory` หรือมีขั้นตอนที่อ้าง path ของ sub-project นั้น (`cache-dependency-path`, `--project <dir>`) ; (ค) อย่างน้อยลดระดับ OUTSIDE_RANGE ข้าม scope เป็น info |
| **F-fixture** | 35 | updatecli #3–#37 | `pkg/.../test_fixtures/*.Dockerfile` เป็น input ของเทสต์ parser; default exclusion มี `fixtures/`, `__fixtures__/`, `testdata/`, `test-fixtures/` แต่ไม่มี `test_fixtures` | ทำให้ชื่อไดเรกทอรีที่ตรงกับ `/(^|[-_])?(test[-_]?)?fixtures?|testdata|test[-_]data/i` ถูกข้ามทั้งกลุ่ม (รวม `_testdata`, `test_fixtures`, `testfixtures`) |
| **F-resolvable** | 13 | DRYTRIX #5–#17 | `node-version: ${ env.NODE_VERSION }` และ `NODE_VERSION: '24'` ถูกกำหนดบน `env:` ของ workflow เดียวกัน แต่ CLI รายงาน UNPARSEABLE | resolve `${ env.X }` จาก `env:` ระดับ workflow/job ในไฟล์เดียวกัน (ถ้าไม่เจอจึง UNPARSEABLE) |
| **F-image** | 2 | grpc_bench #3; cypress-docker-images #1 | Dockerfile ต่อ version/ต่อ benchmark ในไดเรกทอรีพี่น้อง (เช่น `base-internal/releases/node-20/20.15.0/Dockerfile`) แต่ละไฟล์เป็น image คนละตัว ไม่ใช่ pin ของ repo; ถูกนับเป็น project เดียว (scope `.`) แล้วขัดกับ `.node-version` | ผูก Dockerfile กับไดเรกทอรีของมันเองเมื่อไม่มี manifest ที่ใกล้กว่า (หรือเทียบเฉพาะ Dockerfile ที่ root / ที่ชื่อ `Dockerfile` ใน project root) |
| **F-negtest** | 2 | yepanywhere #3, #4 | `sqlite.yml:67` ใช้ node 20.12.2 โดยตั้งใจ ("Reject an actual unsupported runtime ... --reject") — engines-gauge ก็ flag ตัวเดียวกัน | ไม่มีวิธีอัตโนมัติ; รองรับ inline ignore (`# runtime-pin-check: ignore`) หรือ config `ignore` ต่อไฟล์:บรรทัด |
| **F-misparse** | 1 | OpenEnv #53 | `FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy` — repo ชื่อ `.../python` ถูกมองเป็น python image แล้วเอา tag `v1.44.0` (เวอร์ชัน Playwright) เป็นเวอร์ชัน Python | จับเฉพาะ image ทางการ (`python`, `node`, `golang`, `docker.io/library/*`, `public.ecr.aws/docker/library/*`, `mirror.gcr.io/library/*`, `lambda/nodejs|python`) ไม่ใช่ทุก path ที่ลงท้าย `/python` |

## TI — จริงแต่น่าจะตั้งใจ (33)
- matrix ทดสอบ floor/EOL โดยตั้งใจ: caura #11–#14, agentrq #3, protolint #2, kzahel #5
- Dockerfile/image แยกต่างหาก: DRYTRIX #2 (mcp_server/peppol_bridge), void #1–#2, sno-station #1, cypress EOL images #2–#12, grpc_bench #9 (dir `lua_grpc_st_onhold`)
- job ที่ปล่อยลอยโดยตั้งใจ: protolint #1 (`lts/*`)
- drift เล็กน้อย: caura #6–#10, certmate #2–#3, OpenEnv #58–#59
ไม่ควรเป็น error ที่ทำให้ CI ล้ม; แนะนำให้ `--fail-on` default ยังเป็น `error` และดูว่า VERSION_CONFLICT จาก matrix/Dockerfile ไดเรกทอรีอื่นลดระดับได้ไหม

## Repo ที่ไม่มี finding (9) — ไม่ได้วัด recall
GoogleCloudPlatform/buildpacks (CLI เจอ source เดียว), Nimbleway/webrouter (`ARG PYTHON_IMAGE` ถูกแทนด้วยค่า default ถูกต้อง), TauricResearch/Trading-R1, UniClipboard/UniClipboard, crc-org/crc, imagegenius/docker-immich, influxdata/chronograf, rome-os/rome, team-reflect/reflect-open — ผมดู source ที่ CLI อ่านได้ (ค่าตรงกันจริงในสิ่งที่เห็น) แต่ **ไม่ได้ตรวจ false negative** (ไม่ได้ทำ ground truth แยกต่างหาก)

## BOM
ใน 40 repo **ไม่มี `package.json` หรือไฟล์ pin ที่ขึ้นต้นด้วย UTF-8 BOM** (สแกนทุกไฟล์ที่เป็น pin/YAML ใน clone: เจอแต่ไฟล์ข้อมูล `openupm/data/packages/*.yml` 4 ไฟล์ ซึ่งไม่ใช่ pin) และค้นด้วย GitHub code search หา `package.json` ที่มี BOM ไม่เจอ (BOM ค้นด้วย text query ไม่ได้ ต้องเปิดอ่านไบต์) → **หลักฐานจาก corpus จริง = ไม่มี** ผมทำหลักฐานทดแทน: เอา `package.json` จริงของ `ducktors/turborepo-remote-cache` (`engines.node ">=22.0.0"`) เติม BOM `EF BB BF` ไว้หน้าไฟล์ แล้วรันทั้งสอง build:
- CLI เก่า `f05992d`: sources = `.nvmrc 24`, `Dockerfile 24.22.2-alpine` — **ไม่เห็น `engines`**
- CLI `389c91f`: เพิ่ม `package.json >=22.0.0` — **อ่านได้**
Corpus ทั้งชุดรันบน `389c91f` เท่านั้น (ไม่มีผลต่างก่อน/หลัง BOM เพราะไม่มี repo ที่ได้รับผลกระทบ)

## Head-to-head (A5): engines-gauge 1.1.0 และ conflic 1.1.6 บน 40 repo เดียวกัน
| tool | findings (node/python/go เฉพาะ conflic) | ครอบคลุม true-drift ของเรา (VERSION_CONFLICT/OUTSIDE_RANGE ที่เป็น T/TI = 45) | repo ที่มี finding |
|---|---|---|---|
| engines-gauge | 29 | 13 / 45 (Node เท่านั้น) | 12 |
| conflic | 1,397 | 42 / 45 | 28 |
| runtime-pin-check (389c91f) | 275 | — (precision 46.2% เข้ม) | 31 |

อ่านตารางอย่างระวัง:
- "ครอบคลุม" = เครื่องมือนั้นมี finding ที่อ้าง `file:line` เดียวกับอย่างน้อย 1 source ของ finding เรา — หลวมมาก (conflic รายงานทุกคู่จึงโดนง่าย) ไม่ได้ hand-label finding ของคู่แข่ง จึง **ไม่มี precision ของคู่แข่ง** มีเพียงตัวชี้: conflic 220 จาก 1,397 findings (15.7%) อ้างไฟล์ใต้ path ที่เป็น test/fixtures/testdata/tests ; engines-gauge flag `sqlite.yml:67` (negative test เดียวกับ F-negtest ของเรา)
- engines-gauge ไม่รองรับ Python/Go (ตามที่ recon บอก) จึงจับ true-drift ได้น้อยกว่า (13/45)
- conflic จับได้เกือบหมด (42/45) แต่ปริมาณ 1,397 findings ใน 40 repo ทำให้ใช้งานจริงยาก
- **ข้ออ้างใน README เกี่ยวกับคู่แข่งควรใช้เฉพาะตารางนี้** และต้องไม่เกินสิ่งที่ตารางรองรับ (ไม่อ้าง precision ของคู่แข่ง)

## สิ่งที่ผมแนะนำให้ทำต่อ (สำหรับ maintainer)
1. แก้ F-scope และ F-fixture (97 จาก 115 FP) แล้วรัน corpus ซ้ำ (ตั้งเป้า: OUTSIDE_RANGE ข้าม scope = 0; precision เข้ม > 70%) ก่อนเขียนตัวเลขใน README
2. resolve `${ env.X }` ในไฟล์เดียวกัน; จำกัด image ทางการ; ผูก Dockerfile กับไดเรกทอรีตัวเอง
3. ปรับ README ให้ไม่โฆษณา precision จนกว่าจะแก้ข้อ 1

## ข้อจำกัด / สิ่งที่ตรวจไม่ได้
- ผมคนเดียวทำ label; ไม่ได้ถามเจ้าของ repo; "TI" เป็นการประเมิน
- 40 repo เลือกจากการค้นหา (≥4 ชนิดไฟล์ pin, ≥5 ไฟล์, ดาว 300–3,000, push หลัง 2026-09-01) — ลำเอียงไปทาง repo ที่มี pin หลายที่ และมี repo ที่ดูเหมือนสร้างด้วยเอเจนต์หลายตัว; ไม่ใช่ตัวแทนของ repo ทั้งหมด
- ไม่วัด recall/false negative; ไม่ hand-label finding ของคู่แข่ง
- ไม่มี repo ที่มี BOM จริงใน corpus (ดูหัวข้อ BOM)
- `corpus.mjs` ตรวจ citation และคำนวณ precision จาก labels แต่ **ไม่ตัดสิน label ให้** (นั่นคือการ hand-label)

## Per-repo
| repo | sha | findings | T | TI | F |
|---|---|---|---|---|---|
| DRYTRIX/TimeTracker | 9b235cf5 | 17 | 3 | 1 | 13 |
| GoogleCloudPlatform/buildpacks | 4454f455 | 0 | 0 | 0 | 0 |
| LesnyRumcajs/grpc_bench | dc80ca94 | 10 | 8 | 1 | 1 |
| NVIDIA/gpu-operator | f6acfb9e | 9 | 9 | 0 | 0 |
| Nimbleway/webrouter | 816d78f4 | 0 | 0 | 0 | 0 |
| SourceWeft/SourceWeft | f7b6bc1e | 6 | 6 | 0 | 0 |
| TauricResearch/Trading-R1 | 49610d55 | 0 | 0 | 0 | 0 |
| UniClipboard/UniClipboard | d6fb1cf5 | 0 | 0 | 0 | 0 |
| Xe/x | 30374fe5 | 15 | 15 | 0 | 0 |
| Zen-Labs-Corp/hatamoto | f50289a1 | 3 | 2 | 1 | 0 |
| agentrq/agentrq | b7e60807 | 5 | 4 | 1 | 0 |
| authorizerdev/authorizer | 39bed660 | 1 | 1 | 0 | 0 |
| boxlite-ai/boxlite | ee447570 | 22 | 12 | 0 | 10 |
| caura-ai/caura | 8dbb7f40 | 18 | 9 | 9 | 0 |
| ccfos/huatuo | 252cd5ca | 7 | 7 | 0 | 0 |
| cloudbase/garm | c7c1c5e2 | 2 | 2 | 0 | 0 |
| crc-org/crc | 3a4079f1 | 0 | 0 | 0 | 0 |
| cypress-io/cypress-docker-images | 9dd1dfcb | 12 | 0 | 11 | 1 |
| ducktors/turborepo-remote-cache | f62c6c1e | 1 | 1 | 0 | 0 |
| fabriziosalmi/caddy-waf | d89f7e9a | 1 | 1 | 0 | 0 |
| fabriziosalmi/certmate | 9de69813 | 6 | 3 | 2 | 1 |
| frappe/press | 763dbd7b | 11 | 10 | 0 | 1 |
| frederikemmer/MediaLyze | 96a72005 | 1 | 1 | 0 | 0 |
| hkjarral/AVA-AI-Voice-Agent-for-Asterisk | 05cf7d62 | 4 | 4 | 0 | 0 |
| imagegenius/docker-immich | 5daf4222 | 0 | 0 | 0 | 0 |
| influxdata/chronograf | fdb06f1d | 0 | 0 | 0 | 0 |
| kzahel/yepanywhere | 23ee63ee | 7 | 4 | 1 | 2 |
| lynx-family/lynx-stack | 0e64e4e9 | 2 | 2 | 0 | 0 |
| monperrus/crawler-user-agents | 7995a642 | 2 | 2 | 0 | 0 |
| openGemini/openGemini | ceef7f47 | 1 | 1 | 0 | 0 |
| openenv/OpenEnv | 3659dc73 | 59 | 6 | 2 | 51 |
| openupm/openupm | dc203916 | 4 | 4 | 0 | 0 |
| rome-os/rome | c3b9749f | 0 | 0 | 0 | 0 |
| sno-ai/sno-station | 1422f6c5 | 1 | 0 | 1 | 0 |
| team-reflect/reflect-open | 81709349 | 0 | 0 | 0 | 0 |
| terralist/terralist | b95cffde | 5 | 5 | 0 | 0 |
| umputun/revdiff | e4c94537 | 1 | 1 | 0 | 0 |
| updatecli/updatecli | b194b605 | 37 | 2 | 0 | 35 |
| voidzero-dev/void | a3c47219 | 2 | 0 | 2 | 0 |
| yoheimuta/protolint | b99c6783 | 3 | 1 | 2 | 0 |

## Labels (id → [label, reason?]; T ไม่มี reason)
<!-- labels:begin -->
```json
{
 "DRYTRIX_TimeTracker#1": ["T"],
 "DRYTRIX_TimeTracker#2": ["TI", "python 3.11 vs 3.12 in sibling service Dockerfiles (mcp_server, peppol_bridge): real difference, plausibly separate services"],
 "DRYTRIX_TimeTracker#3": ["T"],
 "DRYTRIX_TimeTracker#4": ["T"],
 "DRYTRIX_TimeTracker#5": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#6": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#7": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#8": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#9": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#10": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#11": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#12": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#13": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#14": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#15": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#16": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "DRYTRIX_TimeTracker#17": ["F-resolvable", "value defined in the same workflow file env: block (NODE_VERSION/PYTHON_VERSION); tool should resolve ${{ env.X }}"],
 "LesnyRumcajs_grpc_bench#1": ["T"],
 "LesnyRumcajs_grpc_bench#2": ["T"],
 "LesnyRumcajs_grpc_bench#3": ["F-image", "python Dockerfiles in sibling benchmark dirs (lua_grpc_st_onhold, python_*_bench) are independent images, no shared manifest; compared as one project"],
 "LesnyRumcajs_grpc_bench#4": ["T"],
 "LesnyRumcajs_grpc_bench#5": ["T"],
 "LesnyRumcajs_grpc_bench#6": ["T"],
 "LesnyRumcajs_grpc_bench#7": ["T"],
 "LesnyRumcajs_grpc_bench#8": ["T"],
 "LesnyRumcajs_grpc_bench#9": ["TI", "python:3.9-rc in a dir named lua_grpc_st_onhold (on hold); EOL is true but dir is parked"],
 "LesnyRumcajs_grpc_bench#10": ["T"],
 "NVIDIA_gpu-operator#1": ["T"],
 "NVIDIA_gpu-operator#2": ["T"],
 "NVIDIA_gpu-operator#3": ["T"],
 "NVIDIA_gpu-operator#4": ["T"],
 "NVIDIA_gpu-operator#5": ["T"],
 "NVIDIA_gpu-operator#6": ["T"],
 "NVIDIA_gpu-operator#7": ["T"],
 "NVIDIA_gpu-operator#8": ["T"],
 "NVIDIA_gpu-operator#9": ["T"],
 "SourceWeft_SourceWeft#1": ["T"],
 "SourceWeft_SourceWeft#2": ["T"],
 "SourceWeft_SourceWeft#3": ["T"],
 "SourceWeft_SourceWeft#4": ["T"],
 "SourceWeft_SourceWeft#5": ["T"],
 "SourceWeft_SourceWeft#6": ["T"],
 "Xe_x#1": ["T"],
 "Xe_x#2": ["T"],
 "Xe_x#3": ["T"],
 "Xe_x#4": ["T"],
 "Xe_x#5": ["T"],
 "Xe_x#6": ["T"],
 "Xe_x#7": ["T"],
 "Xe_x#8": ["T"],
 "Xe_x#9": ["T"],
 "Xe_x#10": ["T"],
 "Xe_x#11": ["T"],
 "Xe_x#12": ["T"],
 "Xe_x#13": ["T"],
 "Xe_x#14": ["T"],
 "Xe_x#15": ["T"],
 "Zen-Labs-Corp_hatamoto#1": ["TI", "CI sdk job go matrix leg 1.26 is self-skipped by the \"Does this leg apply?\" gate when go.mod declares 1.27 (ci.yml:440-454): a deliberate, self-managed matrix (reviewer C1; was T)"],
 "Zen-Labs-Corp_hatamoto#2": ["T"],
 "Zen-Labs-Corp_hatamoto#3": ["T"],
 "agentrq_agentrq#1": ["T"],
 "agentrq_agentrq#2": ["T"],
 "agentrq_agentrq#3": ["TI", "CLI matrix floor 20.6 is deliberate (comment in file) though node 20 is EOL"],
 "agentrq_agentrq#4": ["T"],
 "agentrq_agentrq#5": ["T"],
 "authorizerdev_authorizer#1": ["T"],
 "boxlite-ai_boxlite#1": ["T"],
 "boxlite-ai_boxlite#2": ["T"],
 "boxlite-ai_boxlite#3": ["T"],
 "boxlite-ai_boxlite#4": ["T"],
 "boxlite-ai_boxlite#5": ["T"],
 "boxlite-ai_boxlite#6": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#7": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#8": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#9": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#10": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#11": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#12": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#13": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#14": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#15": ["F-scope", "e2e-cloud.yml:393 / lint.yml:204 node 20 job builds sdks/node (cache-dependency-path sdks/node/package-lock.json, no working-directory), not apps/*; root CI attributed to unrelated project roots"],
 "boxlite-ai_boxlite#16": ["T"],
 "boxlite-ai_boxlite#17": ["T"],
 "boxlite-ai_boxlite#18": ["T"],
 "boxlite-ai_boxlite#19": ["T"],
 "boxlite-ai_boxlite#20": ["T"],
 "boxlite-ai_boxlite#21": ["T"],
 "boxlite-ai_boxlite#22": ["T"],
 "caura-ai_caura#1": ["T"],
 "caura-ai_caura#2": ["T"],
 "caura-ai_caura#3": ["T"],
 "caura-ai_caura#4": ["T"],
 "caura-ai_caura#5": ["T"],
 "caura-ai_caura#6": ["TI", "python 3.12 vs 3.13 across workflows (legacy-name-ratchet 3.13); real but low impact"],
 "caura-ai_caura#7": ["TI", "python 3.12 vs 3.13 across workflows (legacy-name-ratchet 3.13); real but low impact"],
 "caura-ai_caura#8": ["TI", "python 3.12 vs 3.13 across workflows (legacy-name-ratchet 3.13); real but low impact"],
 "caura-ai_caura#9": ["TI", "python 3.12 vs 3.13 across workflows (legacy-name-ratchet 3.13); real but low impact"],
 "caura-ai_caura#10": ["TI", "python 3.12 vs 3.13 across workflows (legacy-name-ratchet 3.13); real but low impact"],
 "caura-ai_caura#11": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#12": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#13": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#14": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#15": ["T"],
 "caura-ai_caura#16": ["T"],
 "caura-ai_caura#17": ["T"],
 "caura-ai_caura#18": ["T"],
 "ccfos_huatuo#1": ["T"],
 "ccfos_huatuo#2": ["T"],
 "ccfos_huatuo#3": ["T"],
 "ccfos_huatuo#4": ["T"],
 "ccfos_huatuo#5": ["T"],
 "ccfos_huatuo#6": ["T"],
 "ccfos_huatuo#7": ["T"],
 "cloudbase_garm#1": ["T"],
 "cloudbase_garm#2": ["T"],
 "cypress-io_cypress-docker-images#1": ["F-image", "one Dockerfile per released Node image under base-internal/releases/*: each is its own image, not a pin of the repo runtime; compared with .node-version"],
 "cypress-io_cypress-docker-images#2": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#3": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#4": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#5": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#6": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#7": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#8": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#9": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#10": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#11": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#12": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "ducktors_turborepo-remote-cache#1": ["T"],
 "fabriziosalmi_caddy-waf#1": ["T"],
 "fabriziosalmi_certmate#1": ["T"],
 "fabriziosalmi_certmate#2": ["TI", "python 3.12 vs 3.13 (publish-galaxy); real but minor"],
 "fabriziosalmi_certmate#3": ["TI", "python 3.12 vs 3.13 (publish-galaxy); real but minor"],
 "fabriziosalmi_certmate#4": ["T"],
 "fabriziosalmi_certmate#5": ["T"],
 "fabriziosalmi_certmate#6": ["T"],
 "frappe_press#1": ["T"],
 "frappe_press#2": ["F-scope", "main.yaml:336 node 18 belongs to the ui-tests job (dashboard), not changelog/; no working-directory"],
 "frappe_press#3": ["T"],
 "frappe_press#4": ["T"],
 "frappe_press#5": ["T"],
 "frappe_press#6": ["T"],
 "frappe_press#7": ["T"],
 "frappe_press#8": ["T"],
 "frappe_press#9": ["T"],
 "frappe_press#10": ["T"],
 "frappe_press#11": ["T"],
 "frederikemmer_MediaLyze#1": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#1": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#2": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#3": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#4": ["T"],
 "kzahel_yepanywhere#1": ["T"],
 "kzahel_yepanywhere#2": ["T"],
 "kzahel_yepanywhere#3": ["TI", "corrected (review): deliberate unsupported-runtime test (was F-negtest)"],
 "kzahel_yepanywhere#4": ["TI", "corrected (review): deliberate unsupported-runtime test (was F-negtest)"],
 "kzahel_yepanywhere#5": ["TI", "same deliberate unsupported-runtime test; EOL true"],
 "kzahel_yepanywhere#6": ["T"],
 "kzahel_yepanywhere#7": ["T"],
 "lynx-family_lynx-stack#1": ["T"],
 "lynx-family_lynx-stack#2": ["T"],
 "monperrus_crawler-user-agents#1": ["T"],
 "monperrus_crawler-user-agents#2": ["T"],
 "openGemini_openGemini#1": ["T"],
 "openenv_OpenEnv#1": ["F-scope", "deploy-hf-env.yml python 3.12 vs envs/unity_env requires <=3.10.12: workflow deploys envs by name from inputs, not building unity_env in this step"],
 "openenv_OpenEnv#2": ["T"],
 "openenv_OpenEnv#3": ["T"],
 "openenv_OpenEnv#4": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#5": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#6": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#7": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#8": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#9": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#10": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#11": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#12": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#13": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#14": ["F-scope", "same root CI drift as #2 re-attributed to each env directory (only the extra env-local source differs); #4 also includes a misparsed Playwright image"],
 "openenv_OpenEnv#15": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#16": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#17": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#18": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#19": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#20": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#21": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#22": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#23": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#24": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#25": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#26": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#27": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#28": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#29": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#30": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#31": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#32": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#33": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#34": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#35": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#36": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#37": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#38": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#39": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#40": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#41": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#42": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#43": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#44": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#45": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#46": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#47": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#48": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#49": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#50": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#51": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#52": ["F-scope", "package-ci/publish-pypi/publish-testpypi/test.yml build or check the ROOT package only (python -m build at repo root, no working-directory) but are compared with envs/*/pyproject.toml requires-python"],
 "openenv_OpenEnv#53": ["F-misparse", "FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy: v1.44.0 is the Playwright version, parsed as python version"],
 "openenv_OpenEnv#54": ["T"],
 "openenv_OpenEnv#55": ["T"],
 "openenv_OpenEnv#56": ["T"],
 "openenv_OpenEnv#57": ["T"],
 "openenv_OpenEnv#58": ["TI", "precision difference correct but includes unrelated root workflow sources"],
 "openenv_OpenEnv#59": ["TI", "precision difference correct but includes unrelated root workflow sources"],
 "openupm_openupm#1": ["T"],
 "openupm_openupm#2": ["T"],
 "openupm_openupm#3": ["T"],
 "openupm_openupm#4": ["T"],
 "sno-ai_sno-station#1": ["TI", ".nvmrc 24.18.0 vs tests/apps/reach/ci/Dockerfile 24.15.0 (test infra image)"],
 "terralist_terralist#1": ["T"],
 "terralist_terralist#2": ["T"],
 "terralist_terralist#3": ["T"],
 "terralist_terralist#4": ["T"],
 "terralist_terralist#5": ["T"],
 "umputun_revdiff#1": ["T"],
 "updatecli_updatecli#1": ["T"],
 "updatecli_updatecli#2": ["T"],
 "updatecli_updatecli#3": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#4": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#5": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#6": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#7": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#8": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#9": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#10": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#11": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#12": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#13": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#14": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#15": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#16": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#17": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#18": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#19": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#20": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#21": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#22": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#23": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#24": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#25": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#26": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#27": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#28": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#29": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#30": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#31": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#32": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#33": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#34": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#35": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#36": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "updatecli_updatecli#37": ["F-fixture", "pkg/.../test_fixtures/*.Dockerfile are parser test inputs; default exclusion lists fixtures/ __fixtures__/ testdata/ test-fixtures/ but not test_fixtures"],
 "voidzero-dev_void#1": ["TI", "sandbox/container Dockerfile node 26.x vs .node-version 24.22.1: real but images are separate runtime"],
 "voidzero-dev_void#2": ["TI", "sandbox/container Dockerfile node 26.x vs .node-version 24.22.1: real but images are separate runtime"],
 "yoheimuta_protolint#1": ["TI", "publish node 24 vs test lts/* (deliberately floating test)"],
 "yoheimuta_protolint#2": ["TI", "test matrix [20, lts/*] includes 20 deliberately; EOL true"],
 "yoheimuta_protolint#3": ["T"]
}
```
<!-- labels:end -->

## Labels — rerun 483d4fb (id → [label, reason?]; T ไม่มี reason)
<!-- labels-rerun:begin -->
```json
{
 "DRYTRIX_TimeTracker#5": ["T"],
 "DRYTRIX_TimeTracker#6": ["T"],
 "LesnyRumcajs_grpc_bench#1": ["T"],
 "LesnyRumcajs_grpc_bench#2": ["T"],
 "LesnyRumcajs_grpc_bench#3": ["T"],
 "LesnyRumcajs_grpc_bench#4": ["T"],
 "LesnyRumcajs_grpc_bench#5": ["T"],
 "LesnyRumcajs_grpc_bench#6": ["T"],
 "LesnyRumcajs_grpc_bench#7": ["T"],
 "LesnyRumcajs_grpc_bench#8": ["TI", "python:3.9-rc in a dir named lua_grpc_st_onhold (on hold); EOL is true but dir is parked"],
 "LesnyRumcajs_grpc_bench#9": ["T"],
 "NVIDIA_gpu-operator#1": ["T"],
 "NVIDIA_gpu-operator#2": ["T"],
 "NVIDIA_gpu-operator#3": ["T"],
 "NVIDIA_gpu-operator#4": ["T"],
 "NVIDIA_gpu-operator#5": ["T"],
 "NVIDIA_gpu-operator#6": ["T"],
 "NVIDIA_gpu-operator#7": ["T"],
 "NVIDIA_gpu-operator#8": ["T"],
 "NVIDIA_gpu-operator#9": ["T"],
 "SourceWeft_SourceWeft#1": ["T"],
 "SourceWeft_SourceWeft#2": ["T"],
 "SourceWeft_SourceWeft#3": ["T"],
 "SourceWeft_SourceWeft#4": ["T"],
 "Xe_x#1": ["T"],
 "Xe_x#2": ["T"],
 "Xe_x#3": ["T"],
 "Xe_x#4": ["T"],
 "Xe_x#5": ["T"],
 "Xe_x#6": ["T"],
 "Xe_x#7": ["T"],
 "Xe_x#8": ["T"],
 "Xe_x#9": ["T"],
 "Xe_x#10": ["T"],
 "Xe_x#11": ["T"],
 "Xe_x#12": ["T"],
 "Xe_x#13": ["T"],
 "Xe_x#14": ["T"],
 "Xe_x#15": ["T"],
 "Zen-Labs-Corp_hatamoto#1": ["TI", "CI sdk job go matrix leg 1.26 is self-skipped by the \"Does this leg apply?\" gate when go.mod declares 1.27 (ci.yml:440-454): a deliberate, self-managed matrix (reviewer C1; was T)"],
 "Zen-Labs-Corp_hatamoto#2": ["T"],
 "Zen-Labs-Corp_hatamoto#3": ["T"],
 "agentrq_agentrq#3": ["TI", "CLI matrix floor 20.6 is deliberate (comment in file) though node 20 is EOL"],
 "agentrq_agentrq#4": ["T"],
 "agentrq_agentrq#5": ["T"],
 "authorizerdev_authorizer#1": ["T"],
 "boxlite-ai_boxlite#1": ["T"],
 "boxlite-ai_boxlite#3": ["T"],
 "boxlite-ai_boxlite#4": ["T"],
 "boxlite-ai_boxlite#5": ["T"],
 "boxlite-ai_boxlite#6": ["T"],
 "boxlite-ai_boxlite#7": ["T"],
 "boxlite-ai_boxlite#8": ["T"],
 "boxlite-ai_boxlite#9": ["T"],
 "caura-ai_caura#1": ["T"],
 "caura-ai_caura#2": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#3": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#4": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#5": ["TI", "test matrix deliberately includes old versions (support floor)"],
 "caura-ai_caura#6": ["T"],
 "caura-ai_caura#7": ["T"],
 "caura-ai_caura#8": ["T"],
 "caura-ai_caura#9": ["T"],
 "ccfos_huatuo#1": ["T"],
 "ccfos_huatuo#2": ["T"],
 "ccfos_huatuo#3": ["T"],
 "ccfos_huatuo#4": ["T"],
 "ccfos_huatuo#5": ["T"],
 "ccfos_huatuo#6": ["T"],
 "cloudbase_garm#1": ["T"],
 "cloudbase_garm#2": ["T"],
 "cypress-io_cypress-docker-images#1": ["F-image", "one Dockerfile per released Node image under base-internal/releases/*: each is its own image, not a pin of the repo runtime; compared with .node-version"],
 "cypress-io_cypress-docker-images#2": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#3": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#4": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#5": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#6": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#7": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#8": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#9": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#10": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#11": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "cypress-io_cypress-docker-images#12": ["TI", "node 20 images are EOL but this repo deliberately publishes old-version images"],
 "ducktors_turborepo-remote-cache#1": ["T"],
 "fabriziosalmi_caddy-waf#1": ["T"],
 "fabriziosalmi_certmate#1": ["T"],
 "fabriziosalmi_certmate#2": ["T"],
 "fabriziosalmi_certmate#3": ["T"],
 "frappe_press#1": ["T"],
 "frappe_press#2": ["T"],
 "frappe_press#3": ["T"],
 "frappe_press#4": ["T"],
 "frappe_press#5": ["T"],
 "frappe_press#6": ["T"],
 "frappe_press#7": ["T"],
 "frappe_press#8": ["T"],
 "frappe_press#9": ["T"],
 "frappe_press#10": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#1": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#2": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#3": ["T"],
 "hkjarral_AVA-AI-Voice-Agent-for-Asterisk#4": ["T"],
 "kzahel_yepanywhere#1": ["T"],
 "kzahel_yepanywhere#2": ["TI", "corrected (review): deliberate unsupported-runtime test (was F-negtest)"],
 "kzahel_yepanywhere#3": ["TI", "same deliberate unsupported-runtime test; EOL true"],
 "kzahel_yepanywhere#4": ["T"],
 "lynx-family_lynx-stack#1": ["T"],
 "lynx-family_lynx-stack#2": ["T"],
 "monperrus_crawler-user-agents#1": ["T"],
 "monperrus_crawler-user-agents#2": ["T"],
 "openGemini_openGemini#1": ["T"],
 "openenv_OpenEnv#1": ["T"],
 "openenv_OpenEnv#2": ["T"],
 "openenv_OpenEnv#3": ["T"],
 "openenv_OpenEnv#4": ["T"],
 "openenv_OpenEnv#5": ["T"],
 "openupm_openupm#1": ["T"],
 "openupm_openupm#2": ["T"],
 "openupm_openupm#3": ["T"],
 "openupm_openupm#4": ["T"],
 "sno-ai_sno-station#1": ["TI", ".nvmrc 24.18.0 vs tests/apps/reach/ci/Dockerfile 24.15.0 (test infra image)"],
 "terralist_terralist#1": ["T"],
 "terralist_terralist#2": ["T"],
 "terralist_terralist#3": ["T"],
 "umputun_revdiff#1": ["T"],
 "updatecli_updatecli#2": ["T"],
 "voidzero-dev_void#1": ["TI", "sandbox/container Dockerfile node 26.x vs .node-version 24.22.1: real but images are separate runtime"],
 "voidzero-dev_void#2": ["TI", "sandbox/container Dockerfile node 26.x vs .node-version 24.22.1: real but images are separate runtime"],
 "yoheimuta_protolint#1": ["TI", "publish node 24 vs test lts/* (deliberately floating test)"],
 "yoheimuta_protolint#2": ["TI", "test matrix [20, lts/*] includes 20 deliberately; EOL true"],
 "yoheimuta_protolint#3": ["T"],
 "DRYTRIX_TimeTracker#1": ["T"],
 "DRYTRIX_TimeTracker#2": ["TI", "python 3.11 vs 3.12 in sibling service Dockerfiles (mcp_server, peppol_bridge)"],
 "DRYTRIX_TimeTracker#3": ["T"],
 "DRYTRIX_TimeTracker#4": ["T"],
 "agentrq_agentrq#1": ["T"],
 "agentrq_agentrq#2": ["T"],
 "boxlite-ai_boxlite#2": ["TI", "scope apps: CI 22 vs per-service Dockerfiles 22/24 (separate images, both inside engines ^22.14||>=24.10)"],
 "updatecli_updatecli#1": ["T"]
}
```
<!-- labels-rerun:end -->
