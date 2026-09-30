import type * as CV from '@techstark/opencv-js';
import type { ScanRequest, ScanResult } from '../lib/scannerClient';
import {
  fullQuad,
  orderQuad,
  quadArea,
  validQuad,
  type ScanQuad,
  type ScanSettings,
} from '../lib/scannerTypes';
let engine: Promise<typeof CV> | undefined;
function getEngine() {
  return (engine ??= (async () => {
    const path = '/scanner/opencv-5.0.0.js';
    await import(/* @vite-ignore */ path);
    return await (self as unknown as { cv: Promise<typeof CV> }).cv;
  })());
}
async function decode(blob: Blob, maxEdge: number) {
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(
      'This image format could not be opened. Choose a JPG, PNG or WebP photo, or take a new photo.',
    );
  }
  try {
    if (image.width * image.height > 50_000_000)
      throw new Error('This photo is larger than 50 megapixels. Choose a smaller copy.');
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(image.width * scale)),
      Math.max(1, Math.round(image.height * scale)),
    );
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    image.close();
  }
}
function detect(cv: typeof CV, canvas: OffscreenCanvas) {
  const scale = Math.min(1, 650 / Math.max(canvas.width, canvas.height));
  const small = new OffscreenCanvas(
    Math.max(1, Math.round(canvas.width * scale)),
    Math.max(1, Math.round(canvas.height * scale)),
  );
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  const rgba = cv.matFromImageData(ctx.getImageData(0, 0, small.width, small.height));
  const gray = new cv.Mat(),
    blurred = new cv.Mat(),
    edges = new cv.Mat(),
    binary = new cv.Mat();
  const contours = new cv.MatVector(),
    hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  let best: ScanQuad | undefined,
    score = 0;
  try {
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 35, 110);
    cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
    cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    for (const input of [edges, binary]) {
      cv.findContours(input, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i),
          polygon = new cv.Mat();
        try {
          const area = Math.abs(cv.contourArea(contour)) / (small.width * small.height);
          if (area < 0.1 || area > 0.96) continue;
          cv.approxPolyDP(contour, polygon, 0.025 * cv.arcLength(contour, true), true);
          if (polygon.rows !== 4 || !cv.isContourConvex(polygon)) continue;
          const quad = orderQuad(
            Array.from({ length: 4 }, (_, j) => ({
              x: polygon.data32S[j * 2] / (small.width - 1),
              y: polygon.data32S[j * 2 + 1] / (small.height - 1),
            })),
          );
          if (!validQuad(quad)) continue;
          const lengths = quad.map((p, j) =>
            Math.hypot(
              (p.x - quad[(j + 1) % 4].x) * small.width,
              (p.y - quad[(j + 1) % 4].y) * small.height,
            ),
          );
          if (Math.min(...lengths) < 25) continue;
          const borderPoints = quad.filter(
            (p) => p.x < 0.012 || p.y < 0.012 || p.x > 0.988 || p.y > 0.988,
          ).length;
          const quality = quadArea(quad) * (1 - borderPoints * 0.12);
          if (quality > score) {
            score = quality;
            best = quad;
          }
        } finally {
          polygon.delete();
          contour.delete();
        }
      }
    }
    let sum = 0,
      variance = 0,
      samples = 0;
    const pixels = gray.data,
      w = gray.cols,
      h = gray.rows;
    for (let y = 1; y < h - 1; y += 2)
      for (let x = 1; x < w - 1; x += 2) {
        const at = y * w + x;
        sum += pixels[at];
        samples++;
        const lap =
          pixels[at - 1] + pixels[at + 1] + pixels[at - w] + pixels[at + w] - 4 * pixels[at];
        variance += lap * lap;
      }
    return {
      quad: best || fullQuad(),
      detected: !!best,
      sharpness: variance / Math.max(1, samples),
      light: sum / Math.max(1, samples),
    };
  } finally {
    for (const mat of [rgba, gray, blurred, edges, binary, contours, hierarchy, kernel])
      mat.delete();
  }
}
function render(
  cv: typeof CV,
  canvas: OffscreenCanvas,
  quad: ScanQuad,
  settings: ScanSettings,
  maxEdge: number,
) {
  if (!validQuad(quad))
    throw new Error('Keep all four corners around the document without crossing the edges.');
  const points = quad.map((p) => ({ x: p.x * (canvas.width - 1), y: p.y * (canvas.height - 1) }));
  const distance = (a: number, b: number) =>
    Math.hypot(points[a].x - points[b].x, points[a].y - points[b].y);
  let width = Math.max(distance(0, 1), distance(3, 2)),
    height = Math.max(distance(0, 3), distance(1, 2));
  const ratio = Math.min(1, maxEdge / Math.max(width, height));
  width = Math.max(16, Math.round(width * ratio));
  height = Math.max(16, Math.round(height * ratio));
  const src = cv.matFromImageData(
    canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height),
  );
  const from = cv.matFromArray(
    4,
    1,
    cv.CV_32FC2,
    points.flatMap((p) => [p.x, p.y]),
  );
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0,
    0,
    width - 1,
    0,
    width - 1,
    height - 1,
    0,
    height - 1,
  ]);
  const transform = cv.getPerspectiveTransform(from, to),
    warped = new cv.Mat(),
    gray = new cv.Mat(),
    output = new cv.Mat();
  try {
    cv.warpPerspective(
      src,
      warped,
      transform,
      new cv.Size(width, height),
      cv.INTER_CUBIC,
      cv.BORDER_REPLICATE,
    );
    if (settings.filter === 'bw' || settings.filter === 'gray') {
      cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
      if (settings.filter === 'bw') {
        const block = Math.max(3, Math.min(81, Math.floor(Math.min(width, height) / 10) * 2 + 1));
        cv.adaptiveThreshold(
          gray,
          gray,
          255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          block,
          12 + settings.brightness * 0.18 - settings.contrast * 0.1,
        );
      } else gray.convertTo(gray, -1, 1 + settings.contrast / 100, settings.brightness * 1.2);
      cv.cvtColor(gray, output, cv.COLOR_GRAY2RGBA);
    } else {
      warped.copyTo(output);
      if (settings.filter === 'color') {
        // Estimate paper illumination independently of the ink, then normalize it.
        cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
        const background = new cv.Mat(),
          reduced = new cv.Mat();
        try {
          // Illumination varies slowly: estimate at low resolution instead of
          // convolving a phone-sized photo with a hundreds-of-pixels kernel.
          const down = Math.min(1, 256 / Math.max(width, height));
          cv.resize(
            gray,
            reduced,
            new cv.Size(
              Math.max(8, Math.round(width * down)),
              Math.max(8, Math.round(height * down)),
            ),
            0,
            0,
            cv.INTER_AREA,
          );
          cv.GaussianBlur(
            reduced,
            reduced,
            new cv.Size(0, 0),
            Math.max(1.5, (Math.min(width, height) * down) / 25),
          );
          cv.resize(reduced, background, new cv.Size(width, height), 0, 0, cv.INTER_LINEAR);
          const data = output.data,
            light = background.data;
          for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const factor = Math.min(1.65, 245 / Math.max(110, light[j]));
            for (let c = 0; c < 3; c++)
              data[i + c] = Math.min(
                255,
                Math.max(
                  0,
                  (data[i + c] * factor - 128) * (1.08 + settings.contrast / 100) +
                    128 +
                    settings.brightness * 1.2,
                ),
              );
          }
        } finally {
          background.delete();
          reduced.delete();
        }
      } else if (settings.brightness || settings.contrast) {
        const data = output.data;
        for (let i = 0; i < data.length; i += 4)
          for (let c = 0; c < 3; c++)
            data[i + c] = Math.min(
              255,
              Math.max(
                0,
                (data[i + c] - 128) * (1 + settings.contrast / 100) +
                  128 +
                  settings.brightness * 1.2,
              ),
            );
      }
    }
    const normal = new OffscreenCanvas(width, height);
    normal
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(output.data), width, height), 0, 0);
    const turn = ((settings.rotation % 4) + 4) % 4;
    if (!turn) return normal;
    const rotated = new OffscreenCanvas(turn % 2 ? height : width, turn % 2 ? width : height),
      ctx = rotated.getContext('2d')!;
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate((turn * Math.PI) / 2);
    ctx.drawImage(normal, -width / 2, -height / 2);
    return rotated;
  } finally {
    for (const mat of [src, from, to, transform, warped, gray, output]) mat.delete();
  }
}
let queue = Promise.resolve();
function makeThumbnail(canvas: OffscreenCanvas) {
  const scale = Math.min(1, 180 / Math.max(canvas.width, canvas.height));
  const thumbnail = new OffscreenCanvas(
    Math.max(1, Math.round(canvas.width * scale)),
    Math.max(1, Math.round(canvas.height * scale)),
  );
  thumbnail.getContext('2d')!.drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
}
self.onmessage = ({ data }: MessageEvent<ScanRequest & { id: number }>) => {
  queue = queue.then(async () => {
    let initialized = false;
    try {
      if (!(data.blob instanceof Blob) || data.blob.size > 40 * 1024 * 1024)
        throw new Error('Choose a photo smaller than 40 MB.');
      const cv = await getEngine();
      initialized = true;
      const canvas = await decode(data.blob, data.action === 'detect' ? 650 : 3200);
      let result: ScanResult;
      if (data.action === 'render') {
        const final = render(
          cv,
          canvas,
          data.quad!,
          data.settings!,
          Math.min(3200, data.maxEdge || 1400),
        );
        const blob = await final.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        result = {
          blob,
          thumbnail: await makeThumbnail(final),
          width: final.width,
          height: final.height,
          quad: data.quad!,
          detected: true,
        };
      } else {
        const found = detect(cv, canvas);
        const blob =
          data.action === 'prepare'
            ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 })
            : new Blob();
        result = {
          blob,
          thumbnail: data.action === 'prepare' ? await makeThumbnail(canvas) : undefined,
          width: canvas.width,
          height: canvas.height,
          ...found,
        };
      }
      self.postMessage({ id: data.id, result });
    } catch (error) {
      self.postMessage({
        id: data.id,
        fatal: !initialized,
        error: !initialized
          ? 'The scanner could not load. Check your connection and try again.'
          : error instanceof Error
            ? error.message
            : 'The scan could not be processed. Adjust its corners or try another photo.',
      });
    }
  });
};
