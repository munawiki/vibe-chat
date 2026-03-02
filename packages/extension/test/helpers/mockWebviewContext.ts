import * as vscode from "vscode";

export function createMockWebviewContext(
  overrides?: Partial<import("vscode").ExtensionContext>,
): import("vscode").ExtensionContext {
  const secrets = new Map<string, string>();
  const globalState = new Map<string, unknown>();

  return {
    extensionUri:
      overrides?.extensionUri ?? (vscode.Uri.parse("file:///extension") as import("vscode").Uri),
    extensionMode:
      overrides?.extensionMode ??
      (vscode.ExtensionMode.Development as import("vscode").ExtensionMode),
    secrets:
      overrides?.secrets ??
      ({
        get: (key: string) => Promise.resolve(secrets.get(key)),
        store: (key: string, value: string) => {
          secrets.set(key, value);
          return Promise.resolve();
        },
        delete: (key: string) => {
          secrets.delete(key);
          return Promise.resolve();
        },
        onDidChange: () => ({ dispose: () => {} }),
      } as unknown as import("vscode").SecretStorage),
    globalState:
      overrides?.globalState ??
      ({
        get: <T>(key: string) => globalState.get(key) as T | undefined,
        update: (key: string, value: unknown) => {
          if (value === undefined) globalState.delete(key);
          else globalState.set(key, value);
          return Promise.resolve();
        },
        keys: () => [...globalState.keys()],
        setKeysForSync: () => {},
      } as unknown as import("vscode").Memento),
    subscriptions: overrides?.subscriptions ?? [],
  } as unknown as import("vscode").ExtensionContext;
}
