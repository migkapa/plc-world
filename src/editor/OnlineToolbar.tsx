/**
 * Studio 5000-style online toolbar: controller mode tile (with the animated "running" indicator and
 * Run/Program mode actions), forces tile (enable / disable / remove all I/O forces), edits tile (driven
 * by the host: `editsState`), fault tile (Clear Majors), status lights (Run Mode, Controller OK, Energy
 * Storage OK, I/O OK), key switch, communication path and scan time.
 *
 * Rendering: the toolbar re-renders only when the controller status it shows changes (mode, key, faults,
 * forces…); the scan-time readout is a separate small component that polls on its own.
 */
import { AlertOctagon, Check, ChevronDown, KeyRound, MoreHorizontal, Pencil, PlugZap, TriangleAlert, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { formatVerifyError } from '@/plc/verify';
import { faultId } from '@/plc/errors';
import type { ControllerMode, ControllerStatus, KeySwitch, PlcController } from '@/plc/types';
import { Button } from '@/ui/Button';
import { Modal } from '@/ui/Modal';
import { cn } from '@/ui/cn';
import { toast } from '@/ui/toast';
import { ContextMenu, type MenuEntry } from './EditorOverlays';
import './ladder.css';

/**
 * State of the online edits, shown on the edits tile:
 *  - 'none'    — the running logic is what the editor shows (Studio: "No Edits");
 *  - 'pending' — the editor rungs do not verify: the controller keeps running the last good logic;
 *  - 'held'    — edits are held on purpose (e.g. a branch leg without an instruction yet);
 *  - 'applied' — edits were just accepted online (a short confirmation).
 */
export type EditsState = 'none' | 'pending' | 'applied' | 'held';

export interface OnlineToolbarProps {
  controller: PlcController;
  /** Edits tile (default 'none'). */
  editsState?: EditsState;
  /** Tooltip of the edits tile (default: a description of `editsState`). */
  editsTitle?: string;
  /** Called after a successful Run/Program mode change. */
  onModeChange?(mode: 'RUN' | 'PROG'): void;
  /** The workstation is connected (default true). Offline shows the Offline tile. */
  online?: boolean;
  onGoOnline?(): void;
  onGoOffline?(): void;
  /** Let the user turn the key switch from the toolbar (the physical key is usually on the 3D twin). */
  allowKeySwitch?: boolean;
  /** Communication path (default derived from the hardware). */
  path?: string;
  /**
   * 'calm' (game workspace): forces / edits / faults collapse to icons unless something is going on, and the status
   * lights, key switch, path and scan time live in the "More" menu. 'full' (default) is the Studio 5000 layout.
   */
  density?: 'full' | 'calm';
  className?: string;
}

const MODE_TEXT: Record<ControllerMode, string> = {
  RUN: 'Run',
  PROG: 'Prog',
  REM_RUN: 'Rem Run',
  REM_PROG: 'Rem Prog',
  FAULTED: 'Faulted',
};

/** Default RSLinx-style path, e.g. AB_ETHIP-1\192.168.1.10\Backplane\0. */
export function defaultCommPath(controller: PlcController): string {
  const hw = controller.project.hardware;
  const cpu = hw.modules.find((m) => m.catalog.startsWith('1756-L') || m.catalog.startsWith('5069-L'));
  if (hw.platform === 'ControlLogix') return `AB_ETHIP-1\\192.168.1.10\\Backplane\\${cpu?.slot ?? 0}`;
  return 'AB_ETHIP-1\\192.168.1.10';
}

/** What the toolbar shows of a status (everything but the scan counters / times). */
export function statusKey(st: ControllerStatus, forces: number): string {
  const f = st.majorFault;
  const m = st.minorFaults[st.minorFaults.length - 1];
  return [
    st.mode,
    st.keySwitch,
    st.running,
    st.ok,
    st.ioLed,
    st.forcesEnabled,
    forces,
    f ? `${f.type}:${f.code}:${f.timeMs}` : '',
    st.minorFaults.length,
    m ? `${m.type}:${m.code}:${m.timeMs}` : '',
  ].join('|');
}

/**
 * Controller status, re-rendering only when something the toolbar shows changes. Controller events
 * cover almost everything; a slow poll catches the rest (e.g. Clear Minors) without re-rendering an
 * idle toolbar.
 */
function useStatus(controller: PlcController): [ControllerStatus, () => void] {
  const [status, setStatus] = useState(() => controller.getStatus());
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    let key = '';
    const refresh = (): void => {
      const st = controller.getStatus();
      const k = statusKey(st, Object.keys(controller.getForces()).length);
      if (k === key) return;
      key = k;
      setStatus(st);
    };
    refreshRef.current = refresh;
    refresh();
    const unsub = controller.subscribe(refresh);
    const h = window.setInterval(refresh, 1000);
    return () => {
      unsub();
      window.clearInterval(h);
    };
  }, [controller]);
  const refresh = useCallback(() => refreshRef.current(), []);
  return [status, refresh];
}

