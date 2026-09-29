# Third-party software and fonts

Rovty PDF uses the following open-source components. Their licenses remain applicable to bundled distributions. The app does not contain Sejda source code, logos, copy or other proprietary assets.

- **React / React DOM** — MIT, Meta Platforms and contributors.
- **PDF.js** (`pdfjs-dist`) — Apache License 2.0, Mozilla Foundation and contributors. PDF.js standard fonts, CMaps and WASM include their own notices in the asset distribution.
- **pdf-lib** — MIT, Andrew Dillon and contributors.
- **@pdf-lib/fontkit** — MIT; derived from Fontkit, Devon Govett and contributors. Attribution and license terms are included in `public/fontkit-license.txt`.
- **@embedpdf/pdfium** — MIT, EmbedPDF contributors. The bundled PDFium binary includes PDFium and third-party code with notices in `node_modules/@embedpdf/pdfium/LICENSE.pdfium`.
- **fflate** — MIT, Arjun Barrett.
- **Lucide icons** — ISC, Lucide contributors; some icons derive from Feather under MIT.
- **Archivo** — SIL Open Font License 1.1, Omnibus-Type. Bundled locally through `@fontsource/archivo`.
- **Noto Sans** — SIL Open Font License 1.1, Noto project contributors. The license is included in `public/fonts/OFL.txt`.
- **Caveat** — SIL Open Font License 1.1, Caveat project authors. The license is included in `public/fonts/Caveat-OFL.txt`.
- **Dancing Script** — SIL Open Font License 1.1, Dancing Script project authors. The license is included in `public/fonts/DancingScript-OFL.txt`.

The asset-copy step also publishes the included dependency license files at `/licenses/`.
