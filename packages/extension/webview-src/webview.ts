/**
 * Thin Webview entrypoint.
 *
 * Why:
 * - Keep the bundle entry stable for `esbuild` (`webview-src/webview.ts`).
 * - Keep orchestration separated from feature modules to reduce merge conflicts.
 */
import "./app/webviewApp.js";