/** "Scan 0.042 ms · max 0.051 ms · RUN" — polls on its own so the scan times never re-render the toolbar. */
function ScanReadout({ controller }: { controller: PlcController }) {
  const format = useCallback((): string => {
    const st = controller.getStatus();
    return `${st.lastScanMs.toFixed(3)}|${st.maxScanMs.toFixed(3)}|${st.displayText}`;
  }, [controller]);
  const [text, setText] = useState(format);
  useEffect(() => {
    setText(format());
    const h = window.setInterval(() => setText(format()), 500);
    return () => window.clearInterval(h);
  }, [format]);
  const [last, max, display] = text.split('|');
  return (
    <span className="truncate" data-testid="scan-readout" title={`Last scan ${last} ms · max ${max} ms · ${display}`}>
      Scan <span className="font-mono text-[var(--ld-chrome-text)]">{last} ms</span>
      <span className="@max-[940px]:hidden">
        {' '}
        · max <span className="font-mono text-[var(--ld-chrome-text)]">{max} ms</span> · {display}
      </span>
    </span>
  );
}

const EDITS: Record<EditsState, { label: string; tone: 'neutral' | 'amber-outline' | 'green-outline'; title: string }> = {
  none: { label: 'No Edits', tone: 'neutral', title: 'The controller runs the logic shown in the editor. Rung edits are verified and applied online as you make them.' },
  pending: {
    label: 'Edits Pending',
    tone: 'amber-outline',
    title: 'Your rung edits do not verify yet: the controller keeps running the last good logic. Fix the errors and they are applied online.',
  },
  held: { label: 'Edits Held', tone: 'amber-outline', title: 'Your rung edits are held until they are complete (e.g. a branch level without an instruction).' },
  applied: { label: 'Edits Applied', tone: 'green-outline', title: 'Your rung edits were verified and accepted online — the plant kept running.' },
};

function Led({ state, label, title }: { state: 'green' | 'red' | 'flashing-red' | 'flashing-green' | 'amber' | 'flashing-amber' | 'off'; label: string; title?: string }) {
  const color = state.includes('green') ? 'bg-emerald-400 shadow-emerald-400/70' : state.includes('red') ? 'bg-red-500 shadow-red-500/70' : state.includes('amber') ? 'bg-amber-400 shadow-amber-400/70' : '';
  const on = state !== 'off';
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap" title={`${title ?? label}${on ? '' : ' (off)'}`} data-led={label}>
      <span className={cn('inline-block h-2 w-2 rounded-full', !on ? 'bg-slate-600' : cn(color, 'shadow-[0_0_6px]'), state.startsWith('flashing') && 'ld-blink')} />
      {/* narrow toolbars keep only the lights; the label stays for screen readers and in the tooltip */}
      <span className="@max-[940px]:sr-only">{label}</span>
    </span>
  );
}

