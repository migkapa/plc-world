/**
 * 1756 digital & analog I/O modules:
 *   <DigitalModule1756 catalog="1756-IB16" | "1756-OB16E"/>
 *   <AnalogModule1756  catalog="1756-IF8"  | "1756-OF8"/>
 *
 * Front: indicator head (ST 0-15 yellow point LEDs + bi-color OK, FUSE on the OB16E, CAL on analog)
 * above the RTB housing with its bottom-hinged door. Opening the door reveals the 1756-TBNH (20-pin)
 * or 1756-TBCH (36-pin) terminal block with field wiring running down to a wrapped bundle.
 *
 * Origin: back-bottom-center of the module (backplane connector face), front = +Z.
 */
import { useCallback, useMemo } from 'react';
import type { Placement } from '../../../contracts';
import { LED_HEX } from '../../../common';
import { MOD_FRONT_Z, MOD_H, MOD_W, RTB_FRONT_Z, RTB_TOP_Y } from './dims';
import { RtbAssembly, ioHousingGeometry, rtbPinPositions, type DoorArt, type PinInfo, type RtbPins } from './rtb';
import { Art, ArtPlane, FONT_COND, MAT, PointLeds, Selectable, StatusLed, canvasTexture, type StatusLedState } from './shared';

export type DigitalCatalog1756 = '1756-IB16' | '1756-OB16E';
export type AnalogCatalog1756 = '1756-IF8' | '1756-OF8';

interface IoCommonProps extends Placement {
  /** Module OK indicator (bi-color). Default: steady green. */
  getOk?: () => StatusLedState;
  /** Open the RTB door (animated). */
  doorOpen?: boolean;
  /** Show the field wiring below the module even with the door closed. */
  wired?: boolean;
  onSelect?: () => void;
  highlighted?: boolean;
}

export interface DigitalModule1756Props extends IoCommonProps {
  catalog: DigitalCatalog1756;
  /** Point status (ST 0-15 yellow indicators). */
  getPoint?: (index: number) => boolean;
  /** OB16E electronic-fuse indicator (red when a fuse tripped). */
  getFuse?: () => boolean;
}

export interface AnalogModule1756Props extends IoCommonProps {
  catalog: AnalogCatalog1756;
  /** CAL indicator (flashing green while calibrating). */
  getCal?: () => StatusLedState;
}

const OK_GREEN = (): StatusLedState => 'green';
const OFF = (): StatusLedState => 'off';
const FALSE = () => false;

// ---------------------------------------------------------------------------
// Pin maps (1756 16-point modules: two groups of 8 with commons at 9/10 and 19/20)
// ---------------------------------------------------------------------------

const WIRE_DC = '#1f4fd1'; // NFPA 79 blue = DC control
const WIRE_COMMON = '#e9e9e2'; // white (grounded DC common)
const WIRE_POS = '#c62828';
const WIRE_BLACK = '#141414';

function pinMap(catalog: DigitalCatalog1756 | AnalogCatalog1756): { pins: RtbPins; info: PinInfo[] } {
  const pins: RtbPins = catalog === '1756-IF8' ? 36 : 20;
  const pos = rtbPinPositions(pins);
  const info: PinInfo[] = pos.map((p) => {
    const n = p.pin;
    let label = '';
    let wire: string | undefined;
    switch (catalog) {
      case '1756-IB16':
        if (n <= 8 || (n >= 11 && n <= 18)) {
          const idx = n <= 8 ? n - 1 : n - 3;
          label = `IN-${idx}`;
          wire = WIRE_DC;
        } else {
          label = n <= 10 ? 'GND-0' : 'GND-1';
          wire = n % 2 === 1 ? WIRE_COMMON : undefined;
        }
        break;
      case '1756-OB16E':
        if (n <= 8 || (n >= 11 && n <= 18)) {
          const idx = n <= 8 ? n - 1 : n - 3;
          label = `OUT-${idx}`;
          wire = WIRE_DC;
        } else if (n === 9 || n === 19) {
          label = n === 9 ? 'DC-0(+)' : 'DC-1(+)';
          wire = WIRE_POS;
        } else {
          label = n === 10 ? 'RTN OUT-0' : 'RTN OUT-1';
          wire = WIRE_COMMON;
        }
        break;
      case '1756-OF8': {
        const ch = Math.floor((n - 1) / 2);
        if (n <= 16) {
          label = n % 2 === 1 ? `VOUT-${ch}` : `RTN-${ch}`;
          if (ch < 4) wire = n % 2 === 1 ? WIRE_POS : WIRE_BLACK;
        } else label = n <= 18 ? 'RTN' : 'N.C.';
        break;
      }
      case '1756-IF8': {
        const ch = Math.floor((n - 1) / 4);
        const k = (n - 1) % 4;
        if (n <= 32) {
          label = [`IN-${ch}+`, `IN-${ch}-`, `i RTN-${ch}`, 'RTN'][k]!;
          if (ch < 4 && k < 2) wire = k === 0 ? WIRE_POS : WIRE_BLACK;
        } else label = n <= 34 ? 'RTN' : 'N.C.';
        break;
      }
    }
    return { pin: n, x: p.x, y: p.y, label, wire };
  });
  return { pins, info };
}

