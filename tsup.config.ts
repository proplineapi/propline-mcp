import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // The MCP SDK is ESM-only, so we ship a single ESM build with a shebang
  // entry point. CommonJS users on Node 18+ can still run via npx.
  banner: { js: "#!/usr/bin/env node" },
  dts: false,
  clean: true,
  sourcemap: true,
  target: "node18",
  minify: false,
  splitting: false,
});
