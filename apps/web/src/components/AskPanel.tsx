import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { CitedStory, StoryCard } from '@technews/shared';
import { askQuestion } from '../api';
import { suggestions } from '../suggestions';
import { externalUrl } from '../externalUrl';
import { Icon } from './Icon';
import { Sheet, SheetHeader } from './Sheet';

interface Message {
  role: 'user' | 'assistant';
  text: string;
  storyIds?: string[];
  cited?: CitedStory[]; // titles and links for stories that may not be loaded in the feed
  failed?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  stories: StoryCard[]; // the cards loaded in the feed (the API also searches the rest of the week's news)
  focus: StoryCard | null; // the card Ask was opened from
  onClearFocus: () => void;
  onShowStory: (id: string) => void;
}

const MAX_CONTEXT = 100; // matches the API limit

/** News answers come only from our stories (the server enforces that); tech words are explained in plain language. */
export function AskPanel({ open, onClose, stories, focus, onClearFocus, onShowStory }: Props) {
  const titleId = useId();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const context = stories.slice(0, MAX_CONTEXT);
  const titles = new Map(stories.map((s) => [s.id, s.title]));

  const mutation = useMutation({ mutationFn: askQuestion });

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages, mutation.isPending]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open, focus]);

  const send = (question: string) => {
    const q = question.trim();
    if (q.length < 2 || mutation.isPending) return;
    const history = messages.filter((m) => !m.failed).slice(-8).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: 'user', text: q }]);
    setDraft('');
    mutation.mutate(
      { question: q, storyIds: context.map((s) => s.id), focusId: focus?.id, history },
      {
        onSuccess: (res) => setMessages((m) => [...m, { role: 'assistant', text: res.answer, storyIds: res.storyIds, cited: res.stories }]),
        onError: (err) => setMessages((m) => [...m, { role: 'assistant', text: err.message, failed: true }]),
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  const prompts = suggestions(context, focus);

  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} className="sheet-ask">
      <SheetHeader id={titleId} title="Ask" subtitle="Answers come from this week's news. Ask what any tech word means, too." onClose={onClose} />

      {focus && (
        <div className="focus-chip">
          <span className="focus-label">About</span>
          <span className="focus-title">{focus.title}</span>
          <button type="button" className="icon-button small" aria-label="Ask about all stories instead" onClick={onClearFocus}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      <div className="chat" ref={list} aria-live="polite">
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>Ask about any of this week's stories, even ones you haven't scrolled to, or what a word means.</p>
            <div className="prompt-chips">
              {prompts.map((p) => (
                <button key={p} type="button" className="chip" onClick={() => send(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble bubble-${m.role}${m.failed ? ' bubble-failed' : ''}`}>
            <AnswerText text={m.text} />
            {m.storyIds && m.storyIds.length > 0 && (
              <div className="cited">
                <span className="cited-label">From</span>
                {m.storyIds.map((id) => {
                  if (titles.has(id)) {
                    return (
                      <button key={id} type="button" className="cited-story" onClick={() => onShowStory(id)}>
                        {titles.get(id)}
                      </button>
                    );
                  }
                  // Found by search, not loaded in the feed: open the source article instead.
                  const c = m.cited?.find((x) => x.id === id);
                  return c && externalUrl(c.primaryUrl) ? (
                    <a key={id} className="cited-story" href={externalUrl(c.primaryUrl)!} target="_blank" rel="noopener noreferrer" title={`Opens ${c.sourceName}`}>
                      {c.title}
                    </a>
                  ) : null;
                })}
              </div>
            )}
          </div>
        ))}

        {mutation.isPending && (
          <div className="bubble bubble-assistant bubble-typing" aria-label="Thinking">
            <span />
            <span />
            <span />
          </div>
        )}
      </div>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          ref={input}
          rows={1}
          value={draft}
          maxLength={500}
          placeholder={focus ? 'Ask about this story, or what a word means…' : 'Ask about the news, or what a word means…'}
          aria-label="Your question"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button type="submit" className="send-button" aria-label="Send" disabled={draft.trim().length < 2 || mutation.isPending}>
          <Icon name="send" />
        </button>
      </form>
      {messages.length > 0 && (
        <button type="button" className="text-button new-chat" onClick={() => setMessages([])} disabled={mutation.isPending}>
          New chat
        </button>
      )}
    </Sheet>
  );
}

/** Plain text with "- " bullets. Rendered as text nodes only, never as HTML. */
function AnswerText({ text }: { text: string }) {
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*•]\s+/.test(line);
    const clean = line.replace(/^[-*•]\s+/, '').replace(/\*\*(.+?)\*\*/g, '$1');
    const last = blocks[blocks.length - 1];
    if (last && last.bullets === bullet && bullet) last.lines.push(clean);
    else blocks.push({ bullets: bullet, lines: [clean] });
  }
  return (
    <>
      {blocks.map((b, i) =>
        b.bullets && b.lines.length > 1 ? ( // a lone "- " line reads better as a sentence
          <ul key={i}>
            {b.lines.map((l, j) => (
              <li key={j}>{l}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines[0]}</p>
        ),
      )}
    </>
  );
}
