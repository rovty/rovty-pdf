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
  onClose,
}: {
  choice: FontChoice;
  text: string;
  onReplace: (font: string, remember: boolean) => void;
  onClose: () => void;
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
        onClose();
      }}
    >
      <div className="font-choice-heading">
        <h2 id="font-choice-title">Change font</h2>
        <button className="icon-button" aria-label="Close font chooser" onClick={onClose}>
          <Icon name="X" size={20} />
        </button>
      </div>
      <p id="font-choice-description">
        Rovty matched a similar font so you can keep editing. You can choose another font for this
        line.
      </p>
      <p className="font-choice-original">
        Original PDF font: <strong>{choice.originalFont}</strong>
      </p>
      <fieldset>
        <legend>Font used for this line</legend>
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
                {index === 0 && <small>Current</small>}
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
      <p className="font-choice-note">
        Regular means normal text weight; Bold and Italic are different styles.
      </p>
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
        Use for other lines that need a match for {choice.originalFont}
      </label>
      <p className="font-choice-note">
        Size and color stay the same; letter shapes and spacing may differ. Closing this window
        keeps your text and current font.
      </p>
      <div className="font-choice-actions">
        <button className="button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button"
          disabled={!loaded[selected]}
          onClick={() => onReplace(selected, remember)}
        >
          Apply font
        </button>
      </div>
    </dialog>
  );
}