const DOOR_ART: Record<DigitalCatalog1756 | AnalogCatalog1756, DoorArt> = {
  '1756-IB16': { catalog: '1756-IB16', title: 'DC INPUT', subtitle: '10-31V DC  SINK', band: '#2f6fd6' },
  '1756-OB16E': { catalog: '1756-OB16E', title: 'DC OUTPUT', subtitle: 'ELECTRONICALLY FUSED', band: '#c9392f' },
  '1756-IF8': { catalog: '1756-IF8', title: 'ANALOG INPUT', subtitle: '8 CH  ·  V / mA', band: '#2e9e5b' },
  '1756-OF8': { catalog: '1756-OF8', title: 'ANALOG OUTPUT', subtitle: '8 CH  ·  V / mA', band: '#c98a1f' },
};

// ---------------------------------------------------------------------------
// Indicator head art
// ---------------------------------------------------------------------------

const HEAD_X0 = -MOD_W / 2 + 0.0005;
const HEAD_X1 = MOD_W / 2 - 0.0005;
const HEAD_Y0 = RTB_TOP_Y + 0.0032;
const HEAD_Y1 = MOD_H - 0.0005;
const LED_Z = MOD_FRONT_Z + 0.00035;

/** Point LED positions: two rows of 8 (ST 0-7 / ST 8-15). */
const POINT_POS: Array<readonly [number, number]> = Array.from({ length: 16 }, (_, i) => {
  const row = Math.floor(i / 8);
  const col = i % 8;
  return [-0.0088 + col * 0.0031, 0.1284 - row * 0.0068] as const;
});
const ROW3_Y = 0.1154;

function digitalHeadTexture(catalog: DigitalCatalog1756) {
  return canvasTexture(`clx:head:${catalog}`, 288, Math.round((288 * (HEAD_Y1 - HEAD_Y0)) / (HEAD_X1 - HEAD_X0)), (ctx, w, h) => {
    const a = new Art(ctx, HEAD_X0, HEAD_X1, HEAD_Y0, HEAD_Y1, w, h);
    a.plastic('#222326', 6);
    a.text(catalog === '1756-IB16' ? 'DC INPUT' : 'DC OUTPUT', 0, 0.1368, 0.0024, { weight: 700, color: '#ecece6' });
    // indicator window
    a.rect(0, 0.1223, 0.0305, 0.0232, '#111214', 'rgba(255,255,255,0.10)', 0.00025, 0.0008);
    for (let i = 0; i < 16; i++) {
      const [x, y] = POINT_POS[i]!;
      a.text(String(i), x, y + 0.0026, 0.0017, { weight: 700, color: '#d8d8d2', font: FONT_COND });
      a.rect(x, y, 0.0026, 0.0019, '#050505');
    }
    a.text('ST', -0.0133, POINT_POS[0]![1], 0.0018, { weight: 800, color: '#d8d8d2', font: FONT_COND });
    a.text('ST', -0.0133, POINT_POS[8]![1], 0.0018, { weight: 800, color: '#d8d8d2', font: FONT_COND });
    a.text('OK', 0.0052, ROW3_Y, 0.0019, { weight: 800, color: '#d8d8d2', font: FONT_COND });
    a.rect(0.0105, ROW3_Y, 0.003, 0.0021, '#050505');
    if (catalog === '1756-OB16E') {
      a.text('FUSE', -0.0092, ROW3_Y, 0.0019, { weight: 800, color: '#d8d8d2', font: FONT_COND });
      a.rect(-0.0036, ROW3_Y, 0.003, 0.0021, '#050505');
    }
    a.text(catalog === '1756-IB16' ? '24V DC SINK INPUT' : '24V DC SOURCE OUTPUT', 0, 0.1085, 0.0016, {
      weight: 600,
      color: '#9fa09b',
      font: FONT_COND,
    });
  });
}

