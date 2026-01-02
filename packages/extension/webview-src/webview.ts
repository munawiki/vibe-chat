import { ExtOutboundSchema, type ExtOutbound, type UiInbound } from "../src/ui/webviewProtocol.js";

type VscodeWebviewApi<T> = {
  postMessage: (message: T) => void;
  getState: () => unknown;
  setState: (state: unknown) => void;
};

declare const acquireVsCodeApi: <T>() => VscodeWebviewApi<T>;

const vscode = acquireVsCodeApi<UiInbound>();

type ExtStateMsg = Extract<ExtOutbound, { type: "ext/state" }>;
type ExtMessageMsg = Extract<ExtOutbound, { type: "ext/message" }>;
type ExtProfileResultMsg = Extract<ExtOutbound, { type: "ext/profile.result" }>;

type Elements = {
  status1: HTMLElement | null;
  status2: HTMLElement | null;
  signIn: HTMLButtonElement | null;
  reconnect: HTMLButtonElement | null;
  messages: HTMLElement | null;
  input: HTMLInputElement | null;
  send: HTMLButtonElement | null;
  error: HTMLElement | null;
  profileOverlay: HTMLElement | null;
  profileCard: HTMLElement | null;
  profileAvatar: HTMLImageElement | null;
  profileName: HTMLElement | null;
  profileLogin: HTMLElement | null;
  profileBody: HTMLElement | null;
  profileClose: HTMLButtonElement | null;
  profileOpenOnGitHub: HTMLButtonElement | null;
  profileError: HTMLElement | null;
};

const els: Elements = {
  status1: document.getElementById("status1"),
  status2: document.getElementById("status2"),
  signIn: document.getElementById("btnSignIn") as HTMLButtonElement | null,
  reconnect: document.getElementById("btnReconnect") as HTMLButtonElement | null,
  messages: document.getElementById("messages"),
  input: document.getElementById("input") as HTMLInputElement | null,
  send: document.getElementById("btnSend") as HTMLButtonElement | null,
  error: document.getElementById("error"),
  profileOverlay: document.getElementById("profileOverlay"),
  profileCard: document.getElementById("profileCard"),
  profileAvatar: document.getElementById("profileAvatar") as HTMLImageElement | null,
  profileName: document.getElementById("profileName"),
  profileLogin: document.getElementById("profileLogin"),
  profileBody: document.getElementById("profileBody"),
  profileClose: document.getElementById("profileClose") as HTMLButtonElement | null,
  profileOpenOnGitHub: document.getElementById("profileOpenOnGitHub") as HTMLButtonElement | null,
  profileError: document.getElementById("profileError"),
};

let activeProfileLogin = "";
let activeProfileKey = "";
let profileVisible = false;
let inputIsComposing = false;
let sendPendingAfterComposition = false;
let suppressEnterUntilMs = 0;

const queueTask =
  typeof queueMicrotask === "function"
    ? queueMicrotask
    : (fn: () => void) => {
        void Promise.resolve().then(fn);
      };

function setError(text: string): void {
  if (!els.error) return;
  if (!text) {
    els.error.classList.remove("visible");
    els.error.textContent = "";
    return;
  }
  els.error.classList.add("visible");
  els.error.textContent = text;
}

function setProfileError(text: string): void {
  if (!els.profileError) return;
  if (!text) {
    els.profileError.style.display = "none";
    els.profileError.textContent = "";
    return;
  }
  els.profileError.style.display = "";
  els.profileError.textContent = text;
}

function showProfile(): void {
  if (!els.profileOverlay) return;
  els.profileOverlay.style.display = "";
  profileVisible = true;
  els.profileClose?.focus();
}

function hideProfile(): void {
  if (!els.profileOverlay) return;
  els.profileOverlay.style.display = "none";
  profileVisible = false;
  activeProfileLogin = "";
  activeProfileKey = "";
  setProfileError("");
  if (els.profileBody) els.profileBody.textContent = "";
}

