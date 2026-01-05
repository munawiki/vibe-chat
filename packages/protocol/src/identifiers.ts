import { z } from "zod";

const GITHUB_USER_ID_RE = /^[1-9][0-9]*$/;
const DM_ID_RE = /^dm:v1:([1-9][0-9]*):([1-9][0-9]*)$/;

// Invariant: a GitHub numeric user id is a base-10 string without leading zeros.
// We keep identifiers as strings across the protocol for JSON compatibility, but brand them to
// prevent mixing unrelated ids at compile time.
export const GithubUserIdSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(GITHUB_USER_ID_RE, { message: "Expected GitHub numeric user id" })
  .brand<"GithubUserId">();
export type GithubUserId = z.infer<typeof GithubUserIdSchema>;

function compareNumericStrings(a: string, b: string): -1 | 0 | 1 {
  if (a === b) return 0;
  if (a.length !== b.length) return a.length < b.length ? -1 : 1;
  return a < b ? -1 : 1;
}

// Invariant: dmId MUST be canonical: dm:v1:<a>:<b> where a <= b (numeric).
export const DmIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => DM_ID_RE.test(value), {
    message: "Expected dm id format dm:v1:<a>:<b>",
  })
  .refine((value) => {
    const match = DM_ID_RE.exec(value);
    if (!match) return false;
    const aRaw = match[1];
    const bRaw = match[2];
    if (!aRaw || !bRaw) return false;
    return compareNumericStrings(aRaw, bRaw) <= 0;
  })
  .brand<"DmId">();
export type DmId = z.infer<typeof DmIdSchema>;

// Invariant: dmId is derived from 2 participants and MUST be stable regardless of ordering.
export function dmIdFromParticipants(a: GithubUserId, b: GithubUserId): DmId {
  const dmIdRaw = compareNumericStrings(a, b) <= 0 ? `dm:v1:${a}:${b}` : `dm:v1:${b}:${a}`;
  return DmIdSchema.parse(dmIdRaw);
}

// Invariant: dmId MUST be canonical and only contain valid GitHub user ids.
export function dmIdParticipants(dmId: DmId): { a: GithubUserId; b: GithubUserId } {
  const match = DM_ID_RE.exec(dmId);
  if (!match) throw new Error("Invalid dmId: expected dm:v1:<a>:<b>");

  const aRaw = match[1];
  const bRaw = match[2];
  if (!aRaw || !bRaw) throw new Error("Invalid dmId: missing participants");

  const a = GithubUserIdSchema.parse(aRaw);
  const b = GithubUserIdSchema.parse(bRaw);

  if (compareNumericStrings(a, b) > 0) throw new Error("Invalid dmId: expected canonical ordering");

  return { a, b };
}
