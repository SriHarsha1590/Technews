import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { WORDS_PER_SECOND, wordCount, type ExplainerView, type StoryCard } from '@technews/shared';
import { fetchExplainer } from '../api';
import { CATEGORY_LABEL } from '../format';
import { Icon } from './Icon';
import { Sheet, SheetHeader } from './Sheet';

interface Props {
  story: StoryCard;
  open: boolean;
  onClose: () => void;
}

/** Watch: a 30-60 second narrated slideshow. Mounted only while open, so closing always stops the voice. */
export function WatchSheet({ story, open, onClose }: Props) {
  const titleId = useId();
  return (
    <Sheet open={open} onClose={onClose} labelledBy={titleId} className="sheet-watch">
      <SheetHeader id={titleId} title="Watch" subtitle={story.title} onClose={onClose} />
      {open && <Player story={story} />}
    </Sheet>
  );
}

function Player({ story }: { story: StoryCard }) {
  const q = useQuery({ queryKey: ['explainer', story.id], queryFn: () => fetchExplainer(story.id), staleTime: Infinity, retry: false });

  if (q.isPending) {
    return (
      <div className="player player-wait" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>Making a short video about this story…</p>
        <p className="hint">The first viewer waits about 20 seconds. After that it's instant.</p>
      </div>
    );
  }
  if (q.isError) {
    return (
      <div className="player player-wait" role="alert">
        <p>{q.error.message}</p>
        <button type="button" className="primary" onClick={() => void q.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  return <Playback explainer={q.data} story={story} />;
}

// ---------- Narration: the browser's own speech engine (free, no key, works offline on most devices) ----------

const speech = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const english = (speech?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('en'));
  const preferred = /natural|neural|google us english|samantha|aria|jenny|daniel/i;
  return english.find((v) => preferred.test(v.name)) ?? english.find((v) => v.lang === 'en-US') ?? english[0];
}

const sceneMs = (narration: string) => Math.max(3000, (wordCount(narration) / WORDS_PER_SECOND) * 1000);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function Playback({ explainer, story }: { explainer: ExplainerView; story: StoryCard }) {
  const { scenes } = explainer;
  const [scene, setScene] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(!speech);
  const [progress, setProgress] = useState(0); // 0..1 through the current scene
  const [imageOk, setImageOk] = useState(Boolean(explainer.imageUrl));
  const progressRef = useRef(0);

  const durations = scenes.map((s) => sceneMs(s.narration));
  const total = durations.reduce((a, b) => a + b, 0) / 1000;
  const elapsed = (durations.slice(0, scene).reduce((a, b) => a + b, 0) + progress * durations[scene]) / 1000;

  const goTo = (i: number) => {
    progressRef.current = 0;
    setProgress(0);
    setEnded(false);
    setScene(Math.max(0, Math.min(scenes.length - 1, i)));
  };

  // One run per scene: speak it (or time it when muted), then move on.
  useEffect(() => {
    if (!playing) return;
    const text = scenes[scene].narration;
    const ms = durations[scene];
    const voice = !muted && speech !== null;
    let voiceDone = !voice;
    let finished = false;
    let raf = 0;
    // Muted: resume where we paused. Voice: a scene always restarts, as speech can't resume mid-sentence.
    const begin = performance.now() - (voice ? 0 : progressRef.current * ms);

    const advance = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(raf);
      progressRef.current = 0;
      if (scene + 1 < scenes.length) {
        setProgress(0);
        setScene(scene + 1);
      } else {
        setProgress(1);
        setPlaying(false);
        setEnded(true);
      }
    };

    if (voice) {
      const u = new SpeechSynthesisUtterance(text);
      const v = pickVoice();
      if (v) u.voice = v;
      u.rate = 1;
      u.onend = () => {
        voiceDone = true;
        if (!finished) advance();
      };
      u.onerror = () => {
        voiceDone = true; // no voice available: carry on with captions on the timer
      };
      speech.cancel();
      speech.speak(u);
    }

    const tick = (t: number) => {
      const p = (t - begin) / ms;
      progressRef.current = Math.min(p, voiceDone ? 1 : 0.97); // wait for a slow voice at the end of the bar
      setProgress(progressRef.current);
      if ((p >= 1 && voiceDone) || p > 2.5) return advance(); // 2.5x: the voice is stuck, move on anyway
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      finished = true;
      cancelAnimationFrame(raf);
      if (voice) speech.cancel();
    };
    // durations comes from scenes, which never change while mounted
  }, [scene, playing, muted, scenes]);

  const togglePlay = () => {
    if (ended) {
      goTo(0);
      setPlaying(true);
      return;
    }
    setPlaying((p) => !p);
  };

  const current = scenes[scene];
  return (
    <div className="player">
      <div className={`player-stage${playing ? ' is-playing' : ''}`} aria-live="polite">
        {imageOk && explainer.imageUrl ? (
          <img
            key={scene}
            className={`player-image kb-${scene % 3}`}
            src={explainer.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageOk(false)}
          />
        ) : (
          <div className={`player-fallback cat-${story.category}`} aria-hidden="true">
            <span>{CATEGORY_LABEL[story.category]}</span>
          </div>
        )}
        <div className="player-shade" aria-hidden="true" />

        <div className="player-bars" aria-hidden="true">
          {scenes.map((_, i) => (
            <span key={i}>
              <i style={{ transform: `scaleX(${i < scene ? 1 : i === scene ? progress : 0})` }} />
            </span>
          ))}
        </div>
        <p className="player-brand">
          <span>TechNews</span> · {story.primarySource.name}
        </p>

        <div className="player-text">
          <h4 key={`c${scene}`} className="player-caption">
            {current.caption}
          </h4>
          <p key={`n${scene}`} className="player-subtitle">
            {current.narration}
          </p>
        </div>
      </div>

      <div className="player-controls">
        <button type="button" className="icon-button" aria-label="Previous scene" onClick={() => goTo(scene - 1)} disabled={scene === 0}>
          <Icon name="prev" />
        </button>
        <button type="button" className="play-button" aria-label={ended ? 'Replay' : playing ? 'Pause' : 'Play'} onClick={togglePlay}>
          <Icon name={ended ? 'replay' : playing ? 'pause' : 'play'} size={20} />
        </button>
        <button type="button" className="icon-button" aria-label="Next scene" onClick={() => goTo(scene + 1)} disabled={scene === scenes.length - 1}>
          <Icon name="next" />
        </button>
        <span className="player-time">
          {clock(elapsed)} / {clock(total)}
        </span>
        {speech && (
          <button type="button" className="icon-button" aria-label={muted ? 'Turn narration on' : 'Mute narration'} aria-pressed={muted} onClick={() => setMuted((m) => !m)}>
            <Icon name={muted ? 'muted' : 'sound'} />
          </button>
        )}
      </div>
      <p className="sheet-note">Script written by AI from the article, read by your device's voice.</p>
    </div>
  );
}
