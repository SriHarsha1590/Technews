// A cursor remembers which snapshot you were reading and where you stopped, so page 2 stays
// consistent even if a newer snapshot was published while you scrolled.
import { z } from 'zod';

const Cursor = z.object({
  v: z.number().int().positive().optional(), // Redis snapshot version; absent in Mongo fallback mode
  o: z.number().int().min(0).max(10_000), // offset
});
export type Cursor = z.infer<typeof Cursor>;

export class BadCursorError extends Error {}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  try {
    return Cursor.parse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')));
  } catch {
    throw new BadCursorError('cursor is invalid');
  }
}
