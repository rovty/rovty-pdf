import { cp, mkdir, rm } from 'node:fs/promises';

await mkdir('public/pdfjs', { recursive: true });
for (const folder of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(`node_modules/pdfjs-dist/${folder}`, `public/pdfjs/${folder}`, { recursive: true });
}
// This generated copy is obsolete; the engine now uses one content-hashed Vite asset.
await rm('public/pdfium.wasm', { force: true });
await cp('node_modules/harfbuzzjs/dist/harfbuzz-subset.wasm', 'public/font-instance.wasm');
await mkdir('public/licenses', { recursive: true });
for (const [name, file] of Object.entries({
  react: 'react/LICENSE',
  'react-dom': 'react-dom/LICENSE',
  scheduler: 'scheduler/LICENSE',
  pdfium: '@embedpdf/pdfium/LICENSE',
  'pdfium-dependencies': '@embedpdf/pdfium/LICENSE.pdfium',
  pdfjs: 'pdfjs-dist/LICENSE',
  'pdf-lib': 'pdf-lib/LICENSE.md',
  'pdf-lib-standard-fonts': '@pdf-lib/standard-fonts/LICENSE.md',
  'pdf-lib-upng': '@pdf-lib/upng/LICENSE',
  pako: 'pako/LICENSE',
  tslib: 'tslib/LICENSE.txt',
  fflate: 'fflate/LICENSE',
  lucide: 'lucide-react/LICENSE',
  archivo: '@fontsource/archivo/LICENSE',
  harfbuzz: 'harfbuzzjs/LICENSE',
}))
  await cp(`node_modules/${file}`, `public/licenses/${name}.txt`);
console.log('PDF engines and fonts copied for same-origin, private processing.');

// Pinned, same-origin computer vision engine; loaded only inside the scan worker.
await mkdir('public/scanner', { recursive: true });
await cp('node_modules/@techstark/opencv-js/dist/opencv.js', 'public/scanner/opencv-5.0.0.js');
await cp('node_modules/@techstark/opencv-js/LICENSE', 'public/licenses/opencv.txt');
