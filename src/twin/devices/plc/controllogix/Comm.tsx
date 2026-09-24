/**
 * <Comm1756/> — ControlLogix EtherNet/IP communication modules 1756-EN2T (single port, USB on the front)
 * and 1756-EN4TR (dual port A1/A2, DLR capable).
 *
 * Front: catalog legend, 4-character scrolling display (IP address / "OK"), LINK / NET / OK indicators
 * (EN4TR: LINK A1, LINK A2, NET, OK), write-on label for IP & MAC; RJ45 jack(s) on the underside at the
 * front with patch cables.
 *
 * Origin: back-bottom-center of the module (backplane face), front = +Z.
 */
import { useCallback, useMemo } from 'react';
import type { Placement } from '../../../contracts';
import { MOD_FRONT_Z, MOD_H, MOD_W } from './dims';
import { linkActivity } from './Controller';
import {
  Art,
  ArtPlane,
  DotMatrixDisplay,
  FONT_COND,
  MAT,
  PatchCable,
  Rj45Jack,
  Selectable,
  StatusLed,
  UsbBPort,
  cachedGeo,
  canvasTexture,
  rboxAt,
  type StatusLedState,
} from './shared';

export type CommCatalog1756 = '1756-EN2T' | '1756-EN4TR';

export interface Comm1756Props extends Placement {
  catalog?: CommCatalog1756;
  /** IP address shown on the scrolling display (default 192.168.1.10). */
  ipAddress?: string;
  /** Override the display text (default alternates 'IP=<address>' scrolling and 'OK'). */
  getDisplayText?: () => string;
  /** Module powered (default true). Unpowered = display & LEDs dark. */
  powered?: boolean;
  getOk?: () => StatusLedState;
  getNet?: () => StatusLedState;
  /** LINK indicator per port (0 = port 1 / A1, 1 = A2). Default: activity flicker. */
  getLink?: (port: number) => StatusLedState;
  /** Show patch cables plugged into the RJ45 port(s) (default true). */
  cable?: boolean;
  onSelect?: () => void;
  highlighted?: boolean;
}

const FACE = MOD_FRONT_Z + 0.0025;
const ART_X0 = -MOD_W / 2 + 0.0005;
const ART_X1 = MOD_W / 2 - 0.0005;
const ART_Y0 = 0.0005;
const ART_Y1 = MOD_H - 0.0005;
const LED_Z = FACE + 0.00035;
const DISPLAY_Y = 0.1245;
const LED_X = -0.0118;
const JACK_Z = 0.1288;

function ledRows(catalog: CommCatalog1756): Array<{ name: string; y: number }> {
  return catalog === '1756-EN4TR'
    ? [
        { name: 'LINK A1', y: 0.1128 },
        { name: 'LINK A2', y: 0.1086 },
        { name: 'NET', y: 0.1044 },
        { name: 'OK', y: 0.1002 },
      ]
    : [
        { name: 'LINK', y: 0.1128 },
        { name: 'NET', y: 0.1086 },
        { name: 'OK', y: 0.1044 },
      ];
}

function frontTexture(catalog: CommCatalog1756) {
  return canvasTexture(`clx:comm:${catalog}`, 288, Math.round((288 * (ART_Y1 - ART_Y0)) / (ART_X1 - ART_X0)), (ctx, w, h) => {
    const a = new Art(ctx, ART_X0, ART_X1, ART_Y0, ART_Y1, w, h);
    a.plastic('#202124', 6);
    const lab = { weight: 800, color: '#dcdcd6', font: FONT_COND, align: 'left' as CanvasTextAlign };
    a.text('EtherNet/IP', 0, 0.1372, 0.0017, { weight: 600, color: '#a9aaa4' });
    a.text(catalog, 0, 0.1347, 0.0027, { weight: 800, color: '#f1f1ec' });
    a.rect(0, DISPLAY_Y, 0.0292, 0.0122, '#0b0b0c', 'rgba(255,255,255,0.12)', 0.0003, 0.0012);
    for (const r of ledRows(catalog)) {
      a.rect(LED_X, r.y, 0.0033, 0.0023, '#050505');
      a.text(r.name, LED_X + 0.0028, r.y, 0.0021, lab);
    }
    let y = catalog === '1756-EN4TR' ? 0.0935 : 0.0975;
    if (catalog === '1756-EN2T') {
      a.text('USB', -0.0103, 0.0905, 0.0019, { ...lab, align: 'center' });
      a.rect(0, 0.0905, 0.011, 0.0102, '#0e0e0f', 'rgba(255,255,255,0.08)', 0.0002, 0.0008);
      y = 0.079;
    } else {
      a.text('10/100/1000 Mbps  ·  DLR', 0, y, 0.0017, { weight: 600, color: '#a9aaa4', font: FONT_COND });
      y = 0.086;
    }
    // write-on IP / MAC label
    const lh = 0.024;
    const ly = y - 0.004 - lh / 2;
    a.rect(0, ly, 0.0282, lh, '#e9e8e1', '#a7a8a2', 0.0002, 0.0006);
    const dark = { weight: 700, color: '#2b2b2b', font: FONT_COND, align: 'left' as CanvasTextAlign };
    const top = ly + lh / 2;
    a.text('IP ADDRESS', -0.0128, top - 0.0028, 0.0018, dark);
    a.line(-0.0128, top - 0.0082, 0.0128, top - 0.0082, '#9a9b95', 0.0002);
    a.text('MAC ID', -0.0128, top - 0.0122, 0.0018, dark);
    a.text('00:00:BC:6A:2F:1E', -0.0128, top - 0.0152, 0.0018, { ...dark, weight: 600 });
    a.line(-0.0128, top - 0.0182, 0.0128, top - 0.0182, '#9a9b95', 0.0002);
    a.text('SLOT ______', -0.0128, top - 0.0212, 0.0017, { ...dark, weight: 600, color: '#555' });
    // molded ribs
    for (let i = 0; i < 6; i++) a.rect(0, 0.0215 + i * 0.0026, 0.02, 0.0007, 'rgba(0,0,0,0.45)');
    // port legend + arrows to the underside jacks
    a.line(-0.014, 0.0158, 0.014, 0.0158, 'rgba(255,255,255,0.15)', 0.0002);
    const ports = catalog === '1756-EN4TR' ? ['A1', 'A2'] : ['PORT 1'];
    const xs = catalog === '1756-EN4TR' ? [-0.0082, 0.0082] : [0];
    ports.forEach((p, i) => {
      a.text(p, xs[i]!, 0.0112, 0.0019, { weight: 700, color: '#c9c9c3' });
      const c = a.ctx;
      c.fillStyle = '#a0a19b';
      c.beginPath();
      c.moveTo(a.px(xs[i]! - 0.0022), a.py(0.0072));
      c.lineTo(a.px(xs[i]! + 0.0022), a.py(0.0072));
      c.lineTo(a.px(xs[i]!), a.py(0.0045));
      c.closePath();
      c.fill();
    });
  });
}

