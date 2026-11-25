import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type { StoryCard as Story } from '@technews/shared';
import { TrySheet } from './TrySheet';
import { WatchSheet } from './WatchSheet';
import { Icon } from './Icon';
import { TRUST_LABEL, coverageText, timeAgo } from '../format';
import { READ_AFTER_MS } from '../history';
import { shareStory } from '../share';
import { externalUrl } from '../externalUrl';

interface Props {
  story: Story;
  onAsk: (story: Story) => void;
  /** Undefined when sign-in isn't set up: the Save button is hidden. */
  save?: { saved: boolean; toggle: () => void };
  /** Signed in: adds the story to History. `watched` when Watch was opened. */
  onRead?: (watched: boolean) => void;
}

export function StoryCard({ story, onAsk, save, onRead }: Props) {
  const [shareNote, setShareNote] = useState('');
  const tier = story.primarySource.trustTier;
  const [open, setOpen] = useState<'try' | 'watch' | null>(null);
  const [imageOk, setImageOk] = useState(true);
  const close = () => setOpen(null);
  const ref = useRef<HTMLElement>(null);
  const read = useEffectEvent((watched: boolean) => onRead?.(watched));
  const tracking = Boolean(onRead);

  // Read = the card filled most of the screen for READ_AFTER_MS. Scrolling past quickly doesn't count.
  useEffect(() => {
    const el = ref.current;
    if (!el || !tracking) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      ([e]) => {
        clearTimeout(timer);
        const screen = e.rootBounds?.height ?? innerHeight;
        if (e.intersectionRatio >= 0.6 || e.intersectionRect.height >= screen * 0.6) timer = setTimeout(() => read(false), READ_AFTER_MS);
      },
      { threshold: [0, 0.25, 0.5, 0.6, 0.75, 1] },
    );
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [tracking]);

  const openSheet = (which: 'try' | 'watch') => {
    onRead?.(which === 'watch');
    setOpen(which);
  };

  return (
    <article className="card" id={`card-${story.id}`} aria-labelledby={`h-${story.id}`} ref={ref}>
      <header className="card-meta">
        <span className="source">{story.primarySource.name}</span>
        <span className={`trust trust-${tier}`}>
          {tier === 'official' && <Icon name="check" />}
          {TRUST_LABEL[tier]}
        </span>
        <time className="when" dateTime={story.publishedAt}>
          {timeAgo(story.publishedAt)}
        </time>
        <span className="card-meta-tools">
          <button
            type="button"
            className="card-share"
            aria-label={`Share ${story.title}`}
            title="Share story"
            onClick={() => { void shareStory(story.id, story.title).then(setShareNote); }}
          >
            <Icon name="share" />
          </button>
          {save && (
            <button
              type="button"
              className="save"
              aria-pressed={save.saved}
              aria-label={save.saved ? 'Saved' : 'Save'}
              title={save.saved ? 'Remove from Saved' : 'Save for later'}
              onClick={save.toggle}
            >
              <Icon name="save" />
            </button>
          )}
        </span>
      </header>

      {story.imageUrl && (
        // The box stays when the picture fails to load, so cards don't jump around.
        <div className="card-image">
          {imageOk && <img src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />}
        </div>
      )}

      <h2 className="headline" id={`h-${story.id}`}>
        {externalUrl(story.primaryUrl) ? (
          <a href={externalUrl(story.primaryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => onRead?.(false)}>{story.title}</a>
        ) : story.title}
      </h2>
      <p className="byline">By {story.author ?? story.primarySource.name}</p>

      <p className="summary">{story.summary}</p>

      <p className="coverage">{coverageText(story.sourceCount)}</p>

      <footer className="actions">
        <button type="button" className="action" aria-haspopup="dialog" onClick={() => openSheet('try')}>
          <Icon name="try" />
          Try it
        </button>
        <button type="button" className="action" aria-haspopup="dialog" onClick={() => openSheet('watch')}>
          <Icon name="watch" />
          Watch
        </button>
        <button type="button" className="action" aria-haspopup="dialog" onClick={() => {
            onRead?.(false);
            onAsk(story);
          }}>
          <Icon name="ask" />
          Ask
        </button>
      </footer>
      {shareNote && <p role="status">{shareNote}</p>}

      <TrySheet story={story} open={open === 'try'} onClose={close} />
      <WatchSheet story={story} open={open === 'watch'} onClose={close} />
    </article>
  );
}
