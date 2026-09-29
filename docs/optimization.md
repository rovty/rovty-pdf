# Application optimization — September 2026

This pass covers tool startup, file import, rendering regressions, cloud request handling, offline assets, search metadata, and desktop/mobile navigation. Changes are local to `rovty-pdf`; they have not been deployed.

## Measured loading improvement

Cold production `/edit`, before selecting a file, measured in local Chrome using resource timing decoded body sizes:

| Measurement                                     |          Before |         After |
| ----------------------------------------------- | --------------: | ------------: |
| JavaScript requested                            | 2,034,693 bytes | 310,527 bytes |
| PDF workspace/engine downloads before selection |             Yes |          None |

The JavaScript reduction is approximately **85%**. This measures payload, not a promised internet load time or a field Core Web Vitals score. The final entry bundle is approximately 303 KiB raw / 93 KiB gzip. The build rejects an initial JavaScript dependency graph larger than 400 KiB raw or 130 KiB gzip.

- Public tool pages hydrate their pre-rendered HTML instead of replacing it. An offline home shell received on another route deliberately uses a fresh render for that route.
- The shared upload screen works without the PDF engines. File selection, sample generation, or creating a blank document starts the heavier imports. Basic file checks happen first.
- Multi-file selection and cloud imports retain their original order. Original File handles are released once import finishes; the workspace owns the parsed document bytes.
- Loading failures offer a reload action. A failed route keeps the main navigation available.

## Asset and code cleanup

- Removed the redundant generated `public/pdfium.wasm` copy (4,646,932 bytes). The application and the SDK now share one content-hashed engine asset; offline caching includes it.
- Removed 12 legacy WOFF assets from the build (177,764 bytes). The same Archivo weights and Latin, extended Latin, and Vietnamese coverage remain as WOFF2. PDF editing and recovery fonts are retained.
- Removed the checked-in/generated `public/sitemap.xml`. Prerendering now creates `dist/sitemap.xml` from the typed tool catalog used to generate public pages.
- Consolidated the duplicate upload/sample/blank-document UI and file-size constants. Build-only manifest files are removed after validation. Font fixtures, licenses, recovery fonts, and required offline files remain.

## UX and privacy

- Mobile navigation traps keyboard focus, supports Escape and a visible close control, locks background scrolling, and restores focus. Hidden sidebars are inert. Desktop keeps the labeled sidebar control.
- Internal links retain native Command/Ctrl-click and new-tab behavior. Route changes focus the main content. Search matches format names and tool details, with an accessible result count.
- Tool pages include readable steps, explicit privacy copy, and related tools. Existing limitations such as rasterized compression, cropping versus redaction, and non-OCR text extraction remain visible.
- No analytics, document history, or automatic cloud uploads were added. Saved signatures and offline caching remain opt-in.

## Security and SEO

- Invalid Authorization headers cannot silently fall back to a signed-in cookie. Auth-state cookies must match their expected shape before exchange.
- Request bodies reject malformed lengths, oversized streams, cancellation, and reads exceeding 60 seconds. A stalled stream cannot hold an error response open.
- Malformed share-password encoding returns a client error. Cloud fetches reject redirects rather than forwarding document uploads through them.
- Private `.html` aliases receive no-store/noindex headers and remain excluded from offline navigation caching.
- All 23 tools have unique, concise descriptions. Public pages retain canonical URLs, readable HTML, free-application schema and breadcrumbs. Private/missing routes remove canonicals; navigation back to a public page restores them. Social images include dimensions and accessible descriptions.
- `npm audit` reported **0 known vulnerabilities**. Existing same-origin CSP, file isolation, scoped tokens, revocation, font integrity checks, and privacy tests remain in place.

## Verification

- Production build and TypeScript checks passed, including an unused-local/parameter check and `git diff --check`.
- **93 unit/integration tests passed**, including cloud ownership, token scopes, deletion, timeout/cancellation, font recovery, Sinhala shaping and export helpers.
- Full Worker browser run: **94 passed**, with one invalid-file wording assertion caught. The wording was corrected; **20 affected Worker checks then passed**, including that case and a new multi-file/reopen regression test.
- **5 development-server smoke tests passed** for editing/export, image import, invalid files, multiple files, navigation and modified-click links.
- All **26 public URLs**, canonical redirects, metadata, schemas and noindex 404s passed the HTTP route audit. All public pages were also checked with JavaScript disabled.
- Continuous typing: **65 sampled frames, 21 visible updates, 0 blank frames, 0 loading overlays, 0px page shift**. Desktop/mobile screenshots and a rendered edited export were visually checked.

Local evidence is under ignored `tmp/qa/`: `loading-before.json`, `loading-after.json`, `assets-before.json`, `optimization-build.log`, `optimization-browser.log`, `optimization-recheck.log`, `optimization-dev-smoke.log`, `typing-render-metrics.json`, screenshots and exported samples.

For subsequent changes, run `npm run check`, then `npm run test:worker` after building. `tests/browser/loading.spec.ts` checks the entry payload, hydration, recovery, keyboard navigation, native links, and multi-file import. Deployment uses the existing Worker configuration and `npx wrangler deploy`; building alone does not publish changes.
