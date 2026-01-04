export function hasModeratorRole(user: { roles?: unknown } | undefined): boolean {
  const roles = user?.roles;
  return Array.isArray(roles) && roles.includes("moderator");
}

export function createModBadge(): HTMLSpanElement {
  const badge = document.createElement("span");
  badge.className = "badge mod";
  badge.textContent = "MOD";
  return badge;
}
