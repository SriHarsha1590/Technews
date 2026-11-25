// Service worker: shows the daily digest notification and opens the app when it's tapped.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'TechNews', {
      body: data.body || '',
      icon: '/icon.svg',
      badge: '/icon.svg',
      tag: 'daily-digest', // a newer digest replaces an unread older one
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data.url || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((open) => {
      const tab = open.find((c) => c.url.startsWith(self.location.origin));
      if (tab) return tab.navigate(url).then((c) => (c || tab).focus());
      return clients.openWindow(url);
    }),
  );
});
