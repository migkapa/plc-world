/**
 * Hardware Showroom (/showroom/:device?): device list · 3D viewer with hotspots and demo controls · info card.
 */
import { AlertTriangle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useGame } from '../../game/store';
import { cn, hasWebGL } from '../../ui';
import { useReducedMotion } from '../hud/prefs';
import { useMedia } from '../reference/useMedia';
import { routes } from '../routes';
import { DEFAULT_SHOWROOM_DEVICE, getShowroomDevice } from '../showroom/catalog';
import { DemoControls } from '../showroom/DemoControls';
import { DemoStore } from '../showroom/demo';
import { DeviceList, DevicePicker } from '../showroom/DeviceList';
import { InfoCard } from '../showroom/InfoCard';
import { STAGES } from '../showroom/stages';
import { DeviceViewer } from '../showroom/Viewer';
import { useDocumentTitle } from '../useDocumentTitle';
import '../showroom/showroom.css';

const EXPLORED_KEY = 'plc-world-showroom-explored-v1';

function loadExplored(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(EXPLORED_KEY);
    const arr: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

function saveExplored(s: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(EXPLORED_KEY, JSON.stringify([...s]));
  } catch {
    /* private mode: progress stays in memory */
  }
}

export default function ShowroomPage() {
  const params = useParams<{ device?: string }>();
  const [, navigate] = useLocation();
  const requested = params.device ? decodeURIComponent(params.device) : undefined;
  const found = getShowroomDevice(requested);
  const device = found ?? getShowroomDevice(DEFAULT_SHOWROOM_DEVICE)!;
  const unknown = requested && !found ? requested : undefined;
  useDocumentTitle(`${device.catalog} ${device.name} · Showroom`);
  const stage = STAGES[device.id]!;
  const [webgl] = useState(hasWebGL);
  const demo = useMemo(() => new DemoStore(stage.defaults), [stage]);
  const reducedMotion = useReducedMotion();
  const quality = useGame((s) => s.profile.settings.quality);
  const recordEvent = useGame((s) => s.recordEvent);
  const wide = useMedia('(min-width: 1280px)');
  const desktop = useMedia('(min-width: 1024px)');

  const [explored, setExplored] = useState<Set<string>>(loadExplored);
  const [active, setActive] = useState<number | null>(null);
  const [seen, setSeen] = useState<Set<number>>(() => new Set());
  const [showHotspots, setShowHotspots] = useState(true);
  const [homeSignal, setHomeSignal] = useState(0);

  useEffect(() => {
    setActive(null);
    setSeen(new Set());
    setExplored((prev) => {
      if (prev.has(device.id)) return prev;
      const next = new Set(prev).add(device.id);
      saveExplored(next);
      return next;
    });
    recordEvent({ type: 'showroomVisited', device: device.id });
  }, [device.id, recordEvent]);

  const onActive = (i: number | null) => {
    setActive(i);
    if (i !== null) setSeen((s) => (s.has(i) ? s : new Set(s).add(i)));
  };

  // keyboard: ←/→ step through hotspots while one is open, Esc closes it, H toggles markers
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const n = device.hotspots.length;
      if (e.key === 'Escape' && active !== null) setActive(null);
      else if (e.key === 'ArrowRight' && active !== null) onActive((active + 1) % n);
      else if (e.key === 'ArrowLeft' && active !== null) onActive((active - 1 + n) % n);
      else if (e.key.toLowerCase() === 'h' && !e.metaKey && !e.ctrlKey) setShowHotspots((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const viewer = (
    <div className="relative h-full min-h-0 overflow-hidden rounded-xl border border-edge bg-[#161b22] shadow-inner shadow-black/40">
      {webgl ? (
        <DeviceViewer
          device={device}
          stage={stage}
          demo={demo}
          active={active}
          onActive={onActive}
          seen={seen}
          showHotspots={showHotspots}
          onToggleHotspots={() => setShowHotspots((v) => !v)}
          quality={quality}
          reducedMotion={reducedMotion}
          homeSignal={homeSignal}
          onHome={() => {
            setActive(null);
            setHomeSignal((n) => n + 1);
          }}
        />
      ) : (
        // without WebGL the viewer cannot start (it used to crash the page): the specs and hotspot notes still work
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center" data-testid="showroom-no-webgl">
          <div className="max-w-sm text-sm text-slate-400">
            <div className="font-semibold text-slate-200">3D viewer unavailable (WebGL is disabled)</div>
            <p className="mt-1.5 text-xs leading-relaxed">
              The {device.catalog} specs, status indicators and wiring notes are all in the info card.
            </p>
          </div>
        </div>
      )}
      {/* device title: bottom-left (clear of the toolbar and most hotspots); hidden while a hotspot callout is open */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute bottom-2.5 left-2.5 hidden max-w-[55%] rounded-lg bg-gradient-to-r from-black/55 to-black/0 px-2.5 py-1.5 sm:block',
          !reducedMotion && 'transition-opacity duration-200',
          active !== null && 'opacity-0',
        )}
      >
        <div className="font-mono text-[11px] font-semibold tracking-wide text-slate-300">{device.catalog}</div>
        <div className="text-base leading-tight font-bold text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.6)] xl:text-lg">{device.name}</div>
      </div>
    </div>
  );

  const controls = <DemoControls controls={stage.controls} demo={demo} title={`Try it · ${device.catalog}`} />;
  const notice = unknown && (
    <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[13px] text-amber-200">
      <AlertTriangle size={14} className="shrink-0 text-amber-300" />
      <span className="min-w-0">
        There is no device called “<span className="font-mono">{unknown}</span>” — showing the {device.catalog} instead.
      </span>
    </div>
  );

  if (!desktop) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 pb-10">
          <h1 className="sr-only">Hardware Showroom: {device.name}</h1>
          <DevicePicker current={device.id} explored={explored} onPick={(id) => navigate(routes.showroom(id))} />
          {notice}
          <div className="h-[56vh] max-h-[520px] min-h-[300px]">{viewer}</div>
          {controls}
          <div className="rounded-xl border border-edge bg-panel-2">
            <InfoCard device={device} reducedMotion={reducedMotion} scroll={false} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('grid h-full min-h-0', wide ? 'grid-cols-[256px_minmax(0,1fr)_400px]' : 'grid-cols-[232px_minmax(0,1fr)]')}>
      <DeviceList current={device.id} explored={explored} className="min-h-0 border-r border-edge bg-panel/70" />
      {wide ? (
        <>
          <div className="flex min-h-0 flex-col gap-3 p-3">
            {notice}
            <div className="min-h-0 flex-1">{viewer}</div>
            <div className="max-h-[42%] shrink-0 overflow-y-auto">{controls}</div>
          </div>
          <InfoCard device={device} reducedMotion={reducedMotion} className="min-h-0 border-l border-edge bg-panel-2/60" />
        </>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
            {notice}
            <div className="h-[60vh] min-h-[340px]">{viewer}</div>
            {controls}
            <div className="rounded-xl border border-edge bg-panel-2">
              <InfoCard device={device} reducedMotion={reducedMotion} scroll={false} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
