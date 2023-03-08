import fs from "fs";
import path from "path";
import esbuild from "esbuild";
import minimatch from "minimatch";
import { ImportSpecifier, parse } from "es-module-lexer";
import resolve from "resolve";
import mkdirp from "mkdirp";

type ReconstructedModule = {
  resolvedModulePath: string;
  moduleContents: string;
};

// Recursively resolves module based on Browserify's implementation
// of Node's module resolution algorithm.
function resolveModule({
  reconstructed = [] as ReconstructedModule[],
  maybeResolvedImports,
  stack,
  inputPath,
  contents,
  _imports,
  externs,
}) {
  for (const _import of _imports) {
    // Get the import definition line.
    const importDefinition = contents.slice(_import.ss, _import.se);

    // Resolve the module path.
    const bareSpecifierOrModule =
      _import.n.startsWith(".") && !path.extname(_import.n)
        ? _import.n + ".ts"
        : _import.n;
    const ordinaryModulePath = path.resolve(
      path.dirname(inputPath),
      bareSpecifierOrModule
    );

    // Skip cyclic dependencies.
    if (stack.indexOf(ordinaryModulePath) > -1) return;

    const resolvedModulePath = resolve.sync(ordinaryModulePath);

    // Populate stack for tracking defined modules.
    stack.push(ordinaryModulePath);

    // Get the file contents of each import.
    // We will mutate it on stripping sub-directory imports.
    let ordinaryModuleContents = fs.readFileSync(resolvedModulePath).toString();

    // Children module imports and exports.
    const [modules] = parse(ordinaryModuleContents);
    const maybeResolvedImports = modules
      .map((m: ImportSpecifier) => {
        const bareSpecifierOrModule =
          m.n?.startsWith(".") && !path.extname(m.n) ? m.n + ".ts" : m.n;
        const maybeResolvedPath = path.resolve(
          path.dirname(resolvedModulePath),
          bareSpecifierOrModule || ""
        );
        return stack.includes(maybeResolvedPath) ? m : undefined;
      })
      .filter(Boolean);

    for (const subdirImport of maybeResolvedImports) {
      // In this scenario, `ordinaryModuleContents` is the next module.
      const subdirImportDefinition = ordinaryModuleContents.slice(
        subdirImport?.ss,
        subdirImport?.se
      );
      ordinaryModuleContents = ordinaryModuleContents.replace(subdirImportDefinition, "");
    }

    const templatedModuleContents =
      `// ${bareSpecifierOrModule}\n` + ordinaryModuleContents.trim();

    // Update the last module in the reconstructed table.
    let patchedModule = reconstructed[
      reconstructed.length - 1
    ].moduleContents.replace(importDefinition, templatedModuleContents);

    // Since es-module-lexer does not support matching `ss` and `se` for default
    // exports, we can unsafely use regex for one-liner default exports. Normally,
    // we can expect that users should not need default exports when using this plugin.
    patchedModule = patchedModule.replace(
      /^\s*export\s+default\s+.+\n?(?:\s*)/gm,
      ""
    );

    reconstructed.push({
      resolvedModulePath,
      moduleContents: patchedModule,
    });

    if (modules.length)
      resolveModule({
        stack,
        maybeResolvedImports,
        inputPath: resolvedModulePath /** Allows `../sub-dir` imports. */,
        reconstructed,
        _imports: modules.filter(
          /** Filters for non-extern paths. */
          m => !externs.some(ext => minimatch(m.n || "", ext))
        ),
        externs,
        contents: ordinaryModuleContents,
      });
  }

  return reconstructed;
}

function esbuildPluginPreserveTypes(): esbuild.Plugin {
  return {
    name: "esbuild-plugin-preserve-types",
    setup(build) {
      build.onLoad({ filter: /\.tsx?$/ }, async args => {
        const externs = build.initialOptions?.external || [];
        const contents = await fs.promises.readFile(args.path, "utf8");
        const [_imports] = parse(contents);

        const reconstructed = resolveModule({
          reconstructed: [
            { resolvedModulePath: args.path, moduleContents: contents },
          ],
          maybeResolvedImports: [],
          stack: [],
          contents,
          externs,
          _imports: _imports.filter(
            m => !externs.some(ext => minimatch(m.n || "", ext))
          ),
          inputPath: args.path,
        }) as ReconstructedModule[];

        const output = reconstructed[reconstructed?.length - 1].moduleContents;
        const entry = (build.initialOptions?.entryPoints as string[])[0];

        // Write main chunk to disk.
        if (args.path == path.resolve(entry)) {
          const outDir = path.dirname(
            build.initialOptions?.outfile || "./bundle.ts"
          );
          mkdirp.sync(outDir);
          const outPath = path.resolve(
            build.initialOptions?.outfile || "bundle.ts"
          );

          await fs.promises.writeFile(outPath, output);
        }

        // No op.
        return {
          contents,
          loader: "empty",
        };
      });
    },
  };
}

export default esbuildPluginPreserveTypes;
