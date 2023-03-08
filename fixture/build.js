import * as esbuild from "esbuild";
import esbuildPluginPreserveTypes from "../dist/index.js";

await esbuild.build({
  entryPoints: ["./src/index.ts"],
  outfile: "./build/fixture.ts",
  external: ["@tscc/std/*", "@tscc/env/*"],
  write: false,
  bundle: true,
  plugins: [esbuildPluginPreserveTypes()],
});
