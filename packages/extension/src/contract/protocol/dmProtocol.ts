import { z } from "zod";
import {
  AuthUserSchema,
  CHAT_MESSAGE_TEXT_MAX_LEN,
  DmIdSchema,
  DmMessagePlainSchema,
} from "@vscode-chat/protocol";

const DmThreadSchema = z.object({
  dmId: DmIdSchema,
  peer: AuthUserSchema,
  isBlocked: z.boolean(),
  canTrustKey: z.boolean(),
  warning: z.string().min(1).optional(),
});

const ExtDmStateSchema = z.object({
  type: z.literal("ext/dm.state"),
  threads: z.array(DmThreadSchema),
});

const ExtDmHistorySchema = z.object({
  type: z.literal("ext/dm.history"),
  dmId: DmIdSchema,
  history: z.array(DmMessagePlainSchema),
});

const ExtDmMessageSchema = z.object({
  type: z.literal("ext/dm.message"),
  message: DmMessagePlainSchema,
});

const UiDmOpenSchema = z.object({ type: z.literal("ui/dm.open"), peer: AuthUserSchema });
const UiDmThreadSelectSchema = z.object({
  type: z.literal("ui/dm.thread.select"),
  dmId: DmIdSchema,
});
const UiDmSendSchema = z.object({
  type: z.literal("ui/dm.send"),
  dmId: DmIdSchema,
  text: z.string().min(1).max(CHAT_MESSAGE_TEXT_MAX_LEN),
});
const UiDmPeerKeyTrustSchema = z.object({
  type: z.literal("ui/dm.peerKey.trust"),
  dmId: DmIdSchema,
});

export const dmExtOutboundSchemas = [
  ExtDmStateSchema,
  ExtDmHistorySchema,
  ExtDmMessageSchema,
] as const;
export const dmUiInboundSchemas = [
  UiDmOpenSchema,
  UiDmThreadSelectSchema,
  UiDmSendSchema,
  UiDmPeerKeyTrustSchema,
] as const;

export const DmExtOutboundSchema = z.discriminatedUnion("type", dmExtOutboundSchemas);
export const DmUiInboundSchema = z.discriminatedUnion("type", dmUiInboundSchemas);

export type DmExtOutbound = z.infer<typeof DmExtOutboundSchema>;
export type DmUiInbound = z.infer<typeof DmUiInboundSchema>;

export type ExtDmStateMsg = Extract<DmExtOutbound, { type: "ext/dm.state" }>;
export type ExtDmHistoryMsg = Extract<DmExtOutbound, { type: "ext/dm.history" }>;
export type ExtDmMessageMsg = Extract<DmExtOutbound, { type: "ext/dm.message" }>;

export type UiDmOpenMsg = Extract<DmUiInbound, { type: "ui/dm.open" }>;
export type UiDmThreadSelectMsg = Extract<DmUiInbound, { type: "ui/dm.thread.select" }>;
export type UiDmSendMsg = Extract<DmUiInbound, { type: "ui/dm.send" }>;
export type UiDmPeerKeyTrustMsg = Extract<DmUiInbound, { type: "ui/dm.peerKey.trust" }>;
