import type { ZodType, ZodTypeDef } from "zod";

function parseZodArrayItems<T>(value: unknown, itemSchema: ZodType<T, ZodTypeDef, unknown>): T[] {
  if (!Array.isArray(value)) return [];

  const valid: T[] = [];
  for (const item of value) {
    const parsed = itemSchema.safeParse(item);
    if (parsed.success) valid.push(parsed.data);
  }
  return valid;
}

function boundedTail<T>(items: ReadonlyArray<T>, limit: number): T[] {
  if (limit <= 0) return [];
  return items.slice(-limit);
}

export function parseZodArrayWithLimit<T>(
  value: unknown,
  itemSchema: ZodType<T, ZodTypeDef, unknown>,
  limit: number,
): T[] {
  return boundedTail(parseZodArrayItems(value, itemSchema), limit);
}
