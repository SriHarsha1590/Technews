import { useState, type ReactNode } from 'react';
import type { StoryCard } from '@technews/shared';
import { CATEGORY_LABEL, timeAgo } from '../format';
import { Link } from '../router';
import { Icon } from './Icon';
import { WatchSheet } from './WatchSheet';
import { externalUrl } from '../externalUrl';

/** Page title with a way back to the stories. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      <Link className="back" href="/"><Icon name="back" />Stories</Link>
      <div className="page-head-row">
        <h2 className="page-title">{title}</h2>
        {children}
      </div>
    </header>
  );
}

interface Props {
  story: StoryCard;
  /** Extra details after the source, e.g. when it was read. */
  meta?: ReactNode;
  onRead?: (watched: boolean) => void;
  remove: { label: string; onClick: () => void };
}

/** One story in a compact list (Saved, History): picture, headline, Watch and a remove button. */
export function StoryRow({ story, meta, onRead, remove }: Props) {
  const [watching, setWatching] = useState(false);
  const [imageOk, setImageOk] = useState(true);

  return (
    <li className="row">
      <div className={`row-thumb cat-${story.category}`} aria-hidden="true">
        {story.imageUrl && imageOk ? (
          <img src={story.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageOk(false)} />
        ) : (
          <span>{CATEGORY_LABEL[story.category]}</span>
        )}
      </div>
      <div className="row-body">
        <p className="row-meta">
          <span className="source">{story.primarySource.name}</span>
          <span>{timeAgo(story.publishedAt)}</span>
          {meta}
        </p>
        <h3 className="row-title">
          {externalUrl(story.primaryUrl) ? (
            <a href={externalUrl(story.primaryUrl)!} target="_blank" rel="noopener noreferrer" onClick={() => onRead?.(false)}>{story.title}</a>
          ) : story.title}
        </h3>
        <div className="row-actions">
          <button
            type="button"
            className="text-button"
            aria-haspopup="dialog"
            onClick={() => {
              onRead?.(true);
              setWatching(true);
            }}
          >
            <Icon name="watch" />Watch
          </button>
          <button type="button" className="text-button muted" aria-label={`${remove.label}: ${story.title}`} onClick={remove.onClick}>
            <Icon name="trash" />{remove.label}
          </button>
        </div>
      </div>
      <WatchSheet story={story} open={watching} onClose={() => setWatching(false)} />
    </li>
  );
}
