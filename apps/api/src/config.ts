export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'technews',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '', // empty: Watch, Try it steps and Ask answer 503
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
  llmDailyCap: Number(process.env.LLM_DAILY_CAP ?? 800), // shared with the worker through Redis
  aiRequestsPerMinute: Number(process.env.AI_REQUESTS_PER_MINUTE ?? 20), // per reader (IP), protects the free quota
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID ?? '', // empty: sign-in features answer 503
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '', // empty: notifications unavailable
  trustProxy: Number(process.env.TRUST_PROXY ?? 0), // proxies in front of the API: 1 behind Nginx or a PaaS load balancer
  refreshAdminUids: (process.env.REFRESH_ADMIN_UIDS ?? '').split(',').map((s) => s.trim()).filter(Boolean), // empty: any signed-in reader
  webOrigins: (process.env.WEB_ORIGINS ?? 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
};

export const USER_AGENT = `TechNewsBot/0.1 (+${process.env.BOT_INFO_URL ?? 'https://example.com/technews-bot'})`; // set BOT_INFO_URL to a page about your crawler

// How long browsers and Cloudflare may reuse a response.
export const CACHE = {
  firstPage: 'public, max-age=120', // newest snapshot: refresh soon after each rebuild
  laterPage: 'public, max-age=600', // pinned snapshot never changes
  fallback: 'public, max-age=30', // Redis was unavailable; retry soon
  story: 'public, max-age=300',
  tags: 'public, max-age=900',
  generated: 'public, max-age=86400', // Watch and Try it steps never change once made
  private: 'private, no-store', // anything for a signed-in reader
} as const;
