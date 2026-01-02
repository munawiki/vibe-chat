import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
};

/** @type {import('esbuild').BuildOptions} */
const webviewOptions = {
  entryPoints: ["webview-src/webview.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  sourcemap: true,
  outfile: "media/webview.js",
  logLevel: "info",
};

if (isWatch) {
  const [extensionCtx, webviewCtx] = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(webviewOptions),
  ]);
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  console.log("Watching...");
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
}
