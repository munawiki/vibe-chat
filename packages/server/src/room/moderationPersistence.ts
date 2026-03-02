import { GithubUserIdSchema, type GithubUserId } from "@vscode-chat/protocol";
import { ROOM_DENYLIST_KEY } from "./constants.js";

function compareGithubUserIds(a: GithubUserId, b: GithubUserId): number {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

export async function loadDenylist(state: DurableObjectState): Promise<Set<GithubUserId>> {
  const denylist = new Set<GithubUserId>();
  const saved = await state.storage.get<unknown>(ROOM_DENYLIST_KEY);
  if (!Array.isArray(saved)) return denylist;

  for (const item of saved) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    const parsed = GithubUserIdSchema.safeParse(trimmed);
    if (!parsed.success) continue;
    denylist.add(parsed.data);
  }
  return denylist;
}

export async function saveDenylist(
  state: DurableObjectState,
  denylist: ReadonlySet<GithubUserId>,
): Promise<void> {
  await state.storage.put(ROOM_DENYLIST_KEY, [...denylist].sort(compareGithubUserIds));
}
