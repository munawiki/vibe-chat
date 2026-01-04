export function unknownErrorToMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
