import { defineConfig } from 'tsup'

export default defineConfig({
  // src/cli.ts starts with '#!/usr/bin/env node'; tsup keeps that line and marks dist/cli.js executable.
  entry: ['src/index.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  external: ['semver'],
})
