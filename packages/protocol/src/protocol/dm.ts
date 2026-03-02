import { z } from "zod";
import { DmIdSchema, GithubUserIdSchema } from "../identifiers.js";
import { base64DecodedBytesLength } from "./base64.js";
import { AuthUserSchema, ChatMessagePlainSchema } from "./common.js";

export const DmCipherSuiteSchema = z.enum(["nacl.box.v1"]);
export type DmCipherSuite = z.infer<typeof DmCipherSuiteSchema>;

export const DmIdentitySchema = z.object({
  cipherSuite: DmCipherSuiteSchema,
  publicKey: z
    .string()
    .min(1)
    .max(64)
    .refine((value) => base64DecodedBytesLength(value) === 32, {
      message: "Expected base64-encoded 32-byte public key",
    }),
});
export type DmIdentity = z.infer<typeof DmIdentitySchema>;

export const DmNonceSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => base64DecodedBytesLength(value) === 24, {
    message: "Expected base64-encoded 24-byte nonce",
  });
export type DmNonce = z.infer<typeof DmNonceSchema>;

export const DmCiphertextSchema = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => base64DecodedBytesLength(value) !== null, {
    message: "Expected base64-encoded ciphertext",
  });
export type DmCiphertext = z.infer<typeof DmCiphertextSchema>;

export const DmMessageCipherSchema = z.object({
  id: z.string().min(1),
  dmId: DmIdSchema,
  sender: AuthUserSchema,
  recipientGithubUserId: GithubUserIdSchema,
  senderIdentity: DmIdentitySchema,
  recipientIdentity: DmIdentitySchema,
  nonce: DmNonceSchema,
  ciphertext: DmCiphertextSchema,
  createdAt: z.string().datetime(),
});
export type DmMessageCipher = z.infer<typeof DmMessageCipherSchema>;

export const DmMessagePlainSchema = ChatMessagePlainSchema.extend({
  dmId: DmIdSchema,
});
export type DmMessagePlain = z.infer<typeof DmMessagePlainSchema>;
