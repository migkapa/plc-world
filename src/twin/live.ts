/**
 * Live wiring between a simulated Logix controller and the 3D rack twins
 * (<ControlLogixRack/>, <CompactLogixRack/>).
 *
 *   const live = useMemo(() => rackLiveFromController(controller), [controller]);
 *   <ControlLogixRack hardware={controller.project.hardware} live={live} />
 *
 * Operand conventions (see docs/SCENES.md):
 *   ControlLogix 1756:  DI Local:s:I.Data.n     DO Local:s:O.Data.n     AI Local:s:I.ChnData    AO Local:s:O.ChnData
 *   CompactLogix 5069:  DI Local:s:I.Ptnn.Data  DO Local:s:O.Ptnn.Data  AI Local:s:I.Chnn.Data  AO Local:s:O.Chnn.Data
 *
 * Every getter is defensive: unknown slots, missing tags or a controller that throws return false / 0.
 * Operand strings are built once per project and cached, so per-frame getters do not allocate.
 *
 * No React / three imports here — safe to use from headless code and tests.
 */
import type { ControllerStatus, KeySwitch, ModuleCatalog, ModuleKind, PlcController, Project } from '../plc/types';
import type { RackLive } from './contracts';

// ---------------------------------------------------------------------------
// Catalog helpers (local copy so this module does not depend on the runtime catalog)
// ---------------------------------------------------------------------------

interface CatalogIoInfo {
  kind: ModuleKind;
  /** Digital points or analog channels. */
  points: number;
  family: '1756' | '5069';
}

const IO_INFO: Record<ModuleCatalog, CatalogIoInfo> = {
  '1756-L85E': { kind: 'CPU', points: 0, family: '1756' },
  '1756-L83E': { kind: 'CPU', points: 0, family: '1756' },
  '1756-EN2T': { kind: 'COMM', points: 0, family: '1756' },
  '1756-EN4TR': { kind: 'COMM', points: 0, family: '1756' },
  '1756-IB16': { kind: 'DI', points: 16, family: '1756' },
  '1756-OB16E': { kind: 'DO', points: 16, family: '1756' },
  '1756-IF8': { kind: 'AI', points: 8, family: '1756' },
  '1756-OF8': { kind: 'AO', points: 8, family: '1756' },
  '5069-L320ER': { kind: 'CPU', points: 0, family: '5069' },
  '5069-L330ERM': { kind: 'CPU', points: 0, family: '5069' },
  '5069-IB16': { kind: 'DI', points: 16, family: '5069' },
  '5069-OB16': { kind: 'DO', points: 16, family: '5069' },
  '5069-IF8': { kind: 'AI', points: 8, family: '5069' },
  '5069-OF4': { kind: 'AO', points: 4, family: '5069' },
};

/** Module kind for a catalog number ('DI' when unknown). */
export function catalogKind(catalog: ModuleCatalog): ModuleKind {
  return IO_INFO[catalog]?.kind ?? 'DI';
}

/** Number of digital points / analog channels for a catalog number (0 for CPU/COMM/unknown). */
export function catalogPoints(catalog: ModuleCatalog): number {
  return IO_INFO[catalog]?.points ?? 0;
}

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * Fully-qualified operand for a digital point or analog channel of the module in `slot`.
 * Returns undefined for CPU/COMM modules or out-of-range indices.
 *
 *   ioOperand('1756-IB16', 1, 3)   -> 'Local:1:I.Data.3'
 *   ioOperand('1756-OF8', 4, 1)    -> 'Local:4:O.Ch1Data'
 *   ioOperand('5069-OB16', 2, 7)   -> 'Local:2:O.Pt07.Data'
 *   ioOperand('5069-IF8', 3, 0)    -> 'Local:3:I.Ch00.Data'
 */