function Tile({
  children,
  onClick,
  tone,
  title,
  className,
  menu,
}: {
  children: ReactNode;
  onClick?(el: HTMLElement): void;
  tone: 'green' | 'blue' | 'red' | 'amber' | 'amber-outline' | 'green-outline' | 'neutral';
  title?: string;
  className?: string;
  menu?: boolean;
}) {
  const tones = {
    green: 'border-emerald-400/50 bg-emerald-600 text-white',
    blue: 'border-sky-400/40 bg-sky-700/80 text-white',
    red: 'border-red-400/60 bg-red-600 text-white',
    amber: 'border-amber-300/60 bg-amber-400 text-black',
    'amber-outline': 'border-amber-400/80 bg-amber-400/10 text-amber-300',
    'green-outline': 'border-emerald-400/70 bg-emerald-400/10 text-emerald-300',
    neutral: 'border-[var(--ld-chrome-border)] bg-[var(--ld-chrome-2)] text-[var(--ld-chrome-text)]',
  }[tone];
  return (
    <button
      type="button"
      title={title}
      onClick={(e) => onClick?.(e.currentTarget)}
      disabled={!onClick}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11.5px] font-semibold whitespace-nowrap transition-[filter]',
        onClick ? 'cursor-pointer hover:brightness-110' : 'cursor-default',
        'focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none',
        tones,
        className,
      )}
    >
      {children}
      {menu && <ChevronDown size={12} className="opacity-80" />}
    </button>
  );
}

