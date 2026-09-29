# Rovty PDF

A free PDF toolkit for **pdf.rovty.com**, built as a separate application for **Cloudflare Workers**. React + TypeScript + Vite. Editing runs in the browser; optional cloud storage, templates, reviews, signature requests and a document API use a private R2 bucket, SQLite Durable Objects and the existing Rovty account service. No paid processing service is used.

The interface uses Rovty branding and original assets. Sejda is a functional reference, not a copied product. This toolkit does **not provide complete Sejda feature parity**: OCR, Office-file conversion, digital certificates and advanced desktop PDF authoring are not included.

## Run locally

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5180**. Each PDF tool includes a locally generated sample document, so the editor can be explored without a personal file.

Use **Node.js 22.13+**, preferably the latest Node 22 LTS. `npm ci` copies the PDF engines, CMaps and standard fonts into `public/`. These assets are included in the production build and are served from the same origin.

## Included tools

| Category    | Tools                                                                        |
| ----------- | ---------------------------------------------------------------------------- |
| Edit & sign | Edit PDF, Sign PDF, Fill forms, Watermark, Page numbers, Crop, Flatten forms |
| Organize    | Merge, Split, Organize, Extract, Delete, Rotate, Repair                      |
| Convert     | Compress, Images to PDF, PDF to images, PDF to text, Grayscale               |
| Secure      | Password protection, Unlock with a known password, Redact, Metadata          |

The editor supports existing text lines, new text, images, typed/drawn/uploaded signatures, highlighting, strikethrough, underlining, freehand drawing, filled or outlined shapes, links, visual white covers, and redactions. Additions can be moved and resized, with undo/redo and keyboard movement.

- **Edit on the page:** click a line with Edit text and type directly on the PDF. New text is placed only after choosing Add text. Select highlights existing lines on hover and lets them be dragged with their original font; the moving text is rendered separately from the page background. Each drag is one undoable change, and arrow keys provide precise movement. The page preview uses the actual exported PDF fonts, with cursor/selection geometry taken from its character positions. Formatting controls stay above the canvas without a separate text-entry panel. Enter or Escape finishes editing; Shift+Enter adds a line to new text. Added or explicitly replaced text supports Noto Sans, serif and monospace, bold, italic, underline, strikethrough, size and color. Original PDF font styling is preserved until a replacement is explicitly chosen.
- **Canvas workspace:** opening a document collapses the product navigation and fits the page to the available width. The menu can be reopened from the header. Canvas controls offer fit width, fit page and 25–400% zoom; manual zoom keeps the viewport center in place. Fit modes adapt to the window, navigation and page dimensions. Ctrl/Command plus, minus and zero also work when the canvas has keyboard focus. Zoom changes only the view, never the exported document.
- **Highlight modes:** Text highlights only the selected words or characters, including selections across lines. Mouse selections apply on release; touch selections can be confirmed with Apply highlight. Freehand draws a translucent stroke with adjustable color and brush width. Both modes remain active for repeated highlights, support undo/redo, and preserve the document text in the exported PDF.
- **Find & replace:** search literal text across all pages, optionally match case, jump to results, and replace the first or every match in one undoable change. Original-font glyph validation runs before committing replacements. Search excludes scanned image content and does not upload text.
- **Forms:** fill existing widgets directly on the page or in the form panel. Create text, multiline text, dropdown, checkbox and radio fields with names/defaults. Related radio choices share a field name and have distinct choice values. Downloaded fields remain interactive unless flattening or redaction is selected.
- **Links:** select existing links with Link to edit or delete them; draw new link areas to web/email addresses or document pages. Unsupported named destinations are retained when unchanged. The editor never follows a link automatically.
- **Start blank:** create an A4 PDF without uploading a file. Typed signatures use two locally bundled handwriting fonts and become transparent images; storing them on the device remains optional.

This implements the main documented Sejda-style editing workflow with original Rovty UI. Third-party drive imports, automatic paragraph reflow, arbitrary embedded-image replacement and complete Sejda parity are not included. The Sejda online page describes server uploads; Rovty's local editing does not upload files.

