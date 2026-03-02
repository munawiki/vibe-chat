export type TelemetryEvent =
  | { name: "vscodeChat.auth.exchange"; outcome: "success" }
  | { name: "vscodeChat.auth.exchange"; outcome: "http_error"; httpStatus: number }
  | { name: "vscodeChat.auth.exchange"; outcome: "invalid_response" }
  | { name: "vscodeChat.auth.exchange"; outcome: "network_error" }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "success";
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "handshake_http_error";
      httpStatus: number;
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | {
      name: "vscodeChat.ws.connect";
      outcome: "network_error";
      usedCachedSession: boolean;
      recovered: boolean;
    }
  | { name: "vscodeChat.ws.reconnect_scheduled"; attempt: number; delayMs: number }
  | {
      name: "vscodeChat.ws.legacy_fallback";
      fallback: "handshake_429_body";
      kind: "rate_limited" | "room_full" | "too_many_connections" | "unknown";
    };

export type ChatClientCoreCommand =
  | { type: "cmd/github.session.get"; interactive: boolean; clearSessionPreference?: boolean }
  | { type: "cmd/auth.exchange"; backendUrl: string; accessToken: string }
  | { type: "cmd/ws.open"; backendUrl: string; token: string }
  | { type: "cmd/ws.close"; code: number; reason: string }
  | { type: "cmd/reconnect.cancel" }
  | { type: "cmd/reconnect.schedule"; delayMs: number }
  | { type: "cmd/telemetry.send"; event: TelemetryEvent }
  | { type: "cmd/raise"; error: unknown };
