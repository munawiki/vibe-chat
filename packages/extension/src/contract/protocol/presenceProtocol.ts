import { z } from "zod";
import { PresenceSnapshotSchema } from "@vscode-chat/protocol";

const ExtPresenceSchema = z.object({
  type: z.literal("ext/presence"),
  snapshot: PresenceSnapshotSchema,
});

export const presenceExtOutboundSchemas = [ExtPresenceSchema] as const;
export const PresenceExtOutboundSchema = z.discriminatedUnion("type", presenceExtOutboundSchemas);

export type PresenceExtOutbound = z.infer<typeof PresenceExtOutboundSchema>;
export type ExtPresenceMsg = Extract<PresenceExtOutbound, { type: "ext/presence" }>;
