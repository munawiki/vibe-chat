import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export async function ensureServerDevVars(options) {
  const workspaceDir = options?.workspaceDir ?? process.cwd();
  const serverDir = path.join(workspaceDir, "packages", "server");
  const devVarsPath = path.join(serverDir, ".dev.vars");
  const examplePath = path.join(serverDir, ".dev.vars.example");

  try {
    await fs.access(devVarsPath);
    return { created: false, devVarsPath };
  } catch {
    // continue
  }

  const contents = await fs.readFile(examplePath, "utf8");
  await fs.writeFile(devVarsPath, contents, { encoding: "utf8", flag: "wx" });
  return { created: true, devVarsPath };
}

function spawnPnpm(args, options) {
  const child = spawn(pnpmCommand(), args, {
    cwd: options.cwd,
    stdio: "inherit",
    env: process.env,
  });

  child.on("exit", (code, signal) => {
    const summary = signal ? `signal ${signal}` : `code ${code ?? "unknown"}`;
    process.stderr.write(`[${options.name}] exited (${summary})\n`);
  });

  return child;
}

export async function main(options) {
  const workspaceDir = options?.workspaceDir ?? process.cwd();

  try {
    const { created, devVarsPath } = await ensureServerDevVars({ workspaceDir });
    if (created) process.stderr.write(`[dev] bootstrapped ${devVarsPath}\n`);
  } catch (err) {
    process.stderr.write(
      `[dev] failed to bootstrap packages/server/.dev.vars: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  const server = spawnPnpm(["--filter", "@vscode-chat/server", "dev"], {
    cwd: workspaceDir,
    name: "server",
  });
  const extension = spawnPnpm(["--filter", "vscode-chat", "watch"], {
    cwd: workspaceDir,
    name: "extension",
  });
  const children = [server, extension];

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const child of children) {
      if (child.killed) continue;
      child.kill("SIGTERM");
    }
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  const result = await new Promise((resolve) => {
    for (const child of children) {
      child.once("exit", (code) => {
        shutdown();
        resolve({ code: typeof code === "number" ? code : 1 });
      });
    }
  });

  return result.code;
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      process.stderr.write(
        `[dev] fatal: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
      process.exitCode = 1;
    },
  );
}
