(function () {
  /** @type {import('vscode').WebviewApi<unknown>} */
  const vscode = acquireVsCodeApi();

  const els = {
    status1: document.getElementById("status1"),
    status2: document.getElementById("status2"),
    signIn: document.getElementById("btnSignIn"),
    reconnect: document.getElementById("btnReconnect"),
    messages: document.getElementById("messages"),
    input: document.getElementById("input"),
    send: document.getElementById("btnSend"),
    error: document.getElementById("error"),
    profileOverlay: document.getElementById("profileOverlay"),
    profileCard: document.getElementById("profileCard"),
    profileAvatar: document.getElementById("profileAvatar"),
    profileName: document.getElementById("profileName"),
    profileLogin: document.getElementById("profileLogin"),
    profileBody: document.getElementById("profileBody"),
    profileClose: document.getElementById("profileClose"),
    profileOpenOnGitHub: document.getElementById("profileOpenOnGitHub"),
    profileError: document.getElementById("profileError"),
  };

  let activeProfileLogin = "";
  let activeProfileKey = "";
  let profileVisible = false;

  /** @param {string} text */
  function setError(text) {
    if (!els.error) return;
    if (!text) {
      els.error.classList.remove("visible");
      els.error.textContent = "";
      return;
    }
    els.error.classList.add("visible");
    els.error.textContent = text;
  }

  /** @param {string} text */
  function setProfileError(text) {
    if (!els.profileError) return;
    if (!text) {
      els.profileError.style.display = "none";
      els.profileError.textContent = "";
      return;
    }
    els.profileError.style.display = "";
    els.profileError.textContent = text;
  }

  function showProfile() {
    if (!els.profileOverlay) return;
    els.profileOverlay.style.display = "";
    profileVisible = true;
    if (els.profileClose) els.profileClose.focus();
  }

  function hideProfile() {
    if (!els.profileOverlay) return;
    els.profileOverlay.style.display = "none";
    profileVisible = false;
    activeProfileLogin = "";
    activeProfileKey = "";
    setProfileError("");
    if (els.profileBody) els.profileBody.textContent = "";
  }

  /**
   * @param {string} login
   * @param {string | undefined} avatarUrl
   */
  function renderProfileLoading(login, avatarUrl) {
    setProfileError("");
    if (els.profileAvatar) {
      els.profileAvatar.alt = `@${login}`;
      if (avatarUrl) els.profileAvatar.src = avatarUrl;
      els.profileAvatar.referrerPolicy = "no-referrer";
    }
    if (els.profileName) els.profileName.textContent = `@${login}`;
    if (els.profileLogin) els.profileLogin.textContent = "";
    if (els.profileBody) els.profileBody.textContent = "Loading…";
  }

  /** @param {any} profile */
  function renderProfile(profile) {
    setProfileError("");
    const login = typeof profile?.login === "string" ? profile.login : activeProfileLogin;
    const name = typeof profile?.name === "string" ? profile.name : null;
    const avatarUrl = typeof profile?.avatarUrl === "string" ? profile.avatarUrl : "";

    if (els.profileAvatar) {
      els.profileAvatar.alt = `@${login}`;
      if (avatarUrl) els.profileAvatar.src = avatarUrl;
      els.profileAvatar.referrerPolicy = "no-referrer";
    }

    if (els.profileName) els.profileName.textContent = name ? name : `@${login}`;
    if (els.profileLogin) els.profileLogin.textContent = name ? `@${login}` : "";

    if (!els.profileBody) return;
    els.profileBody.innerHTML = "";

    const bio = typeof profile?.bio === "string" ? profile.bio : null;
    if (bio) {
      const bioEl = document.createElement("div");
      bioEl.textContent = bio;
      els.profileBody.appendChild(bioEl);
    }

    const metaParts = [];
    if (typeof profile?.company === "string" && profile.company) metaParts.push(profile.company);
    if (typeof profile?.location === "string" && profile.location) metaParts.push(profile.location);
    if (metaParts.length > 0) {
      const metaEl = document.createElement("div");
      metaEl.className = "muted";
      metaEl.textContent = metaParts.join(" · ");
      els.profileBody.appendChild(metaEl);
    }

    const statsParts = [];
    if (typeof profile?.followers === "number") statsParts.push(`${profile.followers} followers`);
    if (typeof profile?.following === "number") statsParts.push(`${profile.following} following`);
    if (typeof profile?.publicRepos === "number") statsParts.push(`${profile.publicRepos} repos`);
    if (statsParts.length > 0) {
      const statsEl = document.createElement("div");
      statsEl.className = "muted";
      statsEl.textContent = statsParts.join(" · ");
      els.profileBody.appendChild(statsEl);
    }
  }

  /**
   * @param {string} login
   * @param {string | undefined} avatarUrl
   */
  function openProfile(login, avatarUrl) {
    if (!login) return;
    activeProfileLogin = login;
    activeProfileKey = login.toLowerCase();
    renderProfileLoading(login, avatarUrl);
    showProfile();
    vscode.postMessage({ type: "ui/profile.open", login });
  }

  /**
   * @param {HTMLElement} el
   * @param {string} login
   * @param {string | undefined} avatarUrl
   */
  function bindProfileOpen(el, login, avatarUrl) {
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

  /** @param {{login:string, avatarUrl:string}} user @param {string} text @param {string} createdAt */
  function addMessage(user, text, createdAt) {
    if (!els.messages) return;
    const row = document.createElement("div");
    row.className = "msg";

    const avatar = document.createElement("img");
    avatar.className = "avatar";
    avatar.alt = user.login;
    avatar.src = user.avatarUrl;
    avatar.referrerPolicy = "no-referrer";
    bindProfileOpen(avatar, user.login, user.avatarUrl);

    const body = document.createElement("div");

    const meta = document.createElement("div");
    meta.className = "meta";

    const login = document.createElement("span");
    login.className = "login";
    login.textContent = user.login;
    bindProfileOpen(login, user.login, user.avatarUrl);

    const time = document.createElement("span");
    time.className = "time";
    try {
      time.textContent = new Date(createdAt).toLocaleTimeString();
    } catch {
      time.textContent = createdAt;
    }

    meta.appendChild(login);
    meta.appendChild(time);

    const msgText = document.createElement("div");
    msgText.className = "text";
    msgText.textContent = text;

    body.appendChild(meta);
    body.appendChild(msgText);

    row.appendChild(avatar);
    row.appendChild(body);

    els.messages.appendChild(row);
    els.messages.scrollTop = els.messages.scrollHeight;
  }

  /** @param {{visible:boolean, enabled:boolean, label:string}} action */
  function renderAction(el, action) {
    if (!el || !action) return;
    el.style.display = action.visible ? "" : "none";
    el.disabled = !action.enabled;
    el.textContent = action.label;
  }

  /** @param {{status:string, authStatus?:string, actions?:{signIn?:{visible:boolean, enabled:boolean, label:string}, connect?:{visible:boolean, enabled:boolean, label:string}}, user?:{login:string}, backendUrl?:string}} state */
  function renderState(state) {
    if (els.status1) els.status1.textContent = state.status ?? "unknown";
    const parts = [];
    if (state.user?.login) parts.push(`@${state.user.login}`);
    if (state.backendUrl) parts.push(state.backendUrl);
    if (els.status2) els.status2.textContent = parts.join(" · ");

    const canSend = state.status === "connected";
    if (els.send) els.send.disabled = !canSend;
    if (els.input) els.input.disabled = !canSend;
    renderAction(els.signIn, state.actions?.signIn);
    renderAction(els.reconnect, state.actions?.connect);
  }

  function sendCurrent() {
    if (!els.input) return;
    const text = els.input.value.trim();
    if (!text) return;
    vscode.postMessage({ type: "ui/send", text });
    els.input.value = "";
  }

  if (els.signIn) {
    els.signIn.addEventListener("click", () => vscode.postMessage({ type: "ui/signIn" }));
  }
  if (els.reconnect) {
    els.reconnect.addEventListener("click", () => vscode.postMessage({ type: "ui/reconnect" }));
  }
  if (els.send) {
    els.send.addEventListener("click", sendCurrent);
  }
  if (els.input) {
    els.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendCurrent();
      }
    });
  }
  if (els.profileClose) {
    els.profileClose.addEventListener("click", hideProfile);
  }
  if (els.profileOverlay && els.profileCard) {
    els.profileOverlay.addEventListener("click", (e) => {
      if (e.target === els.profileOverlay) hideProfile();
    });
  }
  if (els.profileOpenOnGitHub) {
    els.profileOpenOnGitHub.addEventListener("click", () => {
      if (!activeProfileLogin) return;
      vscode.postMessage({ type: "ui/profile.openOnGitHub", login: activeProfileLogin });
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && profileVisible) {
      e.preventDefault();
      hideProfile();
    }
  });

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "ext/state":
        setError("");
        renderState(msg.state ?? {});
        return;
      case "ext/history":
        if (!els.messages) return;
        els.messages.innerHTML = "";
        for (const m of msg.history ?? []) {
          addMessage(m.user, m.text, m.createdAt);
        }
        return;
      case "ext/message":
        addMessage(msg.message.user, msg.message.text, msg.message.createdAt);
        return;
      case "ext/error":
        setError(String(msg.message ?? "error"));
        return;
      case "ext/profile.result": {
        const login = typeof msg.login === "string" ? msg.login : "";
        if (!login || login.toLowerCase() !== activeProfileKey) return;
        renderProfile(msg.profile);
        return;
      }
      case "ext/profile.error": {
        const login = typeof msg.login === "string" ? msg.login : "";
        if (!login || login.toLowerCase() !== activeProfileKey) return;
        const code = String(msg.message ?? "error");
        setProfileError("Unable to load profile.");
        if (els.profileBody) {
          els.profileBody.innerHTML = "";
          const detail = document.createElement("div");
          detail.className = "muted";
          detail.textContent = code;
          els.profileBody.appendChild(detail);
        }
        return;
      }
    }
  });

  vscode.postMessage({ type: "ui/ready" });
})();
