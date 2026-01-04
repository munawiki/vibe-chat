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
    const a = BigInt(aRaw);
    const b = BigInt(bRaw);
    return a <= b;
  })
  .brand<"DmId">();
export type DmId = z.infer<typeof DmIdSchema>;
