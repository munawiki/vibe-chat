import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { tmpdir } from "node:os";

import { ensureServerDevVars } from "./dev.mjs";

test("ensureServerDevVars creates .dev.vars from example when missing", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "vscode-chat-"));
  const serverDir = path.join(workspaceDir, "packages", "server");
  await mkdir(serverDir, { recursive: true });

  const examplePath = path.join(serverDir, ".dev.vars.example");
  await writeFile(examplePath, "SESSION_SECRET=example\n", { encoding: "utf8" });

  const result = await ensureServerDevVars({ workspaceDir });
  assert.equal(result.created, true);
  assert.equal(result.devVarsPath, path.join(serverDir, ".dev.vars"));

  const contents = await readFile(result.devVarsPath, "utf8");
  assert.equal(contents, "SESSION_SECRET=example\n");
});

test("ensureServerDevVars is idempotent when .dev.vars already exists", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "vscode-chat-"));
  const serverDir = path.join(workspaceDir, "packages", "server");
  await mkdir(serverDir, { recursive: true });

  const devVarsPath = path.join(serverDir, ".dev.vars");
  await writeFile(devVarsPath, "SESSION_SECRET=existing\n", { encoding: "utf8" });

  const examplePath = path.join(serverDir, ".dev.vars.example");
  await writeFile(examplePath, "SESSION_SECRET=example\n", { encoding: "utf8" });

  const result = await ensureServerDevVars({ workspaceDir });
  assert.equal(result.created, false);
  assert.equal(result.devVarsPath, devVarsPath);

  const contents = await readFile(devVarsPath, "utf8");
  assert.equal(contents, "SESSION_SECRET=existing\n");
});
