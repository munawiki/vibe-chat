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
type ExtPresenceMsg = Extract<ExtOutbound, { type: "ext/presence" }>;
type ExtProfileResultMsg = Extract<ExtOutbound, { type: "ext/profile.result" }>;

type Elements = {
  status1: HTMLElement | null;
  status2: HTMLElement | null;
  identity: HTMLButtonElement | null;
  identityAvatar: HTMLImageElement | null;
  identityLogin: HTMLElement | null;
  presence: HTMLButtonElement | null;
  presenceOverlay: HTMLElement | null;
  presenceCard: HTMLElement | null;
  presenceClose: HTMLButtonElement | null;
  presencePanel: HTMLElement | null;
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
  identity: document.getElementById("btnIdentity") as HTMLButtonElement | null,
  identityAvatar: document.getElementById("identityAvatar") as HTMLImageElement | null,
  identityLogin: document.getElementById("identityLogin"),
  presence: document.getElementById("btnPresence") as HTMLButtonElement | null,
  presenceOverlay: document.getElementById("presenceOverlay"),
  presenceCard: document.getElementById("presenceCard"),
  presenceClose: document.getElementById("presenceClose") as HTMLButtonElement | null,
  presencePanel: document.getElementById("presencePanel"),
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
let presenceVisible = false;
let presenceSnapshot: ExtPresenceMsg["snapshot"] | null = null;
let isConnected = false;
let signedInLoginLowerCase: string | null = null;
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
  profileVisible = false;
  activeProfileLogin = "";
  activeProfileKey = "";
  setProfileError("");
  if (els.profileBody) els.profileBody.textContent = "";
  if (!els.profileOverlay) return;
  els.profileOverlay.style.display = "none";
}

function renderPresencePanel(): void {
  if (!els.presencePanel) return;
  els.presencePanel.innerHTML = "";

  if (!presenceSnapshot) {
    const empty = document.createElement("div");
    empty.className = "presenceEmpty muted";
    empty.textContent = "Online users unavailable.";
    els.presencePanel.appendChild(empty);
    return;
  }

  if (presenceSnapshot.length === 0) {
    const empty = document.createElement("div");
    empty.className = "presenceEmpty muted";
    empty.textContent = "No one online.";
    els.presencePanel.appendChild(empty);
    return;
  }

  for (const entry of presenceSnapshot) {
    const row = document.createElement("div");
    row.className = "presenceUser";
    row.setAttribute("role", "listitem");

    const avatar = document.createElement("img");
    avatar.className = "presenceAvatar";
    avatar.alt = entry.user.login;
    avatar.src = entry.user.avatarUrl;
    avatar.referrerPolicy = "no-referrer";
    bindProfileOpen(avatar, entry.user.login, entry.user.avatarUrl);

    const login = document.createElement("span");
    login.className = "presenceLogin";
    login.textContent = entry.user.login;
    bindProfileOpen(login, entry.user.login, entry.user.avatarUrl);

    row.append(avatar, login);

    els.presencePanel.appendChild(row);
  }
}

function hidePresence(): void {
  presenceVisible = false;
  els.presence?.setAttribute("aria-expanded", "false");
  if (!els.presenceOverlay) return;
  els.presenceOverlay.style.display = "none";
}

function showPresence(): void {
  if (!els.presenceOverlay) return;
  hideProfile();
  els.presenceOverlay.style.display = "";
  presenceVisible = true;
  els.presence?.setAttribute("aria-expanded", "true");
  renderPresencePanel();
  els.presenceClose?.focus();
}

function togglePresencePanel(): void {
  if (!isConnected) return;
  if (!els.presence || els.presence.disabled) return;
  if (presenceVisible) {
    hidePresence();
    return;
  }
  showPresence();
}

function renderPresence(): void {
  if (!els.presence) return;

  if (!isConnected) {
    els.presence.style.display = "none";
    els.presence.disabled = true;
    els.presence.textContent = "Online: —";
    hidePresence();
    return;
  }

  els.presence.style.display = "";
  els.presence.disabled = presenceSnapshot === null;
  els.presence.textContent = `Online: ${presenceSnapshot ? presenceSnapshot.length : "—"}`;

  if (presenceVisible && !els.presence.disabled) renderPresencePanel();
  if (presenceVisible && els.presence.disabled) hidePresence();
}

// Invariant: The profile modal must only be opened by explicit user action (click).
// VS Code may restore/reuse a webview DOM where the overlay is left open, while this script starts fresh.
// Always reset to "closed" on boot to prevent an empty/ghost profile card from showing on reload.
hideProfile();
hidePresence();

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
  hidePresence();
  activeProfileLogin = login;
  activeProfileKey = login.toLowerCase();
  renderProfileLoading(login, avatarUrl);
  showProfile();
  vscode.postMessage({ type: "ui/profile.open", login } satisfies UiInbound);
}

