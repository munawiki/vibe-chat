import * as vscode from "vscode";
import { CHAT_MESSAGE_TEXT_MAX_LEN } from "@vscode-chat/protocol";

export function renderChatWebviewHtml(options: {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  extensionMode: vscode.ExtensionMode;
}): string {
  const mediaRoot = vscode.Uri.joinPath(options.extensionUri, "media");
  const cssUri = options.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "webview.css"));
  const jsUri = options.webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, "webview.js"));
  const nonce = randomNonce();
  const csp = [
    "default-src 'none'",
    "img-src https: data:",
    `style-src ${options.webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
    options.extensionMode === vscode.ExtensionMode.Development
      ? `connect-src ${options.webview.cspSource}`
      : undefined,
  ]
    .filter(Boolean)
    .join("; ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="${csp}"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="${cssUri.toString()}" />
    <title>VS Code Chat</title>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="headerLeft">
          <button class="identityChip" id="btnIdentity" type="button" hidden>
            <img class="identityAvatar" id="identityAvatar" alt="" />
            <span class="identityLogin" id="identityLogin"></span>
          </button>
        </div>
        <div class="headerRight">
          <div class="actions">
            <button class="secondary" id="btnSignIn">Sign in with GitHub</button>
            <button class="secondary" id="btnReconnect" hidden>Connect</button>
          </div>
          <button
            class="connButton"
            id="btnConnStatus"
            type="button"
            disabled
            aria-haspopup="dialog"
            aria-expanded="false"
            aria-controls="presenceOverlay"
          >
            <span class="connText" id="connText" aria-live="polite">Disconnected</span>
            <span class="connDot" id="connDot" aria-hidden="true"></span>
          </button>
        </div>
      </div>
      <div class="channelTabs" role="tablist" aria-label="Channels">
        <button class="tab active" id="btnChannelGlobal" type="button" role="tab" aria-selected="true">
          Global
        </button>
        <button class="tab" id="btnChannelDm" type="button" role="tab" aria-selected="false">
          DM
        </button>
      </div>
      <div class="dmPanel" id="dmPanel" hidden>
        <div class="dmWarning" id="dmWarning" hidden>
          <div class="dmWarningText" id="dmWarningText"></div>
          <button class="danger" id="btnDmTrust" type="button">Trust</button>
        </div>
        <div class="dmThreads" id="dmThreads"></div>
        <div class="dmEmpty muted" id="dmEmpty" hidden>
          Start a DM from a profile card.
        </div>
      </div>
      <div class="messages" id="messages"></div>
      <div class="composer">
        <textarea
          id="input"
          rows="2"
          maxlength="${CHAT_MESSAGE_TEXT_MAX_LEN}"
          placeholder="Type a message…"
          disabled
        ></textarea>
        <button id="btnSend" disabled>Send</button>
      </div>
      <div class="error" id="error"></div>
    </div>
    <div class="profileOverlay" id="profileOverlay" hidden>
      <div class="profileCard" id="profileCard" role="dialog" aria-modal="true" aria-label="GitHub Profile">
        <div class="profileHeader">
          <img class="profileAvatar" id="profileAvatar" alt="" />
          <div class="profileTitle">
            <div class="profileName" id="profileName"></div>
            <div class="profileLogin" id="profileLogin"></div>
          </div>
          <button class="profileClose" id="profileClose" aria-label="Close">×</button>
        </div>
        <div class="profileBody" id="profileBody"></div>
        <div class="profileFooter">
          <div class="profileActions" id="profileActions" hidden>
            <button class="danger" id="profileBan" type="button">Ban</button>
            <button class="secondary" id="profileUnban" type="button">Unban</button>
          </div>
          <button class="secondary" id="profileMessage" type="button" hidden>Message</button>
          <button class="secondary" id="profileOpenOnGitHub">Open on GitHub</button>
        </div>
        <div class="profileModStatus muted" id="profileModStatus" hidden></div>
        <div class="profileError" id="profileError" hidden></div>
      </div>
    </div>
    <div class="presenceOverlay" id="presenceOverlay" hidden>
      <div class="presenceCard" id="presenceCard" role="dialog" aria-modal="true" aria-label="Online users">
        <div class="presenceHeader">
          <div class="presenceTitle" id="presenceTitle">Online users</div>
          <button class="presenceClose" id="presenceClose" aria-label="Close">×</button>
        </div>
        <div class="presencePanel" id="presencePanel" role="list"></div>
      </div>
    </div>
    <script nonce="${nonce}" src="${jsUri.toString()}"></script>
  </body>
</html>`;
}

function randomNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i += 1) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}
