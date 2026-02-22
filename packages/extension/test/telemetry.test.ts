import { describe, expect, it, vi } from "vitest";
import type { TelemetryEvent } from "@vscode-chat/protocol";
import { createExtensionTelemetry } from "../src/telemetry.js";

const vscodeState = vi.hoisted(() => ({
  sender: undefined as
    | undefined
    | { sendEventData: (name: string, data?: Record<string, unknown>) => void },
  dispose: vi.fn(),
}));

vi.mock("vscode", () => ({
  env: {
    createTelemetryLogger: (sender: {
      sendEventData: (eventName: string, data?: Record<string, unknown>) => void;
    }) => {
      vscodeState.sender = sender;
      return {
        logUsage: (eventName: string, data?: Record<string, unknown>) =>
          sender.sendEventData(eventName, data),
        dispose: vscodeState.dispose,
      };
    },
  },
}));

describe("createExtensionTelemetry", () => {
  it("POSTs schema-validated telemetry to /telemetry when backendUrl exists", () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal("fetch", fetchMock);

    const debug = vi.fn();
    const output = { debug } as unknown as import("vscode").LogOutputChannel;
    const telemetry = createExtensionTelemetry({
      output,
      getBackendUrl: () => "https://example.test/",
    });

    const event: TelemetryEvent = { name: "vscodeChat.auth.exchange", outcome: "success" };
    telemetry.send(event);
    telemetry.send({
      name: "vscodeChat.ws.legacy_fallback",
      fallback: "handshake_429_body",
      kind: "room_full",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://example.test/telemetry");
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain(
      '"name":"vscodeChat.ws.legacy_fallback"',
    );
    expect(String(fetchMock.mock.calls[1]?.[1]?.body)).toContain('"kind":"room_full"');

    telemetry.dispose();

    vi.unstubAllGlobals();
  });

  it("drops unknown events and does not throw when backendUrl or fetch is missing", () => {
    const debug = vi.fn();
    const output = { debug } as unknown as import("vscode").LogOutputChannel;

    const telemetry = createExtensionTelemetry({
      output,
      getBackendUrl: () => undefined,
    });

    vscodeState.sender?.sendEventData("unknown.event", {});
    expect(debug).toHaveBeenCalled();

    telemetry.send({ name: "vscodeChat.auth.exchange", outcome: "success" });
    telemetry.dispose();
  });
});
