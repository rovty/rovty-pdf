import { useEffect, useRef, useState } from 'react';
import { native } from '../lib/native';
import { hasLocalFont, setLocalFont, removeLocalFont } from '../lib/localFonts';
import { recoveryFontName, type RecoveredFont } from '../lib/fontRecovery';
import { MAX_FONT_BYTES } from '../../shared/fonts';
import type { SourceFile } from '../lib/types';
import { humanError } from '../lib/utils';

type LocalFontWindow = Window & {
  queryLocalFonts?: (options: {
    postscriptNames: string[];
  }) => Promise<{ postscriptName: string; blob: () => Promise<Blob> }[]>;
};

export default function MatchingFont({
  source,
  name,
  disabled,
  onChange,
}: {
  source: SourceFile;
  name: string;
  disabled: boolean;
  onChange: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(true);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [loaded, setLoaded] = useState(() => hasLocalFont(source, name));
  const query = (window as LocalFontWindow).queryLocalFonts;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  async function load(getFile: () => Promise<Blob>) {
    setBusy(true);
    setError('');
    try {
      const file = await getFile();
      if (file.size > MAX_FONT_BYTES || file.size < 4)
        throw new Error('Choose a TTF or OTF font file up to 12 MB.');
      const font = await native<RecoveredFont>(
        'prepare-font',
        new Uint8Array(await file.arrayBuffer()),
        { fontName: name },
      );
      if (!active.current) return;
      setLocalFont(source, font);
      setLoaded(true);
      onChange();
    } catch (e) {
      if (!active.current) return;
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? 'Font access was not allowed. You can choose a matching font file instead.'
          : humanError(e),
      );
    } finally {
      if (active.current) setBusy(false);
    }
  }

  return (
    <div className="matching-font">
      <button
        className="button secondary"
        disabled={disabled || busy}
        onClick={() => input.current?.click()}
      >
        {busy ? 'Checking font…' : 'Use matching font file'}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept=".ttf,.otf"
        aria-label="Matching font file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void load(async () => file);
        }}
      />
      {query && (
        <button
          className="button secondary"
          disabled={disabled || busy}
          onClick={() =>
            void load(async () => {
              const fonts = await query.call(window, { postscriptNames: [recoveryFontName(name)] });
              if (!fonts.length)
                throw new Error(
                  `${recoveryFontName(name)} was not found on this device. Choose a matching font file instead.`,
                );
              return fonts[0].blob();
            })
          }
        >
          Use installed font
        </button>
      )}
      <p className="inspector-note">
        {loaded
          ? 'Font file loaded for this PDF. '
          : `Choose the full ${recoveryFontName(name)} font (.ttf or .otf, up to 12 MB). `}
        Letters and spacing are checked before use. The font stays in memory for this open PDF and
        is embedded in your download. It is never uploaded.
      </p>
      {loaded && (
        <button
          className="button secondary"
          disabled={disabled || busy}
          onClick={() => {
            removeLocalFont(source, name);
            setLoaded(false);
            setError('');
            onChange();
          }}
        >
          Remove loaded font
        </button>
      )}
      {error && (
        <p className="matching-font-error text-edit-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
