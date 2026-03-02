import type { UiInbound } from "../../src/contract/protocol/index.js";
import { getElements } from "../dom/elements.js";
import { createInitialWebviewState } from "../state/webviewState.js";
import { startWebviewApp } from "./controller.js";
import type { VscodeWebviewApi, WebviewContext } from "./types.js";

declare const acquireVsCodeApi: <T>() => VscodeWebviewApi<T>;

const vscode = acquireVsCodeApi<UiInbound>();
const els = getElements();
const state = createInitialWebviewState();

const queueTask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn: () => void) => {
        void Promise.resolve().then(fn);
      };

const ctx: WebviewContext = { vscode, els, state, queueTask };

startWebviewApp(ctx);
