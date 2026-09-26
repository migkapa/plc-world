/**
 * Small SVG icons in the Logix Designer spirit: instruction glyphs for the palette and tree icons
 * for the Controller Organizer. All use `currentColor`.
 */
import type { SVGProps } from 'react';
import { glyphOf } from './layout';

type P = SVGProps<SVGSVGElement> & { size?: number };

/** Mini instruction glyph for the palette (contact / coil / box). */
export function InstrGlyph({ op, width = 34, height = 16, ...rest }: { op: string; width?: number; height?: number } & SVGProps<SVGSVGElement>) {
  const look = glyphOf(op);
  const y = height / 2;
  const cx = width / 2;
  const sw = 1.4;
  if (look.display === 'box') {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" stroke="currentColor" strokeWidth={sw} {...rest}>
        <path d={`M0 ${y - 3}H7M${width - 7} ${y - 3}H${width}`} />
        <rect x={7} y={1.5} width={width - 14} height={height - 3} rx={1.5} />
        <path d={`M10 ${y - 3}H${width - 14}M10 ${y + 1}H${width - 17}M10 ${y + 4}H${width - 19}`} strokeWidth={1} opacity={0.6} />
      </svg>
    );
  }
  if (look.display === 'contact') {
    const hw = 4.5;
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" stroke="currentColor" strokeWidth={sw} {...rest}>
        <path d={`M0 ${y}H${cx - hw}M${cx + hw} ${y}H${width}`} />
        <path d={`M${cx - hw - 2} ${y - 5.5}H${cx - hw}V${y + 5.5}H${cx - hw - 2}M${cx + hw + 2} ${y - 5.5}H${cx + hw}V${y + 5.5}H${cx + hw + 2}`} />
        {look.glyph === 'xio' && <path d={`M${cx - 2.5} ${y + 4}L${cx + 2.5} ${y - 4}`} />}
        {look.glyph === 'contact' && <circle cx={cx} cy={y} r={1.3} fill="currentColor" stroke="none" />}
      </svg>
    );
  }
  const hw = 5.5;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" stroke="currentColor" strokeWidth={sw} {...rest}>
      <path d={`M0 ${y}H${cx - hw}M${cx + hw} ${y}H${width}`} />
      <path d={`M${cx - hw + 3} ${y - 5.5}A6.5 6.5 0 0 0 ${cx - hw + 3} ${y + 5.5}M${cx + hw - 3} ${y - 5.5}A6.5 6.5 0 0 1 ${cx + hw - 3} ${y + 5.5}`} />
      {look.text && look.text.length === 1 && (
        <text x={cx} y={y + 2.6} fontSize={7} fontWeight={700} textAnchor="middle" fill="currentColor" stroke="none" fontFamily="var(--font-mono)">
          {look.text}
        </text>
      )}
      {look.text && look.text.length > 1 && <circle cx={cx} cy={y} r={1.3} fill="currentColor" stroke="none" />}
    </svg>
  );
}

export function RungGlyph({ width = 34, height = 16, ...rest }: { width?: number; height?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" stroke="currentColor" strokeWidth={1.4} {...rest}>
      <path d={`M3 1V${height - 1}M${width - 3} 1V${height - 1}M3 ${height / 2}H${width - 3}`} />
    </svg>
  );
}

export function BranchGlyph({ width = 34, height = 16, level, ...rest }: { width?: number; height?: number; level?: boolean } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" stroke="currentColor" strokeWidth={1.4} {...rest}>
      <path d={`M0 4H${width}M7 4V12H${width - 7}V4`} />
      {level && <path d={`M${width / 2 - 3} 13.5H${width / 2 + 3}M${width / 2} 10.5V16.5`} strokeWidth={1.6} transform="translate(0,-2)" />}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Organizer icons (16 px)
// ---------------------------------------------------------------------------

export function ControllerIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="2" y="1.5" width="12" height="13" rx="1.5" fill="#3b4b5e" stroke="#94a3b8" strokeWidth="1" />
      <rect x="4" y="3.5" width="8" height="3" rx="0.5" fill="#0b1016" />
      <circle cx="5" cy="9" r="1" fill="#22c55e" />
      <circle cx="8" cy="9" r="1" fill="#22c55e" />
      <circle cx="11" cy="9" r="1" fill="#f59e0b" />
      <rect x="4" y="11.3" width="8" height="1.4" rx="0.5" fill="#64748b" />
    </svg>
  );
}

