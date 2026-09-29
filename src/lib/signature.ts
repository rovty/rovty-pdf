export interface SignaturePixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Estimate plain paper from the image perimeter. Channel medians tolerate ink
// crossing an edge and occasional shadows without selecting the ink color.
function paperColor({ data, width, height }: SignaturePixels) {
  const channels: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    const index = (y * width + x) * 4;
    if (data[index + 3] < 240) return;
    for (let channel = 0; channel < 3; channel++) channels[channel].push(data[index + channel]);
  };
  const step = Math.max(1, Math.floor(Math.max(width, height) / 300));
  for (let x = 0; x < width; x += step) {
    sample(x, 0);
    sample(x, height - 1);
  }
  for (let y = 0; y < height; y += step) {
    sample(0, y);
    sample(width - 1, y);
  }
  return channels.map((values) => {
    values.sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : 255;
  });
}

export function removeSignatureBackground(
  source: SignaturePixels,
  strength: number,
): SignaturePixels {
  const background = paperColor(source);
  const data = new Uint8ClampedArray(source.data);
  const threshold = 5 + Math.max(0, Math.min(100, strength));
  for (let index = 0; index < data.length; index += 4) {
    if (!data[index + 3]) continue;
    const distance = Math.max(
      Math.abs(data[index] - background[0]),
      Math.abs(data[index + 1] - background[1]),
      Math.abs(data[index + 2] - background[2]),
    );
    const edge = Math.max(0, Math.min(1, (distance - threshold) / 40));
    // Soft edges and color unmatting avoid leaving a white outline around ink.
    const alpha = edge * edge * (3 - 2 * edge);
    data[index + 3] = Math.round(data[index + 3] * alpha);
    for (let channel = 0; channel < 3; channel++) {
      data[index + channel] = alpha
        ? background[channel] + (data[index + channel] - background[channel]) / alpha
        : 0;
    }
  }
  // Native ImageData dimensions are prototype getters, not enumerable fields.
  return { width: source.width, height: source.height, data };
}

export function cropSignature(source: SignaturePixels, padding = 8): SignaturePixels {
  const { data, width, height } = source;
  let left = width,
    top = height,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 8) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  if (right < left)
    throw new Error(
      'No signature is visible. Reduce the removal strength or choose a clearer image.',
    );
  const inkWidth = right - left + 1,
    inkHeight = bottom - top + 1;
  const outWidth = inkWidth + padding * 2,
    outHeight = inkHeight + padding * 2;
  const output = new Uint8ClampedArray(outWidth * outHeight * 4);
  for (let y = 0; y < inkHeight; y++) {
    const start = ((top + y) * width + left) * 4;
    output.set(
      data.subarray(start, start + inkWidth * 4),
      ((y + padding) * outWidth + padding) * 4,
    );
  }
  return { data: output, width: outWidth, height: outHeight };
}