**Edit text selects related text on one line.** Nearby letters and words with matching fonts and formatting are grouped even when the PDF stores them as separate objects. Lines above and below, distant columns, and formatting changes remain separate. Unchanged lines retain their original fragments and spacing; editing a grouped line replaces all of its original fragments using the original font. Longer text may need more room. Nested and angled text keeps its existing individual selection and font-safety checks.

In **Signature → Upload image**, choose a PNG, JPG or WebP image (up to 15 MB / 25 megapixels). Background removal starts automatically for opaque images. Adjust the removal strength, check the transparent preview, then use the signature. Existing transparent images are preserved by default. Empty edges are trimmed, and the PDF keeps the signature’s transparency. Removal works best with dark ink on plain, evenly lit paper; textured backgrounds and heavy shadows may need a clearer photo. All processing happens locally, without an AI service or image upload.

### Important behavior

- **Existing-text edits reuse the original PDF font.** PDFium changes the actual text object, retaining its font reference (including embedded fonts), weight/style, baseline, transformation and size. The preview renders the same edited PDF used for export. Font names and embedded status appear in **Text font**. No document or font is uploaded for detection.
- **Missing font characters never trigger a silent substitution.** Subset fonts and unusual encodings may not support new letters. The editor checks glyphs and text readback, then shows an error if the requested text cannot use the original font. Nested Form XObject text also requires explicit replacement because this PDF engine cannot safely save its font-preserving edits. The user can keep supported characters or explicitly choose Noto Sans for that block. Original-font edits use one line per text object; longer text may need repositioning and custom kerning can change. Add text and the explicit Noto option support multiple lines in Latin, Greek and Cyrillic. Scanned pages and outlined text are not editable text objects.
- **Redaction burns changes into newly generated page images.** The output contains no original text layer, forms, links, attachments or metadata. This prevents recovery of content behind redaction marks but also flattens the document. A visual **Cover** is different and is clearly labeled as non-secure.
- **Compression and grayscale rasterize pages.** Text selection, links and interactive forms are lost. If compression would increase the size, the original file is returned with an explanation.
- **Merge, split, page organization, extraction and deletion flatten interactive form fields** to preserve their visible values while combining pages. Page ordering and rotations are preserved in the output.
- **Flatten PDF flattens form fields**, not every possible annotation or layer.
- **Signatures are visual**, not certificate-based digital signatures. Editing a previously digitally signed PDF changes its signed bytes.
- **PDF to text requires selectable text.** OCR and PDF-to-Word/Excel conversions are not advertised as working features.
- **Crop changes the visible page boundary.** It does not securely erase outside content. Metadata removes standard document information and XMP, not embedded attachments or all possible identifying content.
- **Repair rewrites PDFs the engine can parse.** It cannot reconstruct missing bytes or guarantee recovery of severely corrupt files.

## Cloudflare Workers

Connect the PDF Git repository to a **Worker** named `rovty-pdf`. The app now includes `worker/index.ts`, a Workers assets configuration and a Durable Object migration. Use **Workers**, not Pages, for this version.

| Setting                  | Value                                                        |
| ------------------------ | ------------------------------------------------------------ |
| Build command            | Leave blank; Wrangler runs `npm run build` automatically     |
| Static assets            | `dist` (already set in `wrangler.toml`)                      |
| Root directory           | Repository root, or `rovty-pdf` if using a parent repository |
| Environment variable     | `NODE_VERSION=22`                                            |
| Deploy command           | `npx wrangler deploy`                                        |
| Cloud storage / identity | Optional; activate using the steps below                     |

Alternatively, after authenticating Wrangler:

```sh
npm run deploy
```

`npm run deploy` runs the unit tests, then Wrangler runs the production build before publishing. The `[build]` command in `wrangler.toml` also builds the app when calling `npx wrangler deploy` directly, so a fresh checkout does not need an existing `dist` folder. **No deployment is performed merely by building.** The build explicitly copies the bundled PDF engines, fonts and license files; it does not rely on the root `postinstall` script being allowed during dependency installation.

If Cloudflare reports that `/opt/buildhome/repo/dist` does not exist, push the latest `wrangler.toml` and retry. For an older checkout without the `[build]` command, use `npm run build` as Cloudflare's build command and `npx wrangler deploy` as its deploy command. Keep the root directory set to the folder containing `package.json` and `wrangler.toml`; do not commit `dist` or switch to a Pages deploy command.

