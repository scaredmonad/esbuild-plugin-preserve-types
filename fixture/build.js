import * as esbuild from "esbuild";
import esbuildPluginPreserveTypes from "../dist/index.js";

await esbuild.build({
  entryPoints: ["./src/index.ts"],
  bundle: true,
  outfile: "bundle.ts",
  write: false,
  plugins: [esbuildPluginPreserveTypes()],
});