// Invariant: The profile modal must only be opened by explicit user action (click).
// VS Code may restore/reuse a webview DOM where the overlay is left open, while this script starts fresh.
// Always reset to "closed" on boot to prevent an empty/ghost profile card from showing on reload.
hideProfile();

function setProfileAvatar(login: string, avatarUrl: string | undefined): void {
  if (!els.profileAvatar) return;
  els.profileAvatar.alt = `@${login}`;
  if (avatarUrl) els.profileAvatar.src = avatarUrl;
  els.profileAvatar.referrerPolicy = "no-referrer";
}

function renderProfileLoading(login: string, avatarUrl: string | undefined): void {
  setProfileError("");
  setProfileAvatar(login, avatarUrl);
  if (els.profileName) els.profileName.textContent = `@${login}`;
  if (els.profileLogin) els.profileLogin.textContent = "";
  if (els.profileBody) els.profileBody.textContent = "Loading…";
}

function renderProfile(profile: ExtProfileResultMsg["profile"]): void {
  setProfileError("");
  const login = profile.login || activeProfileLogin;
  const name = profile.name ?? null;
  const avatarUrl = profile.avatarUrl ?? "";

  setProfileAvatar(login, avatarUrl);

  if (els.profileName) els.profileName.textContent = name ? name : `@${login}`;
  if (els.profileLogin) els.profileLogin.textContent = name ? `@${login}` : "";

  if (!els.profileBody) return;
  els.profileBody.innerHTML = "";

  if (profile.bio) {
    const bioEl = document.createElement("div");
    bioEl.textContent = profile.bio;
    els.profileBody.appendChild(bioEl);
  }

  const metaParts: string[] = [];
  if (profile.company) metaParts.push(profile.company);
  if (profile.location) metaParts.push(profile.location);
  if (metaParts.length > 0) {
    const metaEl = document.createElement("div");
    metaEl.className = "muted";
    metaEl.textContent = metaParts.join(" · ");
    els.profileBody.appendChild(metaEl);
  }

  const statsParts: string[] = [];
  if (typeof profile.followers === "number") statsParts.push(`${profile.followers} followers`);
  if (typeof profile.following === "number") statsParts.push(`${profile.following} following`);
  if (typeof profile.publicRepos === "number") statsParts.push(`${profile.publicRepos} repos`);
  if (statsParts.length > 0) {
    const statsEl = document.createElement("div");
    statsEl.className = "muted";
    statsEl.textContent = statsParts.join(" · ");
    els.profileBody.appendChild(statsEl);
  }
}

function openProfile(login: string, avatarUrl: string | undefined): void {
  if (!login) return;
  activeProfileLogin = login;
  activeProfileKey = login.toLowerCase();
  renderProfileLoading(login, avatarUrl);
  showProfile();
  vscode.postMessage({ type: "ui/profile.open", login } satisfies UiInbound);
}

function bindProfileOpen(el: HTMLElement, login: string, avatarUrl: string | undefined): void {
  el.classList.add("clickable");
  el.tabIndex = 0;
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", `Open GitHub profile for @${login}`);
  el.addEventListener("click", () => openProfile(login, avatarUrl));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openProfile(login, avatarUrl);
    }
  });
}

function addMessage(message: ExtMessageMsg["message"]): void {
  if (!els.messages) return;
  const row = document.createElement("div");
  row.className = "msg";

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = message.user.login;
  avatar.src = message.user.avatarUrl;
  avatar.referrerPolicy = "no-referrer";
  bindProfileOpen(avatar, message.user.login, message.user.avatarUrl);

  const body = document.createElement("div");

  const meta = document.createElement("div");
  meta.className = "meta";

  const login = document.createElement("span");
  login.className = "login";
  login.textContent = message.user.login;
  bindProfileOpen(login, message.user.login, message.user.avatarUrl);

  const time = document.createElement("span");
  time.className = "time";
  try {
    time.textContent = new Date(message.createdAt).toLocaleTimeString();
  } catch {
    time.textContent = message.createdAt;
  }

  meta.append(login, time);

  const msgText = document.createElement("div");
  msgText.className = "text";
  msgText.textContent = message.text;

  body.append(meta, msgText);

  row.append(avatar, body);

  els.messages.appendChild(row);
  els.messages.scrollTop = els.messages.scrollHeight;
}

