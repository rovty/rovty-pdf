import { useEffect, useRef, useState } from 'react';
import {
  CLOUD_LIMITS,
  type CloudWorkspace as Vault,
  type CloudFile,
  type CloudShare,
  type CloudPreferences,
} from '../../shared/cloud';
import { CloudError, cloudJson, cloudMessage, cloudResponse, uploadCloud } from '../lib/cloud';
import { download, fileSize } from '../lib/utils';
import { Icon } from './Icon';
import { CloudIntro } from './CloudIntro';
export default function CloudWorkspace({
  onOpen,
}: {
  onOpen: (file: File, tool?: string) => void;
}) {
  const [ready, setReady] = useState<boolean>(),
    [account, setAccount] = useState<{ email: string } | null>(null),
    [data, setData] = useState<Vault>();
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('Documents'),
    [selected, setSelected] = useState(''),
    [shareFile, setShareFile] = useState<CloudFile>();
  const [newLink, setNewLink] = useState(''),
    [newToken, setNewToken] = useState('');
  const input = useRef<HTMLInputElement>(null);
  async function refresh() {
    setData(await cloudJson<Vault>('/api/cloud/workspace'));
  }
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      const status = await (
        await cloudResponse('/api/status', { signal: controller.signal })
      ).json();
      setReady(status.configured);
      if (status.configured) {
        try {
          const user = await cloudJson<{ email: string }>('/api/account');
          if (!controller.signal.aborted) {
            setAccount(user);
            await refresh();
          }
        } catch (cause) {
          if (!(cause instanceof CloudError && cause.status === 401)) throw cause;
        }
      }
    })().catch((cause) => {
      if (!controller.signal.aborted) setError(cloudMessage(cause));
    });
    return () => controller.abort();
  }, []);
  async function act(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (cause) {
      setError(cloudMessage(cause));
      if (cause instanceof CloudError && cause.status === 401) {
        setAccount(null);
        setData(undefined);
        setNewToken('');
        setNewLink('');
      }
    } finally {
      setBusy(false);
    }
  }
  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage('Copied.');
  }
  async function upload(file: File) {
    if (file.size > CLOUD_LIMITS.fileBytes)
      throw new Error(
        'Choose a PDF up to 20 MB for cloud storage. Larger PDFs can still be edited locally.',
      );
    await uploadCloud(file, tab === 'Templates');
    await refresh();
    setMessage('Saved to your private cloud workspace.');
  }
  async function open(file: CloudFile) {
    const response = await cloudResponse(`/api/cloud/files/${file.id}`);
    onOpen(
      new File([await response.blob()], file.name, { type: 'application/pdf' }),
      data?.preferences.defaultTool,
    );
  }
  const chosen = data?.files.find((f) => f.id === selected);
  return (
    <section className="cloud-page">
      <CloudIntro compact={Boolean(account)} />
      <p className="cloud-notice">
        <Icon name="ShieldCheck" size={18} />
        Cloud copies are stored by Rovty on Cloudflare until you delete them. Sharing gives link
        holders access. <a href="/privacy">Read the privacy details</a>
      </p>
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
      {typeof location !== 'undefined' &&
        new URLSearchParams(location.search).has('auth') &&
        !account && <p role="alert">Sign-in could not be completed. Please start again below.</p>}
      {ready === undefined && !error && <p role="status">Checking cloud availability…</p>}
      {ready === false && (
        <div className="cloud-panel">
          <h2>Cloud workspace is being prepared.</h2>
          <p>
            You can use all private PDF tools now. Cloud accounts, storage and sharing will open
            here when the service is connected.
          </p>
          <a className="button" href="/edit">
            Open the private editor
          </a>
        </div>
      )}
      {ready && !account && (
        <div className="cloud-panel">
          <h2>Bring your Rovty account.</h2>
          <p>
            Sign in for cloud features. Signing in does not upload any document or signature. Free
            cloud limits: 100 MB total, 50 files, 20 MB per PDF, and links up to 30 days.
          </p>
          <a className="button" href="/api/auth/start">
            Continue with Rovty
          </a>
          <a className="cloud-inline-link" href="/edit">
            Keep editing on this device
          </a>
        </div>
      )}
      {account && (
        <>
          <div className="cloud-account">
            <div>
              <strong>Your cloud workspace</strong>
              <span>{account.email}</span>
            </div>
            <div className="cloud-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act(refresh)}
              >
                Refresh
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await cloudJson('/api/auth/logout', 'POST', {});
                    setAccount(null);
                    setData(undefined);
                    setNewToken('');
                    setNewLink('');
                  })
                }
              >
                Sign out of PDF
              </button>
            </div>
          </div>
          {!data && <p role="status">Opening your workspace…</p>}
          {data && (
            <>
              <div className="cloud-storage">
                <span>
                  {fileSize(data.usedBytes)} of {fileSize(data.limits.accountBytes)} ·{' '}
                  {data.files.length} of {data.limits.files} files
                </span>
                <progress
                  value={data.usedBytes}
                  max={data.limits.accountBytes}
                  aria-label="Cloud storage used"
                />
              </div>
              <div className="category-tabs" aria-label="Cloud workspace sections">
                {['Documents', 'Templates', 'Shared links', 'Preferences', 'Integrations'].map(
                  (item) => (
                    <button
                      key={item}
                      aria-pressed={tab === item}
                      onClick={() => {
                        setTab(item);
                        setShareFile(undefined);
                        setSelected('');
                      }}
                    >
                      {item}
                    </button>
                  ),
                )}
              </div>
              {['Documents', 'Templates'].includes(tab) && (
                <>
                  <div className="cloud-panel cloud-upload">
                    <div>
                      <h2>{tab === 'Templates' ? 'Reusable PDF templates' : 'Your saved PDFs'}</h2>
                      <p>
                        {tab === 'Templates'
                          ? 'Upload a blank PDF as a template. Opening it creates a local working copy.'
                          : 'Choose a PDF to upload. It stays private until you create a share link.'}{' '}
                        Downloads and edits never overwrite the saved original.
                      </p>
                    </div>
                    <input
                      ref={input}
                      className="sr-only"
                      type="file"
                      accept="application/pdf,.pdf"
                      aria-label="Upload a PDF to cloud"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void act(() => upload(file));
                      }}
                    />
                    <button
                      className="button"
                      disabled={busy}
                      onClick={() => input.current?.click()}
                    >
                      <Icon name="FileUp" size={17} />
                      Upload to cloud
                    </button>
                  </div>
                  <div className="cloud-file-list">
                    {data.files
                      .filter((f) => tab !== 'Templates' || f.template)
                      .map((file) => (
                        <article className="cloud-file" key={file.id}>
                          <Icon name={file.template ? 'Files' : 'File'} size={25} />
                          <div className="cloud-file-name">
                            <h3>{file.name}</h3>
                            <p>
                              {fileSize(file.bytes)} · {new Date(file.created).toLocaleDateString()}
                              {file.template ? ' · Template' : ''}
                            </p>
                          </div>
                          <div className="cloud-actions">
                            <button disabled={busy} onClick={() => void act(() => open(file))}>
                              Open copy
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  const response = await cloudResponse(
                                    `/api/cloud/files/${file.id}`,
                                  );
                                  download(
                                    new Uint8Array(await response.arrayBuffer()),
                                    file.name,
                                    'application/pdf',
                                  );
                                })
                              }
                            >
                              Download
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                setShareFile(file);
                                setNewLink('');
                              }}
                            >
                              Share
                            </button>
                            <button disabled={busy} onClick={() => setSelected(file.id)}>
                              Review
                            </button>
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  await cloudJson(`/api/cloud/files/${file.id}`, 'PATCH', {
                                    template: !file.template,
                                  });
                                  await refresh();
                                })
                              }
                            >
                              {file.template ? 'Unmark template' : 'Use as template'}
                            </button>
                            <button
                              disabled={busy}
                              onClick={() => {
                                if (
                                  confirm(
                                    `Delete “${file.name}” and its links, comments and collected signed copies? Downloaded copies cannot be recalled.`,
                                  )
                                )
                                  void act(async () => {
                                    await cloudJson(`/api/cloud/files/${file.id}`, 'DELETE');
                                    if (selected === file.id) setSelected('');
                                    await refresh();
                                  });
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </article>
                      ))}
                  </div>
                  {!data.files.filter((f) => tab !== 'Templates' || f.template).length && (
                    <div className="cloud-empty">
                      <Icon name="Files" size={35} />
                      <h3>
                        {tab === 'Templates'
                          ? 'Start with a blank form.'
                          : 'A little space for your paperwork.'}
                      </h3>
                      <p>Only documents you choose to upload appear here.</p>
                    </div>
                  )}
                  {shareFile && (
                    <ShareForm
                      file={shareFile}
                      defaultDays={data.preferences.defaultExpiryDays}
                      busy={busy}
                      onCancel={() => setShareFile(undefined)}
                      onSubmit={(form) =>
                        void act(async () => {
                          const result = await cloudJson<{
                            share: CloudShare;
                            vault: string;
                            token: string;
                          }>('/api/cloud/shares', 'POST', { ...form, fileId: shareFile.id });
                          setNewLink(
                            `${location.origin}/shared#v=${result.vault}&t=${result.token}`,
                          );
                          setShareFile(undefined);
                          await refresh();
                        })
                      }
                    />
                  )}
                  {chosen && (
                    <div className="cloud-panel">
                      <div className="cloud-section-heading">
                        <h2>Review: {chosen.name}</h2>
                        <button onClick={() => setSelected('')}>Close review</button>
                      </div>
                      <p>
                        Refresh to see new comments. Names entered by link holders are not verified.
                      </p>
                      <CommentForm
                        busy={busy}
                        onSubmit={(form) =>
                          void act(async () => {
                            await cloudJson('/api/cloud/comments', 'POST', {
                              ...form,
                              fileId: chosen.id,
                            });
                            await refresh();
                          })
                        }
                      />
                      {data.comments
                        .filter((c) => c.fileId === chosen.id)
                        .map((comment) => (
                          <div className="cloud-comment" key={comment.id}>
                            <strong>
                              {comment.author}
                              {comment.owner ? '' : ' · Link holder'}
                              {comment.page ? ` · Page ${comment.page}` : ''}
                            </strong>
                            <p>{comment.text}</p>
                            <span>
                              {comment.resolved ? 'Resolved' : 'Open'} ·{' '}
                              {new Date(comment.created).toLocaleString()}
                            </span>
                            <div className="cloud-actions">
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await cloudJson(`/api/cloud/comments/${comment.id}`, 'PATCH', {
                                      resolved: !comment.resolved,
                                    });
                                    await refresh();
                                  })
                                }
                              >
                                {comment.resolved ? 'Reopen' : 'Resolve'}
                              </button>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  void act(async () => {
                                    await cloudJson(`/api/cloud/comments/${comment.id}`, 'DELETE');
                                    await refresh();
                                  })
                                }
                              >
                                Delete comment
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  )}
                </>
              )}
              {newLink && (
                <div className="cloud-panel">
                  <h2>Your link is ready.</h2>
                  <p>
                    Anyone with this link and its password, if set, can access the document until
                    expiry or revocation. Send passwords separately. Copy this link now; it is only
                    shown once.
                  </p>
                  <input aria-label="New share link" readOnly value={newLink} />
                  <div className="cloud-actions">
                    <button className="button" onClick={() => void act(() => copy(newLink))}>
                      Copy link
                    </button>
                    <button onClick={() => setNewLink('')}>Dismiss</button>
                  </div>
                </div>
              )}
              {tab === 'Shared links' && (
                <div className="cloud-panel">
                  <h2>Links & signature requests</h2>
                  <p>
                    Refresh to check progress. Revoking a link stops future access; copies already
                    downloaded remain with their recipients.
                  </p>
                  {!data.shares.length && (
                    <p>No links yet. Choose Share on a saved document to create one.</p>
                  )}
                  {data.shares.map((share) => (
                    <article className="cloud-share" key={share.id}>
                      <h3>{share.label}</h3>
                      <p>
                        {data.files.find((f) => f.id === share.fileId)?.name} ·{' '}
                        {share.mode === 'sign'
                          ? 'Signature request'
                          : share.mode === 'review'
                            ? 'Review link'
                            : 'Download link'}{' '}
                        · {share.passwordProtected ? 'Password protected' : 'Anyone with link'}
                      </p>
                      <p>
                        <strong>
                          {share.revoked
                            ? 'Revoked'
                            : share.expires <= Date.now()
                              ? 'Expired'
                              : share.receipt
                                ? 'Completed'
                                : 'Active'}
                        </strong>{' '}
                        · Expires {new Date(share.expires).toLocaleDateString()} · Opened{' '}
                        {share.opens} times
                      </p>
                      {share.receipt && (
                        <>
                          <p>
                            Returned by {share.receipt.name} on{' '}
                            {new Date(share.receipt.completed).toLocaleString()}. Identity is
                            self-declared.
                          </p>
                          <div className="cloud-actions">
                            <button
                              disabled={busy}
                              onClick={() =>
                                void act(async () => {
                                  const file = data.files.find(
                                    (f) => f.id === share.receipt!.signedFileId,
                                  );
                                  if (file) await open(file);
                                })
                              }
                            >
                              Open signed copy
                            </button>
                            <button
                              onClick={() =>
                                download(
                                  new TextEncoder().encode(JSON.stringify(share.receipt, null, 2)),
                                  'signing-record.json',
                                  'application/json',
                                )
                              }
                            >
                              Download completion record
                            </button>
                          </div>
                        </>
                      )}
                      <div className="cloud-actions">
                        <button
                          disabled={busy || share.revoked}
                          onClick={() =>
                            void act(async () => {
                              await cloudJson(`/api/cloud/shares/${share.id}`, 'PATCH', {});
                              await refresh();
                            })
                          }
                        >
                          Revoke link
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                'Delete this link and its completion record? The PDF files will remain in your workspace.',
                              )
                            )
                              void act(async () => {
                                await cloudJson(`/api/cloud/shares/${share.id}`, 'DELETE');
                                await refresh();
                              });
                          }}
                        >
                          Delete link
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {tab === 'Preferences' && (
                <>
                  <Preferences
                    initial={data.preferences}
                    busy={busy}
                    onSave={(value) =>
                      void act(async () => {
                        await cloudJson('/api/cloud/preferences', 'PUT', value);
                        await refresh();
                        setMessage('Preferences saved to your account.');
                      })
                    }
                  />
                  <div className="cloud-panel">
                    <h2>Delete your cloud data</h2>
                    <p>
                      Remove all saved PDFs, templates, links, comments, signing records,
                      preferences and API tokens. Your Rovty account and local browser signatures
                      are separate.
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        if (
                          confirm(
                            'Permanently delete all your Rovty PDF cloud data? This cannot be undone. Download anything you want to keep first.',
                          )
                        )
                          void act(async () => {
                            await cloudJson('/api/cloud/workspace', 'DELETE', {});
                            setNewLink('');
                            setNewToken('');
                            await refresh();
                            setMessage('Cloud data removed and all links and API tokens revoked.');
                          });
                      }}
                    >
                      Delete all PDF cloud data
                    </button>
                  </div>
                </>
              )}
              {tab === 'Integrations' && (
                <div className="cloud-panel">
                  <h2>Connect your workflow</h2>
                  <p>
                    Use the document API to upload, download, create links and manage reviews from
                    your own applications. Tokens expire after 30 days and stop working when their
                    Rovty session is revoked. Keep them on a trusted server.
                  </p>
                  <a href="/developers">Read the API guide</a>
                  <TokenForm
                    busy={busy}
                    onSubmit={(value) =>
                      void act(async () => {
                        const result = await cloudJson<{ token: string }>(
                          '/api/cloud/tokens',
                          'POST',
                          value,
                        );
                        setNewToken(result.token);
                        await refresh();
                      })
                    }
                  />
                  {newToken && (
                    <div className="cloud-secret">
                      <p>Copy this token now. It is only shown once.</p>
                      <textarea aria-label="New API token" readOnly value={newToken} />
                      <button className="button" onClick={() => void act(() => copy(newToken))}>
                        Copy API token
                      </button>
                      <button onClick={() => setNewToken('')}>Dismiss</button>
                    </div>
                  )}
                  {data.tokens.map((token) => (
                    <article className="cloud-share" key={token.id}>
                      <strong>{token.label}</strong>
                      <p>
                        {token.scope === 'read' ? 'Read only' : 'Read and write'} · Expires{' '}
                        {new Date(token.expires).toLocaleDateString()}
                      </p>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await cloudJson(`/api/cloud/tokens/${token.id}`, 'DELETE');
                            setNewToken('');
                            await refresh();
                          })
                        }
                      >
                        Revoke token
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
function ShareForm({
  file,
  defaultDays,
  busy,
  onSubmit,
  onCancel,
}: {
  file: CloudFile;
  defaultDays: number;
  busy: boolean;
  onSubmit: (value: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="cloud-panel cloud-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        onSubmit({ ...data, days: Number(data.days) });
      }}
    >
      <h2>Share {file.name}</h2>
      <p>
        This creates access to the saved cloud copy. Anyone with the link can use the permissions
        you choose. Use a password for extra protection.
      </p>
      <label>
        Link label
        <input name="label" required maxLength={120} defaultValue={file.name} />
      </label>
      <label>
        Allow link holders to
        <select name="mode">
          <option value="view">View and download</option>
          <option value="review">View, download and comment</option>
          <option value="sign">Sign and return a copy</option>
        </select>
      </label>
      <label>
        Expires in
        <select name="days" defaultValue={defaultDays}>
          {[...new Set([1, 3, 7, 14, 30, defaultDays])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'day' : 'days'}
              </option>
            ))}
        </select>
      </label>
      <label>
        Link password (optional)
        <input
          name="password"
          type="password"
          minLength={10}
          maxLength={128}
          autoComplete="new-password"
        />
      </label>
      <p>
        Signature requests collect a visual signature and a completion record. They do not verify
        identity or create a certificate-based digital signature.
      </p>
      <div className="cloud-actions">
        <button className="button" disabled={busy}>
          Create share link
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
export function CommentForm({
  busy,
  guest = false,
  onSubmit,
}: {
  busy: boolean;
  guest?: boolean;
  onSubmit: (value: Record<string, unknown>) => void;
}) {
  return (
    <form
      className="cloud-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(event.currentTarget));
        onSubmit({ ...data, page: data.page ? Number(data.page) : null });
      }}
    >
      {guest && (
        <label>
          Your name
          <input name="name" required maxLength={80} />
        </label>
      )}
      <label>
        Comment
        <textarea name="text" required maxLength={2000} rows={3} />
      </label>
      <label>
        Page (optional)
        <input name="page" type="number" min={1} max={1000} />
      </label>
      <button className="button secondary" disabled={busy}>
        Post comment
      </button>
    </form>
  );
}
function Preferences({
  initial,
  busy,
  onSave,
}: {
  initial: CloudPreferences;
  busy: boolean;
  onSave: (value: CloudPreferences) => void;
}) {
  return (
    <form
      className="cloud-panel cloud-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        onSave({
          defaultTool: form.get('defaultTool') as CloudPreferences['defaultTool'],
          defaultExpiryDays: Number(form.get('defaultExpiryDays')),
        });
      }}
    >
      <h2>Your account preferences</h2>
      <p>
        These choices sync across devices. Saved signatures and local PDFs never sync automatically.
      </p>
      <label>
        Open cloud copies with
        <select name="defaultTool" defaultValue={initial.defaultTool}>
          {['edit', 'sign', 'merge', 'compress'].map((tool) => (
            <option key={tool} value={tool}>
              {tool}
            </option>
          ))}
        </select>
      </label>
      <label>
        Default link expiry (days)
        <input
          type="number"
          name="defaultExpiryDays"
          min={1}
          max={30}
          defaultValue={initial.defaultExpiryDays}
          required
        />
      </label>
      <button className="button" disabled={busy}>
        Save preferences
      </button>
    </form>
  );
}
function TokenForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (value: Record<string, unknown>) => void;
}) {
  return (
    <form
      className="cloud-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(Object.fromEntries(new FormData(event.currentTarget)));
      }}
    >
      <label>
        Token label
        <input name="label" required maxLength={80} placeholder="My integration" />
      </label>
      <label>
        Permission
        <select name="scope">
          <option value="read">Read only</option>
          <option value="write">Read and write</option>
        </select>
      </label>
      <button className="button secondary" disabled={busy}>
        Create API token
      </button>
    </form>
  );
}
