import { useEffect, useState } from 'react';
import { clearSignatures, listSignatures } from '../lib/signatureStore';
import { disableOffline, enableOffline, offlineEnabled } from '../lib/offline';
import { humanError } from '../lib/utils';

export default function DeviceSettings() {
  const [count, setCount] = useState<number>();
  const [offline, setOffline] = useState(offlineEnabled);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    void listSignatures()
      .then((items) => setCount(items.length))
      .catch(() => setCount(undefined));
  }, []);
  async function toggleOffline() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (offline) {
        await disableOffline();
        setOffline(false);
        setMessage('Offline app files cleared. Saved signatures are unchanged.');
      } else {
        await enableOffline();
        setOffline(true);
        setMessage('Offline tools are ready. You can reopen this app without a connection.');
      }
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy(false);
    }
  }
  async function removeSaved() {
    if (
      !window.confirm(
        'Delete all saved signatures from this browser? Your PDFs will not be changed.',
      )
    )
      return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await clearSignatures();
      setCount(0);
      setMessage('Saved signatures deleted from this browser.');
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="device-settings" aria-labelledby="device-settings-title">
      <span className="eyebrow">YOU’RE IN CONTROL</span>
      <h2 id="device-settings-title">Saved on this device</h2>
      <div className="device-setting">
        <div>
          <h3>Saved signatures{count !== undefined ? ` · ${count}` : ''}</h3>
          <p>
            Save a signature only when you choose “Save on this device”. It stays in this browser,
            without syncing to an account. Anyone using this browser profile can reuse it. You can
            delete individual signatures in the signature dialog.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={busy || count === 0}
          onClick={() => void removeSaved()}
        >
          Delete saved signatures
        </button>
      </div>
      <div className="device-setting">
        <div>
          <h3>Offline tools · {offline ? 'Enabled' : 'Off'}</h3>
          <p>
            Optionally download the app, fonts and PDF engines for offline use. This cache contains
            no PDFs, passwords or signatures. Updates become active after older tabs close.
          </p>
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void toggleOffline()}>
          {busy ? 'Working…' : offline ? 'Clear offline cache' : 'Enable offline tools'}
        </button>
      </div>
      <p className="device-storage-note">
        Browser storage can be cleared by you, the browser, or private browsing. Saved signatures
        are not a backup. Local tools use no tracking or sign-in cookies; a small local preference
        remembers whether offline tools are enabled. Optional cloud sign-in uses essential session
        cookies.
      </p>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
