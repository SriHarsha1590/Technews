import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TRY_LINK_TYPES, type StoryCard, type TryLinkType } from '@technews/shared';
import { fetchTryGuide } from '../api';
import { timeAgo } from '../format';
import { externalUrl } from '../externalUrl';
import { Icon } from './Icon';
import { Sheet, SheetHeader } from './Sheet';

const LABEL: Record<TryLinkType, string> = {
  playground: 'Try it online',
  download: 'Download',
  repo: 'View the code',
  docs: 'Read the docs',
};

const hostOf = (url: string) => new URL(url).hostname.replace(/^www\./, '');

interface Props {
  story: StoryCard;
  open: boolean;
  onClose: () => void;
}

/**
 * Every story can be tried: verified official links first (when we found any), then AI-written steps,
 * then the source article. The steps never contain links, so nothing here points somewhere unverified.
 */
export function TrySheet({ story, open, onClose }: Props) {
  const titleId = useId();
  const guide = useQuery({
    queryKey: ['try-guide', story.id],
    queryFn: () => fetchTryGuide(story.id),
    enabled: open,
    staleTime: Infinity,
    retry: false,
  });
  const links = [...story.tryLinks].sort((a, b) => TRY_LINK_TYPES.indexOf(a.type) - TRY_LINK_TYPES.indexOf(b.type));

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId}>
      <SheetHeader id={titleId} title="Try it" subtitle={story.title} onClose={onClose} />

      {links.length > 0 && (
        <section className="sheet-section" aria-label="Verified links">
          <h4 className="section-label">
            <Icon name="check" size={14} /> Verified links
          </h4>
          <ul className="try-list">
            {links.filter((l) => externalUrl(l.url)).map((l) => (
              <li key={l.url}>
                <a className="try-link" href={externalUrl(l.url)!} target="_blank" rel="noopener noreferrer">
                  <span className="try-label">{LABEL[l.type]}</span>
                  <span className="try-domain">Opens {l.domain}</span>
                  <span className="try-checked">Link checked {timeAgo(l.checkedAt)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="sheet-section" aria-label="Steps" aria-busy={guide.isFetching}>
        <h4 className="section-label">
          <Icon name="spark" size={14} /> {links.length ? 'How to start' : 'Steps to try it'}
        </h4>
        {guide.isPending && (
          <div className="skeleton" aria-label="Writing steps">
            <span />
            <span />
            <span />
            <p className="hint">Writing steps from the article…</p>
          </div>
        )}
        {guide.isError && (
          <div className="inline-error" role="alert">
            <p>{guide.error.message}</p>
            <button type="button" className="text-button" onClick={() => void guide.refetch()}>
              Try again
            </button>
          </div>
        )}
        {guide.data &&
          (guide.data.steps.length ? (
            <ol className="steps">
              {guide.data.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          ) : (
            <p className="hint">Nothing hands-on in this one. The source article has the full details.</p>
          ))}
        {guide.data && guide.data.steps.length > 0 && <p className="sheet-note">Written by AI from the article. Check against the official docs.</p>}
      </section>

      <section className="sheet-section" aria-label="Source">
        <h4 className="section-label">Source</h4>
        {externalUrl(story.primaryUrl) && <a className="try-link source-link" href={externalUrl(story.primaryUrl)!} target="_blank" rel="noopener noreferrer">
          <span className="try-label">
            Read on {story.primarySource.name} <Icon name="external" size={14} />
          </span>
          <span className="try-domain">Opens {hostOf(story.primaryUrl)}</span>
        </a>}
      </section>
    </Sheet>
  );
}
