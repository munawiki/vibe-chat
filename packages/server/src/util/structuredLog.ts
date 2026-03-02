export function log(event: Record<string, unknown>): void {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      ...event,
    }),
  );
}