### Activate the optional cloud workspace

The default configuration deploys the private editor immediately. Cloud workspace displays an honest unavailable state until **both** the `FILES` binding and `PDF_WORKER_SECRET` are configured. No PDFs are uploaded in that state.

1. In the correct Cloudflare account, enable R2 and create a private bucket: `npx wrangler r2 bucket create rovty-pdf-documents`. Keep public access disabled.
2. Uncomment the `[[r2_buckets]]`, `binding = "FILES"` and `bucket_name` lines in `wrangler.toml` and commit that configuration. A dashboard-only binding can be removed by a later Wrangler deployment, so keep it in the repository.
3. Generate one long random secret in your password manager. Set **the same** `PDF_WORKER_SECRET` on `rovty-pdf` and `rovty-dashboard`, using each Worker's Settings → Variables and Secrets or `npx wrangler secret put PDF_WORKER_SECRET` from each project directory. Never put it in a `VITE_*` variable or Git.
4. Deploy the dashboard changes in this workspace first. Its `PDF_ORIGIN` must be `https://pdf.rovty.com`. PDF's `DASHBOARD_ORIGIN` must be `https://dash.rovty.com`. Existing dashboard identity migrations and secrets are required; no paid PDF entitlement is required.
5. Deploy PDF. Wrangler creates the SQLite Durable Object namespace using the included `v1` migration. Open `/cloud`, sign in with Rovty, and test with a non-sensitive sample PDF.

To build and publish PDF directly with Wrangler:

```sh
npx wrangler deploy
```

The CI identity needs Workers deployment, Durable Object and (once enabled) R2 binding permissions. The earlier missing Pages-project error is resolved by deploying this version with `wrangler deploy`. The `allow-scripts` messages are separate install warnings; review the affected package only if a required binary fails to install.

In the Worker’s **Settings → Domains & Routes**, add **pdf.rovty.com** as a custom domain. If the domain is already attached to a Pages project, move that attachment to the Worker during rollout. Do not delete the working deployment before the new Worker is validated.

The build prerenders tool, privacy and API-guide pages with readable HTML, metadata and structured data. Cloud and shared-document shells are noindex, and unknown URLs return `404.html`. Workers assets serve `edit.html` at `/edit`; no SPA wildcard or explicit `.html` rewrite is needed. `public/_headers` supplies the CSP and other static headers. API and download responses set their own no-store/security headers. The build rejects any asset over Workers' 25 MiB limit.

See [cloud workspace operations](docs/cloud-workspace.md) for limits, retention, security boundaries and API examples. Cloudflare free allowances can cover small usage, but R2, Durable Objects and account-service traffic can incur charges as usage grows. Per-account quotas and rate limits reduce usage; they are not a global billing cap.

`scripts/build-offline.mjs` generates a versioned service worker from the built app assets. The worker is registered only after the user enables offline tools; updates activate when older tabs close, without reloading an open PDF.

## Privacy and limits

- Local documents and document passwords remain in browser memory unless the user explicitly uploads an exported document. Signing in alone never uploads documents or signatures.
- Opt-in signatures are stored as finished PNG Blobs in IndexedDB (`rovty-pdf-local`), with a name, dimensions and timestamp. Original uploads are not saved. Identical images are deduplicated; the library allows 20 signatures, up to 2 MiB each. Anyone using the same browser profile can reuse them. They do not sync to accounts or other devices, and browser/private-mode storage may be cleared or evicted.
- Delete individual signatures in **Signature → Saved signatures**, or delete the library in **Privacy & help**. When storage is unavailable, signing still works with saving turned off.
- **Enable offline tools** optionally caches only the app, fonts and PDF engines in Cache Storage. No PDFs, passwords or signatures are included. The only localStorage value is the offline-enabled preference. **Clear offline cache** removes the app worker and cache without deleting signatures.
- No analytics or advertising code is used. Local tools use no account cookies. Optional cloud authentication uses secure, HttpOnly, SameSite cookies containing an opaque session key. The email is returned to display the signed-in account; identity records and central session identifiers are stored server-side.
- Local tools load same-origin app assets. Explicit cloud actions call same-origin APIs; the PDF Worker verifies account sessions with the dashboard server-to-server.
- Reloading, closing the tab or switching tools discards the loaded document. Download to retain the result. Closing this tab does not delete files already downloaded to the device.
- Cloudflare can receive ordinary asset request metadata such as IP addresses; the privacy page distinguishes this from document processing.
- Browser safety limits: 80 MB per PDF, 160 MB total, 50 input files, 1,000 pages, up to 100 image exports or 200 split files per run. These are memory safeguards, not paid quotas.
- More complex documents can require substantial memory. Use smaller page ranges if a device cannot process a large document.

