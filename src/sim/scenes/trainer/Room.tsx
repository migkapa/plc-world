/**
 * Backdrop of the trainer bench: a plain floor and a two-tone back wall with the outlet the bench is plugged into.
 * Deliberately minimal (no textures, window, furniture or daylight lamp): the cameras frame the bench, and the
 * earlier full lab room cost ~20 % of the draw calls and ~18 MB of canvas textures. World coordinates (the bench
 * is at the origin, its back against the wall at z = -0.62).
 */
import type { Vec3 } from '../../../twin/contracts';
import { KBOX, KPLANE, MergeStatic, Slab, km } from './kit';

export const ROOM = {
  backZ: -0.64,
} as const;

/** Lower wall band (behind the bench) and chair rail: gives the bench a darker backdrop. */
const DADO = '#5d7282';
const DADO_H = 1.0;
const SKIRT = '#3b3f44';
const WALL_X0 = -2.4;
const WALL_X1 = 2.4;
const WALL_TOP = 2.7;

function WallOutlet({ position }: { position: Vec3 }) {
  return (
    <group position={position}>
      <mesh geometry={KBOX()} material={km.plastic('#f1f0ea', 0.4)} scale={[0.075, 0.12, 0.008]} position={[0, 0, 0.004]} />
      {[-0.028, 0.028].map((y) => (
        <group key={y} position={[0, y, 0.009]}>
          <mesh geometry={KBOX()} material={km.plastic('#e9e7df', 0.4)} scale={[0.036, 0.042, 0.004]} />
          {[-0.007, 0.007].map((x) => (
            <mesh key={x} geometry={KBOX()} material={km.basic('#1a1a1a')} scale={[0.0025, 0.009, 0.002]} position={[x, 0.005, 0.002]} />
          ))}
        </group>
      ))}
    </group>
  );
}

export function BenchStage() {
  const { backZ } = ROOM;
  const w = WALL_X1 - WALL_X0;
  return (
    <MergeStatic>
      <mesh geometry={KPLANE()} material={km.paint('#3b4047', 0.85)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, backZ + 2.2]} scale={[w, 4.4, 1]} receiveShadow />
      <mesh geometry={KPLANE()} material={km.paint(DADO, 0.8)} position={[0, DADO_H / 2, backZ]} scale={[w, DADO_H, 1]} receiveShadow />
      <mesh geometry={KPLANE()} material={km.paint('#8f969c', 0.9)} position={[0, (WALL_TOP + DADO_H) / 2, backZ]} scale={[w, WALL_TOP - DADO_H, 1]} receiveShadow />
      <Slab min={[WALL_X0, DADO_H - 0.012, backZ]} max={[WALL_X1, DADO_H + 0.012, backZ + 0.014]} material={km.paint('#e9e6df', 0.45)} />
      <Slab min={[WALL_X0, 0, backZ]} max={[WALL_X1, 0.1, backZ + 0.012]} material={km.plastic(SKIRT, 0.6)} />
      <WallOutlet position={[-1.45, 0.38, backZ]} />
    </MergeStatic>
  );
}

/** Occluder of the back wall (for the tag chips). */
export const STAGE_OCCLUDERS: Array<[Vec3, Vec3]> = [
  [
    [WALL_X0 - 0.2, 0, ROOM.backZ - 0.2],
    [WALL_X1 + 0.2, WALL_TOP, ROOM.backZ],
  ],
];
