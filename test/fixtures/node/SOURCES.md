# Fixture provenance (Node extractors)

Real public files, unmodified, fetched on 2026-11-25 from each repository's default branch with
`gh api -H "Accept: application/vnd.github.raw" repos/<repo>/contents/<path>`. Each file keeps the
licence of its repository. Names are `owner-repo.<file>`. Files marked "shared" are copies of
`test/extract/shared/fixtures/` (same sources; see that SOURCES.md).

| fixture | repo | path |
|---|---|---|
| goharbor-harbor.nvmrc | goharbor/harbor | src/portal/.nvmrc |
| kodu-ai-claude-coder.nvmrc | kodu-ai/claude-coder | extension/.nvmrc |
| nomcopter-react-mosaic.node-version | nomcopter/react-mosaic | .node-version |
| pure-css-pure.package.json | pure-css/pure | package.json (devEngines.runtime) |
| preactjs-preact.package.json | preactjs/preact | package.json (volta.node) |
| bofandra-satusehat.package.json | bofandra/satusehat-integration-sdk | sdks/node/package.json (engines.node with `\|\|`) |
| devexpress-devextreme.mise.toml | DevExpress/DevExtreme | .mise.toml |
| vickynovarese-playwright.yml | VickyNovarese/Playwright-Proyectos | .github/workflows/playwright.yml (`lts/*`) |
| expressjs-express.ci.yml | expressjs/express | .github/workflows/ci.yml (matrix list, quoted `lts/*`) |
| sindresorhus-got.main.yml | sindresorhus/got | .github/workflows/main.yml (block-style matrix) |
| shared: the six Dockerfiles, vitejs-vite.ci.yml, pallets-flask.tests.yaml, gin-gonic-gin.gin.yml, fillo001-greenledger.Ci.yml, manfredsteger-polly.gitlab-ci.yml, both .tool-versions, three mise.toml | see shared SOURCES.md | |

Recon samples that could not be fetched (repo or path gone): m-7labs/discord-ai-moderator,
Ibraah2/LEOPARD (workflow), Fortuna0006/ono-tebe-nado. Their forms (`[18.x, 20.x]`, `14.x`) are
covered by the expressjs/got fixtures and inline tests.
