import { useEffect, useRef, useState } from 'react';
import { fallbackFontLabel } from '../lib/fontLabels';
import type { FontChoice } from '../lib/fontChoice';
import { Icon } from './Icon';

const faces = new Map<string, Promise<string>>();
function previewFont(name: string) {
  let ready = faces.get(name);
  if (!ready) {
    ready = (async () => {
      const response = await fetch(
        `/fonts/${name.startsWith('NotoSerif-') ? 'fallback/' : ''}${name}.ttf`,
        { credentials: 'omit', referrerPolicy: 'no-referrer' },
      );
      if (!response.ok) throw new Error('Font preview could not load.');
      const family = `RovtyChoice-${name}`;
      const face = new FontFace(family, await response.arrayBuffer());
      document.fonts.add(await face.load());
      return family;
    })().catch((error) => {
      faces.delete(name);
      throw error;
    });
    faces.set(name, ready);
  }
  return ready;
}

export default function FontChoiceDialog({
  choice,
  text,
  onReplace,
  onKeep,
}: {
  choice: FontChoice;
  text: string;
  onReplace: (font: string, remember: boolean) => void;
  onKeep: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(choice.replacementFont);
  const [remember, setRemember] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false),
    [retry, setRetry] = useState(0);
  const alternative = choice.replacementFont.startsWith('NotoSerif-')
    ? choice.replacementFont.replace('NotoSerif-', 'NotoSans-')
    : choice.replacementFont.replace('NotoSans-', 'NotoSerif-');
  const fonts = [choice.replacementFont, alternative];
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  useEffect(() => {
    let active = true;
    setFailed(false);
    for (const name of [choice.replacementFont, alternative]) {
      void previewFont(name)
        .then((family) => {
          if (active) setLoaded((current) => ({ ...current, [name]: family }));
        })
        .catch(() => {
          if (active) setFailed(true);
        });
    }
    return () => {
      active = false;
    };
  }, [choice.replacementFont, alternative, retry]);
  return (
    <dialog
      ref={dialog}
      className="font-choice-dialog"
      aria-labelledby="font-choice-title"
      aria-describedby="font-choice-description"
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
    >
      <div className="font-choice-heading">
        <h2 id="font-choice-title">Font replacement</h2>
        <button className="icon-button" aria-label="Keep original and close" onClick={onKeep}>
          <Icon name="X" size={20} />
        </button>
      </div>
      <p id="font-choice-description">
        The original font cannot write all the characters in this edit. Choose a replacement for
        this line.
      </p>
      <p className="font-choice-original">
        Original font: <strong>{choice.originalFont}</strong>
      </p>
      <fieldset>
        <legend>Choose a replacement font</legend>
        {fonts.map((font, index) => (
          <label key={font} className={`font-choice-option ${selected === font ? 'selected' : ''}`}>
            <input
              type="radio"
              name="replacement-font"
              value={font}
              checked={selected === font}
              onChange={() => setSelected(font)}
            />
            <span>
              <span className="font-choice-name">
                {fallbackFontLabel(font)}
                {index === 0 && <small>Suggested</small>}
              </span>
              {loaded[font] ? (
                <span className="font-choice-sample" style={{ fontFamily: loaded[font] }}>
                  {text || 'Aa Bb Cc 123'}
                </span>
              ) : (
                <span className="font-choice-loading">
                  {failed ? 'Preview unavailable' : 'Loading preview…'}
                </span>
              )}
            </span>
          </label>
        ))}
      </fieldset>
      {failed && (
        <p role="status">
          A font preview could not load.{' '}
          <button className="text-button" onClick={() => setRetry((value) => value + 1)}>
            Retry previews
          </button>
        </p>
      )}
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Use this choice for {choice.originalFont} in this PDF
      </label>
      <p className="font-choice-note">
        Only lines that need a replacement will change. Size and color stay the same; letter shapes
        and spacing may differ. This choice lasts until you close the document.
      </p>
      <div className="font-choice-actions">
        <button className="button secondary" onClick={onKeep}>
          Keep original
        </button>
        <button
          className="button"
          disabled={!loaded[selected]}
          onClick={() => onReplace(selected, remember)}
        >
          Replace
        </button>
      </div>
    </dialog>
  );
}
