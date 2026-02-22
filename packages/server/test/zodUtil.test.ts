import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseZodArrayWithLimit } from "../src/zodUtil.js";

describe("parseZodArrayWithLimit", () => {
  it("returns an empty array for non-array input", () => {
    expect(parseZodArrayWithLimit("nope", z.string(), 10)).toEqual([]);
  });

  it("filters invalid items and returns the bounded tail", () => {
    const schema = z.number().int().positive();
    const value: unknown = [1, 2, -1, 3, "x", 4];

    expect(parseZodArrayWithLimit(value, schema, 3)).toEqual([2, 3, 4]);
    expect(parseZodArrayWithLimit(value, schema, 99)).toEqual([1, 2, 3, 4]);
  });

  it("returns an empty array when limit is non-positive", () => {
    expect(parseZodArrayWithLimit([1, 2, 3], z.number(), 0)).toEqual([]);
    expect(parseZodArrayWithLimit([1, 2, 3], z.number(), -1)).toEqual([]);
  });
});
