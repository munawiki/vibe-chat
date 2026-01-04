import type { UiInbound } from "../../src/contract/webviewProtocol.js";
import type { Elements } from "../dom/elements.js";
import type { WebviewState } from "../state/webviewState.js";

export type VscodeWebviewApi<T> = {
  postMessage: (message: T) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

export type QueueTask = (fn: () => void) => void;

export type WebviewContext = {
  vscode: VscodeWebviewApi<UiInbound>;
  els: Elements;
  state: WebviewState;
  queueTask: QueueTask;
};
