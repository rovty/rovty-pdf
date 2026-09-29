import type { Mark } from '../lib/types';

export default function MarkGraphic({ mark: m }: { mark: Mark }) {
  if (m.kind === 'highlight' && m.highlightRects)
    return (
      <g
        className="text-highlight-mark"
        fill={m.color}
        opacity={m.opacity}
        style={{ mixBlendMode: 'multiply' }}
      >
        {m.highlightRects.map((rect, index) => (
          <rect
            key={index}
            x={m.x + rect.x}
            y={m.y + rect.y}
            width={rect.width}
            height={rect.height}
          />
        ))}
      </g>
    );
  if (m.kind === 'text')
    return (
      <text
        x={m.x}
        y={m.y + m.fontSize * 0.9}
        fill={m.color}
        opacity={m.opacity}
        fontSize={m.fontSize}
        fontFamily="Noto PDF"
      >
        <tspan>{(m.text || '').split('\n')[0]}</tspan>
        {(m.text || '')
          .split('\n')
          .slice(1)
          .map((line, i) => (
            <tspan key={i} x={m.x} dy={m.fontSize * 1.2}>
              {line}
            </tspan>
          ))}
      </text>
    );
  if (m.kind === 'image')
    return (
      <image
        href={m.dataUrl}
        x={m.x}
        y={m.y}
        width={m.width}
        height={m.height}
        opacity={m.opacity}
        preserveAspectRatio="none"
      />
    );
  if (
    m.kind === 'pen' ||
    m.kind === 'line' ||
    (m.kind === 'highlight' && m.highlightMode === 'freehand')
  )
    return (
      <polyline
        className={m.kind === 'highlight' ? 'freehand-highlight-mark' : undefined}
        style={m.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
        points={(
          m.points || [
            [0, 0],
            [m.width, m.height],
          ]
        )
          .map((pt) => `${m.x + pt[0]},${m.y + pt[1]}`)
          .join(' ')}
        fill="none"
        stroke={m.color}
        strokeWidth={m.strokeWidth}
        opacity={m.opacity}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  if (m.kind === 'ellipse')
    return (
      <ellipse
        cx={m.x + m.width / 2}
        cy={m.y + m.height / 2}
        rx={m.width / 2}
        ry={m.height / 2}
        fill={m.fillColor || 'none'}
        stroke={m.color}
        strokeWidth={m.strokeWidth}
        opacity={m.opacity}
      />
    );
  return (
    <rect
      x={m.x}
      y={m.y}
      width={m.width}
      height={m.height}
      fill={
        m.kind === 'rectangle'
          ? m.fillColor || 'none'
          : m.kind === 'cover'
            ? '#fff'
            : m.kind === 'redact'
              ? '#000'
              : m.kind === 'link'
                ? '#668bc72b'
                : m.color
      }
      opacity={m.kind === 'redact' || m.kind === 'cover' ? 1 : m.opacity}
      stroke={m.kind === 'rectangle' ? m.color : m.kind === 'link' ? '#4c76a8' : 'none'}
      strokeWidth={m.strokeWidth}
      style={m.kind === 'highlight' ? { mixBlendMode: 'multiply' } : undefined}
    />
  );
}
