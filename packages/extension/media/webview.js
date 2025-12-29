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
  };

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

    const body = document.createElement("div");

    const meta = document.createElement("div");
    meta.className = "meta";

    const login = document.createElement("span");
    login.className = "login";
    login.textContent = user.login;

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

  /** @param {{status:string, user?:{login:string}, backendUrl?:string}} state */
  function renderState(state) {
    if (els.status1) els.status1.textContent = state.status ?? "unknown";
    const parts = [];
    if (state.user?.login) parts.push(`@${state.user.login}`);
    if (state.backendUrl) parts.push(state.backendUrl);
    if (els.status2) els.status2.textContent = parts.join(" · ");

    const canSend = state.status === "connected";
    if (els.send) els.send.disabled = !canSend;
    if (els.input) els.input.disabled = !canSend;
    if (els.reconnect) els.reconnect.disabled = state.status === "connecting";
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
    }
  });

  vscode.postMessage({ type: "ui/ready" });
})();
