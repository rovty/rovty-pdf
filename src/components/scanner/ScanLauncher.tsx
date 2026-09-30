import { useState } from 'react';
import { Icon } from '../Icon';
import type Scanner from './Scanner';
import type { ScannerProps } from './Scanner';
import { followLink } from '../../lib/navigation';
export default function ScanLauncher(
  props: Omit<ScannerProps, 'initialFiles' | 'startCamera' | 'onExit'> & {
    navigate: (path: string) => void;
  },
) {
  const [loaded, setLoaded] = useState<{
      Component: typeof Scanner;
      files: File[];
      camera: boolean;
    }>(),
    [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  async function start(camera: boolean, files: File[] = []) {
    setLoading(true);
    setError('');
    try {
      const module = await import('./Scanner');
      setLoaded({ Component: module.default, files, camera });
    } catch {
      setError('The scanner could not load. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }
  if (loaded)
    return (
      <loaded.Component
        {...props}
        onExit={() => props.navigate('/')}
        initialFiles={loaded.files}
        startCamera={loaded.camera}
      />
    );
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div>
          <span className="tool-icon mint">
            <Icon name="ScanLine" size={24} />
          </span>
          <div>
            <h1>Scan to PDF</h1>
            <p>Your camera. A clearer document.</p>
          </div>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <section className="upload-zone">
        <div className="upload-art mint">
          <Icon name="Camera" size={42} />
        </div>
        <h2>A pocket scanner, in your browser.</h2>
        <p>
          Scan documents, receipts, whiteboards and ID cards. Straighten edges, clean up shadows,
          and save a multi-page PDF.
        </p>
        <button
          className="button upload-button"
          disabled={loading}
          onClick={() => void start(true)}
        >
          <Icon name="Camera" size={20} />
          {loading ? 'Opening scanner…' : 'Use camera'}
        </button>
        <button className="sample-link" disabled={loading} onClick={() => void start(false)}>
          Open scanner & import photos
          <Icon name="ArrowRight" size={15} />
        </button>
        <span className="upload-private">
          <Icon name="ShieldCheck" size={15} />
          No uploads, no account, no watermarks.
        </span>
        <p className="upload-limit">
          Camera access is requested only when you choose it. Photos stay on your device.
        </p>
      </section>
      <div className="tool-explainer">
        <div>
          <Icon name="Camera" />
          <h3>1. Capture your pages.</h3>
          <p>
            Use the live camera or import photos. Capture documents in a batch, including the front
            and back of an ID.
          </p>
        </div>
        <div>
          <Icon name="Crop" />
          <h3>2. Make every scan clear.</h3>
          <p>
            Automatic edge detection and adjustable corners correct perspective. Preview clean
            color, grayscale or black-and-white scans.
          </p>
        </div>
        <div>
          <Icon name="Download" />
          <h3>3. Create your PDF.</h3>
          <p>
            Arrange pages, choose A4, Letter or a custom fit, then download. You can continue in the
            PDF editor.
          </p>
        </div>
      </div>
      <section className="tool-explainer">
        <div>
          <h3>Does Rovty upload my scans?</h3>
          <p>
            No. Camera frames, ID cards and imported photos are processed on your device. They are
            not saved in cookies or browser storage.
          </p>
        </div>
        <div>
          <h3>Can I scan without a live camera?</h3>
          <p>
            Yes. Import existing photos or use your phone’s camera picker. You can adjust corners
            even when automatic detection cannot find an edge.
          </p>
        </div>
        <div>
          <h3>Can I make a black-and-white PDF?</h3>
          <p>
            Yes. Choose Black & white for crisp document scans, or Grayscale to keep shades in
            photos and illustrations.
          </p>
        </div>
      </section>
      <div className="workspace-back">
        <a href="/" onClick={(event) => followLink(event, props.navigate)}>
          <Icon name="ArrowLeft" size={16} />
          All PDF tools
        </a>
        <a href="/privacy" onClick={(event) => followLink(event, props.navigate)}>
          How privacy works
        </a>
      </div>
    </div>
  );
}
