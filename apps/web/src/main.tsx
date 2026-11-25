import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/literata';
import './styles.css';
import { App } from './App';
import { AuthProvider, useAuth } from './auth';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as Window & { technewsInstall?: Event }).technewsInstall = event;
});
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function ReaderSession() {
  const { user } = useAuth();
  return <App key={user?.uid ?? 'visitor'} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ReaderSession />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
