import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Icon } from './Icon';
import { cropSignature, removeSignatureBackground, type SignaturePixels } from '../lib/signature';
import { humanError } from '../lib/utils';
import {
  deleteSignature,
  listSignatures,
  saveSignature,
  signatureDataUrl,
  type SavedSignature,
} from '../lib/signatureStore';

type Preview = { url: string; width: number; height: number };
function previewOf(source: SignaturePixels): Preview {
  const pixels = cropSignature(source);
  const canvas = document.createElement('canvas');
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);
  return { url: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

export default function SignatureDialog({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (url: string, width: number, height: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const input = useRef<HTMLInputElement>(null),
    drawing = useRef(false);
  const last = useRef<[number, number] | undefined>(undefined),
    request = useRef(0);
  const [mode, setMode] = useState<'draw' | 'upload' | 'saved' | 'type'>('draw');
  const [typedName, setTypedName] = useState(''),
    [typedStyle, setTypedStyle] = useState('Rovty Script');
  const [typedPreview, setTypedPreview] = useState<Preview>();
  const [saved, setSaved] = useState<SavedSignature[]>([]),
    [savedUrls, setSavedUrls] = useState<Record<string, string>>({});
  const [selectedSaved, setSelectedSaved] = useState<string>(),
    [saveLocally, setSaveLocally] = useState(false);
  const [signatureName, setSignatureName] = useState('My signature'),
    [saving, setSaving] = useState(false),
    [storageError, setStorageError] = useState('');
  const [hasInk, setHasInk] = useState(false),
    [color, setColor] = useState('#171719');
  const [source, setSource] = useState<SignaturePixels>(),
    [filename, setFilename] = useState('');
  const [removeBackground, setRemoveBackground] = useState(true),
    [strength, setStrength] = useState(30);
  const [preview, setPreview] = useState<Preview>(),
    [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (mode !== 'type') return;
    let active = true;
    setTypedPreview(undefined);
    void (async () => {
      try {
        await document.fonts.load(`64px "${typedStyle}"`);
        if (!typedName.trim()) return;
        const canvas = document.createElement('canvas');
        canvas.width = 1200;
        canvas.height = 240;
        const ctx = canvas.getContext('2d')!;
        ctx.font = `96px "${typedStyle}"`;
        const size = Math.min(96, (96 * 1100) / Math.max(1, ctx.measureText(typedName).width));
        ctx.font = `${size}px "${typedStyle}"`;
        ctx.fillStyle = color;
        ctx.fillText(typedName, 35, 155);
        const result = previewOf(ctx.getImageData(0, 0, canvas.width, canvas.height));
        if (active) setTypedPreview(result);
      } catch (e) {
        if (active) setError(humanError(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [mode, typedName, typedStyle, color]);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      request.current++;
      dialog.current?.close();
    };
  }, []);
  useEffect(() => {
    let active = true;
    void listSignatures()
      .then((items) => {
        if (active) setSaved(items);
      })
      .catch((cause) => {
        if (active) setStorageError(humanError(cause));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const urls = Object.fromEntries(
      saved.map((item) => [item.id, URL.createObjectURL(item.image)]),
    );
    setSavedUrls(urls);
    return () => Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
  }, [saved]);
  async function removeSaved(id: string) {
    setSaving(true);
    setStorageError('');
    try {
      await deleteSignature(id);
      setSaved((items) => items.filter((item) => item.id !== id));
      if (selectedSaved === id) setSelectedSaved(undefined);
    } catch (cause) {
      setStorageError(humanError(cause));
    } finally {
      setSaving(false);
    }
  }
  useEffect(() => {
    if (!source) return;
    setProcessing(true);
    const timer = window.setTimeout(() => {
      try {
        setPreview(
          previewOf(removeBackground ? removeSignatureBackground(source, strength) : source),
        );
        setError('');
      } catch (cause) {
        setPreview(undefined);
        setError(humanError(cause));
      } finally {
        setProcessing(false);
      }
    }, 60);
    return () => window.clearTimeout(timer);
  }, [source, removeBackground, strength]);

  async function upload(file?: File) {
    if (!file) return;
    const id = ++request.current;
    setLoading(true);
    setError('');
    setSource(undefined);
    setPreview(undefined);
    try {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type))
        throw new Error('Choose a PNG, JPG or WebP signature image.');
      if (file.size > 15 * 1024 * 1024)
        throw new Error('Choose a signature image smaller than 15 MB.');
      const bitmap = await createImageBitmap(file);
      try {
        if (bitmap.width * bitmap.height > 25_000_000)
          throw new Error('Resize this signature image to under 25 megapixels.');
        if (id !== request.current) return;
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        const imageCanvas = document.createElement('canvas');
        imageCanvas.width = Math.max(1, Math.round(bitmap.width * scale));
        imageCanvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = imageCanvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0, imageCanvas.width, imageCanvas.height);
        const pixels = context.getImageData(0, 0, imageCanvas.width, imageCanvas.height);
        let transparent = false;
        for (let i = 3; i < pixels.data.length; i += 4)
          if (pixels.data[i] < 240) {
            transparent = true;
            break;
          }
        setRemoveBackground(!transparent);
        setStrength(30);
        setFilename(file.name);
        setSignatureName(file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'My signature');
        setSource(pixels);
      } finally {
        bitmap.close();
      }
    } catch (cause) {
      if (id === request.current) setError(humanError(cause));
    } finally {
      if (id === request.current) setLoading(false);
      if (input.current) input.current.value = '';
    }
  }
  const point = (event: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const bounds = canvas.current!.getBoundingClientRect();
    return [
      ((event.clientX - bounds.left) * 720) / bounds.width,
      ((event.clientY - bounds.top) * 260) / bounds.height,
    ];
  };
  async function save() {
    setSaving(true);
    setError('');
    setStorageError('');
    try {
      if (mode === 'saved') {
        const item = saved.find((item) => item.id === selectedSaved);
        if (item) onSave(await signatureDataUrl(item.image), item.width, item.height);
        return;
      }
      const output =
        mode === 'type'
          ? typedPreview
          : mode === 'upload'
            ? preview
            : previewOf(canvas.current!.getContext('2d')!.getImageData(0, 0, 720, 260));
      if (output) {
        if (saveLocally) await saveSignature({ ...output, name: signatureName });
        onSave(output.url, output.width, output.height);
      }
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <dialog
      className="modal signature-modal"
      ref={dialog}
      aria-labelledby="signature-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-title">
        <div>
          <span className="eyebrow">A PERSONAL TOUCH</span>
          <h2 id="signature-title">Your signature.</h2>
        </div>
        <button className="icon-button" aria-label="Close signature dialog" onClick={onClose}>
          <Icon name="X" size={20} />
        </button>
      </div>
      <div className="signature-methods" role="group" aria-label="Signature method">
        <button aria-pressed={mode === 'type'} onClick={() => setMode('type')}>
          <Icon name="Type" size={16} />
          Type signature
        </button>
        <button aria-pressed={mode === 'draw'} onClick={() => setMode('draw')}>
          <Icon name="Pencil" size={16} />
          Draw signature
        </button>
        <button aria-pressed={mode === 'upload'} onClick={() => setMode('upload')}>
          <Icon name="ImagePlus" size={16} />
          Upload image
        </button>
        <button aria-pressed={mode === 'saved'} onClick={() => setMode('saved')}>
          Saved signatures{saved.length ? ` (${saved.length})` : ''}
        </button>
      </div>
      {mode === 'type' && (
        <div>
          <label className="field">
            Your name
            <input
              autoFocus
              maxLength={80}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
            />
          </label>
          <label className="field">
            Signature style
            <select value={typedStyle} onChange={(e) => setTypedStyle(e.target.value)}>
              <option value="Rovty Script">Flowing</option>
              <option value="Rovty Hand">Handwritten</option>
            </select>
          </label>
          <label className="field color-field">
            Signature color
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <div className="signature-preview">
            {typedPreview ? (
              <img src={typedPreview.url} alt="Typed signature preview" />
            ) : (
              <span>Type your name to preview your signature.</span>
            )}
          </div>
        </div>
      )}
      <div hidden={mode !== 'draw'}>
        <p>Draw below using your mouse, pen or finger.</p>
        <canvas
          ref={canvas}
          width={720}
          height={260}
          aria-label="Draw your signature"
          onPointerDown={(event) => {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drawing.current = true;
            last.current = point(event);
          }}
          onPointerMove={(event) => {
            if (!drawing.current || !last.current) return;
            const next = point(event),
              context = canvas.current!.getContext('2d')!;
            context.strokeStyle = color;
            context.lineWidth = 3;
            context.lineCap = 'round';
            context.lineJoin = 'round';
            context.beginPath();
            context.moveTo(...last.current);
            context.lineTo(...next);
            context.stroke();
            last.current = next;
            setHasInk(true);
          }}
          onPointerUp={() => {
            drawing.current = false;
          }}
          onPointerCancel={() => {
            drawing.current = false;
          }}
        />
        <div className="signature-controls">
          <label>
            Ink{' '}
            <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
          <button
            onClick={() => {
              canvas.current?.getContext('2d')?.clearRect(0, 0, 720, 260);
              setHasInk(false);
            }}
          >
            <Icon name="RotateCcw" size={14} />
            Clear
          </button>
        </div>
      </div>
      <div hidden={mode !== 'upload'}>
        <p>
          Choose a signature on plain paper or a transparent image. PNG, JPG or WebP · up to 15 MB.
        </p>
        <input
          ref={input}
          className="sr-only"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Upload signature image"
          onChange={(event) => void upload(event.target.files?.[0])}
        />
        <button
          className="button secondary signature-upload-button"
          disabled={loading}
          onClick={() => input.current?.click()}
        >
          <Icon name="ImagePlus" size={16} />
          {loading ? 'Opening image…' : source ? 'Choose another image' : 'Choose signature image'}
        </button>
        {source && (
          <>
            <div className="signature-preview" aria-busy={processing}>
              {preview && <img src={preview.url} alt="Signature preview" />}
              {!preview && (
                <span>
                  {processing ? 'Preparing your signature…' : 'Adjust the settings below.'}
                </span>
              )}
            </div>
            <p className="signature-filename" title={filename}>
              {filename}
            </p>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={removeBackground}
                onChange={(event) => {
                  setProcessing(true);
                  setRemoveBackground(event.target.checked);
                }}
              />
              Remove background
            </label>
            {removeBackground && (
              <label className="field">
                Background removal strength <span className="field-value">{strength}%</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={strength}
                  onChange={(event) => {
                    setProcessing(true);
                    setStrength(Number(event.target.value));
                  }}
                />
                <span>
                  Use less for faint ink, more for paper shadows. Works best on a plain, evenly lit
                  background.
                </span>
              </label>
            )}
            <p className="inspector-note">
              The checkerboard shows transparency. Empty edges are trimmed before placing your
              signature.
            </p>
          </>
        )}
      </div>
      {mode === 'saved' && (
        <div className="saved-signatures">
          <p>Only in this browser. Choose a saved signature to reuse it.</p>
          {!saved.length && !storageError && (
            <p>No saved signatures yet. Draw or upload one, then choose “Save on this device”.</p>
          )}
          <div className="saved-signature-grid">
            {saved.map((item) => (
              <div className="saved-signature" key={item.id}>
                <button
                  className="saved-signature-select"
                  aria-pressed={selectedSaved === item.id}
                  onClick={() => setSelectedSaved(item.id)}
                  disabled={saving}
                  aria-label={`Select ${item.name}`}
                >
                  <span className="signature-preview">
                    <img src={savedUrls[item.id]} alt="" />
                  </span>
                  <strong>{item.name}</strong>
                </button>
                <button
                  className="text-delete"
                  disabled={saving}
                  aria-label={`Delete ${item.name}`}
                  onClick={() => void removeSaved(item.id)}
                >
                  <Icon name="Trash2" size={14} />
                  Delete
                </button>
              </div>
            ))}
          </div>
          {storageError && (
            <p role="alert" className="signature-error">
              {storageError}
            </p>
          )}
        </div>
      )}
      {mode !== 'saved' && (
        <div className="signature-save-option">
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={saveLocally}
              onChange={(event) => setSaveLocally(event.target.checked)}
              disabled={saving}
            />
            Save on this device
          </label>
          {saveLocally && (
            <>
              <label className="field">
                Signature name
                <input
                  value={signatureName}
                  maxLength={80}
                  onChange={(event) => setSignatureName(event.target.value)}
                  disabled={saving}
                />
              </label>
              <p className="inspector-note">
                Available to anyone using this browser profile. Save only on a device you trust.
                Delete it anytime in Saved signatures or Privacy &amp; help.
              </p>
            </>
          )}
        </div>
      )}
      {error && (
        <p className="signature-error" role="alert">
          {error}
        </p>
      )}
      <p className="inspector-note">
        A visual signature. It never leaves your device. Saving is optional and does not sync to
        your Rovty account.
      </p>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button"
          disabled={
            saving ||
            (mode === 'type'
              ? !typedPreview
              : mode === 'draw'
                ? !hasInk
                : mode === 'saved'
                  ? !selectedSaved
                  : !preview || loading || processing)
          }
          onClick={() => void save()}
        >
          <Icon name="Plus" size={16} />
          {saving ? 'Saving…' : 'Use signature'}
        </button>
      </div>
    </dialog>
  );
}
