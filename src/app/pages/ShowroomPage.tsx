/**
 * Hardware Showroom (/showroom/:device?): device list · 3D viewer with hotspots and demo controls · info card.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { useGame } from '../../game/store';
import { cn } from '../../ui';
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
  const device = getShowroomDevice(params.device) ?? getShowroomDevice(DEFAULT_SHOWROOM_DEVICE)!;
  const stage = STAGES[device.id]!;
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
      <div className="pointer-events-none absolute top-12 left-2.5 hidden max-w-[60%] rounded-lg sm:block bg-gradient-to-r from-black/55 to-black/0 px-2.5 py-1.5 sm:top-14">
        <div className="font-mono text-[11px] font-semibold tracking-wide text-slate-300">{device.catalog}</div>
        <div className="text-lg leading-tight font-bold text-white [text-shadow:0_1px_8px_rgba(0,0,0,0.6)] sm:text-xl">{device.name}</div>
      </div>
    </div>
  );

  const controls = <DemoControls controls={stage.controls} demo={demo} title={`Try it · ${device.catalog}`} />;

  if (!desktop) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 p-3 pb-10">
          <DevicePicker current={device.id} explored={explored} onPick={(id) => navigate(routes.showroom(id))} />
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
            <div className="min-h-0 flex-1">{viewer}</div>
            <div className="max-h-[42%] shrink-0 overflow-y-auto">{controls}</div>
          </div>
          <InfoCard device={device} reducedMotion={reducedMotion} className="min-h-0 border-l border-edge bg-panel-2/60" />
        </>
      ) : (
        <div className="min-h-0 overflow-y-auto">
          <div className="flex flex-col gap-3 p-3">
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