function hideHeaderIdentity(): void {
  if (!els.identity) return;
  els.identity.style.display = "none";
  els.identity.dataset.login = "";
  els.identity.dataset.avatarUrl = "";
  els.identity.removeAttribute("aria-label");

  if (els.identityAvatar) {
    els.identityAvatar.alt = "";
    els.identityAvatar.removeAttribute("src");
  }

  if (els.identityLogin) els.identityLogin.textContent = "";
}

function showHeaderIdentity(login: string, avatarUrl: string): void {
  if (!els.identity) return;
  els.identity.style.display = "";
  els.identity.dataset.login = login;
  els.identity.dataset.avatarUrl = avatarUrl;
  els.identity.setAttribute("aria-label", `Open GitHub profile for @${login}`);

  if (els.identityAvatar) {
    els.identityAvatar.alt = login;
    els.identityAvatar.src = avatarUrl;
    els.identityAvatar.referrerPolicy = "no-referrer";
  }

  if (els.identityLogin) els.identityLogin.textContent = `@${login}`;
}

function openHeaderIdentityProfile(): void {
  const login = els.identity?.dataset.login;
  if (!login) return;
  const avatarUrl = els.identity?.dataset.avatarUrl || undefined;
  openProfile(login, avatarUrl);
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

function classifyMessageRow(row: HTMLElement, authorLoginLowerCase: string): void {
  row.classList.toggle("own", signedInLoginLowerCase === authorLoginLowerCase);
}

function reclassifyMessages(): void {
  if (!els.messages) return;
  const login = signedInLoginLowerCase;
  els.messages.querySelectorAll<HTMLElement>(".msg").forEach((row) => {
    const author = row.dataset.authorLogin;
    if (!author || !login) {
      row.classList.remove("own");
      return;
    }
    row.classList.toggle("own", author === login);
  });
}

function addMessage(message: ExtMessageMsg["message"]): void {
  if (!els.messages) return;
  const row = document.createElement("div");
  row.className = "msg";
  const authorLoginLowerCase = message.user.login.toLowerCase();
  row.dataset.authorLogin = authorLoginLowerCase;
  if (signedInLoginLowerCase) classifyMessageRow(row, authorLoginLowerCase);

  const avatar = document.createElement("img");
  avatar.className = "avatar";
  avatar.alt = message.user.login;
  avatar.src = message.user.avatarUrl;
  avatar.referrerPolicy = "no-referrer";
  bindProfileOpen(avatar, message.user.login, message.user.avatarUrl);

  const body = document.createElement("div");
  body.className = "body";

  const meta = document.createElement("div");
  meta.className = "meta";

  const login = document.createElement("span");
  login.className = "login";
  login.textContent = message.user.login;
  bindProfileOpen(login, message.user.login, message.user.avatarUrl);

  const time = document.createElement("span");
  time.className = "time";
  try {
    time.textContent = new Date(message.createdAt).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
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
  const status = state.status ?? "unknown";
  isConnected = status === "connected";

  if (els.status1) {
    if (isConnected) {
      els.status1.style.display = "none";
      els.status1.textContent = "";
    } else {
      els.status1.style.display = "";
      els.status1.textContent = status;
    }
  }

  // The backend URL is a developer detail and should not be surfaced in the chat header UI.
  // Keep `state.backendUrl` in the state contract for diagnostics/config, but do not render it.
  if (els.status2) {
    els.status2.style.display = "none";
    els.status2.textContent = "";
  }

  const prevSignedInLogin = signedInLoginLowerCase;
  signedInLoginLowerCase =
    "user" in state && state.user?.login ? state.user.login.toLowerCase() : null;
  if (prevSignedInLogin !== signedInLoginLowerCase) reclassifyMessages();

  if ("user" in state && state.user?.login && state.user.avatarUrl) {
    showHeaderIdentity(state.user.login, state.user.avatarUrl);
  } else {
    hideHeaderIdentity();
  }

  if (!isConnected) presenceSnapshot = null;
  renderPresence();

  const canSend = isConnected;
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
els.presence?.addEventListener("click", () => togglePresencePanel());
els.identity?.addEventListener("click", () => openHeaderIdentityProfile());

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

els.presenceClose?.addEventListener("click", () => hidePresence());

if (els.presenceOverlay && els.presenceCard) {
  els.presenceOverlay.addEventListener("click", (e) => {
    if (e.target === els.presenceOverlay) hidePresence();
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
    return;
  }

  if (e.key === "Escape" && presenceVisible) {
    e.preventDefault();
    hidePresence();
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
    case "ext/presence":
      presenceSnapshot = msg.snapshot;
      renderPresence();
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
