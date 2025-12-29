import * as esbuild from "esbuild";

const isWatch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  sourcemap: true,
  outfile: "dist/extension.cjs",
  external: ["vscode"],
  logLevel: "info",
};

if (isWatch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("Watching...");
} else {
  await esbuild.build(options);
}
