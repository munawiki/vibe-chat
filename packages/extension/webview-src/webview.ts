export function renderBootError(error: unknown): void {
  const pre = document.createElement("pre");
  pre.textContent = `Webview initialization failed.\n\n${String(error)}`;
  pre.style.whiteSpace = "pre-wrap";
  pre.style.padding = "12px";
  pre.style.color = "#b00020";

  document.body.replaceChildren(pre);
}

export async function bootWebview(
  loadApp: () => Promise<unknown> = () => import("./app/webviewApp.js"),
): Promise<void> {
  try {
    await loadApp();
  } catch (error) {
    renderBootError(error);
  }
}

const globals = globalThis as { __VSCODE_CHAT_WEBVIEW_TEST__?: boolean };
if (!globals.__VSCODE_CHAT_WEBVIEW_TEST__) {
  void bootWebview();
}
