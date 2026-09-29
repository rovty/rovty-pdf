import { useState } from 'react';
import type { Output } from '../lib/types';
import { CloudError, cloudMessage, uploadCloud } from '../lib/cloud';
import { fileSize } from '../lib/utils';
export default function CloudSave({ output }: { output: Output }) {
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false),
    [error, setError] = useState(''),
    [signIn, setSignIn] = useState(false);
  if (output.mime !== 'application/pdf') return null;
  if (!open)
    return (
      <button className="button secondary" onClick={() => setOpen(true)}>
        Save a cloud copy
      </button>
    );
  async function save() {
    setBusy(true);
    setError('');
    setSignIn(false);
    try {
      await uploadCloud(output);
      setDone(true);
    } catch (cause) {
      setError(cloudMessage(cause));
      setSignIn(cause instanceof CloudError && cause.status === 401);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="cloud-save">
      <strong>{done ? 'Cloud copy saved.' : 'Save this PDF to your account?'}</strong>
      <p>
        {output.name} · {fileSize(output.bytes.length)}.{' '}
        {done
          ? 'Your copy is private. Manage it in the cloud workspace.'
          : 'This uploads the finished PDF to Rovty on Cloudflare, where it stays until you delete it. It is not shared automatically.'}
      </p>
      {error && <p role="alert">{error}</p>}
      {signIn && (
        <p>
          <a href="/cloud" target="_blank" rel="noreferrer">
            Sign in to cloud workspace in a new tab
          </a>
          , then retry here.
        </p>
      )}
      <div className="cloud-actions">
        {!done && (
          <button className="button" disabled={busy} onClick={() => void save()}>
            {busy ? 'Uploading…' : 'Upload this PDF'}
          </button>
        )}
        <button onClick={() => setOpen(false)}>Close</button>
        {done && (
          <a href="/cloud" target="_blank" rel="noreferrer">
            Open cloud workspace
          </a>
        )}
      </div>
    </div>
  );
}
