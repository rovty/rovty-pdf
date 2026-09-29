# Rovty PDF cloud workspace

Editing remains browser-based. Cloud features are opt-in and require private storage and the dashboard identity integration. No automatic upload occurs when selecting a local PDF, signing in, or editing. Features remain free to users for now.

## Implemented

- Rovty account connection with explicit consent, a browser-bound handoff, a single-use nonce and an HttpOnly session cookie. The dashboard checks current central-session validity on every account/API request. PDF is free and does not query paid entitlements.
- Private PDF storage, downloads, deletion, and reusable PDF templates. Opening a cloud file creates a local copy. Saving a result creates a new cloud file; the original is not overwritten.
- Preferences for the default tool and share expiry, synchronized to the account. Local signature libraries never sync automatically.
- View/download, review, and signature-request links with random secrets, optional PBKDF2 passwords, expiration and immediate revocation.
- Comments with optional page numbers and owner resolution/deletion. Comments are visible to review link holders. Names provided by guests are unverified; content is rendered as text.
- Signature requests return one signed PDF and a completion record with the name, consent, time and SHA-256 hashes of both versions. This does not verify identity, certify document integrity, or prove that only a signature changed. It is not certificate signing or a qualified electronic-signature service. Users copy and send links themselves; Rovty does not send email automatically.
- Server-side document API with read-only or read/write tokens, explicit expiry, revocation, ownership checks and no-store responses. See `/developers` in the app. PDF processing is still performed locally, not by this API.

OCR and Word/Excel conversion are not supplied by Workers automatically and are not part of this release. No external paid processing provider is integrated.

## Architecture and activation

`worker/index.ts` serves `/api/*`; Workers assets serve `dist`. `PdfCloud` is a SQLite Durable Object, with one isolated object per user and separate short-lived session objects. Metadata and sessions use Durable Object storage. Document bytes use private R2 keys containing an opaque account-object ID plus a random file UUID. The R2 bucket has no public URL, and the browser never receives an R2 credential.

The default deployment deliberately omits the `FILES` bucket binding, allowing the existing private tools to deploy without enabling a billable service. Follow the README to create the bucket, commit the uncommented binding, install the matching `PDF_WORKER_SECRET` on both Workers, deploy the dashboard and then deploy PDF. `/api/status` reports availability without returning secrets. It verifies local configuration, not the health of the dashboard authentication service.

The dashboard must already have `0002_sso_nonces.sql`, the platform identity migrations and its existing Supabase/SSO secrets. The PDF credential is independent of Wed, billing and Assist credentials. Never reuse a privileged Supabase service key as `PDF_WORKER_SECRET`.

## Limits and operating costs

Per account: 100 MiB total, 50 PDFs, 20 MiB per PDF, 20 templates, 50 links, 200 comments, 5 API tokens. Links last 1–30 days; tokens last 30 days and depend on the creating Rovty session. Account cookies last 7 days, subject to central revocation. The Worker applies 60 cloud requests per minute per client IP. These limits are declared in `shared/cloud.ts` and enforced server-side.

These quotas limit individual accounts, not total expenditure. Cloudflare free allowances and Supabase usage limits still apply. Monitor total R2 bytes/operations, Durable Object requests/storage and dashboard requests before a broad launch. There is no paid OCR/Office conversion service. Public links and signature requests can consume the owner's quota; when the account is full, the signer sees a clear error and keeps their downloaded copy.

Cloud account operations serialize within their Durable Object, including file quotas, link checks and single-completion signature requests. Processing local PDFs incurs no backend document-processing workload. There is no background polling; users refresh cloud reviews when needed.

## Privacy and retention

Local editing sends no document bytes to the server. A cloud upload contains the chosen PDF (including any signature already placed in it), its name and its size. Cloud storage is private by default but is not end-to-end encrypted. Only explicit share links allow guest access. Link secrets live in URL fragments and are transmitted in POST bodies/headers, not query strings; pages use `Referrer-Policy: no-referrer` and noindex.

Deleting a file removes its metadata, comments, links and collected signed copies. Deleting all cloud data also revokes tokens and removes preferences. Access disappears when metadata is removed. A durable deletion queue retries R2 cleanup after outages; Cloudflare operational recovery/backups are outside the application's immediate deletion guarantee. Expired links stop working immediately; old share metadata is pruned by an alarm. Completed signing records are pruned 30 days after link expiry unless the owner deletes them earlier. Saved PDFs remain until deleted, including returned signed copies.

Only public app assets enter the optional offline cache. `/api/*`, `/cloud` and `/shared` bypass it. Session cookies, PDF responses, account lists, signatures, share passwords and tokens are never cached there. No third-party analytics or automatic emails are added. Worker observability is disabled to avoid logging sensitive request URLs; do not add body/token logging during operations.

## Release verification

Run `npm run check`, `npm run test:worker` and `npx wrangler deploy --dry-run`. Dashboard tests cover PDF handoff binding, nonce replay, central-session revocation and separation from Wed credentials. Cloud tests exercise real local Durable Objects and R2 for tenant isolation, CSRF, invalid uploads, password links, permissions, signing consent/replay, API scope and cleanup. Browser tests cover local tools, font matching, offline behavior and cloud workflows.

After production setup, use a non-sensitive PDF to verify login, upload, cross-device reopening, a password review link in a separate browser, revocation, signing return, API token revocation, logout and deletion. Application readiness is not a claim of legal e-signature certification or a security audit.
