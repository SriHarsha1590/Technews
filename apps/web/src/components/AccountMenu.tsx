import { useRef, useState } from 'react';
import { useAuth, type AuthUser } from '../auth';
import { Link, navigate } from '../router';
import { Icon } from './Icon';

/** The reader's Google photo, or their initial when there isn't one (or it fails to load). */
export function Avatar({ user, large = false }: { user: AuthUser; large?: boolean }) {
  const [photoOk, setPhotoOk] = useState(true);
  const className = `avatar${large ? ' avatar-large' : ''}`;
  if (user.photoUrl && photoOk) {
    return <img className={className} src={user.photoUrl} alt="" referrerPolicy="no-referrer" onError={() => setPhotoOk(false)} />;
  }
  return <span className={className} aria-hidden="true">{user.name.trim().charAt(0).toUpperCase() || '?'}</span>;
}

/** Top-right account button. The native popover closes on Escape and on a tap outside. */
export function AccountMenu({ user, admin = false }: { user: AuthUser; admin?: boolean }) {
  const { signOut } = useAuth();
  const menu = useRef<HTMLDivElement>(null);
  const close = () => menu.current?.hidePopover();

  return (
    <>
      <button type="button" className="account" aria-label="Your account" title={user.name} popoverTarget="account-menu">
        <Avatar user={user} />
      </button>
      <div id="account-menu" className="account-menu" popover="auto" ref={menu}>
        <div className="account-menu-head">
          <Avatar user={user} />
          <div>
            <strong>{user.name}</strong>
            {user.email && <span>{user.email}</span>}
          </div>
        </div>
        <nav aria-label="Your account">
          {admin && <Link href="/admin" onClick={close}>Admin dashboard</Link>}
          <Link href="/profile" onClick={close}><Icon name="user" />Profile</Link>
          <Link href="/saved" onClick={close}><Icon name="save" />Saved</Link>
          <Link href="/history" onClick={close}><Icon name="history" />History</Link>
          <button
            type="button"
            onClick={() => {
              close();
              void signOut().then(() => navigate('/'));
            }}
          >
            <Icon name="signout" />Sign out
          </button>
        </nav>
      </div>
    </>
  );
}
