// Daily digest rules, kept free of database and network code so they can be unit-tested.
import type { DigestSettings, Story } from '@technews/shared';

export const CATCH_UP_HOURS = 3; // if the worker was down at 8:00, still send at 9:00 or 10:00

/** The reader's local calendar day and hour. */
export function localParts(date: Date, timeZone: string): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}

/** Due when it's the chosen hour (or up to 3 hours after) in the reader's zone, and nothing was sent today. */
export function isDue(digest: DigestSettings, lastDigestOn: string | undefined, now: Date): { due: boolean; today: string } {
  const { day, hour } = localParts(now, digest.timeZone);
  const inWindow = hour >= digest.hour && hour < digest.hour + CATCH_UP_HOURS;
  return { due: digest.enabled && inWindow && lastDigestOn !== day, today: day };
}

export interface DigestMessage {
  title: string;
  body: string;
  url: string; // relative: opened on whatever address the app runs at
}

type DigestStory = Pick<Story, 'title' | 'tags'>;

export function buildDigestMessage(stories: DigestStory[], stack: string[]): DigestMessage {
  const matched = [...new Set(stories.flatMap((s) => s.tags.filter((t) => stack.includes(t))))].slice(0, 3);
  const title = stack.length
    ? `${stories.length} new in ${matched.join(', ') || 'your stack'}`
    : `Today's top ${stories.length === 1 ? 'story' : `${stories.length} stories`}`;
  return {
    title,
    body: stories.map((s) => `• ${s.title}`).join('\n'),
    url: stack.length ? '/?view=foryou' : '/',
  };
}
