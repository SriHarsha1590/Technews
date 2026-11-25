import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth';
import { fetchAdmin, fetchStory } from '../api';
import { Link } from '../router';
import { StackSettings } from './AccountSettings';
import { RefreshButton } from './RefreshButton';
import { StoryCard } from './StoryCard';
import { AskPanel } from './AskPanel';

export function WelcomePage() {
  const { user } = useAuth();
  return <div className="page"><h2>Make TechNews yours</h2><p>Choose technologies to follow. You can change these in your profile anytime.</p><StackSettings /><Link className="primary" href="/?view=foryou" onClick={() => { if (user) localStorage.setItem(`welcome:${user.uid}`, 'done'); }}>Start reading</Link><Link href="/" onClick={() => { if (user) localStorage.setItem(`welcome:${user.uid}`, 'done'); }}>Skip for now</Link></div>;
}

export function AdminPage() {
  const { user, token } = useAuth();
  const status = useQuery({ queryKey: ['admin', user?.uid], queryFn: async () => fetchAdmin(await token()), refetchInterval: 10_000 });
  return <div className="page"><h2>Admin dashboard</h2><p>Monitor feed delivery and manage a pipeline refresh.</p>{status.isPending ? <p role="status">Loading service status…</p> : status.isError ? <p role="alert">{status.error.message}</p> : <><dl className="admin-status"><dt>MongoDB</dt><dd>{status.data.mongo ? 'Available' : 'Unavailable'}</dd><dt>Redis</dt><dd>{status.data.redis ? 'Available' : 'Unavailable'}</dd><dt>Pipeline</dt><dd>{status.data.pipeline.state}</dd><dt>Last started</dt><dd>{status.data.pipeline.startedAt ? new Date(status.data.pipeline.startedAt).toLocaleString() : 'Never'}</dd><dt>Last finished</dt><dd>{status.data.pipeline.finishedAt ? new Date(status.data.pipeline.finishedAt).toLocaleString() : 'Not yet'}</dd><dt>Feed published</dt><dd>{status.data.feedVersion ? new Date(status.data.feedVersion).toLocaleString() : 'No snapshot'}</dd></dl><RefreshButton onUpdate={() => { void status.refetch(); }} /></>}</div>;
}

export function StoryPage({ id }: { id: string }) {
  const [asking, setAsking] = useState(false);
  const story = useQuery({ queryKey: ['story', id], queryFn: () => fetchStory(id), enabled: /^[a-f0-9]{24}$/.test(id) });
  useEffect(() => {
    document.title = `${story.data?.title ?? 'Story'} · TechNews`;
  }, [id, story.data]);
  return <div className="scroll"><Link href="/">Back to stories</Link>{!id || !/^[a-f0-9]{24}$/.test(id) ? <p>Invalid story link.</p> : story.isPending ? <p role="status">Loading story…</p> : story.isError ? <p role="alert">This story is unavailable or has expired.</p> : <><StoryCard story={story.data} onAsk={() => setAsking(true)} /><AskPanel open={asking} onClose={() => setAsking(false)} stories={[story.data]} focus={story.data} onClearFocus={() => {}} onShowStory={() => setAsking(false)} /></>}</div>;
}

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
export function InstallApp() {
  const [note, setNote] = useState('');
  return <section className="settings-section"><h3>Install TechNews</h3><p>On iPhone, open Safari’s Share menu and choose Add to Home Screen. On Android or desktop, use your browser’s Install app option.</p><button type="button" className="secondary" onClick={async () => {
    const event = (window as Window & { technewsInstall?: InstallEvent }).technewsInstall;
    if (!event) { setNote('Use your browser menu to add TechNews to your home screen.'); return; }
    await event.prompt(); await event.userChoice;
    delete (window as Window & { technewsInstall?: InstallEvent }).technewsInstall;
  }}>Install app</button><p role="status">{note}</p></section>;
}