type HeaderAction = ExtStateMsg["state"]["actions"]["signIn"];

function renderAction(el: HTMLButtonElement | null, action: HeaderAction | undefined): void {
  if (!el || !action) return;
  el.style.display = action.visible ? "" : "none";
  el.disabled = !action.enabled;
  el.textContent = action.label;
}

function renderState(state: ExtStateMsg["state"]): void {
  if (els.status1) els.status1.textContent = state.status ?? "unknown";
  const parts: string[] = [];
  if ("user" in state && state.user?.login) parts.push(`@${state.user.login}`);
  if (state.backendUrl) parts.push(state.backendUrl);
  if (els.status2) els.status2.textContent = parts.join(" · ");

  const canSend = state.status === "connected";
  if (els.send) els.send.disabled = !canSend;
  if (els.input) els.input.disabled = !canSend;
  renderAction(els.signIn, state.actions?.signIn);
  renderAction(els.reconnect, state.actions?.connect);
}

function sendCurrent(): void {
  if (!els.input) return;
  const text = els.input.value.trim();
  if (!text) return;
  vscode.postMessage({ type: "ui/send", text } satisfies UiInbound);
  els.input.value = "";
}

els.signIn?.addEventListener("click", () => vscode.postMessage({ type: "ui/signIn" }));
els.reconnect?.addEventListener("click", () => vscode.postMessage({ type: "ui/reconnect" }));
els.send?.addEventListener("click", () => sendCurrent());

if (els.input) {
  els.input.addEventListener("compositionstart", () => {
    inputIsComposing = true;
  });
  els.input.addEventListener("compositionend", () => {
    inputIsComposing = false;
    if (!sendPendingAfterComposition) return;
    sendPendingAfterComposition = false;
    suppressEnterUntilMs = Date.now() + 100;
    queueTask(() => sendCurrent());
  });
  els.input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      if (inputIsComposing || e.isComposing) {
        sendPendingAfterComposition = true;
        return;
      }

      e.preventDefault();
      if (Date.now() < suppressEnterUntilMs) return;
      sendCurrent();
    }
  });
}

els.profileClose?.addEventListener("click", () => hideProfile());

if (els.profileOverlay && els.profileCard) {
  els.profileOverlay.addEventListener("click", (e) => {
    if (e.target === els.profileOverlay) hideProfile();
  });
}

els.profileOpenOnGitHub?.addEventListener("click", () => {
  if (!activeProfileLogin) return;
  vscode.postMessage({ type: "ui/profile.openOnGitHub", login: activeProfileLogin });
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && profileVisible) {
    e.preventDefault();
    hideProfile();
  }
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  const parsed = ExtOutboundSchema.safeParse(event.data);
  if (!parsed.success) return;

  const msg = parsed.data;

  switch (msg.type) {
    case "ext/state":
      setError("");
      renderState(msg.state);
      return;
    case "ext/history":
      if (!els.messages) return;
      els.messages.innerHTML = "";
      for (const m of msg.history) addMessage(m);
      return;
    case "ext/message":
      addMessage(msg.message);
      return;
    case "ext/error":
      setError(msg.message);
      return;
    case "ext/profile.result": {
      if (msg.login.toLowerCase() !== activeProfileKey) return;
      renderProfile(msg.profile);
      return;
    }
    case "ext/profile.error": {
      if (msg.login.toLowerCase() !== activeProfileKey) return;
      setProfileError("Unable to load profile.");
      if (els.profileBody) {
        els.profileBody.innerHTML = "";
        const detail = document.createElement("div");
        detail.className = "muted";
        detail.textContent = msg.message;
        els.profileBody.appendChild(detail);
      }
      return;
    }
  }
});

vscode.postMessage({ type: "ui/ready" });
