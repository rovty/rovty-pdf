import {
  CLOUD_LIMITS,
  SIGNING_CONSENT,
  type CloudFile,
  type CloudShare,
  type CloudComment,
  type CloudToken,
  type CloudPreferences,
} from '../shared/cloud';
import {
  body,
  equal,
  fail,
  HttpError,
  json,
  passwordHash,
  pdf,
  random,
  sha256,
  text,
} from './http';
import type { Env, Identity } from './env';

interface Share extends CloudShare {
  hash: string;
  salt: string;
  passwordHash: string;
}
interface Token extends CloudToken {
  hash: string;
  identity: Identity;
}
interface Vault {
  files: CloudFile[];
  shares: Share[];
  comments: CloudComment[];
  tokens: Token[];
  preferences: CloudPreferences;
}
const fresh = (): Vault => ({
  files: [],
  shares: [],
  comments: [],
  tokens: [],
  preferences: { defaultTool: 'edit', defaultExpiryDays: 7 },
});
const safeShare = ({
  hash: _hash,
  salt: _salt,
  passwordHash: _passwordHash,
  ...share
}: Share): CloudShare => share;
const safeToken = ({ hash: _hash, identity: _identity, ...token }: Token): CloudToken => token;
const DAY = 86400000;

// One SQLite-backed Durable Object per account. Tokens and sessions never enter
// the public asset cache. All mutations are serialized, including quota checks.
export class PdfCloud {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        return await this.handle(request);
      } catch (error) {
        return json(
          {
            error:
              error instanceof HttpError
                ? error.message
                : 'Cloud storage is temporarily unavailable. Please retry.',
          },
          error instanceof HttpError ? error.status : 503,
        );
      }
    });
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      const session = await this.ctx.storage.get<Identity>('session');
      if (session) {
        await this.ctx.storage.deleteAll();
        return;
      }
      const vault = await this.ctx.storage.get<Vault>('vault');
      if (!vault) return;
      // Metadata/access is removed first. A durable deletion queue survives an
      // R2 outage and is retried, including after a "delete cloud data" request.
      await this.cleanup();
      const now = Date.now();
      vault.shares = vault.shares.filter(
        (s) => s.expires > now || (s.receipt && s.expires > now - 30 * DAY),
      );
      vault.tokens = vault.tokens.filter((t) => t.expires > now);
      await this.save(vault);
    });
  }
  private key(id: string) {
    return `${this.ctx.id.toString()}/${id}.pdf`;
  }
  private async cleanup() {
    const pending = (await this.ctx.storage.get<string[]>('deletions')) || [];
    if (pending.length && this.env.FILES) {
      const vault = await this.ctx.storage.get<Vault>('vault');
      const live = new Set(vault?.files.map((f) => this.key(f.id)) || []);
      try {
        await this.env.FILES.delete(pending.filter((key) => !live.has(key)));
        await this.ctx.storage.delete('deletions');
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 60000);
      }
    }
  }
  private async queueDelete(ids: string[]) {
    const pending = (await this.ctx.storage.get<string[]>('deletions')) || [];
    await this.ctx.storage.put('deletions', [
      ...new Set([...pending, ...ids.map((id) => this.key(id))]),
    ]);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
  private async save(vault: Vault) {
    await this.ctx.storage.put('vault', vault);
    const pending = await this.ctx.storage.get<string[]>('deletions');
    if (pending?.length || vault.shares.length || vault.tokens.length)
      await this.ctx.storage.setAlarm(Date.now() + (pending?.length ? 60000 : DAY));
    else await this.ctx.storage.deleteAlarm();
  }
  private async storeFile(
    vault: Vault,
    request: Request,
    template = false,
    beforeSave?: (file: CloudFile) => void,
  ): Promise<CloudFile> {
    if (!this.env.FILES) fail(503, 'Cloud storage is not configured.');
    if (vault.files.length >= CLOUD_LIMITS.files)
      fail(409, 'Your cloud file limit is reached. Delete a file first.');
    if (template && vault.files.filter((f) => f.template).length >= CLOUD_LIMITS.templates)
      fail(409, 'Your template limit is reached.');
    const data = await pdf(request, CLOUD_LIMITS.fileBytes);
    if (vault.files.reduce((sum, f) => sum + f.bytes, 0) + data.length > CLOUD_LIMITS.accountBytes)
      fail(409, 'Your cloud storage is full. Delete a file first.');
    let name = 'document.pdf';
    try {
      name =
        text(decodeURIComponent(request.headers.get('x-file-name') || name), 180).replace(
          /[\\/]/g,
          '-',
        ) || name;
    } catch {
      fail(400, 'Invalid file name.');
    }
    const file: CloudFile = {
      id: crypto.randomUUID(),
      name,
      bytes: data.length,
      sha256: await sha256(data),
      created: Date.now(),
      template,
    };
    // Queue the object before writing it so an interrupted request cannot leave
    // an untracked PDF behind. Remove from queue only after metadata is saved.
    await this.queueDelete([file.id]);
    await this.env.FILES.put(this.key(file.id), data, {
      httpMetadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' },
    });
    vault.files.push(file);
    beforeSave?.(file);
    await this.save(vault);
    const pending = (await this.ctx.storage.get<string[]>('deletions')) || [];
    await this.ctx.storage.put(
      'deletions',
      pending.filter((key) => key !== this.key(file.id)),
    );
    return file;
  }
  private async download(file: CloudFile) {
    const object = await this.env.FILES?.get(this.key(file.id));
    if (!object) fail(404, 'This file is no longer available.');
    return new Response(object.body, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(object.size),
        'Content-Disposition': `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  private async handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    // These internal session endpoints are addressed by the entry Worker only.
    if (path === '/internal/session') {
      if (request.method === 'PUT') {
        const identity = (await request.json()) as Identity;
        await this.ctx.storage.put('session', identity);
        await this.ctx.storage.setAlarm(identity.expires);
        return json({ ok: true });
      }
      if (request.method === 'DELETE') {
        await this.ctx.storage.deleteAll();
        return json({ ok: true });
      }
      const identity = await this.ctx.storage.get<Identity>('session');
      return identity && identity.expires > Date.now()
        ? json(identity)
        : json({ error: 'Sign in to your Rovty account.' }, 401);
    }
    const vault = (await this.ctx.storage.get<Vault>('vault')) || fresh();
    if (path === '/internal/token') {
      const hash = await sha256(request.headers.get('x-api-token') || '');
      const token = vault.tokens.find((t) => equal(t.hash, hash) && t.expires > Date.now());
      return token
        ? json({ identity: token.identity, scope: token.scope })
        : json({ error: 'Invalid or expired API token.' }, 401);
    }
    if (path.startsWith('/public/')) return this.public(request, vault, path.slice(8));
    if (path === '/workspace' && request.method === 'GET')
      return json({
        ...vault,
        shares: vault.shares.map(safeShare),
        tokens: vault.tokens.map(safeToken),
        usedBytes: vault.files.reduce((sum, f) => sum + f.bytes, 0),
        limits: CLOUD_LIMITS,
      });
    if (path === '/files' && request.method === 'POST') {
      const file = await this.storeFile(
        vault,
        request,
        request.headers.get('x-template') === 'true',
      );
      return json(file, 201);
    }
    const fileMatch = path.match(/^\/files\/([a-f0-9-]{36})$/);
    if (fileMatch) {
      const file = vault.files.find((f) => f.id === fileMatch[1]);
      if (!file) fail(404, 'File not found.');
      if (request.method === 'GET') return this.download(file);
      if (request.method === 'PATCH') {
        const data = await body(request);
        if (data.name !== undefined)
          file.name = text(data.name, 180).replace(/[\\/]/g, '-') || 'document.pdf';
        if (typeof data.template === 'boolean') {
          if (
            data.template &&
            !file.template &&
            vault.files.filter((f) => f.template).length >= CLOUD_LIMITS.templates
          )
            fail(409, 'Your template limit is reached.');
          file.template = data.template;
        }
        await this.save(vault);
        return json(file);
      }
      if (request.method === 'DELETE') {
        const related = vault.shares.filter((s) => s.fileId === file.id);
        const ids = [
          file.id,
          ...related.flatMap((s) => (s.receipt ? [s.receipt.signedFileId] : [])),
        ];
        await this.queueDelete(ids);
        vault.files = vault.files.filter((f) => !ids.includes(f.id));
        vault.shares = vault.shares.filter(
          (s) => !ids.includes(s.fileId) && !ids.includes(s.receipt?.signedFileId || ''),
        );
        vault.comments = vault.comments.filter((c) => !ids.includes(c.fileId));
        await this.save(vault);
        await this.cleanup();
        return json({ ok: true });
      }
    }
    if (path === '/shares' && request.method === 'POST') {
      const data = await body(request);
      if (!vault.files.some((f) => f.id === data.fileId)) fail(404, 'File not found.');
      vault.shares = vault.shares.filter((s) => s.expires > Date.now() || s.receipt);
      if (vault.shares.length >= CLOUD_LIMITS.shares)
        fail(409, 'Your share limit is reached. Delete an old link first.');
      if (!['view', 'review', 'sign'].includes(String(data.mode))) fail(400, 'Choose a link type.');
      const days = Number(data.days);
      if (!Number.isInteger(days) || days < 1 || days > CLOUD_LIMITS.expiryDays)
        fail(400, 'Choose an expiry from 1 to 30 days.');
      const password = data.password === undefined ? '' : data.password;
      if (typeof password !== 'string' || password.length > 128)
        fail(400, 'Invalid link password.');
      if (password && password.length < 10)
        fail(400, 'Use a share password of at least 10 characters.');
      const token = random(),
        salt = random();
      const share: Share = {
        id: crypto.randomUUID(),
        fileId: String(data.fileId),
        label: text(data.label, 120, 'Shared document'),
        mode: data.mode as Share['mode'],
        created: Date.now(),
        expires: Date.now() + days * DAY,
        revoked: false,
        opens: 0,
        hash: await sha256(token),
        salt,
        passwordHash: password ? await passwordHash(password, salt) : '',
        passwordProtected: Boolean(password),
      };
      vault.shares.push(share);
      await this.save(vault);
      return json({ share: safeShare(share), vault: this.ctx.id.toString(), token }, 201);
    }
    const shareMatch = path.match(/^\/shares\/([a-f0-9-]{36})$/);
    if (shareMatch && ['DELETE', 'PATCH'].includes(request.method)) {
      const share = vault.shares.find((s) => s.id === shareMatch[1]);
      if (!share) fail(404, 'Link not found.');
      if (request.method === 'PATCH') share.revoked = true;
      else vault.shares = vault.shares.filter((s) => s.id !== share.id);
      await this.save(vault);
      return json({ ok: true });
    }
    if (path === '/comments' && request.method === 'POST') {
      const data = await body(request);
      if (!vault.files.some((f) => f.id === data.fileId)) fail(404, 'File not found.');
      const comment = this.comment(vault, String(data.fileId), data, true, 'Document owner');
      await this.save(vault);
      return json(comment, 201);
    }
    const commentMatch = path.match(/^\/comments\/([a-f0-9-]{36})$/);
    if (commentMatch && ['PATCH', 'DELETE'].includes(request.method)) {
      const comment = vault.comments.find((c) => c.id === commentMatch[1]);
      if (!comment) fail(404, 'Comment not found.');
      if (request.method === 'DELETE')
        vault.comments = vault.comments.filter((c) => c.id !== comment.id);
      else {
        const data = await body(request);
        comment.resolved = data.resolved === true;
      }
      await this.save(vault);
      return json({ ok: true });
    }
    if (path === '/preferences' && request.method === 'PUT') {
      const data = await body(request),
        days = Number(data.defaultExpiryDays);
      if (
        !['edit', 'sign', 'merge', 'compress'].includes(String(data.defaultTool)) ||
        !Number.isInteger(days) ||
        days < 1 ||
        days > 30
      )
        fail(400, 'Invalid preferences.');
      vault.preferences = {
        defaultTool: data.defaultTool as CloudPreferences['defaultTool'],
        defaultExpiryDays: days,
      };
      await this.save(vault);
      return json(vault.preferences);
    }
    if (path === '/tokens' && request.method === 'POST') {
      vault.tokens = vault.tokens.filter((t) => t.expires > Date.now());
      if (vault.tokens.length >= CLOUD_LIMITS.tokens)
        fail(409, 'Revoke an API token before creating another.');
      const data = await body(request),
        raw = random();
      if (!['read', 'write'].includes(String(data.scope))) fail(400, 'Choose an API permission.');
      const identity = JSON.parse(request.headers.get('x-identity') || '{}') as Identity;
      const token: Token = {
        id: crypto.randomUUID(),
        label: text(data.label, 80, 'Integration'),
        scope: data.scope as Token['scope'],
        created: Date.now(),
        expires: Date.now() + 30 * DAY,
        hash: await sha256(raw),
        identity,
      };
      vault.tokens.push(token);
      await this.save(vault);
      return json({ token: `${this.ctx.id.toString()}.${raw}`, details: safeToken(token) }, 201);
    }
    const tokenMatch = path.match(/^\/tokens\/([a-f0-9-]{36})$/);
    if (tokenMatch && request.method === 'DELETE') {
      vault.tokens = vault.tokens.filter((t) => t.id !== tokenMatch[1]);
      await this.save(vault);
      return json({ ok: true });
    }
    if (path === '/workspace' && request.method === 'DELETE') {
      await this.queueDelete(vault.files.map((f) => f.id));
      await this.save(fresh());
      await this.cleanup();
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  }
  private comment(
    vault: Vault,
    fileId: string,
    data: Record<string, unknown>,
    owner: boolean,
    author: string,
  ) {
    if (vault.comments.length >= CLOUD_LIMITS.comments) fail(409, 'The comment limit is reached.');
    const message = text(data.text, 2000);
    if (!message) fail(400, 'Write a comment.');
    const page = data.page == null ? null : Number(data.page);
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 1000))
      fail(400, 'Invalid page number.');
    const comment: CloudComment = {
      id: crypto.randomUUID(),
      fileId,
      author,
      text: message,
      page,
      owner,
      resolved: false,
      created: Date.now(),
    };
    vault.comments.push(comment);
    return comment;
  }
  private async public(request: Request, vault: Vault, action: string) {
    const token = request.headers.get('x-share-token') || '',
      password = decodeURIComponent(request.headers.get('x-share-password') || '');
    const hash = await sha256(token),
      now = Date.now();
    const share = vault.shares.find((s) => equal(s.hash, hash) && !s.revoked && s.expires > now);
    if (!share) fail(404, 'This link has expired, was revoked, or is not valid.');
    if (share.passwordHash && !equal(share.passwordHash, await passwordHash(password, share.salt)))
      fail(401, 'Enter the correct link password.');
    const file = vault.files.find((f) => f.id === share.fileId);
    if (!file) fail(404, 'This file is no longer available.');
    if (action === 'open') {
      share.opens += 1;
      await this.save(vault);
      return json({
        file,
        share: safeShare(share),
        comments: share.mode === 'review' ? vault.comments.filter((c) => c.fileId === file.id) : [],
      });
    }
    if (action === 'download') return this.download(file);
    if (action === 'comment' && share.mode === 'review') {
      const data = await body(request),
        name = text(data.name, 80);
      if (!name) fail(400, 'Enter your name.');
      const comment = this.comment(vault, file.id, data, false, name);
      await this.save(vault);
      return json(comment, 201);
    }
    if (action === 'sign' && share.mode === 'sign') {
      if (share.receipt) fail(409, 'This signature request is already completed.');
      let name = '';
      try {
        name = text(decodeURIComponent(request.headers.get('x-signer-name') || ''), 80);
      } catch {
        fail(400, 'Enter your name.');
      }
      if (!name || request.headers.get('x-signing-consent') !== 'accepted')
        fail(400, 'Enter your name and accept electronic signing.');
      await this.storeFile(vault, request, false, (signed) => {
        share.receipt = {
          name,
          consent: SIGNING_CONSENT,
          completed: Date.now(),
          originalSha256: file.sha256,
          signedSha256: signed.sha256,
          signedFileId: signed.id,
        };
      });
      return json({ receipt: share.receipt }, 201);
    }
    fail(403, 'This link does not allow that action.');
  }
}
