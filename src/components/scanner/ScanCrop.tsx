import { useRef, type PointerEvent, type CSSProperties } from 'react';
import { validQuad, type ScanPage, type ScanQuad } from '../../lib/scannerTypes';
export default function ScanCrop({
  page,
  onChange,
  disabled,
}: {
  page: ScanPage;
  onChange: (quad: ScanQuad) => void;
  disabled: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null),
    drag = useRef<number | undefined>(undefined);
  const names = ['Top left', 'Top right', 'Bottom right', 'Bottom left'];
  function move(event: PointerEvent<SVGSVGElement>) {
    if (drag.current === undefined || disabled) return;
    const box = svg.current!.getBoundingClientRect();
    const next = page.quad.map((p, i) =>
      i === drag.current
        ? {
            x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
            y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
          }
        : p,
    ) as ScanQuad;
    if (validQuad(next)) onChange(next);
  }
  const polygon = page.quad.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ');
  return (
    <div
      className="scan-crop"
      style={
        {
          aspectRatio: `${page.width}/${page.height}`,
          '--scan-aspect': page.width / page.height,
        } as CSSProperties
      }
    >
      <img
        src={page.sourceUrl}
        alt="Original photo with adjustable document corners"
        draggable={false}
      />
      <svg
        ref={svg}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
        aria-label="Document crop corners"
      >
        <path
          d={`M0 0H1000V1000H0Z M${polygon.replaceAll(' ', 'L')}Z`}
          fill="#101b2466"
          fillRule="evenodd"
        />
        <polygon
          points={polygon}
          fill="transparent"
          stroke="#bfe781"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {page.quad.map((point, index) => (
          <g
            key={index}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={`${names[index]} crop corner`}
            aria-valuetext={`${Math.round(point.x * 1000) / 10} percent across, ${Math.round(point.y * 1000) / 10} percent down`}
            aria-valuenow={Math.round(point.x * 1000) / 10}
            aria-valuemin={0}
            aria-valuemax={100}
            onPointerDown={(event) => {
              if (disabled) return;
              event.preventDefault();
              drag.current = index;
              svg.current!.setPointerCapture(event.pointerId);
            }}
            onKeyDown={(event) => {
              if (
                disabled ||
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
              )
                return;
              event.preventDefault();
              const step = event.shiftKey ? 0.025 : 0.005;
              const next = page.quad.map((p, i) =>
                i === index
                  ? {
                      x: Math.max(
                        0,
                        Math.min(
                          1,
                          p.x +
                            (event.key === 'ArrowLeft'
                              ? -step
                              : event.key === 'ArrowRight'
                                ? step
                                : 0),
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          1,
                          p.y +
                            (event.key === 'ArrowUp'
                              ? -step
                              : event.key === 'ArrowDown'
                                ? step
                                : 0),
                        ),
                      ),
                    }
                  : p,
              ) as ScanQuad;
              if (validQuad(next)) onChange(next);
            }}
          >
            <circle cx={point.x * 1000} cy={point.y * 1000} r="75" fill="transparent" />
            <circle
              cx={point.x * 1000}
              cy={point.y * 1000}
              r="9"
              fill="white"
              stroke="#5b793e"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
    </div>
  );
}
