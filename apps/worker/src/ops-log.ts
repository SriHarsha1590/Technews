/** Startup and schedule events outside Temporal's workflow/activity logger. */
export function opsLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number> = {},
): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    event,
    ...fields,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
