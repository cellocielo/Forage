import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Reminder notifications on this device (Web Push). The server (send-reminders) decides
 * when, using the same settings as the extension's reminders.
 */

// The server's public VAPID key; the private half is an Edge Function secret.
export const VAPID_PUBLIC_KEY = 'BO7IVBeoB05TpI7ssmOx6nqyz1i2wur8ifFqmPsi07w680LitNMUcIGCVAW0LSQrc50sZoLAE2Cp00IkdivlfO8';

/**
 * needs-install: an iPhone or iPad in Safari, where notifications only work once the app is
 * added to the Home Screen.
 */
export type PushStatus = 'unsupported' | 'needs-install' | 'blocked' | 'off' | 'on';

function isAppleMobile(): boolean {
  // iPadOS reports itself as a Mac, but with touch.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function isInstalled(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return (await registration?.pushManager.getSubscription()) ?? null;
}

export async function pushStatus(): Promise<PushStatus> {
  if (!supported()) return isAppleMobile() && !isInstalled() ? 'needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function saveSubscription(client: SupabaseClient, subscription: PushSubscription): Promise<void> {
  const { endpoint, keys } = subscription.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('This browser gave an incomplete subscription.');
  const { error } = await client.rpc('save_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: keys.p256dh,
    p_auth: keys.auth,
  });
  if (error) throw new Error(error.message);
}

/** Asks for permission (call from a tap) and registers this device. */
export async function turnOnPush(client: SupabaseClient): Promise<PushStatus> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'blocked' : 'off';
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }));
  await saveSubscription(client, subscription);
  return 'on';
}

/** Re-saves an existing subscription, so it follows whoever is signed in on this device. */
export async function syncPush(client: SupabaseClient): Promise<void> {
  const subscription = await currentSubscription();
  if (subscription && Notification.permission === 'granted') await saveSubscription(client, subscription);
}

/** Stops reminders on this device. */
export async function turnOffPush(client: SupabaseClient): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await client.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  await subscription.unsubscribe();
}

export async function sendTestPush(client: SupabaseClient): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await client.functions.invoke('send-reminders', { body: { test: true } });
  if (!error) return { ok: true };
  if (error instanceof FunctionsHttpError) {
    const payload = await (error.context as Response).json().catch(() => null);
    if (payload && typeof payload.error === 'string') return { ok: false, message: payload.error };
  }
  return { ok: false, message: "Couldn't send a test. Check your connection and try again." };
}

/** Opening the app from a reminder resets the back-off. */
export async function respondToReminder(client: SupabaseClient): Promise<void> {
  await client.rpc('respond_to_push_reminder');
}
