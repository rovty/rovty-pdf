import { useEffect, useRef, useState } from 'react';
import { nativeText } from '../lib/native';
import { groupTextLines, textSources } from '../lib/textBlocks';
import { markFromText } from '../lib/editorObjects';
import { applyTextEdits } from '../lib/textEdits';
import { humanError } from '../lib/utils';
import type { EditState, Mark, SourceFile } from '../lib/types';
import { Icon } from './Icon';

export default function FindReplace({
  source,
  value,
  onChange,
  onSelect,
  onClose,
  disabled,
}: {
  source: SourceFile;
  value: EditState;
  onChange: (value: EditState) => void;
  onSelect: (mark: Mark) => void;
  onClose: () => void;
  disabled: boolean;
}) {
  const [query, setQuery] = useState(''),
    [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false),
    [lines, setLines] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const latest = useRef(value);
  const mounted = useRef(true);
  latest.current = value;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void (async () => {
      try {
        const result: Mark[] = [];
        for (let page = 0; page < source.pages.length && active; page++) {
          result.push(
            ...groupTextLines(await nativeText(source.bytes, page)).map((item) =>
              markFromText(source, page, item),
            ),
          );
        }
        if (active) setLines(result);
      } catch (e) {
        if (active) setError(humanError(e));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [source]);
  const paths = new Set(
    value.marks.flatMap((mark) =>
      mark.originalText
        ? textSources(mark.originalText).map((item) => `${mark.page}:${item.path.join('.')}`)
        : [],
    ),
  );
  const all = [
    ...lines.filter((line) => !paths.has(`${line.page}:${line.sourcePath!.join('.')}`)),
    ...value.marks.filter((mark) => mark.kind === 'text'),
  ];
  const expression = new RegExp(
    query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    matchCase ? 'g' : 'gi',
  );
  const hits = query
    ? all.flatMap((mark) =>
        [...(mark.text || '').matchAll(expression)].map((match) => ({
          mark,
          index: match.index,
          length: match[0].length,
        })),
      )
    : [];
  async function replace(allMatches: boolean) {
    if (!hits.length || busy || disabled) return;
    const before = value;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const replacements = new Map<string, Mark>();
      for (const { mark, index, length } of allMatches ? hits : hits.slice(0, 1)) {
        if (replacements.has(mark.id)) continue;
        replacements.set(mark.id, {
          ...mark,
          text: allMatches
            ? (mark.text || '').replace(expression, () => replacement)
            : mark.text!.slice(0, index) + replacement + mark.text!.slice(index + length),
        });
      }
      const marks = [
        ...value.marks.filter((mark) => !replacements.has(mark.id)),
        ...replacements.values(),
      ];
      // Reject unsupported original-font glyphs before committing a multi-page change.
      await applyTextEdits(source, marks);
      if (!mounted.current) return;
      if (latest.current !== before)
        throw new Error('The document changed while checking fonts. Try replacing again.');
      onChange({ ...value, marks });
      setStatus(
        `Replaced ${allMatches ? hits.length : 1} ${allMatches && hits.length !== 1 ? 'matches' : 'match'}.`,
      );
    } catch (e) {
      setError(humanError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="find-panel" aria-label="Find and replace">
      <div className="find-panel-title">
        <strong>Find &amp; replace</strong>
        <button className="icon-button" aria-label="Close find and replace" onClick={onClose}>
          <Icon name="X" size={16} />
        </button>
      </div>
      <div className="find-inputs">
        <label className="field">
          Find text
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setStatus('');
            }}
          />
        </label>
        <label className="field">
          Replace with
          <input value={replacement} onChange={(e) => setReplacement(e.target.value)} />
        </label>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={matchCase}
            onChange={(e) => setMatchCase(e.target.checked)}
          />
          Match case
        </label>
        <button
          className="button secondary"
          disabled={disabled || busy || loading || !hits.length}
          onClick={() => void replace(false)}
        >
          Replace first
        </button>
        <button
          className="button secondary"
          disabled={disabled || busy || loading || !hits.length}
          onClick={() => void replace(true)}
        >
          {busy ? 'Checking fonts…' : 'Replace all'}
        </button>
      </div>
      <p role="status">
        {loading
          ? 'Reading document text…'
          : `${hits.length} matches across ${source.pages.length} pages. ${status || 'Search stays on your device.'}`}
      </p>
      {error && (
        <p role="alert" className="text-edit-error">
          {error}
        </p>
      )}
      {!loading && (
        <div className="find-results">
          {hits.slice(0, 100).map(({ mark, index }, i) => (
            <button
              key={`${mark.id}-${index}`}
              disabled={disabled || busy}
              onClick={() => onSelect(mark)}
            >
              <span>Page {mark.page + 1}</span>{' '}
              {mark.text?.slice(Math.max(0, index - 30), index + query.length + 50)}
              <span className="sr-only"> Match {i + 1}</span>
            </button>
          ))}
          {hits.length > 100 && (
            <span>Showing the first 100 matches. Replace all includes every match.</span>
          )}
        </div>
      )}
    </section>
  );
}
