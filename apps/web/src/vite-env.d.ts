/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface Window {
  /** Dev-only test hook: Playwright sets this to fake a signed-in or signed-out reader. */
  __TECHNEWS_TEST_AUTH__?: { user: { uid: string; name: string } | null };
}

// Font packages only register @font-face rules; they export nothing.
declare module '@fontsource-variable/*';
