Fixture repos for test/cli.test.ts. Hand-built, each one for one behaviour:
- mixed: node/python/go conflicts, an EOL pin and a CI matrix value outside engines.
- clean: every pin agrees (exit 0).
- alias-drift: lts/* beside .nvmrc 24 (conflicts once Node 26 is LTS, 2026-10-28).
- monorepo: per-project-root scopes.
- floating: only info findings (latest / variant-only image tag).
