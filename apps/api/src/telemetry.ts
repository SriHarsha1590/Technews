/** Process-local API telemetry. Scrape each instance; logs carry the same events to the configured sink. */
export function apiTelemetry() {
  const requests = new Map<string, number>();
  const errors = new Map<number, number>();
  const limits = new Map<string, number>();
  let aiUnavailable = 0;
  let aiCapHits = 0;
  let latestStory = 0;
  const emit = (event: string, fields: Record<string, string | number>) =>
    console.log(
      JSON.stringify({ time: new Date().toISOString(), event, ...fields }),
    );
  return {
    request(method: string, status: number, durationMs: number) {
      const key = `${method}:${status}`;
      requests.set(key, (requests.get(key) ?? 0) + 1);
      if (status >= 500) errors.set(status, (errors.get(status) ?? 0) + 1);
      emit("api_request", { method, status, durationMs });
    },
    rateLimit(scope: string) {
      limits.set(scope, (limits.get(scope) ?? 0) + 1);
      emit("rate_limited", { scope });
    },
    aiFailure(reason: "cap" | "budget_store" | "provider") {
      aiUnavailable++;
      if (reason === "cap") aiCapHits++;
      emit("public_ai_unavailable", { reason });
    },
    error(status: number, cause: unknown) {
      const errorName = cause instanceof Error ? cause.name : "UnknownError";
      // Stack locations help triage failures without logging request data or exception messages.
      const frame =
        cause instanceof Error
          ? cause.stack?.split("\n").slice(1, 2)[0]?.trim()
          : undefined;
      emit("api_error", { status, errorName, ...(frame ? { frame } : {}) });
    },
    feedPublishedAt(value: string | undefined) {
      const seconds = value ? Date.parse(value) / 1000 : NaN;
      if (Number.isFinite(seconds))
        latestStory = Math.max(latestStory, seconds);
    },
    metrics() {
      const lines = [
        ...[...requests].map(([key, count]) => {
          const [method, status] = key.split(":");
          return `technews_api_requests_total{method="${method}",status="${status}"} ${count}`;
        }),
        ...[...errors].map(
          ([status, count]) =>
            `technews_api_errors_total{status="${status}"} ${count}`,
        ),
        ...[...limits].map(
          ([scope, count]) =>
            `technews_api_rate_limit_total{scope="${scope}"} ${count}`,
        ),
        `technews_api_public_ai_unavailable_total ${aiUnavailable}`,
        `technews_api_public_ai_cap_hits_total ${aiCapHits}`,
        `technews_api_feed_latest_story_timestamp_seconds ${latestStory}`,
      ];
      return `${lines.join("\n")}\n`;
    },
  };
}
