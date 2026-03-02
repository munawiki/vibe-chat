import { z } from "zod";
import { chatExtOutboundSchemas, chatUiInboundSchemas } from "./chatProtocol.js";
import { dmExtOutboundSchemas, dmUiInboundSchemas } from "./dmProtocol.js";
import { moderationExtOutboundSchemas, moderationUiInboundSchemas } from "./moderationProtocol.js";
import { presenceExtOutboundSchemas } from "./presenceProtocol.js";
import { profileExtOutboundSchemas, profileUiInboundSchemas } from "./profileProtocol.js";

export * from "./chatProtocol.js"; export * from "./dmProtocol.js";
export * from "./moderationProtocol.js";
export * from "./presenceProtocol.js";
export * from "./profileProtocol.js";

export const UiInboundSchema = z.discriminatedUnion("type", [
  ...chatUiInboundSchemas,
  ...dmUiInboundSchemas,
  ...moderationUiInboundSchemas,
  ...profileUiInboundSchemas,
]);

export const ExtOutboundSchema = z.discriminatedUnion("type", [
  ...chatExtOutboundSchemas,
  ...dmExtOutboundSchemas,
  ...presenceExtOutboundSchemas,
  ...profileExtOutboundSchemas,
  ...moderationExtOutboundSchemas,
]);

export type UiInbound = z.infer<typeof UiInboundSchema>; export type ExtOutbound = z.infer<typeof ExtOutboundSchema>;
