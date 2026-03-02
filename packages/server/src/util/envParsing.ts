import { z } from "zod";

export function envNumberPreprocess(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return Number(trimmed);
  }
  return value;
}

export function envStringPreprocess(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed;
  }
  return value;
}

export function envInt(options: {
  min: number;
  max: number;
  default: number;
}): z.ZodType<number, z.ZodTypeDef, unknown> {
  return z
    .preprocess(envNumberPreprocess, z.number().int().min(options.min).max(options.max))
    .default(options.default);
}

export function envOptionalInt(options: {
  min: number;
  max: number;
}): z.ZodType<number | undefined, z.ZodTypeDef, unknown> {
  return z
    .preprocess(envNumberPreprocess, z.number().int().min(options.min).max(options.max))
    .optional();
}
