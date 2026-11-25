# Fixture provenance (go)

Real public files, unmodified, fetched 2026-11-25 from the default branch with
`gh api repos/<repo>/contents/<path>`; each keeps the licence of its repository. Names are `owner-repo.<file>`.

| fixture | repo | path |
|---|---|---|
| roaringbitmap-roaring.go.mod | RoaringBitmap/roaring | go.mod (`go 1.24.0` + `toolchain go1.24.4`) |
| apache-dubbo-admin.go.mod | apache/dubbo-admin | go.mod (275 lines, `require ( … )` blocks) |
| gin-gonic-gin.go.mod | gin-gonic/gin | go.mod |
| genuinetools-weather.Dockerfile | genuinetools/weather | Dockerfile (`FROM golang:alpine as builder`) |
| gin-gonic-gin.gin.yml | gin-gonic/gin | .github/workflows/gin.yml (`^1`, matrix `go`) |
| smartcontractkit-chainlink.tool-versions | smartcontractkit/chainlink | .tool-versions (`golang        1.27.3`) |
| authgear-authgear-server.tool-versions | authgear/authgear-server | .tool-versions |
| replicate-cog.mise.toml | replicate/cog | mise.toml (`go = "latest"`, 942 lines) |