export function ioOperand(catalog: ModuleCatalog, slot: number, index: number): string | undefined {
  const info = IO_INFO[catalog];
  if (!info || index < 0 || index >= info.points) return undefined;
  const base = `Local:${slot}:`;
  if (info.family === '1756') {
    switch (info.kind) {
      case 'DI':
        return `${base}I.Data.${index}`;
      case 'DO':
        return `${base}O.Data.${index}`;
      case 'AI':
        return `${base}I.Ch${index}Data`;
      case 'AO':
        return `${base}O.Ch${index}Data`;
      default:
        return undefined;
    }
  }
  switch (info.kind) {
    case 'DI':
      return `${base}I.Pt${pad2(index)}.Data`;
    case 'DO':
      return `${base}O.Pt${pad2(index)}.Data`;
    case 'AI':
      return `${base}I.Ch${pad2(index)}.Data`;
    case 'AO':
      return `${base}O.Ch${pad2(index)}.Data`;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// RackLive factory
// ---------------------------------------------------------------------------

interface SlotEntry {
  catalog: ModuleCatalog;
  kind: ModuleKind;
  /** Operand per point/channel; null = tag missing (checked lazily), undefined = not checked yet. */
  ops: Array<string | null | undefined>;
}

/** Status used when the controller throws (e.g. no project loaded yet). */
const FALLBACK_STATUS: ControllerStatus = {
  mode: 'PROG',
  keySwitch: 'PROG',
  running: false,
  ok: 'off',
  runLed: 'off',
  forceLed: 'off',
  ioLed: 'off',
  displayText: '',
  minorFaults: [],
  scanCount: 0,
  lastScanMs: 0,
  maxScanMs: 0,
  uptimeMs: 0,
  forcesInstalled: false,
  forcesEnabled: false,
  firstScan: false,
};

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Create the live link used by the rack twins to show LEDs, displays and key switch state. */
export function rackLiveFromController(controller: PlcController): RackLive {
  let project: Project | null = null;
  const slots = new Map<number, SlotEntry>();

  // Status is read by many LED getters per frame: cache it for a few ms.
  let statusCache: ControllerStatus | null = null;
  let statusAt = -Infinity;

  function sync(): void {
    let p: Project | null = null;
    try {
      p = controller.project ?? null;
    } catch {
      p = null;
    }
    if (p === project) return;
    project = p;
    slots.clear();
    for (const m of p?.hardware?.modules ?? []) {
      const kind = catalogKind(m.catalog);
      slots.set(m.slot, { catalog: m.catalog, kind, ops: new Array(catalogPoints(m.catalog)) });
    }
  }

  /** Resolve (and cache) the operand for a point, or null if the tag does not exist. */
  function operand(entry: SlotEntry, slot: number, index: number): string | null {
    if (index < 0 || index >= entry.ops.length) return null;
    const cached = entry.ops[index];
    if (cached !== undefined) return cached;
    const op = ioOperand(entry.catalog, slot, index) ?? null;
    let ok = false;
    if (op) {
      try {
        ok = controller.tags.exists(op);
      } catch {
        ok = false;
      }
    }
    // Cached per project: I/O tags are created from the hardware config when the project is loaded.
    entry.ops[index] = ok ? op : null;
    return ok ? op : null;
  }

  return {
    status(): ControllerStatus {
      const t = now();
      if (!statusCache || t - statusAt > 4) {
        try {
          statusCache = controller.getStatus();
        } catch {
          statusCache = FALLBACK_STATUS;
        }
        statusAt = t;
      }
      return statusCache;
    },

    point(slot: number, index: number): boolean {
      sync();
      const entry = slots.get(slot);
      if (!entry || (entry.kind !== 'DI' && entry.kind !== 'DO')) return false;
      const op = operand(entry, slot, index);
      if (!op) return false;
      try {
        if (entry.kind === 'DI') return controller.tags.readBool(op);
        return Boolean(controller.readOutputForField(op));
      } catch {
        return false;
      }
    },

    channel(slot: number, ch: number): number {
      sync();
      const entry = slots.get(slot);
      if (!entry || (entry.kind !== 'AI' && entry.kind !== 'AO')) return 0;
      const op = operand(entry, slot, ch);
      if (!op) return 0;
      try {
        const v = entry.kind === 'AI' ? controller.tags.readNumber(op) : Number(controller.readOutputForField(op));
        return Number.isFinite(v) ? v : 0;
      } catch {
        return 0;
      }
    },

    setKeySwitch(pos: KeySwitch): void {
      try {
        controller.setKeySwitch(pos);
      } catch {
        /* ignore */
      }
      statusCache = null;
    },
  };
}

/**
 * A controller-less RackLive for showrooms/previews: a powered controller whose mode follows the key
 * switch (RUN -> Run, PROG -> Program, REM -> keeps running state) with the given point/channel pattern.
 */
export function staticRackLive(opts: {
  status?: Partial<ControllerStatus>;
  point?: (slot: number, index: number) => boolean;
  channel?: (slot: number, ch: number) => number;
  onKeySwitch?: (pos: KeySwitch) => void;
} = {}): RackLive {
  const status: ControllerStatus = {
    ...FALLBACK_STATUS,
    mode: 'REM_RUN',
    keySwitch: 'REM',
    running: true,
    ok: 'green',
    runLed: 'green',
    ioLed: 'green',
    displayText: 'Rem Run',
    ...opts.status,
  };
  const applyKey = (pos: KeySwitch) => {
    status.keySwitch = pos;
    if (status.mode === 'FAULTED') return;
    const running = pos === 'RUN' ? true : pos === 'PROG' ? false : status.running;
    status.running = running;
    status.mode = pos === 'REM' ? (running ? 'REM_RUN' : 'REM_PROG') : running ? 'RUN' : 'PROG';
    status.runLed = running ? 'green' : 'off';
    status.displayText = pos === 'REM' ? (running ? 'Rem Run' : 'Rem Prog') : running ? 'RUN' : 'PROG';
  };
  return {
    status: () => status,
    point: opts.point ?? (() => false),
    channel: opts.channel ?? (() => 0),
    setKeySwitch: (pos) => {
      applyKey(pos);
      opts.onKeySwitch?.(pos);
    },
  };
}
