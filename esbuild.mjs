import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const extensionOptions = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  format: "cjs",
  platform: "node",
  target: "node18",
  external: ["vscode"],
  sourcemap: true,
  minify: false,
};

/**
 * Webview-side bundle. Plain IIFE for the browser platform — no CSP
 * exceptions, no CDN. Bundles jsdiff (via src/webview/align.js) alongside
 * the UI wiring; rendering the aligned rows is Step 4.
 * @type {import('esbuild').BuildOptions}
 */
const webviewOptions = {
  entryPoints: ["src/webview/main.js"],
  bundle: true,
  outfile: "media/main.js",
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  minify: true,
};

if (watch) {
  const [extensionCtx, webviewCtx] = await Promise.all([
    esbuild.context(extensionOptions),
    esbuild.context(webviewOptions),
  ]);
  await Promise.all([extensionCtx.watch(), webviewCtx.watch()]);
  console.log("[esbuild] watching for changes...");
} else {
  await Promise.all([esbuild.build(extensionOptions), esbuild.build(webviewOptions)]);
  console.log("[esbuild] build complete");
}
