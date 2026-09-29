import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  SIGNING_CONSENT,
  type CloudComment,
  type CloudFile,
  type CloudShare,
  type SigningReceipt,
} from '../../shared/cloud';
import { cloudJson, cloudMessage, cloudResponse } from '../lib/cloud';
import { getTool } from '../lib/catalog';
import { openPdf } from '../lib/pdf';
import { download } from '../lib/utils';
import type { Output } from '../lib/types';
import { PdfCanvas } from './PdfCanvas';
import { CommentForm } from './CloudWorkspace';
const Workspace = lazy(() => import('./Workspace'));
interface Shared {
  file: CloudFile;
  share: CloudShare;
  comments: CloudComment[];
}
export default function SharedDocument({ onDirty }: { onDirty: (value: boolean) => void }) {
  const [hash, setHash] = useState(location.hash),
    [dirty, setDirty] = useState(false);
  const changedDirty = useCallback(
    (value: boolean) => {
      setDirty(value);
      onDirty(value);
    },
    [onDirty],
  );
  useEffect(() => {
    const changed = () => {
      if (location.hash === hash) return;
      if (
        dirty &&
        !window.confirm(
          'Open a different shared document? Unsaved signing changes will be discarded.',
        )
      ) {
        history.replaceState(null, '', `/shared${hash}`);
        return;
      }
      setHash(location.hash);
      changedDirty(false);
    };
    window.addEventListener('hashchange', changed);
    return () => window.removeEventListener('hashchange', changed);
  }, [hash, dirty, changedDirty]);
  // Remount on a new fragment so a late response from the previous link cannot
  // populate the newly opened document or reuse its password/signing state.
  return <SharedContents key={hash} onDirty={changedDirty} />;
}
function SharedContents({ onDirty }: { onDirty: (value: boolean) => void }) {
  const [link] = useState(() => {
    const params = new URLSearchParams(location.hash.slice(1));
    return { vault: params.get('v') || '', token: params.get('t') || '' };
  });
  const [password, setPassword] = useState(''),
    [shared, setShared] = useState<Shared>(),
    [file, setFile] = useState<File>(),
    [output, setOutput] = useState<Output>();
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [receipt, setReceipt] = useState<SigningReceipt>();
  const [signing, setSigning] = useState(false);
  const valid = /^[a-f0-9]{64}$/.test(link.vault) && /^[a-f0-9]{64}$/.test(link.token);
  async function act(run: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (cause) {
      setError(cloudMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const access = () => ({ ...link, password });
  async function open() {
    const result = await cloudJson<Shared>('/api/public/open', 'POST', access());
    setShared(result);
    setReceipt(result.share.receipt);
    const response = await cloudResponse('/api/public/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(access()),
    });
    setFile(new File([await response.blob()], result.file.name, { type: 'application/pdf' }));
  }
  return (
    <section className="cloud-page shared-page">
      <span className="eyebrow">SHARED WITH ROVTY PDF</span>
      <h1>{shared?.share.label || 'A document for you.'}</h1>
      <p>
        Open a shared PDF in your browser. Viewing does not upload anything from your device.
        Comments and signed copies are sent to the document owner only when you submit them.
      </p>
      {!valid && (
        <p role="alert" className="error-banner">
          This link is incomplete. Ask the owner for the full link, including everything after the #
          symbol.
        </p>
      )}
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="result-banner" role="status">
          {message}
        </p>
      )}
      {!file && valid && (
        <form
          className="cloud-panel cloud-form"
          onSubmit={(event) => {
            event.preventDefault();
            void act(open);
          }}
        >
          <label>
            Link password (if provided)
            <input
              type="password"
              value={password}
              maxLength={128}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? 'Opening…' : 'Open shared PDF'}
          </button>
          <p>
            The owner can see how many times the link was opened. This is not an identity check.
          </p>
        </form>
      )}
      {shared && file && (
        <>
          <div className="cloud-panel">
            <h2>{shared.file.name}</h2>
            <p>
              Access expires {new Date(shared.share.expires).toLocaleString()}. Downloaded copies
              cannot be recalled by the owner.
            </p>
            <div className="cloud-actions">
              <button
                className="button secondary"
                onClick={() =>
                  void act(async () => {
                    const response = await cloudResponse('/api/public/download', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(access()),
                    });
                    download(
                      new Uint8Array(await response.arrayBuffer()),
                      file.name,
                      'application/pdf',
                    );
                  })
                }
              >
                Download PDF
              </button>
              {shared.share.mode === 'sign' && !receipt && (
                <button className="button" onClick={() => setSigning(true)}>
                  Add your signature
                </button>
              )}
              <a href="/privacy">Privacy details</a>
            </div>
          </div>
          {!signing && <Viewer file={file} />}
          {shared.share.mode === 'review' && (
            <div className="cloud-panel">
              <h2>Document review</h2>
              <p>
                Your name, comment and optional page number are stored with this PDF and visible to
                the owner and other review link holders.
              </p>
              <CommentForm
                guest
                busy={busy}
                onSubmit={(value) =>
                  void act(async () => {
                    await cloudJson('/api/public/comment', 'POST', { ...access(), ...value });
                    const refreshed = await cloudJson<Shared>('/api/public/open', 'POST', access());
                    setShared(refreshed);
                    setMessage('Comment posted.');
                  })
                }
              />
              <button
                className="cloud-inline-link"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    setShared(await cloudJson<Shared>('/api/public/open', 'POST', access()));
                  })
                }
              >
                Refresh comments
              </button>
              {shared.comments.map((comment) => (
                <article key={comment.id} className="cloud-comment">
                  <strong>
                    {comment.author}
                    {comment.owner ? ' · Document owner' : ' · Unverified name'}
                    {comment.page ? ` · Page ${comment.page}` : ''}
                  </strong>
                  <p>{comment.text}</p>
                  <span>
                    {comment.resolved ? 'Resolved' : 'Open'} ·{' '}
                    {new Date(comment.created).toLocaleString()}
                  </span>
                </article>
              ))}
            </div>
          )}
          {signing && !receipt && (
            <>
              <p className="cloud-notice">
                Add your visual signature, then download the signed PDF. Review your result before
                choosing “Send signed copy” below.
              </p>
              <Suspense fallback={<p role="status">Opening signature editor…</p>}>
                <Workspace
                  tool={getTool('sign')!}
                  initialFile={file}
                  onResult={setOutput}
                  onDirty={(value) => {
                    onDirty(value);
                    if (value) setOutput(undefined);
                  }}
                  navigate={() => {
                    setSigning(false);
                    setOutput(undefined);
                    onDirty(false);
                  }}
                  cloudSave={false}
                />
              </Suspense>
              {output && (
                <form
                  className="cloud-panel cloud-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget),
                      name = String(form.get('name') || '');
                    void act(async () => {
                      const response = await cloudResponse('/api/public/sign', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/pdf',
                          'x-share-vault': link.vault,
                          'x-share-token': link.token,
                          'x-share-password': encodeURIComponent(password),
                          'x-signer-name': encodeURIComponent(name),
                          'x-signing-consent': 'accepted',
                          'x-file-name': encodeURIComponent(output.name),
                        },
                        body: new Blob([new Uint8Array(output.bytes)], { type: 'application/pdf' }),
                      });
                      const result = await response.json();
                      setReceipt(result.receipt);
                      setOutput(undefined);
                      setSigning(false);
                      onDirty(false);
                    });
                  }}
                >
                  <h2>Return your signed copy</h2>
                  <p>
                    This uploads the finished PDF, your entered name and your consent to the owner’s
                    cloud workspace. A completion record stores the time and hashes of the original
                    and returned PDFs. It does not verify your identity or certify that only a
                    signature was changed.
                  </p>
                  <label>
                    Your full name
                    <input name="name" maxLength={80} required />
                  </label>
                  <label className="cloud-checkbox">
                    <input type="checkbox" required />
                    {SIGNING_CONSENT}
                  </label>
                  <button className="button" disabled={busy}>
                    Send signed copy
                  </button>
                </form>
              )}
            </>
          )}
          {receipt && (
            <div className="cloud-panel">
              <h2>Signed copy received.</h2>
              <p>
                Returned by {receipt.name} on {new Date(receipt.completed).toLocaleString()}. The
                document owner can download it from their workspace.
              </p>
              <p>
                This records a visual signature and self-declared name, not a certificate-based
                digital signature.
              </p>
              <button
                className="button secondary"
                onClick={() =>
                  download(
                    new TextEncoder().encode(JSON.stringify(receipt, null, 2)),
                    'signing-record.json',
                    'application/json',
                  )
                }
              >
                Download completion record
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
function Viewer({ file }: { file: File }) {
  const [doc, setDoc] = useState<PDFDocumentProxy>(),
    [page, setPage] = useState(0),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true,
      loaded: PDFDocumentProxy | undefined;
    void file
      .arrayBuffer()
      .then((data) => openPdf(new Uint8Array(data)))
      .then((value) => {
        loaded = value;
        if (active) setDoc(value);
        else void value.loadingTask.destroy();
      })
      .catch(() => {
        if (active)
          setError(
            'This PDF cannot be previewed here. Download it to open locally; encrypted PDFs may need a document password.',
          );
      });
    return () => {
      active = false;
      void loaded?.loadingTask.destroy();
    };
  }, [file]);
  return (
    <div className="cloud-viewer">
      {error && <p role="alert">{error}</p>}
      {doc && (
        <>
          <div className="cloud-actions">
            <button disabled={page === 0} onClick={() => setPage((n) => n - 1)}>
              Previous page
            </button>
            <span>
              Page {page + 1} of {doc.numPages}
            </span>
            <button disabled={page + 1 >= doc.numPages} onClick={() => setPage((n) => n + 1)}>
              Next page
            </button>
          </div>
          <div className="cloud-preview-sheet">
            <PdfCanvas doc={doc} index={page} onError={setError} />
          </div>
        </>
      )}
    </div>
  );
}
