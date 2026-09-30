# Scan to PDF

`/scan` is a free, local scanner. Its landing page is prerendered and indexed; the scanner UI and image engine load on use. It supports camera batches, native photo capture, image import, perspective cropping, four color modes, page ordering, PDF export and editor handoff. ID mode pairs front/back scans on A4; other modes use A4, Letter or each scan's aspect ratio. Scans are image PDFs, not OCR documents.

## Privacy and lifecycle

Camera access is requested after the user chooses it. Audio is always disabled. Tracks stop when the camera closes, the document becomes hidden, or the scanner unmounts. Native camera/photo pickers provide a fallback for permission denial or missing browser APIs. Auto capture requires stable detected edges and sufficient image detail/light; a document must leave view for three frames before another automatic capture is allowed.

Source photos, previews and PDF bytes are held in memory. Nothing is persisted to local storage, IndexedDB, cookies or cloud storage. Exports are newly encoded JPEG image streams, so original photo EXIF/GPS metadata is not copied. Revocable object URLs are released when replaced, removed or the scan session closes. The optional app cache includes public scanner code and the versioned engine, never user photos or frames.

## Processing and security

A module worker handles image decoding, contour detection, perspective transforms and adaptive black/white thresholding. OpenCV 5.0.0-release.1 is pinned, copied to `/scanner/opencv-5.0.0.js`, served locally, and licensed in `/licenses/opencv.txt`. The OpenCV generated bindings need dynamic JavaScript invocation. Only the content-hashed `scanner.worker-*` response allows it. That worker has `connect-src 'none'`, `default-src 'none'` and no DOM access; the application retains its existing strict script policy. Same-origin camera permission is necessary because client-side navigation keeps the original page's permissions policy. Microphone, location and payment remain disabled.

A batch is limited to 40 scans and 100 MB of normalized source images. Imports accept 40 MB per photo, 160 MB per batch and decoded images up to 50 megapixels. Photos are normalized to a maximum 3,200-pixel long edge. High export keeps that resolution; standard export uses up to 2,200 pixels. Preview and detection operate at smaller resolutions. Browser-supported HEIC/HEIF/AVIF decoding varies; unsupported images produce a recoverable message recommending JPEG, PNG or WebP.

Cropped pages must be convex and have a nontrivial area. Uncertain edge detection keeps the full photo and opens manual corner adjustment. Color cleanup is reversible; all exports are generated from the normalized original and current settings, not from a repeatedly edited preview.

## Validation

`tests/scanner.test.ts` covers crop validation and PDF layout. `tests/browser/scanner.spec.ts` checks camera denial and stream cleanup, automatic capture re-arming, known perspective corners, adaptive black/white output, mobile layouts, page ordering, ID pairing and export, local storage, and editor handoff. Camera automation uses an explicit canvas-backed media stream; hardware torch, zoom and native photo pickers still depend on the user's device/browser.
