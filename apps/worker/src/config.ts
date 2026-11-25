// All environment settings in one place, with local-dev defaults.
export const config = {
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://localhost:27017',
  mongoDb: process.env.MONGO_DB ?? 'technews',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6380',
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
  llmCallsPerSecond: Number(process.env.LLM_CALLS_PER_SECOND ?? 0.1),
  llmDailyCap: Number(process.env.WORKER_LLM_DAILY_CAP ?? process.env.LLM_DAILY_CAP ?? 800),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com', // push services contact this if something goes wrong
};

export const TASK_QUEUE = 'technews'; // workflows + normal activities
export const LLM_TASK_QUEUE = 'llm'; // AI calls only, rate-limited
export const USER_AGENT = `TechNewsBot/0.1 (+${process.env.BOT_INFO_URL ?? 'https://example.com/technews-bot'})`; // set BOT_INFO_URL to a page about your crawler
