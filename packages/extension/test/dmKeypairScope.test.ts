import { describe, expect, it, vi } from "vitest";
import { dmSecretStorageKeyV2 } from "../src/e2ee/dmCrypto.js";
import { DmKeypairScope } from "../src/ui/chatView/directMessages/dmKeypairScope.js";

describe("DmKeypairScope", () => {
  it("switches scope by github user id and resets trusted store", async () => {
    const secrets = new Map<string, string>();
    const trustedPeerKeys = {
      ensureScope: vi.fn(() => Promise.resolve()),
      reset: vi.fn(),
    };
    const scope = new DmKeypairScope({
      secrets: {
        get: (key) => Promise.resolve(secrets.get(key)),
        store: (key, value) => {
          secrets.set(key, value);
          return Promise.resolve();
        },
        delete: (key) => {
          secrets.delete(key);
          return Promise.resolve();
        },
      },
      trustedPeerKeys,
      onSecretMigrationDiagnostic: () => {},
    });

    await scope.getUserKeypairScoped("1" as import("@vscode-chat/protocol").GithubUserId);
    await scope.getUserKeypairScoped("2" as import("@vscode-chat/protocol").GithubUserId);

    expect(trustedPeerKeys.ensureScope).toHaveBeenCalledTimes(2);
    expect(trustedPeerKeys.reset).toHaveBeenCalledTimes(1);
    expect(scope.getSnapshot().signedInGithubUserId).toBe("2");
    expect(
      secrets.has(dmSecretStorageKeyV2("2" as import("@vscode-chat/protocol").GithubUserId)),
    ).toBe(true);
  });
});
