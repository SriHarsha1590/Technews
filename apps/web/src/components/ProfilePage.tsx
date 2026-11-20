import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth, type AuthUser } from '../auth';
import { fetchStats } from '../api';
import { Link, navigate } from '../router';
import { Avatar } from './AccountMenu';
import { DigestSettings, StackSettings } from './AccountSettings';
import { Icon } from './Icon';
import { PageHeader } from './StoryRow';

/** Who's signed in, what they've read, watched and saved, and their settings. */
export function ProfilePage({ user }: { user: AuthUser }) {
  const { token, signOut } = useAuth();
  const stats = useQuery({ queryKey: ['stats', user.uid], queryFn: async () => fetchStats(await token()) });

  // "Choose your stack" links to /profile#stack.
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }, []);

  const since = user.createdAt ? new Date(user.createdAt).toLocaleDateString([], { month: 'long', year: 'numeric' }) : null;
  const count = (n: number | undefined) => (n === undefined ? '–' : n.toLocaleString());

  return (
    <div className="page">
      <PageHeader title="Profile" />

      <section className="profile" aria-label="Your account">
        <Avatar user={user} large />
        <div>
          <p className="profile-name">{user.name}</p>
          {user.email && <p className="hint">{user.email}</p>}
          <p className="hint">
            {user.provider === 'google' ? 'Signed in with Google' : 'Signed in with email'}
            {since && ` · Member since ${since}`}
          </p>
        </div>
      </section>

      <nav className="stats" aria-label="Your activity">
        <Link href="/history"><strong>{count(stats.data?.read)}</strong><span>Read</span></Link>
        <Link href="/history?filter=watched"><strong>{count(stats.data?.watched)}</strong><span>Watched</span></Link>
        <Link href="/saved"><strong>{count(stats.data?.saved)}</strong><span>Saved</span></Link>
      </nav>

      <StackSettings />
      <DigestSettings />

      <section className="settings-section" aria-labelledby="account-title">
        <h3 id="account-title">Account</h3>
        <button type="button" className="secondary with-icon" onClick={() => void signOut().then(() => navigate('/'))}>
          <Icon name="signout" />Sign out
        </button>
      </section>
    </div>
  );
}
