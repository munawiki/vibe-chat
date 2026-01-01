import { describe, expect, it } from "vitest";
import { deriveChatViewModel } from "../src/ui/viewModel.js";

describe("deriveChatViewModel", () => {
  it("shows sign-in when signed-out", () => {
    const vm = deriveChatViewModel({ authStatus: "signedOut", status: "disconnected" });

    expect(vm.actions.signIn.visible).toBe(true);
    expect(vm.actions.connect.visible).toBe(false);
  });

  it("shows connect when signed-in and disconnected", () => {
    const vm = deriveChatViewModel({ authStatus: "signedIn", status: "disconnected" });

    expect(vm.actions.signIn.visible).toBe(false);
    expect(vm.actions.connect.visible).toBe(true);
  });

  it("hides actions while connecting", () => {
    const vm = deriveChatViewModel({
      authStatus: "signedIn",
      status: "connecting",
      backendUrl: "http://127.0.0.1:8787",
    });

    expect(vm.actions.signIn.visible).toBe(false);
    expect(vm.actions.connect.visible).toBe(false);
  });

  it("hides actions when connected", () => {
    const vm = deriveChatViewModel({
      authStatus: "signedIn",
      status: "connected",
      backendUrl: "http://127.0.0.1:8787",
      user: { githubUserId: "123", login: "octocat", avatarUrl: "https://example.com/a.png" },
    });

    expect(vm.actions.signIn.visible).toBe(false);
    expect(vm.actions.connect.visible).toBe(false);
  });

  it("overrides backendUrl for display", () => {
    const vm = deriveChatViewModel(
      { authStatus: "signedIn", status: "disconnected" },
      "http://127.0.0.1:8787",
    );

    expect(vm.backendUrl).toBe("http://127.0.0.1:8787");
  });
});
