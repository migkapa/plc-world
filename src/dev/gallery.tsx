/**
 * Dev-only 3D gallery for inspecting device models in isolation.
 *
 *   http://localhost:5173/gallery.html                 -> index of previews
 *   http://localhost:5173/gallery.html?p=<name>        -> one preview
 *   &cam=x,y,z&target=x,y,z                            -> camera override (meters)
 *
 * Any file matching src/**\/*.preview.tsx that exports `previews: Record<string, Preview>` is picked up.
 */
import { OrbitControls, Bounds } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import '../index.css';
import { GalleryStage } from './GalleryStage';

export interface Preview {
  Component: ComponentType;
  /** Default camera position & target (meters). If omitted, the view auto-fits the object. */
  camera?: { position: [number, number, number]; target: [number, number, number]; fov?: number };
  description?: string;
}

const modules = import.meta.glob<{ previews: Record<string, Preview> }>('../**/*.preview.tsx', { eager: true });
const previews: Record<string, Preview> = {};
for (const mod of Object.values(modules)) Object.assign(previews, mod.previews ?? {});

function parseVec(s: string | null): [number, number, number] | undefined {
  if (!s) return undefined;
  const v = s.split(',').map(Number);
  return v.length === 3 && v.every((n) => Number.isFinite(n)) ? (v as [number, number, number]) : undefined;
}

function Index() {
  const names = Object.keys(previews).sort();
  return (
    <div className="p-8 text-slate-200">
      <h1 className="mb-4 text-2xl font-bold">Device gallery ({names.length})</h1>
      <ul className="grid grid-cols-3 gap-2">
        {names.map((n) => (
          <li key={n}>
            <a className="text-sky-400 hover:underline" href={`?p=${encodeURIComponent(n)}`}>
              {n}
            </a>
            <div className="text-xs text-slate-500">{previews[n]!.description}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function View({ name }: { name: string }) {
  const params = new URLSearchParams(location.search);
  const p = previews[name];
  if (!p) return <div className="p-8 text-red-400">Unknown preview “{name}”.</div>;
  const cam = parseVec(params.get('cam')) ?? p.camera?.position;
  const target = parseVec(params.get('target')) ?? p.camera?.target ?? [0, 0, 0];
  const { Component } = p;
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      gl={{ preserveDrawingBuffer: true, antialias: true }}
      camera={{ position: cam ?? [0.6, 0.5, 0.9], fov: p.camera?.fov ?? 35, near: 0.005, far: 200 }}
    >
      <GalleryStage>
        {cam ? (
          <Component />
        ) : (
          <Bounds fit clip observe margin={1.2}>
            <Component />
          </Bounds>
        )}
      </GalleryStage>
      <OrbitControls makeDefault target={target} />
    </Canvas>
  );
}

const name = new URLSearchParams(location.search).get('p');
createRoot(document.getElementById('root')!).render(<StrictMode>{name ? <View name={name} /> : <Index />}</StrictMode>);