function analogHeadTexture(catalog: AnalogCatalog1756) {
  return canvasTexture(`clx:head:${catalog}`, 288, Math.round((288 * (HEAD_Y1 - HEAD_Y0)) / (HEAD_X1 - HEAD_X0)), (ctx, w, h) => {
    const a = new Art(ctx, HEAD_X0, HEAD_X1, HEAD_Y0, HEAD_Y1, w, h);
    a.plastic('#222326', 6);
    a.text(catalog === '1756-IF8' ? 'ANALOG INPUT' : 'ANALOG OUTPUT', 0, 0.1368, 0.0022, { weight: 700, color: '#ecece6' });
    a.rect(0, 0.1265, 0.0305, 0.0125, '#111214', 'rgba(255,255,255,0.10)', 0.00025, 0.0008);
    a.text('CAL', -0.0062, 0.1296, 0.0019, { weight: 800, color: '#d8d8d2', font: FONT_COND });
    a.text('OK', -0.0062, 0.1236, 0.0019, { weight: 800, color: '#d8d8d2', font: FONT_COND });
    a.rect(0.0045, 0.1296, 0.0032, 0.0022, '#050505');
    a.rect(0.0045, 0.1236, 0.0032, 0.0022, '#050505');
    a.text(catalog === '1756-IF8' ? 'Current / Voltage' : 'Current / Voltage', 0, 0.1158, 0.0017, {
      weight: 600,
      color: '#b7b8b2',
      font: FONT_COND,
    });
    a.text(catalog === '1756-IF8' ? '8 Single-ended / 4 Diff.' : '8 Outputs', 0, 0.1128, 0.0016, {
      weight: 500,
      color: '#9fa09b',
      font: FONT_COND,
    });
  });
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

const SEL_SIZE: [number, number, number] = [MOD_W + 0.0018, MOD_H + 0.0018, 0.016];
const SEL_CENTER: [number, number, number] = [0, MOD_H / 2, RTB_FRONT_Z - 0.0065];

export function DigitalModule1756({
  catalog,
  getPoint = FALSE,
  getOk = OK_GREEN,
  getFuse,
  doorOpen = false,
  wired = false,
  onSelect,
  highlighted,
  position,
  rotation,
  scale,
}: DigitalModule1756Props) {
  const head = digitalHeadTexture(catalog);
  const { pins, info } = useMemo(() => pinMap(catalog), [catalog]);
  const fuseState = useCallback((): StatusLedState => (getFuse?.() ? 'red' : 'off'), [getFuse]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={SEL_SIZE} center={SEL_CENTER} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={ioHousingGeometry()} material={MAT.body()} castShadow />
        <ArtPlane tex={head} x0={HEAD_X0} x1={HEAD_X1} y0={HEAD_Y0} y1={HEAD_Y1} z={MOD_FRONT_Z + 0.0001} />
        <PointLeds positions={POINT_POS} z={LED_Z} color={LED_HEX.yellow} get={getPoint} size={[0.0022, 0.0015, 0.0007]} />
        <StatusLed get={getOk} position={[0.0105, ROW3_Y, LED_Z]} size={[0.0026, 0.0017, 0.0007]} />
        {catalog === '1756-OB16E' && <StatusLed get={fuseState} offColor="red" position={[-0.0036, ROW3_Y, LED_Z]} size={[0.0026, 0.0017, 0.0007]} />}
        <RtbAssembly catalog={catalog} pins={pins} pinInfo={info} door={DOOR_ART[catalog]} doorOpen={doorOpen} wired={wired} />
      </Selectable>
    </group>
  );
}

export function AnalogModule1756({
  catalog,
  getOk = OK_GREEN,
  getCal = OFF,
  doorOpen = false,
  wired = false,
  onSelect,
  highlighted,
  position,
  rotation,
  scale,
}: AnalogModule1756Props) {
  const head = analogHeadTexture(catalog);
  const { pins, info } = useMemo(() => pinMap(catalog), [catalog]);
  return (
    <group position={position} rotation={rotation} scale={scale}>
      <Selectable size={SEL_SIZE} center={SEL_CENTER} onSelect={onSelect} highlighted={highlighted}>
        <mesh geometry={ioHousingGeometry()} material={MAT.body()} castShadow />
        <ArtPlane tex={head} x0={HEAD_X0} x1={HEAD_X1} y0={HEAD_Y0} y1={HEAD_Y1} z={MOD_FRONT_Z + 0.0001} />
        <StatusLed get={getCal} position={[0.0045, 0.1296, LED_Z]} size={[0.0028, 0.0018, 0.0007]} />
        <StatusLed get={getOk} position={[0.0045, 0.1236, LED_Z]} size={[0.0028, 0.0018, 0.0007]} />
        <RtbAssembly catalog={catalog} pins={pins} pinInfo={info} door={DOOR_ART[catalog]} doorOpen={doorOpen} wired={wired} />
      </Selectable>
    </group>
  );
}
