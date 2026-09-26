/**
 * Demo RackLive for previews / showroom: a fake running controller with animated I/O patterns.
 * (The real connection comes from `rackLiveFromController()` in src/twin/live.ts.)
 */
import type { RackLive } from '../../../contracts';
import type { ControllerStatus, HardwareConfig, KeySwitch } from '../../../../plc/types';

export interface CompactDemoLiveOptions {
  hardware: HardwareConfig;
  /** I/O animation: 'traffic' = traffic-light scene outputs (slot 2 OB16) + sensors (slot 1 IB16), 'chase' = walking bits. */
  pattern?: 'traffic' | 'chase';
  initialKey?: KeySwitch;
  faulted?: boolean;
  forces?: 'off' | 'enabled' | 'disabled';
}

const now = () => performance.now() / 1000;

/** Traffic light cycle outputs (NS_Red, NS_Yellow, NS_Green, EW_Red, EW_Yellow, EW_Green, Walk, Dont_Walk). */
function trafficOut(t: number, i: number): boolean {
  const c = t % 16;
  const nsGreen = c < 6;
  const nsYellow = c >= 6 && c < 8;
  const ewGreen = c >= 9 && c < 14;
  const ewYellow = c >= 14 && c < 15.5;
  const walk = c < 4.5;
  switch (i) {
    case 0:
      return !nsGreen && !nsYellow;
    case 1:
      return nsYellow;
    case 2:
      return nsGreen;
    case 3:
      return !ewGreen && !ewYellow;
    case 4:
      return ewYellow;
    case 5:
      return ewGreen;
    case 6:
      return walk;
    case 7:
      return !walk && !(c >= 4.5 && c < 6 && Math.floor(t * 2) % 2 === 1);
    default:
      return false;
  }
}

function trafficIn(t: number, i: number): boolean {
  const c = t % 16;
  if (i === 0) return c > 11.2 && c < 11.6; // pedestrian push button tap
  if (i === 1) return c > 1 && c < 8.7; // EW car waiting on the loop
  return false;
}

export function createCompactDemoLive({ hardware, pattern = 'chase', initialKey = 'RUN', faulted = false, forces = 'off' }: CompactDemoLiveOptions): RackLive {
  let key: KeySwitch = initialKey;
  const t0 = now();
  const kinds = new Map(hardware.modules.map((m) => [m.slot, m.catalog]));
  const status: ControllerStatus = {
    mode: 'RUN',
    keySwitch: key,
    running: true,
    ok: 'green',
    runLed: 'green',
    forceLed: 'off',
    ioLed: 'green',
    displayText: 'Run',
    minorFaults: [],
    scanCount: 0,
    lastScanMs: 0.42,
    maxScanMs: 0.9,
    uptimeMs: 0,
    forcesInstalled: forces !== 'off',
    forcesEnabled: forces === 'enabled',
    firstScan: false,
  };
  const running = () => !faulted && key !== 'PROG';
  return {
    status() {
      const t = now() - t0;
      status.keySwitch = key;
      status.uptimeMs = t * 1000;
      status.scanCount = Math.floor(t * 1000);
      status.forceLed = forces === 'enabled' ? 'amber' : forces === 'disabled' ? 'flashing-amber' : 'off';
      if (faulted) {
        status.mode = 'FAULTED';
        status.running = false;
        status.ok = 'flashing-red';
        status.runLed = 'off';
        status.displayText = 'Major Fault T04:C20 Array subscript too large';
      } else if (key === 'PROG') {
        status.mode = 'PROG';
        status.running = false;
        status.ok = 'green';
        status.runLed = 'off';
        status.displayText = 'Prog';
      } else {
        status.mode = key === 'REM' ? 'REM_RUN' : 'RUN';
        status.running = true;
        status.ok = 'green';
        status.runLed = 'green';
        status.displayText = key === 'REM' ? 'Rem Run' : 'Run';
      }
      return status;
    },
    point(slot, index) {
      const cat = kinds.get(slot);
      const t = now() - t0;
      const isOut = cat === '5069-OB16' || cat === '1756-OB16E';
      if (isOut && !running()) return false;
      if (pattern === 'traffic') return isOut ? trafficOut(t, index) : trafficIn(t, index);
      const phase = Math.floor(t * 6 + slot * 3) % 16;
      return isOut ? phase === index || (phase + 8) % 16 === index : (Math.floor(t * 1.3 + index * 0.37 + slot) % 3 === 0);
    },
    channel(slot, ch) {
      const t = now() - t0;
      return 50 + 45 * Math.sin(t * 0.7 + ch + slot);
    },
    setKeySwitch(pos) {
      key = pos;
    },
  };
}
