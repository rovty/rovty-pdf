import { useRef, useState } from 'react';
import { Icon } from './Icon';
import { tools } from '../lib/catalog';
import { followLink } from '../lib/navigation';
import { humanError } from '../lib/utils';
import { MAX_FILE_SIZE, MAX_TOTAL_SIZE } from '../lib/limits';
import type { Tool } from '../lib/types';

type UploadProps = {
  tool: Tool;
  onFiles: (files: File[]) => void | Promise<void>;
  loading?: boolean;
};

// No eager PDF-engine imports: this screen is usable before the editor downloads.
export function ToolUpload({ tool, onFiles, loading = false }: UploadProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  const locked = useRef(false);
  const busy = loading || opening;
  const isImages = tool.id === 'images-to-pdf';
  async function open(source: File[] | 'sample' | 'blank') {
    if (loading || locked.current || (Array.isArray(source) && !source.length)) return;
    locked.current = true;
    setOpening(true);
    setError('');
    try {
      let files: File[];
      if (source === 'sample') {
        const { demoFile } = await import('../lib/pdf');
        files = [await demoFile()];
      } else if (source === 'blank') {
        const { PDFDocument } = await import('pdf-lib');
        const document = await PDFDocument.create();
        document.addPage([595.28, 841.89]);
        files = [
          new File([new Uint8Array(await document.save())], 'Untitled.pdf', {
            type: 'application/pdf',
          }),
        ];
      } else files = source;
      if (files.length > 50 || files.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE)
        throw new Error('Choose up to 50 files totaling less than 160 MB.');
      if (isImages) {
        if (files.some((file) => !/^image\/(jpeg|png|webp)$/.test(file.type)))
          throw new Error('Choose JPG, PNG or WebP images.');
      } else {
        for (const file of files) {
          if (file.size > MAX_FILE_SIZE)
            throw new Error('Choose a PDF smaller than 80 MB to fit browser memory.');
          if (!(await file.slice(0, 1024).text()).includes('%PDF-'))
            throw new Error(
              'This file could not be read as a PDF. Use Images to PDF for photos and scans.',
            );
        }
      }
      await onFiles(tool.multiple ? files : files.slice(0, 1));
    } catch (cause) {
      setError(humanError(cause));
    } finally {
      locked.current = false;
      setOpening(false);
      if (input.current) input.current.value = '';
    }
  }
  return (
    <>
      {error && (
        <p className="error-banner" role="alert">
          {error}
        </p>
      )}
      <div
        className={`upload-zone ${dragging ? 'drag-over' : ''}`}
        aria-busy={busy}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void open(Array.from(event.dataTransfer.files));
        }}
      >
        <input
          ref={input}
          className="sr-only"
          type="file"
          disabled={busy}
          aria-label={isImages ? 'Choose images' : 'Choose PDF files'}
          accept={isImages ? 'image/jpeg,image/png,image/webp' : '.pdf,application/pdf'}
          multiple={tool.multiple}
          onChange={(event) => void open(Array.from(event.target.files || []))}
        />
        <div className={`upload-art ${tool.accent}`}>
          <Icon name={isImages ? 'Images' : 'FileUp'} size={41} />
          <span>+</span>
        </div>
        <h2>
          {busy
            ? 'Opening your file…'
            : isImages
              ? 'A PDF starts with your images.'
              : 'Let’s start with your PDF.'}
        </h2>
        <p>
          {isImages
            ? 'Drop JPG, PNG or WebP images here.'
            : 'Drag and drop your PDF here, or choose a file.'}
        </p>
        <button
          className="button upload-button"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          {busy ? <span className="spinner light" /> : <Icon name="Plus" size={19} />}
          {isImages ? 'Choose images' : tool.multiple ? 'Choose PDF files' : 'Choose a PDF'}
        </button>
        <span className="upload-limit">
          {isImages
            ? 'JPG, PNG or WebP · up to 50 images'
            : 'PDF files up to 80 MB · no sign-up needed'}
        </span>
        {!isImages && (
          <button className="sample-link" disabled={busy} onClick={() => void open('sample')}>
            Just looking? Try a sample PDF <Icon name="ArrowRight" size={14} />
          </button>
        )}
        {tool.editor && (
          <button className="sample-link" disabled={busy} onClick={() => void open('blank')}>
            Start with a blank document <Icon name="Plus" size={14} />
          </button>
        )}
        <noscript>
          Enable JavaScript to use these tools. Files are processed in your browser.
        </noscript>
        <span className="upload-private">
          <Icon name="ShieldCheck" size={14} /> Your documents stay on your device.
        </span>
        <span className="sr-only" role="status">
          {busy ? 'Opening your file. Please wait.' : ''}
        </span>
      </div>
    </>
  );
}

export function ToolHelp({ tool, navigate }: { tool: Tool; navigate: (path: string) => void }) {
  const related = tools
    .filter((item) => item.category === tool.category && item.id !== tool.id)
    .slice(0, 3);
  return (
    <>
      <div className="tool-explainer">
        <div>
          <Icon name="FileUp" size={20} />
          <h3>1. Choose your file.</h3>
          <p>
            Open {tool.id === 'images-to-pdf' ? 'your images' : 'a PDF'} from your device. No
            account or upload is needed for local tools.
          </p>
        </div>
        <div>
          <Icon name={tool.icon} size={20} />
          <h3>2. Make it yours.</h3>
          <p>{tool.detail}</p>
        </div>
        <div>
          <Icon name="Download" size={20} />
          <h3>3. Download the result.</h3>
          <p>
            Review your changes and choose “{tool.action}”. Keep your original and save a new copy
            without an added watermark.
          </p>
        </div>
      </div>
      <nav className="related-tools" aria-label="Related PDF tools">
        <span>More for your document</span>
        {related.map((item) => (
          <a key={item.id} href={`/${item.id}`} onClick={(event) => followLink(event, navigate)}>
            {item.name}
            <Icon name="ArrowUpRight" size={14} />
          </a>
        ))}
      </nav>
      <div className="workspace-back">
        <a href="/" onClick={(event) => followLink(event, navigate)}>
          <Icon name="ArrowLeft" size={16} /> Explore all PDF tools
        </a>
        <span>Made for the everyday.</span>
      </div>
    </>
  );
}

export default function ToolLanding({
  tool,
  onFiles,
  navigate,
  loading,
}: UploadProps & { navigate: (path: string) => void }) {
  return (
    <div className="workspace">
      <div className="workspace-heading">
        <div>
          <span className={`tool-icon small ${tool.accent}`}>
            <Icon name={tool.icon} size={22} />
          </span>
          <div>
            <h1>{tool.name}</h1>
            <p>{tool.description}</p>
          </div>
        </div>
      </div>
      <ToolUpload tool={tool} onFiles={onFiles} loading={loading} />
      <ToolHelp tool={tool} navigate={navigate} />
    </div>
  );
}
