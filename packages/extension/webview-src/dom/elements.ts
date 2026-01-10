export type Elements = {
  channelGlobal: HTMLButtonElement | null;
  channelDm: HTMLButtonElement | null;
  dmPanel: HTMLElement | null;
  dmWarning: HTMLElement | null;
  dmWarningText: HTMLElement | null;
  dmTrust: HTMLButtonElement | null;
  dmThreads: HTMLElement | null;
  dmEmpty: HTMLElement | null;
  connButton: HTMLButtonElement | null;
  connDot: HTMLElement | null;
  connText: HTMLElement | null;
  identity: HTMLButtonElement | null;
  identityAvatar: HTMLImageElement | null;
  identityLogin: HTMLElement | null;
  presenceOverlay: HTMLElement | null;
  presenceCard: HTMLElement | null;
  presenceClose: HTMLButtonElement | null;
  presencePanel: HTMLElement | null;
  presenceTitle: HTMLElement | null;
  signIn: HTMLButtonElement | null;
  reconnect: HTMLButtonElement | null;
  messages: HTMLElement | null;
  input: HTMLTextAreaElement | null;
  send: HTMLButtonElement | null;
  error: HTMLElement | null;
  profileOverlay: HTMLElement | null;
  profileCard: HTMLElement | null;
  profileAvatar: HTMLImageElement | null;
  profileName: HTMLElement | null;
  profileLogin: HTMLElement | null;
  profileBody: HTMLElement | null;
  profileClose: HTMLButtonElement | null;
  profileActions: HTMLElement | null;
  profileBan: HTMLButtonElement | null;
  profileUnban: HTMLButtonElement | null;
  profileMessage: HTMLButtonElement | null;
  profileSignOut: HTMLButtonElement | null;
  profileOpenOnGitHub: HTMLButtonElement | null;
  profileModStatus: HTMLElement | null;
  profileError: HTMLElement | null;
};

export function getElements(): Elements {
  return {
    channelGlobal: document.getElementById("btnChannelGlobal") as HTMLButtonElement | null,
    channelDm: document.getElementById("btnChannelDm") as HTMLButtonElement | null,
    dmPanel: document.getElementById("dmPanel"),
    dmWarning: document.getElementById("dmWarning"),
    dmWarningText: document.getElementById("dmWarningText"),
    dmTrust: document.getElementById("btnDmTrust") as HTMLButtonElement | null,
    dmThreads: document.getElementById("dmThreads"),
    dmEmpty: document.getElementById("dmEmpty"),
    connButton: document.getElementById("btnConnStatus") as HTMLButtonElement | null,
    connDot: document.getElementById("connDot"),
    connText: document.getElementById("connText"),
    identity: document.getElementById("btnIdentity") as HTMLButtonElement | null,
    identityAvatar: document.getElementById("identityAvatar") as HTMLImageElement | null,
    identityLogin: document.getElementById("identityLogin"),
    presenceOverlay: document.getElementById("presenceOverlay"),
    presenceCard: document.getElementById("presenceCard"),
    presenceClose: document.getElementById("presenceClose") as HTMLButtonElement | null,
    presencePanel: document.getElementById("presencePanel"),
    presenceTitle: document.getElementById("presenceTitle"),
    signIn: document.getElementById("btnSignIn") as HTMLButtonElement | null,
    reconnect: document.getElementById("btnReconnect") as HTMLButtonElement | null,
    messages: document.getElementById("messages"),
    input: document.getElementById("input") as HTMLTextAreaElement | null,
    send: document.getElementById("btnSend") as HTMLButtonElement | null,
    error: document.getElementById("error"),
    profileOverlay: document.getElementById("profileOverlay"),
    profileCard: document.getElementById("profileCard"),
    profileAvatar: document.getElementById("profileAvatar") as HTMLImageElement | null,
    profileName: document.getElementById("profileName"),
    profileLogin: document.getElementById("profileLogin"),
    profileBody: document.getElementById("profileBody"),
    profileClose: document.getElementById("profileClose") as HTMLButtonElement | null,
    profileActions: document.getElementById("profileActions"),
    profileBan: document.getElementById("profileBan") as HTMLButtonElement | null,
    profileUnban: document.getElementById("profileUnban") as HTMLButtonElement | null,
    profileMessage: document.getElementById("profileMessage") as HTMLButtonElement | null,
    profileSignOut: document.getElementById("profileSignOut") as HTMLButtonElement | null,
    profileOpenOnGitHub: document.getElementById("profileOpenOnGitHub") as HTMLButtonElement | null,
    profileModStatus: document.getElementById("profileModStatus"),
    profileError: document.getElementById("profileError"),
  };
}
