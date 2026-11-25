# Fixture provenance (python)

Real public files, unmodified, fetched 2026-11-25 from the default branch with
`gh api repos/<repo>/contents/<path>`; each keeps the licence of its repository. Names are `owner-repo.<file>`.

| fixture | repo | path |
|---|---|---|
| zyphra-zonos.python-version | Zyphra/Zonos | .python-version (no trailing newline) |
| mindwerks-worldengine.python-version | Mindwerks/worldengine | .python-version (six versions, one per line) |
| qin2dim-hcaptcha-challenger.pyproject.toml | QIN2DIM/hcaptcha-challenger | pyproject.toml (`project.requires-python`) |
| pallets-flask.pyproject.toml | pallets/flask | pyproject.toml |
| keephq-keep.pyproject.toml | keephq/keep | pyproject.toml (Poetry `python = ">=3.11,<3.14"`; also python-dotenv, python-json-logger keys) |
| esdalmaijer-pygaze.pyproject.toml | esdalmaijer/PyGaze | pyproject.toml (Poetry `python = ">= 3.7"`) |
| codeforphilly-chime.runtime.txt | CodeForPhilly/chime | runtime.txt |
| stefmolin-hands-on-data-analysis.runtime.txt | stefmolin/Hands-On-Data-Analysis-with-Pandas | runtime.txt |
| authgear-authgear-server.tool-versions | authgear/authgear-server | .tool-versions |
| smartcontractkit-chainlink.tool-versions | smartcontractkit/chainlink | .tool-versions (aligned columns) |
| spiker1992-python-event-sourcing.Dockerfile | Spiker1992/python-event-sourcing | Dockerfile (`FROM python:slim`) |
| pallets-flask.tests.yaml | pallets/flask | .github/workflows/tests.yaml (matrix, `python-version-file`) |
