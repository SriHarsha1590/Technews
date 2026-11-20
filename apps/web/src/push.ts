// Turns browser notifications on or off for the daily digest.
import { deletePush, fetchPushKey, postPush } from './api';
import { keyToBytes } from './pushKey';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function enablePush(token: string): Promise<void> {
  if (!pushSupported()) throw new Error("This browser can't show notifications. On iPhone, add the app to your home screen first.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are blocked for this site. Allow them in your browser settings, then try again.');
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(await fetchPushKey()) }));
  await postPush(token, sub.toJSON());
}

export async function disablePush(token: string): Promise<void> {
  if (!pushSupported()) return;
  const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
  if (!sub) return;
  await deletePush(token, sub.endpoint);
  await sub.unsubscribe();
}
