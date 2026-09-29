const KEY = 'rovty-pdf:offline-enabled';
export function offlineEnabled() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
export async function registerOffline() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator))
    throw new Error('Offline tools require a supported browser and the production build.');
  return navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
}
export async function enableOffline() {
  // Check that the opt-in can be remembered before installing persistent assets.
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    throw new Error('Browser storage is blocked. Allow site storage to enable offline tools.');
  }
  try {
    await installOffline();
  } catch (error) {
    await disableOffline().catch(() => {});
    throw error;
  }
}
async function installOffline() {
  const registration = await registerOffline();
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker) throw new Error('The offline tools could not start. Please try again.');
  if (!['installed', 'activated'].includes(worker.state))
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(
          new Error('The offline download took too long. Check your connection and try again.'),
        );
      }, 120_000);
      const cleanup = () => {
        window.clearTimeout(timer);
        worker.removeEventListener('statechange', changed);
      };
      const changed = () => {
        if (['installed', 'activated'].includes(worker.state)) {
          cleanup();
          resolve();
        }
        if (worker.state === 'redundant') {
          cleanup();
          reject(
            new Error(
              'The offline download failed. Check your connection or available browser storage.',
            ),
          );
        }
      };
      worker.addEventListener('statechange', changed);
      changed();
    });
}
export async function disableOffline() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Blocked preference storage must not prevent removing the worker and cache.
  }
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      const workers = [registration.active, registration.waiting, registration.installing];
      if (workers.some((worker) => worker && new URL(worker.scriptURL).pathname === '/sw.js'))
        await registration.unregister();
    }
  }
  if ('caches' in window)
    for (const key of await caches.keys())
      if (key.startsWith('rovty-pdf-app-')) await caches.delete(key);
}
