/**
 * Headless controller-mode logic of the showroom's ControlLogix / CompactLogix demos: key switch, remote
 * mode, simulated major fault and the two ways to clear it (Clear Majors, key PROG → RUN → PROG).
 */
import { sfx } from '../../../audio/sfx';
import type { DemoStore } from '../demo';

export const isRunning = (d: DemoStore): boolean => !d.bool('faulted') && (d.str('key') === 'RUN' || (d.str('key') === 'REM' && d.bool('remoteRun')));

/**
 * Key-switch move. Moving into REM keeps the current mode (Remote Run / Remote Program), like the real switch.
 * While a recoverable major fault is active, turning the key PROG → RUN → PROG clears it (Rockwell's
 * key-switch fault clear; passing through REM in between does not matter). `faultTrail` keeps the
 * non-REM positions visited since the fault.
 */
export function turnKey(d: DemoStore, pos: string): void {
  if (pos === d.str('key')) return;
  const wasRunning = isRunning(d);
  const patch: Record<string, string | boolean> = { key: pos, remoteRun: pos === 'REM' ? wasRunning : d.bool('remoteRun') };
  if (d.bool('faulted') && pos !== 'REM') {
    const trail = d.str('faultTrail').split(',').filter(Boolean);
    if (trail[trail.length - 1] !== pos) trail.push(pos);
    if (trail.slice(-3).join(',') === 'PROG,RUN,PROG') {
      Object.assign(patch, { faulted: false, faultTrail: '', remoteRun: false });
      sfx.play('click');
    } else patch.faultTrail = trail.slice(-3).join(',');
  }
  d.patch(patch);
  sfx.play('toggle');
}

/** Simulated program fault: only executing logic can raise T04:C20, so the controller must be running. */
export function simulateMajorFault(d: DemoStore): void {
  if (!isRunning(d) || d.bool('faulted')) return;
  const key = d.str('key');
  d.patch({ faulted: true, faultTrail: key === 'REM' ? '' : key });
  sfx.play('fault');
}

/** Clear Majors (Studio 5000 / HMI): the controller goes to Program — unless the key is in hard RUN. */
export function clearMajors(d: DemoStore): void {
  d.patch({ faulted: false, faultTrail: '', remoteRun: false });
}
