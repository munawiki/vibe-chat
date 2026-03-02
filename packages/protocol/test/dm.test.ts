import { describe, expect, it } from "vitest";
import { DmIdSchema, GithubUserIdSchema, dmIdFromParticipants, dmIdParticipants } from "../src/index.js";

describe("dmId helpers", () => {
  it("derives a stable canonical dmId", () => {
    const a = GithubUserIdSchema.parse("1");
    const b = GithubUserIdSchema.parse("2");
    expect(dmIdFromParticipants(a, b)).toBe("dm:v1:1:2");
    expect(dmIdFromParticipants(b, a)).toBe("dm:v1:1:2");
  });

  it("extracts dmId participants in canonical order", () => {
    const dmId = DmIdSchema.parse("dm:v1:1:2");
    expect(dmIdParticipants(dmId)).toEqual({ a: "1", b: "2" });
  });

  it("rejects non-canonical dmId", () => {
    expect(DmIdSchema.safeParse("dm:v1:2:1").success).toBe(false);
  });
});
