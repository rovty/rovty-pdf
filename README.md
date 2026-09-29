# Rovty PDF

A free, private PDF toolkit for **pdf.rovty.com**, built as a separate application for **Cloudflare Pages**. React + TypeScript + Vite; no server database, accounts, API keys, paid services, or document-upload endpoint.

The interface uses Rovty branding and original assets. Sejda is a functional reference, not a copied product. This is a browser-only toolkit, **not complete Sejda feature parity**: OCR, Office-file conversion, digital certificates and advanced desktop PDF authoring are not included.

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

The editor supports selectable existing text blocks, new text, images, drawn or uploaded signatures, highlighting, freehand drawing, rectangles, ellipses, lines, links, visual white covers, and redactions. Additions can be moved and resized, with undo/redo and keyboard movement. Existing interactive form fields can be completed in the form panel.

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

## Cloudflare Pages

Create a Pages project named `rovty-pdf` and connect its Git repository.

| Setting                    | Value                                                        |
| -------------------------- | ------------------------------------------------------------ |
| Framework preset           | Vite                                                         |
| Build command              | `npm run build`                                              |
| Output directory           | `dist`                                                       |
| Root directory             | Repository root, or `rovty-pdf` if using a parent repository |
| Environment variable       | `NODE_VERSION=22`                                            |
| Runtime secrets / bindings | None                                                         |

Alternatively, after authenticating Wrangler and creating the Pages project:

```sh
npm run deploy
```

The deploy command runs unit tests and the production build before publishing. **No deployment is performed merely by building.**

In Pages → Custom domains, add **pdf.rovty.com** and follow Cloudflare’s DNS instructions. The intended domain is `pdf.rovty.com` (with the dot before `com`). There is no backend to configure.

The build prerenders 25 public pages with readable HTML, unique metadata, canonicals, social previews and structured data, plus a noindex `404.html` for unknown URLs. Cloudflare Pages automatically serves files such as `edit.html` at `/edit`; no SPA wildcard or explicit `.html` rewrite is needed. `public/_headers` supplies the Content Security Policy and other headers. The CSP limits network connections to this app’s origin and allows the bundled WebAssembly engine. The build check rejects any single asset over Cloudflare Pages’ 25 MiB limit.

`scripts/build-offline.mjs` generates a versioned service worker from the built app assets. The worker is registered only after the user enables offline tools; updates activate when older tabs close, without reloading an open PDF.

## Privacy and limits

- Documents and passwords remain in browser memory. Signatures also stay in memory unless the user checks **Save on this device**, which is off by default.
- Opt-in signatures are stored as finished PNG Blobs in IndexedDB (`rovty-pdf-local`), with a name, dimensions and timestamp. Original uploads are not saved. Identical images are deduplicated; the library allows 20 signatures, up to 2 MiB each. Anyone using the same browser profile can reuse them. They do not sync to accounts or other devices, and browser/private-mode storage may be cleared or evicted.
- Delete individual signatures in **Signature → Saved signatures**, or delete the library in **Privacy & help**. When storage is unavailable, signing still works with saving turned off.
- **Enable offline tools** optionally caches only the app, fonts and PDF engines in Cache Storage. No PDFs, passwords or signatures are included. The only localStorage value is the offline-enabled preference. **Clear offline cache** removes the app worker and cache without deleting signatures.
- No cookies, analytics or advertising code is used.
- Network requests load same-origin app assets only. External Rovty links are ordinary navigation chosen by the user.
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
npm run test:pages
```

`test:pages` runs the browser suite against the actual Pages emulator, including offline use with Cloudflare's clean-URL handling. Check all public SEO URLs with:

```sh
npx wrangler pages dev dist --port 8792
# In another terminal:
node scripts/check-pages.mjs http://127.0.0.1:8792
```

Browser checks use installed Google Chrome and Poppler (`pdftotext`, `pdfinfo`, `pdfimages`, `pdftoppm`). They cover native text removal, annotations, forms, signatures, page ordering, encryption/decryption, irreversible raster redaction, each utility’s download, bad files and responsive layouts. Screenshots and test outputs go into ignored `tmp/qa/`.

`test:production` serves the existing `dist` build on port 5181 with the exact headers from `_headers`. Run `npm run build` first. Coverage also includes mobile editing, placement on rotated/cropped pages, password clearing, same-origin-only requests, uploaded signature transparency, persistence across reloads, optional storage failures, offline exports and clearing storage. SEO checks load public pages without JavaScript to verify readable HTML and structured data. An `undici` override keeps Wrangler’s development dependency above the patched version.

## Rovty integration

Product details are in `public/product.json`. The sibling dashboard now has a separate **free external app** card linking directly to `https://pdf.rovty.com/`, including when paid access is unavailable. PDF is outside the paid entitlement, checkout and SSO registry: it intentionally requires no account. Marketing links and a product page are included in `rovty.com`, at `/products/pdf`, on the homepage, products page, pricing page and footer. Both projects support an optional `VITE_ROVTY_PDF_ORIGIN` override for local navigation.

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
