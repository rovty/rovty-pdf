import { useEffect, useRef, useState } from 'react';
import { native } from '../lib/native';
import type { Mark, PageInfo, TextLayers } from '../lib/types';

export default function TextMovePreview({
  bytes,
  origin,
  position,
  info,
  scale,
  onError,
}: {
  bytes: Uint8Array;
  origin: Mark;
  position: Mark;
  info: PageInfo;
  scale: number;
  onError: (error: string) => void;
}) {
  const background = useRef<HTMLCanvasElement>(null),
    foreground = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let active = true;
    setReady(false);
    void native<TextLayers>('text-layers', bytes, {
      pageIndex: origin.page,
      mark: origin,
      info,
      scale: scale * Math.min(devicePixelRatio || 1, 2),
    })
      .then((layers) => {
        if (!active) return;
        for (const [ref, pixels] of [
          [background, layers.background],
          [foreground, layers.foreground],
        ] as const) {
          const canvas = ref.current!;
          canvas.width = layers.width;
          canvas.height = layers.height;
          canvas
            .getContext('2d')!
            .putImageData(
              new ImageData(new Uint8ClampedArray(pixels), layers.width, layers.height),
              0,
              0,
            );
        }
        setReady(true);
      })
      .catch((error) => {
        if (active)
          onError(
            error instanceof Error ? error.message : 'The moving text preview could not load.',
          );
      });
    return () => {
      active = false;
    };
  }, [bytes, origin, info, scale, onError]);
  return (
    <div
      className="text-move-preview"
      data-ready={ready}
      style={{ visibility: ready ? 'visible' : 'hidden' }}
      aria-hidden="true"
    >
      <canvas ref={background} />
      <canvas
        ref={foreground}
        className="moving-text-layer"
        style={{
          transform: `translate(${(position.x - origin.x) * scale}px, ${(position.y - origin.y) * scale}px)`,
        }}
      />
    </div>
  );
}
