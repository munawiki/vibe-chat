import { z } from "zod";

const NonEmptyString = z.string().min(1);

export const UiInboundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ui/ready") }),
  z.object({ type: z.literal("ui/signIn") }),
  z.object({ type: z.literal("ui/reconnect") }),
  z.object({ type: z.literal("ui/send"), text: NonEmptyString }),
  z.object({ type: z.literal("ui/profile.open"), login: NonEmptyString }),
  z.object({ type: z.literal("ui/profile.openOnGitHub"), login: NonEmptyString }),
]);

export type UiInbound = z.infer<typeof UiInboundSchema>;
