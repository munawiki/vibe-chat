import { describe, expect, it } from "vitest";
import { DmCiphertextSchema, DmIdentitySchema, DmNonceSchema } from "../src/index.js";

describe("dm base64 schemas", () => {
  it("accepts valid base64 lengths", () => {
    expect(
      DmIdentitySchema.safeParse({
        cipherSuite: "nacl.box.v1",
        publicKey: Buffer.alloc(32).toString("base64"),
      }).success,
    ).toBe(true);
    expect(DmNonceSchema.safeParse(Buffer.alloc(24).toString("base64")).success).toBe(true);
    expect(DmCiphertextSchema.safeParse(Buffer.from("ciphertext").toString("base64")).success).toBe(
      true,
    );
  });

  it("rejects invalid base64 payloads", () => {
    expect(
      DmIdentitySchema.safeParse({
        cipherSuite: "nacl.box.v1",
        publicKey: "not-base64",
      }).success,
    ).toBe(false);
    expect(DmNonceSchema.safeParse("not-base64").success).toBe(false);
    expect(DmCiphertextSchema.safeParse("not-base64").success).toBe(false);
  });
});
