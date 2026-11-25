# Fixture provenance

Real public files used as parser test data (small CI/config files, unmodified). Fetched on 2026-11-25
from the default branch with `gh api repos/<repo>/contents/<path>`; each file keeps the licence of its
repository. Names are `owner-repo.<file>`. They are the samples docs/TASKS.md A3 asks for.

| fixture | repo | path |
|---|---|---|
| nearai-ironclaw.Dockerfile | nearai/ironclaw | Dockerfile |
| botpress-botpress.Dockerfile | botpress/botpress | Dockerfile |
| eritislami-evobot.Dockerfile | eritislami/evobot | Dockerfile |
| defguard-defguard.Dockerfile | DefGuard/defguard | Dockerfile |
| humanmade-tachyon.Dockerfile | humanmade/tachyon | Dockerfile |
| raineorshine-npm-check-updates.Dockerfile | raineorshine/npm-check-updates | Dockerfile |
| genuinetools-weather.Dockerfile | genuinetools/weather | Dockerfile |
| vitejs-vite.ci.yml | vitejs/vite | .github/workflows/ci.yml |
| pallets-flask.tests.yaml | pallets/flask | .github/workflows/tests.yaml |
| gin-gonic-gin.gin.yml | gin-gonic/gin | .github/workflows/gin.yml |
| fillo001-greenledger.Ci.yml | Fillo001/greenledger | .GitHub/workflows/Ci.Yml (directory and file names with mixed case) |
| manfredsteger-polly.gitlab-ci.yml | manfredsteger/polly | .gitlab-ci.yml.restored |
| gitlabhq-gitlabhq.tool-versions | gitlabhq/gitlabhq | .tool-versions |
| smartcontractkit-chainlink.tool-versions | smartcontractkit/chainlink | .tool-versions |
| conventional-changelog-commitlint.mise.toml | conventional-changelog/commitlint | .mise.toml |
| metabase-metabase.mise.toml | metabase/metabase | mise.toml |
| butlerx-wetty.mise.toml | butlerx/wetty | .mise.toml |

## Added for rpc-prec-extract (corpus shapes, pinned to the corpus SHAs in bench/repos.txt)

| fixture | repo @ SHA | path |
|---|---|---|
| drytrix-timetracker.ci.yml | DRYTRIX/TimeTracker @ 9b235cf5d4a06a3968c9d3d3843574a1f9df2684 | .github/workflows/ci.yml (`env:` NODE_VERSION/PYTHON_VERSION at workflow level; `node-version: ${{ env.NODE_VERSION }}`) |
| drytrix-timetracker.build-desktop.yml | DRYTRIX/TimeTracker @ 9b235cf5… | .github/workflows/build-desktop.yml |
| openenv-openenv.browsergym.Dockerfile | openenv/OpenEnv @ 3659dc73eb8114724209e642eee749cd94348ce3 | envs/browsergym_env/server/Dockerfile (`FROM mcr.microsoft.com/playwright/python:v1.44.0-jammy`) |

## Added for rpc-diag-scope (corpus SHA from bench/repos.txt)

| fixture | repo @ SHA | path |
|---|---|---|
| influxdata-chronograf.resources.kind-config.yaml | influxdata/chronograf @ fdb06f1d13597fa523c06bb4033963c5b4affefe | .github/workflows/resources/kind-config.yaml (valid Kubernetes YAML, not a workflow) |
| influxdata-chronograf.resources.test-resources.yaml | same | .github/workflows/resources/test-resources.yaml (valid multi-document Kubernetes YAML) |
| influxdata-chronograf.cypress-tests.yaml | same | .github/workflows/chronograf-cypress-tests.yaml (a real top-level workflow beside them) |
