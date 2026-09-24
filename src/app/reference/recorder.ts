/**
 * Per-scan trace recorder for the instruction playground: a SceneLogic wrapper samples the traced tags on
 * every fixed simulation step (before each scan, i.e. the result of the previous scan), so even one-scan
 * pulses (ONS/OSR/OSF, timer .DN self-resets) show up in the timing diagram. Headless.
 */
import type { PlcController } from '../../plc/types';
import type { SceneLogic } from '../../sim/types';

export interface TraceSpec {
  tag: string;
  kind: 'bool' | 'number';
}

export class TraceRecorder {
  readonly capacity: number;
  /** Simulated time of each sample (ms). */
  readonly times: Float64Array;
  /** One value column per trace (NaN = tag missing / unreadable). */
  readonly values: Float64Array[];
  /** Index of the next write. */
  head = 0;
  count = 0;
  timeMs = 0;
  /** Increments on every sample. */
  version = 0;

  constructor(
    readonly traces: readonly TraceSpec[],
    windowMs = 10_000,
    stepMs = 10,
  ) {
    this.capacity = Math.ceil(windowMs / stepMs) + 64;
    this.times = new Float64Array(this.capacity);
    this.values = traces.map(() => new Float64Array(this.capacity));
  }

  sample(controller: PlcController, dtMs: number): void {
    this.timeMs += dtMs;
    const i = this.head;
    this.times[i] = this.timeMs;
    for (let k = 0; k < this.traces.length; k++) {
      const t = this.traces[k]!;
      let v = Number.NaN;
      try {
        v = t.kind === 'bool' ? (controller.tags.readBool(t.tag) ? 1 : 0) : controller.tags.readNumber(t.tag);
      } catch {
        v = Number.NaN;
      }
      this.values[k]![i] = v;
    }
    this.head = (i + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
    this.version++;
  }

  /** Visit samples oldest → newest (index into times/values). */
  forEach(fn: (index: number) => void): void {
    const start = (this.head - this.count + this.capacity) % this.capacity;
    for (let n = 0; n < this.count; n++) fn((start + n) % this.capacity);
  }

  /** Latest value of trace k (NaN when nothing recorded). */
  latest(k: number): number {
    if (this.count === 0) return Number.NaN;
    return this.values[k]![(this.head - 1 + this.capacity) % this.capacity]!;
  }
}

/**
 * Wrap a scene so `onStep(dtMs)` runs after every fixed plant step (i.e. right before each PLC scan).
 * All other scene behaviour is delegated unchanged.
 */
export function withStepHook<S>(scene: SceneLogic<S>, onStep: (dtMs: number) => void): SceneLogic<S> {
  return {
    ...scene,
    createState: () => scene.createState(),
    step(state, dtMs, io) {
      scene.step(state, dtMs, io);
      onStep(dtMs);
    },
    setControl: (state, id, value) => scene.setControl(state, id, value),
    getControl: (state, id) => scene.getControl(state, id),
    observe: (state) => scene.observe(state),
  };
}
