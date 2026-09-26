/**
 * Simulation runtime: couples a controller with a scene (plant model) in lock-step.
 *
 * Every fixed step (default 10 ms of simulated time):
 *   1. scene.step(state, stepMs, io)   — field devices: read outputs, write inputs
 *   2. controller.scan(stepMs)         — one PLC scan
 *
 * `tick(realDtMs)` is driven by the animation loop: it scales by `speed`, honours `paused` and caps
 * the catch-up work (a background tab resuming does not freeze the page). UI listeners are notified
 * at most ~30 times per second. Headless (no React / DOM / three imports).
 *
 * Momentary controls are edge-latched: a press released before the next fixed step stays pressed for
 * that one step, so the PLC always sees at least one scan of it (a quick tap between two slow animation
 * frames is never lost).
 */
import type { PlcController } from '../plc/types';
import type { IoAccess, SceneLogic, SimRuntime } from './types';

export interface SimRuntimeOptions {
  /** Fixed step in ms (default 10). */
  stepMs?: number;
  /** Maximum fixed steps executed by one tick() (default 25); the backlog beyond is dropped. */
  maxCatchUpSteps?: number;
  /** Minimum real time between listener notifications in ms (default 33 ≈ 30 Hz; 0 = every step batch). */
  notifyIntervalMs?: number;
  /** Clock for notification throttling (default performance.now / Date.now). */
  now?: () => number;
}

/** Runtime with a couple of extras beyond the shared `SimRuntime` contract. */
export interface SimRuntimeEx extends SimRuntime {
  /** Reset the plant; with `resetTags` also reset controller tag values (when the controller supports it). */
  resetScene(opts?: { resetTags?: boolean }): void;
  /**
   * Operator / test control changes: `listener(id, value)` runs after every `setControl()` (UI pad, 3D
   * clicks, hotkeys, test steps), unthrottled. Returns an unsubscribe function.
   */
  onControl(listener: ControlListener): () => void;
  /** Stop forwarding controller events and drop all listeners. */
  dispose(): void;
}

/** Listener for `SimRuntimeEx.onControl`. */
export type ControlListener = (id: string, value: boolean | number) => void;

function defaultNow(): () => number {
  const perf = (globalThis as { performance?: { now(): number } }).performance;
  return perf && typeof perf.now === 'function' ? () => perf.now() : () => Date.now();
}

class SimRuntimeImpl<S> implements SimRuntimeEx {
  readonly controller: PlcController;
  readonly scene: SceneLogic<unknown>;
  readonly stepMs: number;

  private readonly logic: SceneLogic<S>;
  private spd = 1;
  private isPaused = false;
  private st: S;
  private time = 0;
  private ver = 0;
  private pending = 0;
  private readonly maxCatchUp: number;
  private readonly notifyInterval: number;
  private readonly clock: () => number;
  private lastNotify = Number.NEGATIVE_INFINITY;
  private dirty = false;
  private readonly listeners = new Set<() => void>();
  private readonly controlListeners = new Set<ControlListener>();
  private readonly io: IoAccess;
  private readonly unsubController: () => void;
  /** Fixed steps executed so far (for the momentary edge latch). */
  private stepsDone = 0;
  private readonly momentary: ReadonlySet<string>;
  /** Momentary control id → `stepsDone` when it was pressed. */
  private readonly pressedAt = new Map<string, number>();
  /** Momentary releases that wait for the next fixed step (the press has not been scanned yet). */
  private readonly deferredRelease = new Set<string>();

  constructor(controller: PlcController, scene: SceneLogic<S>, opts: SimRuntimeOptions) {
    this.controller = controller;
    this.logic = scene;
    this.scene = scene as SceneLogic<unknown>;
    this.stepMs = opts.stepMs && opts.stepMs > 0 ? opts.stepMs : 10;
    this.maxCatchUp = Math.max(1, opts.maxCatchUpSteps ?? 25);
    this.notifyInterval = Math.max(0, opts.notifyIntervalMs ?? 33);
    this.clock = opts.now ?? defaultNow();
    this.st = scene.createState();
    this.momentary = new Set(scene.controls.filter((ct) => ct.type === 'momentary').map((ct) => ct.id));
    const c = controller;
    this.io = {
      readBool: (operand) => {
        const v = c.readOutputForField(operand);
        return typeof v === 'boolean' ? v : v !== 0;
      },
      readNumber: (operand) => Number(c.readOutputForField(operand)),
      writeBool: (operand, value) => c.writeInputFromField(operand, value),
      writeNumber: (operand, value) => c.writeInputFromField(operand, value),
    };
    this.unsubController = controller.subscribe(() => this.notify(true));
  }

  get state(): unknown {
    return this.st;
  }

  get timeMs(): number {
    return this.time;
  }

  get version(): number {
    return this.ver;
  }

  /** Simulation speed factor for tick(). Non-finite or negative values are ignored. */
  get speed(): number {
    return this.spd;
  }

  set speed(v: number) {
    if (!Number.isFinite(v) || v < 0 || v === this.spd) return;
    this.spd = v;
    this.notify(true);
  }

  get paused(): boolean {
    return this.isPaused;
  }

