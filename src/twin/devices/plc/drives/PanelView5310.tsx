/**
 * PanelView 5310 graphic terminal (2713P-T7WD1 / T9WD1 / T10… / T12WD1 …) digital twin.
 *
 * Panel-mount HMI: thin black bezel (the front sticks out < 6 mm from the panel), widescreen TFT under glass,
 * status LED, and a body behind the panel cutout with mounting levers, 24 V DC terminal block, two Ethernet
 * ports and USB. The screen content is REAL interactive DOM (`children`) projected onto the display area
 * with drei <Html transform> at the terminal's native resolution; with no children a sample
 * View-Designer-style screen (header, motor graphic, Start/Stop buttons) is shown.
 *
 * Origin: center of the bezel's BACK face (= the panel surface) at the bezel's bottom edge. The bezel is in
 * front (z ∈ [0, 6 mm]); the housing goes behind the panel (negative z). Front faces +Z.
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';
import { Led, materials } from '../../../common';
import type { PanelView5310Props } from '../../../contracts';
import { barcode, canvasTexture, mmCtx } from '../compactlogix/canvas';
import { box, cachedGeometry, plane, roundedBox } from '../compactlogix/geometry';
import { cachedMaterial, decalMaterial, HighlightFrame, Rj45Jack, usePick } from '../compactlogix/parts';
import { HtmlScreen } from './HtmlScreen';

type PvSize = NonNullable<PanelView5310Props['size']>;

interface PvSpec {
  diag: number; // inches
  res: [number, number];
  catalog: string;
  /** Bezel margins (mm): left/right, top, bottom. */
  side: number;
  top: number;
  bottom: number;
  depth: number; // housing depth behind the panel (m)
}

export const PV5310_SPECS: Record<PvSize, PvSpec> = {
  7: { diag: 7, res: [800, 480], catalog: '2713P-T7WD1', side: 21, top: 21, bottom: 30, depth: 0.046 },
  9: { diag: 9, res: [800, 480], catalog: '2713P-T9WD1', side: 22, top: 22, bottom: 31, depth: 0.048 },
  10: { diag: 10.1, res: [1280, 800], catalog: '2713P-T10WD1', side: 22, top: 22, bottom: 32, depth: 0.05 },
  12: { diag: 12.1, res: [1280, 800], catalog: '2713P-T12WD1', side: 23, top: 23, bottom: 33, depth: 0.052 },
  15: { diag: 15.6, res: [1366, 768], catalog: '2713P-T15WD1', side: 24, top: 24, bottom: 34, depth: 0.056 },
};

const BEZEL_T = 0.0058; // bezel projection in front of the panel

function dims(size: PvSize, resolution?: [number, number]) {
  const s = PV5310_SPECS[size];
  const [rx, ry] = resolution ?? s.res;
  const [nx, ny] = s.res;
  const diagM = s.diag * 0.0254;
  const k = diagM / Math.hypot(nx, ny);
  const sw = nx * k; // active area (m)
  const sh = ny * k;
  const W = sw + (2 * s.side) / 1000;
  const H = sh + (s.top + s.bottom) / 1000;
  return { s, sw, sh, W, H, rx, ry, screenY: s.bottom / 1000 + sh / 2 };
}

function bezelPrint(size: PvSize, wMm: number, bottomMm: number, sideMm: number) {
  return canvasTexture(`pv5310-bezel:${size}`, Math.round(wMm * 6), Math.round(bottomMm * 6), (ctx, w, h) => {
    const m = mmCtx(ctx, 6, bottomMm);
    ctx.clearRect(0, 0, w, h);
    m.text('PanelView 5310', sideMm, bottomMm / 2, Math.min(4.2, bottomMm * 0.17), { color: '#b9bdc2', weight: 600 });
  });
}

