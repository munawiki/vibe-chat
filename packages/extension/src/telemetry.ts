import * as vscode from "vscode";
import { TelemetryEventSchema } from "@vscode-chat/protocol";
import type { TelemetryEvent } from "@vscode-chat/protocol";
import { stripTrailingSlashes } from "./util/strings.js";

export type ExtensionTelemetry = {
  send(event: TelemetryEvent): void;
  dispose(): void;
};

export function createExtensionTelemetry(options: {
  output: vscode.LogOutputChannel;
  getBackendUrl: () => string | undefined;
}): ExtensionTelemetry {
  const sender: vscode.TelemetrySender = {
    sendEventData(eventName: string, data?: Record<string, unknown>): void {
      const candidate = data ? { name: eventName, ...data } : { name: eventName };
      const parsed = TelemetryEventSchema.safeParse(candidate);
      if (!parsed.success) {
        options.output.debug(`Dropped unknown telemetry event: ${eventName}`);
        return;
      }

      const backendUrl = options.getBackendUrl();
      if (!backendUrl) return;
      const url = `${stripTrailingSlashes(backendUrl)}/telemetry`;

      if (typeof fetch !== "function") return;

      void fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(parsed.data),
      }).catch(() => {
        // Telemetry must never break the extension.
      });
    },

    sendErrorData(): void {
      // Intentionally ignored: this extension uses explicit, schema-validated events only.
    },
  };

  const logger = vscode.env.createTelemetryLogger(sender, {
    ignoreUnhandledErrors: true,
    ignoreBuiltInCommonProperties: true,
  });

  return {
    send(event: TelemetryEvent): void {
      logger.logUsage(event.name, toTelemetryData(event));
    },
    dispose(): void {
      logger.dispose();
    },
  };
}

function toTelemetryData(event: TelemetryEvent): Record<string, unknown> {
  const { name: _name, ...rest } = event;
  return rest;
}