const OK_GREEN = (): StatusLedState => 'green';

export function Comm1756({
  catalog = '1756-EN2T',
  ipAddress = '192.168.1.10',
  getDisplayText,
  powered = true,
  getOk = OK_GREEN,
  getNet = OK_GREEN,
  getLink,
  cable = true,
  onSelect,
  highlighted,
  position,
  rotation,
  scale,
}: Comm1756Props) {
  const front = frontTexture(catalog);
  const body = cachedGeo('clx:commBody', () => rboxAt(MOD_W, MOD_H, FACE, 0, MOD_H / 2, FACE / 2, 0.0012));
  const rows = ledRows(catalog);
  const dual = catalog === '1756-EN4TR';

  const ipText = `IP=${ipAddress}`;
  // scroll the IP address, then hold 'OK' for 2 s
  const scrollSec = (4 + ipText.length + 3) * 0.26;
  const defaultText = useCallback(() => {
    const t = (performance.now() / 1000) % (scrollSec + 2);
    return t < scrollSec ? ipText : 'OK';
  }, [ipText, scrollSec]);
  const text = useCallback(() => (powered ? (getDisplayText ?? defaultText)() : ''), [powered, getDisplayText, defaultText]);

  const act0 = useMemo(() => linkActivity(0.2), []);
  const act1 = useMemo(() => linkActivity(3.1), []);
  const link0 = useCallback((): StatusLedState => (!powered ? 'off' : getLink ? getLink(0) : act0()), [powered, getLink, act0]);
  const link1 = useCallback((): StatusLedState => (!powered ? 'off' : getLink ? getLink(1) : act1()), [powered, getLink, act1]);
  const net = useCallback((): StatusLedState => (powered ? getNet() : 'off'), [powered, getNet]);
  const ok = useCallback((): StatusLedState => (powered ? getOk() : 'off'), [powered, getOk]);
  const getters: Array<() => StatusLedState> = dual ? [link0, link1, net, ok] : [link0, net, ok];
  const jackXs = dual ? [-0.0082, 0.0082] : [0];

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={[MOD_W + 0.0018, MOD_H + 0.0018, 0.016]} center={[0, MOD_H / 2, FACE - 0.0065]} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={body} material={MAT.body()} castShadow />
        <ArtPlane tex={front} x0={ART_X0} x1={ART_X1} y0={ART_Y0} y1={ART_Y1} z={FACE + 0.0001} />
        <DotMatrixDisplay getText={text} width={0.0248} height={0.0082} position={[0, DISPLAY_Y, FACE + 0.00025]} />
        {rows.map((r, i) => (
          <StatusLed key={r.name} get={getters[i]!} position={[LED_X, r.y, LED_Z]} />
        ))}
        {!dual && <UsbBPort position={[0, 0.0905, FACE + 0.0002]} />}
        {jackXs.map((x, i) => (
          <group key={i}>
            <Rj45Jack position={[x, -0.0002, JACK_Z]} rotation={[Math.PI / 2, 0, 0]} />
            {cable && <PatchCable position={[x, -0.0002, JACK_Z]} color={i === 0 ? '#1f63d6' : '#d9a21b'} />}
          </group>
        ))}
      </Selectable>
    </group>
  );
}

