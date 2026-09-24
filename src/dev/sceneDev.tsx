/**
 * Dev harness for full 3D scenes with a live controller running the scene's demo program.
 *
 *   scene-dev.html?scene=motor-station                    default camera
 *   &cam=<presetId>                                       camera preset from the definition
 *   &campos=x,y,z&target=x,y,z                            explicit camera
 *   &quality=low|medium|high                              stage quality (default high)
 *   &ctrl=start:1,hoa:2                                   set controls at load (momentary ones stay held)
 *   &tap=start                                            tap momentary controls 300 ms after load
 *   &warm=5000                                            simulate N ms instantly before the first frame
 *   &prog=1                                               leave the controller in PROG (no demo logic)
 */
import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { createDemoRuntime } from '../sim/demo';
import { SCENES } from '../sim/scenes/views';
import { useSimLoop } from '../sim/useSimLoop';
import { SceneCanvas, useStageCamera, type StageQuality } from '../twin/Stage';

const params = new URLSearchParams(location.search);

function vec(s: string | null): [number, number, number] | undefined {
  if (!s) return undefined;
  const v = s.split(',').map(Number);
  return v.length === 3 && v.every(Number.isFinite) ? (v as [number, number, number]) : undefined;
}

function parseValue(v: string): boolean | number {
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isFinite(n) ? n : true;
}

function CameraBar() {
  const cam = useStageCamera();
  return (
    <div className="absolute top-2 left-2 flex gap-1">
      {cam.presets.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => cam.goTo(p.id)}
          className={`rounded px-2 py-1 text-xs ${cam.current === p.id ? 'bg-sky-600 text-white' : 'bg-black/60 text-slate-200'}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function Harness({ id }: { id: string }) {
  const def = SCENES[id];
  const demo = useMemo(() => {
    if (!def) return null;
    const d = createDemoRuntime(def.logic, def.demoRungs ?? [], { run: params.get('prog') !== '1' });
    for (const pair of (params.get('ctrl') ?? '').split(',').filter(Boolean)) {
      const [k, v] = pair.split(':');
      if (k) d.runtime.setControl(k, parseValue(v ?? 'true'));
    }
    const warm = Number(params.get('warm') ?? 0);
    if (warm > 0) d.runtime.step(warm);
    return d;
  }, [def]);
  const [, setTick] = useState(0);
  useSimLoop(demo?.runtime);
  useEffect(() => {
    if (!demo) return;
    const taps = (params.get('tap') ?? '').split(',').filter(Boolean);
    const h = window.setTimeout(() => {
      for (const t of taps) demo.runtime.setControl(t, true);
      window.setTimeout(() => taps.forEach((t) => demo.runtime.setControl(t, false)), 300);
    }, 300);
    const unsub = demo.runtime.subscribe(() => setTick((n) => (n + 1) % 1_000_000));
    return () => {
      window.clearTimeout(h);
      unsub();
    };
  }, [demo]);

  if (!def || !demo) return <div className="p-8 text-red-400">Unknown scene “{id}”. Known: {Object.keys(SCENES).join(', ')}</div>;
  const presetId = params.get('cam');
  const cameras = presetId ? [...def.cameras].sort((a, b) => (a.id === presetId ? -1 : b.id === presetId ? 1 : 0)) : def.cameras;
  const campos = vec(params.get('campos'));
  const target = vec(params.get('target'));
  const finalCams = campos ? [{ id: 'custom', label: 'Custom', position: campos, target: target ?? [0, 0, 0] as [number, number, number] }, ...cameras] : cameras;
  const obs = demo.runtime.observe();
  const View = def.View;
  return (
    <SceneCanvas
      cameras={finalCams}
      lighting={def.environment ?? 'hall'}
      quality={(params.get('quality') as StageQuality) ?? 'high'}
      overlay={
        <>
          <CameraBar />
          <div className="absolute top-2 right-2 max-h-[90vh] w-56 overflow-auto rounded bg-black/60 p-2 font-mono text-[10px] text-slate-300">
            <div className="mb-1 text-slate-100">{demo.controller.getStatus().mode}</div>
            {Object.entries(obs).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span>{k}</span>
                <span>{typeof v === 'number' ? Math.round(v * 100) / 100 : String(v)}</span>
              </div>
            ))}
          </div>
          <div className="absolute bottom-2 left-2 flex flex-wrap gap-1">
            {def.logic.controls.map((c) => (
              <button
                key={c.id}
                type="button"
                className="rounded bg-black/60 px-2 py-1 text-xs text-slate-200"
                onPointerDown={() => (c.type === 'momentary' ? demo.runtime.setControl(c.id, true) : undefined)}
                onPointerUp={() => (c.type === 'momentary' ? demo.runtime.setControl(c.id, false) : undefined)}
                onClick={() => {
                  if (c.type === 'maintained' || c.type === 'fault') demo.runtime.setControl(c.id, !demo.runtime.getControl(c.id));
                  if (c.type === 'selector') demo.runtime.setControl(c.id, ((Number(demo.runtime.getControl(c.id)) + 1) % (c.positions?.length ?? 2)));
                }}
              >
                {c.label}: {String(demo.runtime.getControl(c.id))}
              </button>
            ))}
          </div>
        </>
      }
    >
      <View state={demo.runtime.state} runtime={demo.runtime} />
    </SceneCanvas>
  );
}

const id = params.get('scene');
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {id ? (
      <Harness id={id} />
    ) : (
      <div className="p-8 text-slate-200">
        <h1 className="mb-3 text-xl font-bold">Scenes</h1>
        {Object.keys(SCENES).map((s) => (
          <a key={s} className="block text-sky-400" href={`?scene=${s}`}>
            {s}
          </a>
        ))}
      </div>
    )}
  </StrictMode>,
);
