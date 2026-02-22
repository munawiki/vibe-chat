import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type MigrationBlock = {
  tag: string;
  newSqliteClasses: string[];
};

function parseMigrationBlocks(toml: string): MigrationBlock[] {
  const blocks = toml
    .split("[[migrations]]")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  return blocks
    .map((block) => {
      const tagMatch = block.match(/tag\s*=\s*"([^"]+)"/);
      const classesMatch = block.match(/new_sqlite_classes\s*=\s*\[([^\]]*)\]/);
      const classesRaw = classesMatch?.[1] ?? "";
      const newSqliteClasses = classesRaw
        .split(",")
        .map((entry) => entry.trim().replaceAll('"', ""))
        .filter((entry) => entry.length > 0);

      return {
        tag: tagMatch?.[1] ?? "",
        newSqliteClasses,
      };
    })
    .filter((block) => block.tag.length > 0);
}

function readUtf8File(path: URL): string {
  return (readFileSync as (file: URL, encoding: "utf8") => string)(path, "utf8");
}

describe("wrangler durable object migrations", () => {
  it("keeps explicit additive migration boundaries for ChatRoom and DmRoom", () => {
    const wranglerTomlPath = new URL("../wrangler.toml", import.meta.url);
    const raw = readUtf8File(wranglerTomlPath);
    const migrations = parseMigrationBlocks(raw);

    expect(migrations).toEqual([
      { tag: "v1", newSqliteClasses: ["ChatRoom"] },
      { tag: "v2", newSqliteClasses: ["DmRoom"] },
    ]);
  });
});
