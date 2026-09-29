import { MAX_FONT_BYTES } from '../../shared/fonts';

type FontEngine = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(size: number): number;
  free(pointer: number): void;
  hb_blob_create(data: number, size: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_keep_everything(input: number): void;
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): number;
  hb_subset_input_pin_axis_location(
    input: number,
    face: number,
    tag: number,
    value: number,
  ): number;
  hb_subset_or_fail(face: number, input: number): number;
};

// HarfBuzz pins the full font to a static instance. Keeping every glyph avoids
// another PDF subset with the same missing-uppercase/lowercase problem.
export async function createFontInstancer(wasm: Uint8Array) {
  const module = await WebAssembly.compile(new Uint8Array(wasm).buffer);
  const instance = await WebAssembly.instantiate(module);
  const hb = instance.exports as unknown as FontEngine;
  hb._initialize();
  return (bytes: Uint8Array, axes: Record<string, number>) => {
    if (bytes.length < 4 || bytes.length > MAX_FONT_BYTES)
      throw new Error('The matching font has an invalid size.');
    const pointer = hb.malloc(bytes.length);
    if (!pointer) throw new Error('Not enough browser memory to prepare this font.');
    let blob = 0,
      face = 0,
      input = 0,
      output = 0,
      result = 0;
    try {
      new Uint8Array(hb.memory.buffer).set(bytes, pointer);
      // READONLY: this allocation remains alive until both face and blob close.
      blob = hb.hb_blob_create(pointer, bytes.length, 1, 0, 0);
      face = hb.hb_face_create(blob, 0);
      input = hb.hb_subset_input_create_or_fail();
      if (!blob || !face || !input) throw new Error('The matching font could not be opened.');
      hb.hb_subset_input_keep_everything(input);
      if (!hb.hb_subset_input_pin_all_axes_to_default(input, face))
        throw new Error('The matching font could not be made static.');
      for (const [tag, value] of Object.entries(axes)) {
        if (!/^[ -~]{4}$/.test(tag) || !Number.isFinite(value))
          throw new Error('The matching font has invalid variation settings.');
        const code =
          [...tag].reduce((code, character) => (code << 8) | character.charCodeAt(0), 0) >>> 0;
        if (!hb.hb_subset_input_pin_axis_location(input, face, code, value))
          throw new Error('The matching font does not support this style.');
      }
      output = hb.hb_subset_or_fail(face, input);
      if (!output) throw new Error('The matching font could not be made static.');
      result = hb.hb_face_reference_blob(output);
      const size = hb.hb_blob_get_length(result),
        data = hb.hb_blob_get_data(result, 0);
      if (!data || size < 4 || size > MAX_FONT_BYTES)
        throw new Error('The matching font has an invalid size.');
      return new Uint8Array(hb.memory.buffer).slice(data, data + size);
    } finally {
      if (result) hb.hb_blob_destroy(result);
      if (output) hb.hb_face_destroy(output);
      if (input) hb.hb_subset_input_destroy(input);
      if (face) hb.hb_face_destroy(face);
      if (blob) hb.hb_blob_destroy(blob);
      hb.free(pointer);
    }
  };
}

let engine: ReturnType<typeof createFontInstancer> | undefined;
export async function instantiateFont(bytes: Uint8Array, axes: Record<string, number>) {
  engine ??= fetch('/font-instance.wasm', {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(15000),
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('The font engine could not load. Try editing again.');
      return createFontInstancer(new Uint8Array(await response.arrayBuffer()));
    })
    .catch((error) => {
      engine = undefined;
      throw error;
    });
  return (await engine)(bytes, axes);
}