## Validation

```sh
npm test
npm run build
npm run test:browser
npm run test:production
npm run test:worker
```

`test:worker` runs the browser suite against the actual Workers emulator, including offline use with Cloudflare's clean-URL handling. `npm test` also runs real local Durable Object/R2 integration tests. Check all public SEO URLs with:

```sh
npx wrangler dev --port 8792
# In another terminal:
node scripts/check-pages.mjs http://127.0.0.1:8792
```

Browser checks use installed Google Chrome and Poppler (`pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`). They cover native text removal, annotations, forms, signatures, page ordering, encryption/decryption, irreversible raster redaction, each utility’s download, bad files and responsive layouts. Screenshots and test outputs go into ignored `tmp/qa/`.

`test:production` serves the existing `dist` build on port 5181 with the exact headers from `_headers`. Run `npm run build` first. Coverage also includes mobile editing, placement on rotated/cropped pages, password clearing, same-origin-only requests, uploaded signature transparency, persistence across reloads, optional storage failures, offline exports and clearing storage. SEO checks load public pages without JavaScript to verify readable HTML and structured data. An `undici` override keeps Wrangler’s development dependency above the patched version.

## Rovty integration

Product details are in `public/product.json`. The dashboard has a separate **free external app** card linking directly to `https://pdf.rovty.com/`, including when paid access is unavailable. PDF stays outside paid entitlements and checkout. Optional cloud account connection uses a dedicated `/api/pdf-auth/*` flow; local tools require no account. Marketing links and a product page are included in `rovty.com`, at `/products/pdf`, on the homepage, products page, pricing page and footer. Both projects support an optional `VITE_ROVTY_PDF_ORIGIN` override for local navigation.

This app still builds and deploys independently of the dashboard, marketing site and Wed. All PDF tools are free for everyone for now; the copy does not promise permanent pricing.

## Search visibility

The sitemap at `https://pdf.rovty.com/sitemap.xml` lists the public tool pages. SEO descriptions focus on the PDF toolkit; saved signatures are documented as a feature and in privacy controls. See [the workspace SEO rollout notes](../SEO.md) for all Rovty product sitemap URLs and Google Search Console steps after deployment.

## Source map

- `src/components/Home.tsx`: tool library and search.
- `src/components/Workspace.tsx`: uploads, processing, options and downloads.
- `src/components/Editor.tsx`: visual editing, native text selection, forms, signatures and history.
- `src/components/SignatureDialog.tsx`: drawing, uploads, transparent previews and the saved library.
- `src/components/DeviceSettings.tsx`: signature deletion and offline controls.
- `src/lib/signatureStore.ts`: opt-in IndexedDB persistence.
- `src/lib/offline.ts`: opt-in service worker lifecycle.
- `src/lib/seo.ts` and `scripts/prerender.tsx`: public HTML, metadata and structured data.
- `src/lib/signature.ts`: local paper-background removal and cropping.
- `src/lib/operations.ts`: PDF composition and browser conversions.
- `src/lib/textEdits.ts` and `src/workers/text.ts`: original-font replacement, glyph validation and shared preview/export handling.
- `src/workers/native.worker.ts`: PDFium WASM operations on a dedicated worker.
- `src/lib/pdf.ts`: rendering, import validation and sample document.
- `src/lib/catalog.ts`: complete list of actually available tools.

Third-party notices are in `THIRD_PARTY_NOTICES.md`. Keep these licenses with deployments and distributions.
