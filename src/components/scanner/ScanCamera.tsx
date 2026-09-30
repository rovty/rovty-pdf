import { useEffect, useRef, useState } from 'react';
import type { ScannerClient } from '../../lib/scannerClient';
import { scanModes, type ScanMode, type ScanQuad } from '../../lib/scannerTypes';
import { Icon } from '../Icon';
import { openScanCamera, isMobileCamera } from '../../lib/scanCameraDevice';
type ExtendedCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min: number; max: number; step: number };
};
export default function ScanCamera({
  client,
  mode,
  count,
  onCapture,
  onClose,
  onImport,
  automatic,
  onAutomaticChange,
  onModeChange,
}: {
  client: ScannerClient;
  mode: ScanMode;
  count: number;
  onCapture: (blob: Blob) => Promise<boolean>;
  onClose: () => void;
  onImport: () => void;
  automatic: boolean;
  onAutomaticChange: (value: boolean) => void;
  onModeChange: (mode: ScanMode) => void;
}) {
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | undefined>(undefined),
    alive = useRef(true),
    capturing = useRef(false);
  const captureLatest = useRef(onCapture);
  captureLatest.current = onCapture;
  const [status, setStatus] = useState('Allow camera access to start scanning.'),
    [error, setError] = useState(''),
    [ready, setReady] = useState(false),
    [working, setWorking] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState('');
  const [caps, setCaps] = useState<ExtendedCapabilities>({}),
    [torch, setTorch] = useState(false),
    [zoom, setZoom] = useState(1),
    [quad, setQuad] = useState<ScanQuad>(),
    [stable, setStable] = useState(0);
  const [aspect, setAspect] = useState(4 / 3);
  const auto = useRef(false);
  auto.current = automatic;
  const stability = useRef({
    quad: undefined as ScanQuad | undefined,
    since: 0,
    armed: true,
    absent: 0,
  });
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    const controller = new AbortController();
    const stop = () => {
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = undefined;
      setReady(false);
    };
    async function start() {
      setError('');
      setReady(false);
      setTorch(false);
      setCaps({});
      setQuad(undefined);
      setStable(0);
      stability.current = { quad: undefined, since: 0, armed: true, absent: 0 };
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError(
          'Live camera scanning needs a secure connection and a supported browser. Take a photo or import images below.',
        );
        return;
      }
      try {
        const opened = await openScanCamera(
          navigator.mediaDevices,
          isMobileCamera(),
          controller.signal,
          device || undefined,
        );
        const next = opened.stream;
        if (disposed) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = next;
        video.current!.srcObject = next;
        await video.current!.play();
        if (disposed) return;
        setAspect(video.current!.videoWidth / video.current!.videoHeight);
        const track = next.getVideoTracks()[0];
        const cap = track.getCapabilities?.() || {};
        setCaps(cap);
        setZoom((track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom || 1);
        setCameras(opened.cameras);
        setReady(true);
        setStatus('Place the full document inside the camera view.');
      } catch (cause) {
        if (disposed) return;
        stop();
        const name = (cause as DOMException)?.name;
        setError(
          name === 'NotAllowedError'
            ? 'Camera permission was not granted. Allow it in your browser settings, or take a photo below.'
            : name === 'NotFoundError'
              ? 'No camera was found. Import photos to scan them.'
              : name === 'NotReadableError'
                ? 'The camera is busy in another app. Close that app and try again.'
                : name === 'OverconstrainedError'
                  ? 'A rear camera is not available in this browser. Take a photo with your phone camera and import it.'
                  : cause instanceof Error && name === 'Error'
                    ? cause.message
                    : 'The camera could not start. Try again or import a photo.',
        );
      }
    }
    void start();
    const hidden = () => {
      if (document.hidden) {
        stop();
        onClose();
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      disposed = true;
      controller.abort();
      alive.current = false;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = undefined;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [device]);
  async function capture() {
    const view = video.current;
    if (!view?.videoWidth || capturing.current || count >= 40) return;
    capturing.current = true;
    setWorking(true);
    stability.current.armed = false;
    setStable(0);
    try {
      const scale = Math.min(1, 3200 / Math.max(view.videoWidth, view.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(view.videoWidth * scale);
      canvas.height = Math.round(view.videoHeight * scale);
      canvas.getContext('2d')!.drawImage(view, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (result) =>
            result ? resolve(result) : reject(new Error('The camera frame could not be saved.')),
          'image/jpeg',
          0.95,
        ),
      );
      const added = await captureLatest.current(blob);
      if (alive.current)
        setStatus(
          added
            ? 'Page added. Remove this page before scanning the next one.'
            : 'The page was not added. Review the message above before capturing again.',
        );
    } catch (cause) {
      if (alive.current)
        setError(cause instanceof Error ? cause.message : 'Please try taking the photo again.');
    } finally {
      capturing.current = false;
      if (alive.current) setWorking(false);
    }
  }
  const captureRef = useRef(capture);
  captureRef.current = capture;
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const canvas = document.createElement('canvas');
    async function detect() {
      const view = video.current;
      if (disposed || !view?.videoWidth) return;
      if (!capturing.current) {
        try {
          const scale = 480 / Math.max(view.videoWidth, view.videoHeight);
          canvas.width = Math.round(view.videoWidth * scale);
          canvas.height = Math.round(view.videoHeight * scale);
          canvas.getContext('2d')!.drawImage(view, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob(resolve, 'image/jpeg', 0.75),
          );
          if (blob) {
            const found = await client.run({ action: 'detect', blob });
            if (disposed) return;
            setQuad(found.detected ? found.quad : undefined);
            const state = stability.current,
              now = performance.now();
            if (!found.detected) {
              state.since = now;
              state.quad = undefined;
              state.absent++;
              if (state.absent >= 3) state.armed = true;
              setStable(0);
              setStatus('Show all four edges against a contrasting background.');
            } else {
              state.absent = 0;
              const motion = state.quad
                ? Math.max(
                    ...found.quad.map((point, i) =>
                      Math.hypot(point.x - state.quad![i].x, point.y - state.quad![i].y),
                    ),
                  )
                : 1;
              state.quad = found.quad;
              const good = motion < 0.015 && (found.sharpness || 0) > 35 && (found.light || 0) > 45;
              if (!good) state.since = now;
              const progress = Math.min(1, (now - state.since) / 1400);
              setStable(good && state.armed ? progress : 0);
              setStatus(
                !state.armed
                  ? 'Page captured. Move it out of view for the next scan.'
                  : (found.light || 0) < 45
                    ? 'Add more light for a clearer scan.'
                    : (found.sharpness || 0) < 35
                      ? 'Hold steady and let the camera focus.'
                      : good
                        ? 'Edges found. Hold steady.'
                        : 'Edges found. Keep the document still.',
              );
              if (auto.current && good && progress === 1 && state.armed) void captureRef.current();
            }
          }
        } catch {
          if (!disposed)
            setStatus(
              'Live edge detection is unavailable. Capture manually and adjust the corners.',
            );
        }
      }
      if (!disposed) timer = setTimeout(() => void detect(), 350);
    }
    void detect();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [ready, client]);
  async function cameraSetting(setting: Record<string, number | boolean>) {
    try {
      await stream.current
        ?.getVideoTracks()[0]
        .applyConstraints({ advanced: [setting] as MediaTrackConstraintSet[] });
    } catch {
      setError('This camera could not apply that setting. You can continue scanning.');
    }
  }
  return (
    <section className="scan-camera" aria-label="Camera scanner">
      <div className="scan-camera-heading">
        <div>
          <strong>
            {mode === 'id'
              ? count % 2 === 0
                ? 'Scan the front of the card'
                : 'Scan the back of the card'
              : 'Capture your next page'}
          </strong>
          <p role="status">{status}</p>
        </div>
        <button className="icon-button" aria-label="Close camera" onClick={onClose}>
          <Icon name="X" />
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
          <button
            className="button secondary"
            onClick={() => {
              stream.current?.getTracks().forEach((track) => track.stop());
              onClose();
              onImport();
            }}
          >
            Take or import a photo
          </button>
        </div>
      )}
      <div className="scan-camera-view">
        <div
          className="scan-camera-image"
          style={{ aspectRatio: aspect, '--camera-aspect': aspect } as React.CSSProperties}
        >
          <video
            ref={video}
            muted
            playsInline
            aria-label="Live camera preview"
            onResize={() => {
              if (video.current?.videoWidth && video.current.videoHeight)
                setAspect(video.current.videoWidth / video.current.videoHeight);
            }}
          />
          {quad && (
            <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
              <polygon
                points={quad.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                fill="#bfe78118"
                stroke="#bfe781"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          )}
          {!ready && !error && (
            <span className="scan-camera-wait">
              <span className="spinner" /> Opening camera…
            </span>
          )}
          {working && <span className="scan-camera-wait">Adding page…</span>}
        </div>
      </div>
      <details className="scan-camera-options">
        <summary>
          <Icon name="SlidersHorizontal" size={17} /> Camera options
        </summary>
        <div className="scan-camera-settings">
          <label>
            Document type
            <select
              aria-label="Camera document type"
              value={mode}
              onChange={(event) => onModeChange(event.target.value as ScanMode)}
            >
              {scanModes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={automatic}
              onChange={(e) => {
                onAutomaticChange(e.target.checked);
                stability.current.since = performance.now();
              }}
            />{' '}
            Auto capture when steady
          </label>
          {cameras.length > 1 && (
            <label>
              Camera
              <select
                aria-label="Choose camera"
                value={device}
                onChange={(e) => setDevice(e.target.value)}
              >
                <option value="">Standard rear camera</option>
                {cameras.map((item, i) => (
                  <option key={item.deviceId} value={item.deviceId}>
                    {item.label || `Camera ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {caps.torch && (
            <button
              className="button secondary"
              aria-pressed={torch}
              onClick={() => {
                void cameraSetting({ torch: !torch });
                setTorch(!torch);
              }}
            >
              <Icon name="Zap" size={16} />
              Light
            </button>
          )}
          {caps.zoom && (
            <label>
              Camera zoom
              <input
                aria-label="Camera zoom"
                type="range"
                min={caps.zoom.min}
                max={caps.zoom.max}
                step={caps.zoom.step || 0.1}
                value={zoom}
                onChange={(e) => {
                  setZoom(Number(e.target.value));
                  void cameraSetting({ zoom: Number(e.target.value) });
                }}
              />
            </label>
          )}
        </div>
      </details>
      <div className="scan-capture-row">
        <span>
          {count} {count === 1 ? 'page' : 'pages'} captured
        </span>
        <button
          className="scan-shutter"
          disabled={!ready || working || count >= 40}
          aria-label="Capture page"
          onClick={() => void capture()}
          style={{ '--scan-progress': `${stable * 100}%` } as React.CSSProperties}
        >
          <Icon name="Camera" size={28} />
        </button>
        <button className="button secondary" onClick={onClose}>
          {count ? 'Review scans' : 'Cancel'}
          <Icon name="ArrowRight" size={16} />
        </button>
      </div>
    </section>
  );
}
