// One small stroke icon set, so every button looks like it belongs to the same app.
const paths = {
  check: <path d="M3.5 8.5l3 3 6-7" />,
  try: <path d="M5 3.5v9l7.5-4.5z" />,
  watch: <><rect x="2" y="3.5" width="12" height="9" rx="2" /><path d="M7 6.5v3l2.5-1.5z" /></>,
  ask: <path d="M3 4.5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4.5a2 2 0 0 1-2 2H7.5L4.5 13.5V11h0A1.5 1.5 0 0 1 3 9.5z" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  play: <path d="M5 3.5v9l7.5-4.5z" />,
  pause: <path d="M5.5 3.5v9M10.5 3.5v9" />,
  prev: <path d="M4 3.5v9M12 3.5L6 8l6 4.5z" />,
  next: <path d="M12 3.5v9M4 3.5L10 8l-6 4.5z" />,
  sound: <><path d="M2.5 6v4h2.5L8.5 13V3L5 6z" /><path d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.8a6 6 0 0 1 0 8.4" /></>,
  muted: <><path d="M2.5 6v4h2.5L8.5 13V3L5 6z" /><path d="M11 6l3.5 4M14.5 6L11 10" /></>,
  replay: <><path d="M3 8a5 5 0 1 0 1.5-3.5" /><path d="M3 2.5V5h2.5" /></>,
  send: <path d="M2.5 8L13.5 2.5 10 13.5 7.5 8.5z" />,
  external: <><path d="M9 3h4v4M13 3L7.5 8.5" /><path d="M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></>,
  spark: <path d="M8 2l1.4 3.9L13.5 7 9.4 8.4 8 12.5 6.6 8.4 2.5 7l4.1-1.1z" />,
  save: <path d="M4.5 2.5h7a1 1 0 0 1 1 1v10l-4.5-3-4.5 3v-10a1 1 0 0 1 1-1z" />,
  share: <><path d="M8 10V2.5M5.25 5.25 8 2.5l2.75 2.75" /><path d="M4.5 7H3.75A1.75 1.75 0 0 0 2 8.75v3.5A1.75 1.75 0 0 0 3.75 14h8.5A1.75 1.75 0 0 0 14 12.25v-3.5A1.75 1.75 0 0 0 12.25 7h-.75" /></>,
  user: <><circle cx="8" cy="5.5" r="2.75" /><path d="M2.75 13.5a5.25 5.25 0 0 1 10.5 0" /></>,
  history: <><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" /><path d="M2.5 2.5v2.5H5" /><path d="M8 5v3.25l2.25 1.5" /></>,
  signout: <><path d="M6.5 13.5h-3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3" /><path d="M10.5 11l3-3-3-3M13.5 8H6" /></>,
  trash: <><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5" /><path d="M4 4.5l.6 8.1a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9l.6-8.1" /></>,
  back: <path d="M9.5 3.5L5 8l4.5 4.5" />,
  eye: <><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>,
  eyeOff: <><path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.7 2.2M4.3 4.9C2.5 6.1 1.5 8 1.5 8s2.4 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7" /><path d="M2 2l12 12" /></>,
};

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}