export function TagsIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#e2e8f0" stroke="#64748b" />
      <path d="M1.5 5.5H14.5M1.5 8.5H14.5M1.5 11H14.5M6 2.5V13.5" stroke="#64748b" strokeWidth="0.9" />
      <rect x="1.5" y="2.5" width="13" height="3" fill="#3b82f6" opacity="0.85" />
    </svg>
  );
}

export function FolderIcon({ size = 16, open, ...rest }: P & { open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z" fill="#d4a93a" stroke="#8a6a18" strokeWidth="0.8" />
      {open ? <path d="M1.5 13.5l2-6.5h12l-2 6.5z" fill="#f2c94c" stroke="#8a6a18" strokeWidth="0.8" /> : <path d="M1.5 6h13" stroke="#8a6a18" strokeWidth="0.6" />}
    </svg>
  );
}

export function TaskIcon({ size = 16, periodic, ...rest }: P & { periodic?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <circle cx="8" cy="8" r="6.2" fill="#e0f2fe" stroke="#0369a1" strokeWidth="1" />
      {periodic ? (
        <path d="M8 4.2V8l2.6 1.6" stroke="#0369a1" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      ) : (
        <path d="M5 8a3 3 0 1 0 1-2.3M5 4.4v1.6h1.6" stroke="#0369a1" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      )}
    </svg>
  );
}

export function ProgramIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z" fill="#6aa0d8" stroke="#1e4f86" strokeWidth="0.8" />
      <circle cx="8.5" cy="9.3" r="2.4" fill="none" stroke="#fff" strokeWidth="1.1" />
      <circle cx="8.5" cy="9.3" r="0.8" fill="#fff" />
    </svg>
  );
}

export function RoutineIcon({ size = 16, main, ...rest }: P & { main?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="1.5" y="1.5" width="13" height="13" rx="1" fill="#f8fafc" stroke="#64748b" />
      <path d="M3.5 3V13M12.5 3V13M3.5 6H12.5M3.5 10H12.5" stroke="#0f172a" strokeWidth="1" />
      <path d="M6 5v2M7.5 5v2M9.5 9v2M11 9v2" stroke="#16a34a" strokeWidth="1" />
      {main && (
        <g>
          <circle cx="12.6" cy="12.6" r="3" fill="#e0252b" />
          <text x="12.6" y="14.6" fontSize="5" fontWeight="800" fill="#fff" textAnchor="middle" fontFamily="var(--font-sans)">
            1
          </text>
        </g>
      )}
    </svg>
  );
}

export function ModuleIcon({ size = 16, kind = 'DI', ...rest }: P & { kind?: string }) {
  const color = kind === 'CPU' ? '#e0252b' : kind === 'COMM' ? '#0ea5e9' : kind.startsWith('A') ? '#a855f7' : kind === 'DO' ? '#f59e0b' : '#22c55e';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="4" y="1" width="8" height="14" rx="1" fill="#334155" stroke="#94a3b8" strokeWidth="0.8" />
      <rect x="5.3" y="2.5" width="5.4" height="2" fill={color} />
      <path d="M5.5 7h5M5.5 9h5M5.5 11h5" stroke="#94a3b8" strokeWidth="0.7" />
    </svg>
  );
}

export function BackplaneIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="1" y="3" width="14" height="10" rx="1" fill="#1e293b" stroke="#94a3b8" strokeWidth="0.8" />
      <path d="M3.5 4.5v7M6 4.5v7M8.5 4.5v7M11 4.5v7M13.5 4.5v7" stroke="#64748b" strokeWidth="1.2" />
    </svg>
  );
}

export function NetworkIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="5.5" y="1.5" width="5" height="4" rx="0.6" fill="#0ea5e9" />
      <rect x="1" y="10.5" width="5" height="4" rx="0.6" fill="#0ea5e9" />
      <rect x="10" y="10.5" width="5" height="4" rx="0.6" fill="#0ea5e9" />
      <path d="M8 5.5v3M3.5 10.5v-2h9v2" stroke="#7dd3fc" strokeWidth="1" fill="none" />
    </svg>
  );
}

export function DataTypeIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="2" y="2" width="12" height="12" rx="1.5" fill="#ede9fe" stroke="#7c3aed" strokeWidth="0.9" />
      <path d="M5 5.5h6M5 8h4M5 10.5h5" stroke="#7c3aed" strokeWidth="1.1" />
    </svg>
  );
}

export function HandlerIcon({ size = 16, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <path d="M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z" fill="#94a3b8" stroke="#475569" strokeWidth="0.8" />
      <path d="M8 7v3.2M8 11.6v.4" stroke="#b91c1c" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function GenericIcon({ size = 16, color = '#64748b', ...rest }: P & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" {...rest}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke={color} strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2" fill={color} />
    </svg>
  );
}