  set paused(v: boolean) {
    const p = Boolean(v);
    if (p === this.isPaused) return;
    this.isPaused = p;
    this.notify(true); // listeners see the final state right away (nothing is left throttled)
  }

  private fixedStep(): void {
    const dt = this.stepMs;
    this.logic.step(this.st, dt, this.io);
    this.controller.scan(dt);
    this.time += dt;
    this.ver++;
    this.stepsDone++;
    this.dirty = true;
    if (this.deferredRelease.size > 0) {
      const ids = [...this.deferredRelease];
      this.deferredRelease.clear();
      for (const id of ids) this.applyControl(id, false);
    }
  }

  step(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs <= 0) return;
    this.pending += dtMs;
    // Tolerate floating point residue (e.g. 0.1 + 0.2 ms accumulations).
    while (this.pending >= this.stepMs - 1e-9) {
      this.pending -= this.stepMs;
      this.fixedStep();
    }
    if (this.pending < 1e-9) this.pending = 0;
    this.notify(false);
  }

  tick(realDtMs: number): void {
    const add = realDtMs * this.spd;
    if (this.isPaused || !Number.isFinite(add) || add <= 0) {
      this.notify(false); // flush a throttled notification once the interval has passed
      return;
    }
    // Never queue more than one tick can run: the backlog beyond is dropped anyway.
    this.pending = Math.min(this.pending + add, (this.maxCatchUp + 1) * this.stepMs);
    let steps = 0;
    while (this.pending >= this.stepMs - 1e-9 && steps < this.maxCatchUp) {
      this.pending -= this.stepMs;
      this.fixedStep();
      steps++;
    }
    if (this.pending >= this.stepMs) this.pending %= this.stepMs; // drop the backlog
    this.notify(false);
  }

  setControl(id: string, value: boolean | number): void {
    if (this.momentary.has(id)) {
      if (value === true) {
        this.deferredRelease.delete(id); // pressed again before the latched release: stay pressed
        this.pressedAt.set(id, this.stepsDone);
      } else if (value === false && this.pressedAt.get(id) === this.stepsDone && this.logic.getControl(this.st, id) === true) {
        // released before any scan saw the press: keep it for the next fixed step
        this.deferredRelease.add(id);
        return;
      }
    }
    this.applyControl(id, value);
  }

  private applyControl(id: string, value: boolean | number): void {
    if (value === false) this.pressedAt.delete(id);
    this.logic.setControl(this.st, id, value);
    this.dirty = true;
    this.notify(true);
    for (const l of [...this.controlListeners]) {
      try {
        l(id, value);
      } catch (e) {
        console.error('[sim] control listener failed', e);
      }
    }
  }

  onControl(listener: ControlListener): () => void {
    this.controlListeners.add(listener);
    return () => {
      this.controlListeners.delete(listener);
    };
  }

  getControl(id: string): boolean | number {
    return this.logic.getControl(this.st, id);
  }

  observe(): Record<string, boolean | number> {
    return this.logic.observe(this.st);
  }

  resetScene(opts: { resetTags?: boolean } = {}): void {
    // Settings (switch positions, selectors, analog values, faults, e.g. the garage's `initial_cars`)
    // survive a plant reset so they stay in sync with the UI widgets; momentary buttons are released.
    const keep: Array<[string, boolean | number]> = [];
    for (const c of this.logic.controls) {
      if (c.type !== 'momentary') keep.push([c.id, this.logic.getControl(this.st, c.id)]);
    }
    const fresh = this.logic.createState();
    const cur = this.st as unknown;
    if (cur !== null && typeof cur === 'object' && fresh !== null && typeof fresh === 'object' && !Array.isArray(cur)) {
      // Keep the same object so views holding a reference keep working.
      for (const k of Object.keys(cur)) delete (cur as Record<string, unknown>)[k];
      Object.assign(cur, fresh);
    } else {
      this.st = fresh;
    }
    for (const [id, value] of keep) this.logic.setControl(this.st, id, value);
    if (opts.resetTags) {
      const ctl = this.controller as PlcController & { resetTagValues?: () => void };
      ctl.resetTagValues?.();
    }
    this.time = 0;
    this.pending = 0;
    this.pressedAt.clear();
    this.deferredRelease.clear();
    this.ver++;
    this.dirty = true;
    this.notify(true);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(force: boolean): void {
    if (!force && !this.dirty) return;
    const t = this.clock();
    if (!force && t - this.lastNotify < this.notifyInterval) return;
    this.lastNotify = t;
    this.dirty = false;
    for (const l of [...this.listeners]) {
      try {
        l();
      } catch (e) {
        console.error('[sim] runtime listener failed', e);
      }
    }
  }

  dispose(): void {
    this.unsubController();
    this.listeners.clear();
    this.controlListeners.clear();
  }
}

/**
 * Create a simulation runtime for `scene` wired to `controller`.
 * The scene state is created immediately; the controller keeps its current mode.
 */
export function createSimRuntime<S>(
  controller: PlcController,
  scene: SceneLogic<S>,
  opts: SimRuntimeOptions = {},
): SimRuntimeEx {
  return new SimRuntimeImpl(controller, scene, opts);
}