function backLabel(catalog: string) {
  return canvasTexture(`pv5310-back:${catalog}`, 600, 360, (ctx, w, h) => {
    const m = mmCtx(ctx, 10, 36);
    ctx.fillStyle = '#dcdddc';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 12);
    ctx.fill();
    m.text('PanelView 5310', 3, 32, 3.4, { color: '#111', weight: 800 });
    m.text(`CAT ${catalog}   SER A`, 3, 27.5, 2.6, { color: '#111', weight: 700 });
    m.text('24V DC  1.1 A max   Class 2', 3, 23.4, 2.2, { color: '#222', weight: 500 });
    m.text('Enclosure: Type 4X (indoor), 12, 13, IP66', 3, 19.8, 2.0, { color: '#222', weight: 500 });
    barcode(m, 3, 5, 34, 8, catalog.length * 131);
    m.text('IND. CONT. EQ.', 44, 9, 2.0, { color: '#222', weight: 800 });
    m.strokeRect(41.5, 5, 16, 8.5, '#333', 0.3, 1.5);
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface PanelView5310TwinProps extends PanelView5310Props {
  /** Screen backlight on (false = dark glass, DOM hidden). Default true. */
  getScreenOn?: () => boolean;
  highlighted?: boolean;
  onSelect?: () => void;
  /** Extra CSS for the screen root element. */
  screenStyle?: CSSProperties;
  /** Hide the DOM screen when other 3D objects block the view of it (default true). */
  occlude?: boolean;
}

export function PanelView5310({
  size = 7,
  children,
  resolution,
  getScreenOn,
  highlighted = false,
  onSelect,
  screenStyle,
  occlude = true,
  position,
  rotation,
  scale,
}: PanelView5310TwinProps) {
  const d = dims(size, resolution);
  const { s, sw, sh, W, H, rx, ry, screenY } = d;
  const { hovered, handlers } = usePick(onSelect);
  const [screenOn, setScreenOn] = useState(true);
  const lastOn = useRef(true);
  const root = useRef<THREE.Group>(null);

  useFrame(() => {
    const on = getScreenOn ? getScreenOn() : true;
    if (on !== lastOn.current) {
      lastOn.current = on;
      setScreenOn(on);
    }
  });

  const bezelGeo = useMemo(() => bezelGeometry(W, H, sw, sh, s.bottom / 1000), [W, H, sw, sh, s.bottom]);
  const bezelMat = materials.plastic('#141517', 0.5);
  const housingMat = materials.plastic('#2a2c2f', 0.6);
  const bodyW = sw + 0.012;
  const bodyH = sh + 0.02;

  return (
    <group ref={root} position={position} rotation={rotation} scale={scale} {...handlers}>
      {/* bezel frame with the window cut out */}
      <mesh geometry={bezelGeo} material={bezelMat} castShadow receiveShadow />
      {/* printed bottom band */}
      <mesh
        geometry={plane(W - 0.006, s.bottom / 1000 - 0.006)}
        material={decalMaterial(bezelPrint(size, (W - 0.006) * 1000, s.bottom - 6, s.side - 3), 0.45, 0.05, true)}
        position={[0, s.bottom / 2000, BEZEL_T + 0.0002]}
      />
      {/* status LED (bottom right) */}
      <Led color="green" get={() => (screenOn ? 'on' : 'flash')} size={[0.0026, 0.0026, 0.0006]} shape="round" position={[W / 2 - s.side / 1000 - 0.004, s.bottom / 2000, BEZEL_T + 0.0003]} />

      {/* display: black matrix + glass */}
      <mesh geometry={plane(sw + 0.003, sh + 0.003)} material={screenMaterial(screenOn)} position={[0, screenY, BEZEL_T - 0.0016]} />
      <mesh geometry={plane(sw + 0.004, sh + 0.004)} material={glassMaterial()} position={[0, screenY, BEZEL_T - 0.0008]} />

      {/* housing behind the panel */}
      <mesh geometry={roundedBox(bodyW, bodyH, s.depth, 0.003)} material={housingMat} position={[0, screenY, -s.depth / 2]} castShadow receiveShadow />
      <mesh geometry={box(bodyW - 0.012, bodyH - 0.012, 0.004)} material={materials.plastic('#1f2023', 0.7)} position={[0, screenY, -s.depth - 0.001]} />
      <mesh
        geometry={plane(0.06, 0.036)}
        material={decalMaterial(backLabel(s.catalog), 0.55)}
        position={[bodyW / 4, screenY + bodyH / 5, -s.depth - 0.0032]}
        rotation={[0, Math.PI, 0]}
      />
      {/* ports on the back (bottom area): 2× Ethernet, USB, 24 V DC plug */}
      <group position={[0, screenY - bodyH / 2 + 0.022, -s.depth - 0.0031]} rotation={[0, Math.PI, 0]}>
        <Rj45Jack position={[-0.03, 0, 0]} />
        <Rj45Jack position={[-0.012, 0, 0]} />
        <mesh geometry={box(0.012, 0.0045, 0.002)} material={materials.metal('#c3c7cb', 0.3)} position={[0.008, 0, 0]} />
        <mesh geometry={roundedBox(0.016, 0.009, 0.008, 0.001)} material={materials.plastic('#1b7a3a', 0.5)} position={[0.03, 0, 0.004]} />
      </group>
      {/* mounting levers (behind the panel) */}
      {[-1, 1].map((side) =>
        [0.25, 0.75].map((f) => (
          <MountLever key={`${side}:${f}`} x={side * (bodyW / 2 + 0.004)} y={screenY - bodyH / 2 + bodyH * f} side={side} />
        )),
      )}

      {/* live screen content (DOM) */}
      <HtmlScreen
        widthPx={rx}
        heightPx={ry}
        width={sw}
        position={[0, screenY, BEZEL_T - 0.0004]}
        visible={screenOn}
        occlude={occlude}
        occludeIgnore={root}
      >
        <div style={{ position: 'relative', width: rx, height: ry, background: '#0b0f14', userSelect: 'none', ...screenStyle }}>
          {children ?? <SampleHmiScreen width={rx} height={ry} />}
          {/* glass reflection overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background:
                'linear-gradient(118deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.035) 28%, rgba(255,255,255,0) 42%, rgba(255,255,255,0) 70%, rgba(255,255,255,0.04) 100%)',
            }}
          />
        </div>
      </HtmlScreen>

      {(highlighted || hovered) && (
        <HighlightFrame center={[0, H / 2, (BEZEL_T - s.depth) / 2]} size={[W + 0.004, H + 0.004, BEZEL_T + s.depth + 0.004]} strength={highlighted ? 1 : 0.35} />
      )}
    </group>
  );
}

function screenMaterial(on: boolean) {
  return cachedMaterial(`pv-screen:${on}`, () => new THREE.MeshStandardMaterial({ color: on ? '#0b0f14' : '#050607', roughness: 0.3, metalness: 0 }));
}

function glassMaterial() {
  return cachedMaterial(
    'pv-glass',
    () =>
      new THREE.MeshPhysicalMaterial({
        color: '#ffffff',
        roughness: 0.03,
        metalness: 0,
        transparent: true,
        opacity: 0.07,
        clearcoat: 1,
        clearcoatRoughness: 0.03,
        depthWrite: false,
      }),
  );
}

/** Bezel: rounded outer frame with a rectangular window and a chamfered inner lip. */
function bezelGeometry(W: number, H: number, sw: number, sh: number, bottom: number) {
  return cachedGeometry(`pv-bezel:${W.toFixed(4)}:${H.toFixed(4)}:${sw.toFixed(4)}`, () => {
    const r = 0.006;
    const s = new THREE.Shape();
    const x0 = -W / 2;
    const x1 = W / 2;
    s.moveTo(x0 + r, 0);
    s.lineTo(x1 - r, 0);
    s.quadraticCurveTo(x1, 0, x1, r);
    s.lineTo(x1, H - r);
    s.quadraticCurveTo(x1, H, x1 - r, H);
    s.lineTo(x0 + r, H);
    s.quadraticCurveTo(x0, H, x0, H - r);
    s.lineTo(x0, r);
    s.quadraticCurveTo(x0, 0, x0 + r, 0);
    const hole = new THREE.Path();
    const m = 0.0022; // window slightly larger than the active area
    const hx0 = -sw / 2 - m;
    const hx1 = sw / 2 + m;
    const hy0 = bottom - m;
    const hy1 = bottom + sh + m;
    hole.moveTo(hx0, hy0);
    hole.lineTo(hx0, hy1);
    hole.lineTo(hx1, hy1);
    hole.lineTo(hx1, hy0);
    hole.closePath();
    s.holes.push(hole);
    const bevel = 0.0012;
    const g = new THREE.ExtrudeGeometry(s, { depth: BEZEL_T - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
    g.translate(0, 0, bevel);
    return g;
  });
}

function MountLever({ x, y, side }: { x: number; y: number; side: number }) {
  return (
    <group position={[x, y, -0.012]}>
      <mesh geometry={box(0.008, 0.014, 0.018)} material={materials.plastic('#3a3d41', 0.6)} castShadow />
      <mesh geometry={box(0.004, 0.006, 0.01)} material={materials.metal('#b8bcc0', 0.35)} position={[side * 0.004, 0, 0.004]} />
    </group>
  );
}

// ---------------------------------------------------------------------------
// Sample screen (shown when no children are given)
// ---------------------------------------------------------------------------

function SampleHmiScreen({ width, height }: { width: number; height: number }) {
  const k = height / 480;
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(45.3);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const px = (n: number) => `${Math.round(n * k)}px`;
  const btn = (bg: string, fg = '#fff'): CSSProperties => ({
    background: `linear-gradient(${bg}, ${shade(bg, -0.18)})`,
    color: fg,
    border: `${px(1)} solid ${shade(bg, -0.35)}`,
    borderRadius: px(6),
    fontWeight: 700,
    fontSize: px(20),
    padding: `${px(10)} ${px(12)}`,
    boxShadow: `inset 0 ${px(1)} 0 rgba(255,255,255,0.35), 0 ${px(2)} ${px(3)} rgba(0,0,0,0.35)`,
    cursor: 'pointer',
    minWidth: px(120),
  });
  return (
    <div style={{ width, height, fontFamily: 'Inter Variable, Inter, Arial, sans-serif', background: '#d7dade', color: '#1f2328', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div
        style={{
          height: px(44),
          display: 'flex',
          alignItems: 'center',
          padding: `0 ${px(12)}`,
          gap: px(12),
          background: 'linear-gradient(#5c6570, #3b434c)',
          color: '#fff',
          borderBottom: `${px(2)} solid #2a3037`,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: px(20), letterSpacing: 0.3 }}>Conveyor 1 · Overview</div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: px(15), opacity: 0.9 }}>{clock.toLocaleTimeString([], { hour12: false })}</div>
        <div style={{ background: '#2e8b3e', borderRadius: px(4), padding: `${px(3)} ${px(8)}`, fontSize: px(13), fontWeight: 700 }}>NO ALARMS</div>
      </div>
      {/* body */}
      <div style={{ flex: 1, display: 'flex', gap: px(12), padding: px(12) }}>
        <div style={{ flex: 1.35, background: '#eef0f2', border: `${px(1)} solid #a9afb6`, borderRadius: px(6), position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: px(10), top: px(6), fontSize: px(14), fontWeight: 700, color: '#4a525b' }}>M101 · Infeed Conveyor</div>
          <MotorGraphic running={running} k={k} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: px(10) }}>
          <div style={{ background: '#1d2126', color: '#8cf59b', borderRadius: px(6), padding: px(10), fontFamily: 'JetBrains Mono, monospace' }}>
            <div style={{ fontSize: px(13), color: '#9aa3ad', fontFamily: 'Inter Variable, Arial' }}>Drive speed</div>
            <div style={{ fontSize: px(38), fontWeight: 700 }}>
              {(running ? speed : 0).toFixed(1)} <span style={{ fontSize: px(18) }}>Hz</span>
            </div>
            <div style={{ height: px(8), background: '#333a42', borderRadius: px(4), overflow: 'hidden' }}>
              <div style={{ width: `${((running ? speed : 0) / 60) * 100}%`, height: '100%', background: '#3ccf5a', transition: 'width 0.6s' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: px(8) }}>
            <button style={btn('#2f9e44')} onClick={() => setRunning(true)}>
              START
            </button>
            <button style={btn('#d9363e')} onClick={() => setRunning(false)}>
              STOP
            </button>
          </div>
          <div style={{ display: 'flex', gap: px(8) }}>
            <button style={{ ...btn('#8a939c'), minWidth: 0, flex: 1 }} onClick={() => setSpeed((v) => Math.max(0, +(v - 5).toFixed(1)))}>
              − 5 Hz
            </button>
            <button style={{ ...btn('#8a939c'), minWidth: 0, flex: 1 }} onClick={() => setSpeed((v) => Math.min(60, +(v + 5).toFixed(1)))}>
              + 5 Hz
            </button>
          </div>
          <div style={{ fontSize: px(13), color: '#4a525b' }}>
            Status: <b style={{ color: running ? '#1f8a36' : '#6b737b' }}>{running ? 'RUNNING' : 'STOPPED'}</b>
          </div>
        </div>
      </div>
      {/* nav bar */}
      <div style={{ height: px(46), display: 'flex', gap: px(6), padding: `${px(6)} ${px(12)}`, background: '#b9bec4', borderTop: `${px(1)} solid #98a0a8` }}>
        {['Overview', 'Trends', 'Alarms', 'Settings'].map((t, i) => (
          <div
            key={t}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: px(5),
              fontWeight: 700,
              fontSize: px(15),
              background: i === 0 ? 'linear-gradient(#3f78c9, #2b5ea8)' : 'linear-gradient(#e9ebee, #cfd3d8)',
              color: i === 0 ? '#fff' : '#2a3037',
              border: `${px(1)} solid ${i === 0 ? '#244f8f' : '#9aa1a9'}`,
            }}
          >
            {t}
          </div>
        ))}
      </div>
    </div>
  );
}

function MotorGraphic({ running, k }: { running: boolean; k: number }) {
  const color = running ? '#2fa84f' : '#8a929a';
  return (
    <svg viewBox="0 0 400 260" style={{ position: 'absolute', inset: `${Math.round(24 * k)}px 0 0 0`, width: '100%', height: `calc(100% - ${Math.round(24 * k)}px)` }}>
      <style>{`@keyframes pvspin{to{transform:rotate(360deg)}} @keyframes pvbelt{to{stroke-dashoffset:-40}}`}</style>
      {/* conveyor */}
      <rect x="30" y="170" width="340" height="22" rx="11" fill="#5b636b" />
      <line
        x1="40"
        y1="170"
        x2="360"
        y2="170"
        stroke="#2b3036"
        strokeWidth="5"
        strokeDasharray="14 6"
        style={running ? { animation: 'pvbelt 0.6s linear infinite' } : undefined}
      />
      {[0, 1, 2].map((i) => (
        <rect key={i} x={70 + i * 100} y={138} width="46" height="32" rx="3" fill="#c8964f" stroke="#8f6a33" />
      ))}
      {/* motor */}
      <g transform="translate(150 40)">
        <rect x="0" y="20" width="100" height="62" rx="10" fill={color} stroke="#1c2024" strokeWidth="3" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={14 + i * 18} y1="26" x2={14 + i * 18} y2="76" stroke="rgba(0,0,0,0.25)" strokeWidth="4" />
        ))}
        <rect x="100" y="42" width="24" height="16" fill="#9aa2aa" stroke="#1c2024" strokeWidth="2" />
        <rect x="18" y="82" width="64" height="12" fill="#444b52" />
        <g transform="translate(-26 51)">
          <circle r="22" fill="#e6e9ec" stroke="#1c2024" strokeWidth="3" />
          <g style={running ? { animation: 'pvspin 0.8s linear infinite', transformOrigin: '0 0' } : undefined}>
            {[0, 120, 240].map((a) => (
              <path key={a} d="M0 0 L6 -18 L-6 -18 Z" fill={color} transform={`rotate(${a})`} />
            ))}
          </g>
        </g>
        <text x="50" y="12" textAnchor="middle" fontSize="16" fontWeight="700" fill="#1f2328">
          M101
        </text>
      </g>
      <text x="200" y="232" textAnchor="middle" fontSize="18" fontWeight="800" fill={running ? '#1f8a36' : '#59616a'}>
        {running ? '● RUNNING' : '○ STOPPED'}
      </text>
    </svg>
  );
}

function shade(hex: string, amt: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

