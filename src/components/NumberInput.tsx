import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { clamp } from '../lib/utils';

/** Keep unfinished input (empty, decimals, or a first digit) intact while typing. */
export default function NumberInput({
  value,
  min,
  max,
  integer = false,
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'min' | 'max' | 'onChange' | 'type'> & {
  value: number;
  min: number;
  max: number;
  integer?: boolean;
  onValueChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const published = useRef(value);
  useLayoutEffect(() => {
    // Undo, selection changes and the other size control can update this field.
    if (value !== published.current) {
      published.current = value;
      setText(String(value));
    }
  }, [value]);
  function publish(next: number) {
    published.current = next;
    if (next !== value) onValueChange(next);
  }
  function finish() {
    if (text === String(value)) return;
    const number = text.trim() ? Number(text) : value;
    const next = Number.isFinite(number)
      ? clamp(integer ? Math.round(number) : number, min, max)
      : value;
    setText(String(next));
    publish(next);
  }
  return (
    <input
      {...props}
      type="number"
      min={min}
      max={max}
      step={props.step ?? (integer ? 1 : 'any')}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const number = Number(next);
        if (
          next.trim() &&
          Number.isFinite(number) &&
          number >= min &&
          number <= max &&
          (!integer || Number.isInteger(number))
        )
          publish(number);
      }}
      onBlur={(event) => {
        finish();
        props.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          finish();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          setText(String(value));
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}
