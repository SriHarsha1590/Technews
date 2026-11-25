import { RETENTION_DAYS } from "./feed";

/** Both services create the same Mongo TTL indexes, using insertion timestamps. */
export const CONTENT_RETENTION_INDEXES = {
  articles: {
    key: { fetchedAt: 1 },
    name: "article_retention",
    expireAfterSeconds: RETENTION_DAYS * 86_400,
  },
  stories: {
    key: { createdAt: 1 },
    name: "story_retention",
    expireAfterSeconds: RETENTION_DAYS * 86_400,
  },
} as const;