export function OnlineToolbar({ controller, editsState = 'none', editsTitle, onModeChange, online = true, onGoOnline, onGoOffline, allowKeySwitch, path, className, density = 'full'}: OnlineToolbarProps) {
  const [st, refreshStatus] = useStatus(controller);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [confirmForces, setConfirmForces] = useState(false);
  const lastFault = useRef<string | undefined>(undefined);

  const openMenu = (el: HTMLElement, entries: MenuEntry[]): void => {
    const r = el.getBoundingClientRect();
    setMenu({ x: r.left, y: r.bottom + 4, entries });
  };

  const requestMode = useCallback(
    (mode: 'RUN' | 'PROG') => {
      const s = controller.getStatus();
      if (s.keySwitch !== 'REM') {
        toast({
          tone: 'warning',
          title: `Key switch is in ${s.keySwitch}`,
          body: `Remote mode changes need the key switch in REM. Turn the key on the controller to ${mode === 'RUN' ? 'RUN' : 'PROG'} or REM.`,
        });
        return;
      }
      if (s.mode === 'FAULTED') {
        toast({ tone: 'error', title: 'Controller is faulted', body: 'Clear the major fault (Clear Majors) before changing the mode.' });
        return;
      }
      if (controller.requestMode(mode)) {
        onModeChange?.(mode);
        return;
      }
      const errs = controller.verify().filter((e) => e.severity === 'error');
      const list = errs.slice(0, 3).map((e, i) => `${i + 1}) ${formatVerifyError(e).replace(/^Error: /, '')}`).join('   ');
      toast({
        tone: 'error',
        title: `Cannot go to Run mode — ${errs.length} verification error${errs.length === 1 ? '' : 's'}`,
        body: `${list}${errs.length > 3 ? `   … and ${errs.length - 3} more` : ''}`,
        duration: 9000,
      });
    },
    [controller, onModeChange],
  );

  // announce new major faults
  useEffect(() => {
    const f = st.majorFault;
    const key = f ? `${f.type}:${f.code}:${f.timeMs}` : undefined;
    if (key && key !== lastFault.current) {
      toast({ tone: 'error', title: `Major fault ${faultId(f!.type, f!.code)}`, body: f!.message, duration: 8000 });
    }
    lastFault.current = key;
  }, [st.majorFault]);

  const running = st.running;
  const faulted = st.mode === 'FAULTED';
  const forcesCount = Object.keys(controller.getForces()).length;
  const modeTone = !online ? 'neutral' : faulted ? 'red' : running ? 'green' : 'blue';

  const modeMenu = (): MenuEntry[] => {
    const remote = st.keySwitch === 'REM';
    const out: MenuEntry[] = [
      { heading: `Controller ${controller.project.controllerName}` },
      { label: 'Run Mode', disabled: !online || running || faulted || !remote, hint: remote ? undefined : 'Key switch not in REM', onSelect: () => requestMode('RUN') },
      // a faulted controller refuses mode changes until its major fault is cleared
      { label: 'Program Mode', disabled: !online || !running || !remote, hint: faulted ? 'Clear Majors first' : remote ? undefined : 'Key switch not in REM', onSelect: () => requestMode('PROG') },
      { label: 'Test Mode', disabled: true, hint: 'Not emulated', onSelect: () => undefined },
    ];
    if (faulted) out.push('sep', { label: 'Clear Faults', onSelect: () => controller.clearMajorFault() });
    if (onGoOffline && online) out.push('sep', { label: 'Go Offline', onSelect: onGoOffline });
    if (onGoOnline && !online) out.push('sep', { label: 'Go Online', onSelect: onGoOnline });
    return out;
  };

  const forcesMenu = (): MenuEntry[] => {
    const forces = controller.getForces();
    const entries: MenuEntry[] = [
      { label: 'Enable All I/O Forces', disabled: !online || st.forcesEnabled || forcesCount === 0, hint: forcesCount === 0 ? 'No forces installed' : undefined, onSelect: () => setConfirmForces(true) },
      { label: 'Disable All I/O Forces', disabled: !online || !st.forcesEnabled, onSelect: () => controller.enableForces(false) },
      { label: 'Remove All I/O Forces', danger: true, disabled: !online || forcesCount === 0, onSelect: () => controller.removeAllForces() },
    ];
    const keys = Object.keys(forces);
    if (keys.length > 0) {
      entries.push('sep', { heading: `${keys.length} force${keys.length === 1 ? '' : 's'} installed` });
      for (const k of keys.slice(0, 12)) {
        const v = forces[k]!;
        entries.push({ label: `${k} = ${typeof v === 'boolean' ? (v ? '1' : '0') : v}`, icon: <Zap size={12} className="text-amber-400" />, disabled: !online, hint: 'Remove this force', onSelect: () => controller.removeForce(k) });
      }
    }
    return entries;
  };

  const faultMenu = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (st.majorFault) {
      out.push({ heading: `Major fault ${faultId(st.majorFault.type, st.majorFault.code)}` });
      out.push({ label: st.majorFault.message.slice(0, 80), disabled: true, onSelect: () => undefined });
      out.push({ label: 'Clear Majors', onSelect: () => controller.clearMajorFault() });
    }
    if (st.minorFaults.length > 0) {
      out.push('sep', { heading: `${st.minorFaults.length} minor fault(s)` });
      for (const f of st.minorFaults.slice(-5)) out.push({ label: `${faultId(f.type, f.code)} ${f.message.slice(0, 60)}`, disabled: true, onSelect: () => undefined });
      const c = controller as PlcController & { clearMinorFaults?(): void };
      if (c.clearMinorFaults) {
        out.push({
          label: 'Clear Minors',
          onSelect: () => {
            c.clearMinorFaults!();
            refreshStatus(); // clearing minors raises no controller event
          },
        });
      }
    }
    return out;
  };

  const keyPositions: KeySwitch[] = ['RUN', 'REM', 'PROG'];

  // Narrow toolbars (container queries): below 940 px the status lights become dots with tooltips and the path
  // hides; below 800 px the key switch and scan time move into the "…" menu; below 640 px the tiles shrink and
  // below 560 px the forces / edits / faults tiles keep only their icons (label in the tooltip and for screen readers).
  const moreMenu = (): MenuEntry[] => {
    const now = controller.getStatus();
    const lights: MenuEntry[] =
      density === 'calm'
        ? [
            {
              heading: [
                online && now.running ? 'Run Mode ●' : 'Run Mode ○',
                now.ok === 'green' ? 'Controller OK ●' : 'Controller Fault ✕',
                now.ioLed === 'green' ? 'I/O OK ●' : now.ioLed === 'off' ? 'No I/O' : 'I/O not OK ✕',
              ].join('  ·  '),
            },
            'sep',
          ]
        : [];
    return [
      ...lights,
      { heading: allowKeySwitch ? 'Key switch' : 'Key switch (turn it on the 3D controller)' },
      ...keyPositions.map(
        (k): MenuEntry => ({
          label: k,
          icon: now.keySwitch === k ? <Check size={12} /> : <span className="inline-block w-3" />,
          disabled: !allowKeySwitch || now.keySwitch === k,
          onSelect: () => controller.setKeySwitch(k),
        }),
      ),
      'sep',
      { heading: `Path: ${path ?? defaultCommPath(controller)}` },
      {
        label: online ? `Scan ${now.lastScanMs.toFixed(3)} ms · max ${now.maxScanMs.toFixed(3)} ms · ${now.displayText}` : 'Not connected',
        disabled: true,
        onSelect: () => undefined,
      },
    ];
  };

  const calm = density === 'calm';
  const quietForces = !online || forcesCount === 0;

  return (
    <div
      className={cn(
        'ld-root @container h-11 min-w-0 shrink-0 border-b border-[var(--ld-chrome-border)] bg-[var(--ld-chrome)] text-[11px] text-[var(--ld-chrome-muted)] ld-theme-dark',
        className,
      )}
    >
      <div
        className="flex h-full min-w-0 items-center gap-2 overflow-x-auto px-2"
        style={{ scrollbarWidth: 'none' }}
        role="toolbar"
        aria-label="Controller online toolbar"
      >
        {/* mode */}
        <Tile tone={modeTone} menu onClick={(el) => openMenu(el, modeMenu())} title="Controller mode" className={cn('min-w-[132px] justify-between @max-[640px]:min-w-0', faulted && 'ld-blink')}>
          <span className="flex items-center gap-1.5">
            {online && running ? (
              <span className="ld-run-anim inline-block h-3 w-5 rounded-[2px] border border-white/60" aria-hidden />
            ) : online && faulted ? (
              <AlertOctagon size={13} />
            ) : online ? (
              <span className="inline-block h-3 w-5 rounded-[2px] border border-white/50 bg-white/15" aria-hidden />
            ) : (
              <PlugZap size={13} />
            )}
            <span>{online ? MODE_TEXT[st.mode] : 'Offline'}</span>
          </span>
        </Tile>
        {/* forces */}
        <Tile
          tone={!online || forcesCount === 0 ? 'neutral' : st.forcesEnabled ? 'amber' : 'amber-outline'}
          menu
          onClick={(el) => openMenu(el, forcesMenu())}
          title="I/O forces"
          className={cn(calm ? (quietForces ? 'min-w-0' : '') : 'min-w-[118px] justify-between @max-[640px]:min-w-0', online && forcesCount > 0 && !st.forcesEnabled && 'ld-blink')}
        >
          <span className="flex items-center gap-1.5">
            <Zap size={12} />
            <span className={cn('@max-[560px]:sr-only', calm && quietForces && 'sr-only')}>{forcesCount === 0 ? 'No Forces' : st.forcesEnabled ? 'Forces Enabled' : 'Forces Disabled'}</span>
          </span>
        </Tile>
        {/* edits */}
        <Tile tone={online ? EDITS[editsState].tone : 'neutral'} title={editsTitle ?? EDITS[editsState].title} className={calm ? 'min-w-0' : 'min-w-[104px] @max-[640px]:min-w-0'}>
          <span className="flex items-center gap-1.5" data-testid="edits-tile" data-state={editsState}>
            <Pencil size={11} /> <span className={cn('@max-[560px]:sr-only', calm && editsState === 'none' && 'sr-only')}>{EDITS[editsState].label}</span>
          </span>
        </Tile>
        {/* faults */}
        <Tile
          tone={faulted ? 'red' : st.minorFaults.length > 0 ? 'amber-outline' : 'neutral'}
          menu={faulted || st.minorFaults.length > 0}
          {...(faulted || st.minorFaults.length > 0 ? { onClick: (el: HTMLElement) => openMenu(el, faultMenu()) } : {})}
          title={st.majorFault ? st.majorFault.message : 'Controller faults'}
        >
          {faulted ? <AlertOctagon size={12} /> : <TriangleAlert size={12} />}
          <span className={cn(!faulted && '@max-[560px]:sr-only', calm && !faulted && st.minorFaults.length === 0 && 'sr-only')}>
          {faulted && st.majorFault ? `Major Fault ${faultId(st.majorFault.type, st.majorFault.code)}` : st.minorFaults.length > 0 ? `${st.minorFaults.length} Minor Fault${st.minorFaults.length === 1 ? '' : 's'}` : 'No Faults'}
        </span>
        </Tile>
        {faulted && (
          <Button size="xs" variant="danger" onClick={() => controller.clearMajorFault()} className="shrink-0">
            Clear Majors
          </Button>
        )}
        <div className={cn('mx-1 h-7 w-px shrink-0 bg-[var(--ld-chrome-border)]', calm && 'hidden')} />
        {/* status lights */}
        <div className={cn(calm && 'hidden')}>
        <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-0.5 text-[10.5px] leading-[14px] @max-[940px]:gap-x-1.5" data-testid="status-lights">
          <Led state={online && running ? 'green' : 'off'} label="Run Mode" />
          <Led state={!online ? 'off' : st.ok === 'green' ? 'green' : st.ok === 'off' ? 'off' : 'flashing-red'} label={st.ok === 'green' || !online ? 'Controller OK' : 'Controller Fault'} />
          <Led state={online ? 'green' : 'off'} label="Energy Storage OK" />
          <Led state={!online ? 'off' : st.ioLed === 'green' ? 'green' : st.ioLed === 'off' ? 'off' : st.ioLed === 'flashing-red' ? 'flashing-red' : 'flashing-green'} label="I/O OK" title={st.ioLed === 'off' ? 'No I/O modules configured' : 'All I/O connections running'} />
        </div>
        </div>
        <div className={cn('mx-1 h-7 w-px shrink-0 bg-[var(--ld-chrome-border)] @max-[800px]:hidden', calm && 'hidden')} />
        {/* key switch */}
        <div className={cn('flex shrink-0 items-center gap-1.5 @max-[800px]:hidden', calm && 'hidden')} title="Controller key switch" data-testid="key-switch">
          <KeyRound size={13} className="text-[var(--ld-chrome-muted)]" />
          <div className="flex overflow-hidden rounded-md border border-[var(--ld-chrome-border)]">
            {keyPositions.map((k) => (
              <button
                key={k}
                type="button"
                disabled={!allowKeySwitch}
                onClick={() => controller.setKeySwitch(k)}
                aria-pressed={st.keySwitch === k}
                className={cn(
                  'px-1.5 py-0.5 font-mono text-[10px] font-bold',
                  st.keySwitch === k ? 'bg-slate-200 text-slate-900' : 'text-[var(--ld-chrome-muted)]',
                  allowKeySwitch && st.keySwitch !== k && 'cursor-pointer hover:bg-white/10',
                )}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
        <div className={cn('mx-1 h-7 w-px shrink-0 bg-[var(--ld-chrome-border)] @max-[800px]:hidden', calm && 'hidden')} />
        {/* path & scan */}
        <div className={cn('flex min-w-0 shrink-0 flex-col leading-[14px] @max-[800px]:hidden', calm && 'hidden')}>
          <span className="truncate @max-[940px]:hidden">
            Path: <span className="font-mono text-[var(--ld-chrome-text)]">{path ?? defaultCommPath(controller)}</span>
          </span>
          {online ? <ScanReadout controller={controller} /> : <span className="truncate">Not connected</span>}
        </div>
        {/* narrow: key switch, path and scan time in a menu */}
        <button
          type="button"
          onClick={(e) => openMenu(e.currentTarget, moreMenu())}
          className={cn(
            'hidden h-7 shrink-0 cursor-pointer items-center gap-1 rounded-md border border-[var(--ld-chrome-border)] bg-[var(--ld-chrome-2)] px-1.5 text-[var(--ld-chrome-text)] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none @max-[800px]:inline-flex',
            calm && 'inline-flex',
          )}
          title={`Key switch ${st.keySwitch}, communication path and scan time`}
          aria-label="More controller status: key switch, path and scan time"
          data-testid="toolbar-more"
        >
          <KeyRound size={12} />
          <span className="font-mono text-[10px] font-bold">{st.keySwitch}</span>
          <MoreHorizontal size={13} />
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={menu.entries} themeClass="ld-theme-dark" onClose={() => setMenu(null)} />}
      <Modal
        open={confirmForces}
        onClose={() => setConfirmForces(false)}
        title={
          <span className="flex items-center gap-2">
            <TriangleAlert size={18} className="text-amber-400" /> Enable All I/O Forces
          </span>
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmForces(false)}>
              Cancel
            </Button>
            <Button
              variant="warning"
              size="sm"
              onClick={() => {
                controller.enableForces(true);
                setConfirmForces(false);
              }}
            >
              Enable forces
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Enabling I/O forces makes the controller override input values and drive forced outputs regardless of the logic. On a real machine this can cause
          unexpected motion — always make sure the area is clear.
        </p>
        <p className="mt-2 text-sm text-slate-400">
          {forcesCount} force{forcesCount === 1 ? '' : 's'} will take effect.
        </p>
      </Modal>
    </div>
  );
}
