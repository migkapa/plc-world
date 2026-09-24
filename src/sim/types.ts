/**
 * Simulation contracts: a "scene" is a small virtual plant (machine + field devices)
 * wired to the PLC's I/O modules. Scene LOGIC is pure TypeScript (headless, testable,
 * used by mission validation). Scene VIEWS are React Three Fiber components.
 */
import type { ComponentType } from 'react';
import type { HardwareConfig, PlcController, TagDef } from '../plc/types';

/** Field-side access to the controller's I/O image, handed to scene.step(). */
export interface IoAccess {
  /** Value the output module is driving to the field (false/0 when the controller is not running). */
  readBool(operand: string): boolean;
  readNumber(operand: string): number;
  /** Drive an input point/channel from the field side (e.g. a push button closing a contact). */
  writeBool(operand: string, value: boolean): void;
  writeNumber(operand: string, value: number): void;
}

/** One wired I/O point (documents the field wiring and creates the alias tag). */
export interface IoPointDef {
  /** Fully qualified I/O operand, e.g. 'Local:1:I.Data.0' or 'Local:3:I.Ch0Data'. */
  operand: string;
  /** Alias tag created in the starter project, e.g. 'Start_PB'. */
  alias: string;
  dir: 'input' | 'output';
  signal: 'digital' | 'analog';
  /** Physical device, e.g. '800F-X10 green flush push button (N.O.)'. */
  device: string;
  /** Short explanation, e.g. 'Normally-open: input is 1 while pressed'. */
  description: string;
  /** For analog points: engineering units & range. */
  units?: string;
  range?: [number, number];
  /** Device id in the 3D view that this point belongs to (for highlight / hover). */
  deviceId?: string;
}

/** Operator / instructor controls that tests and the UI can actuate. */
export interface ControlDef {
  id: string;
  label: string;
  /**
   * momentary  - push button, true while held
   * maintained - toggle / latching switch (e.g. E-stop mushroom: pushed = true until reset)
   * selector   - discrete positions (value is the index)
   * analog     - continuous value within `range`
   * fault      - instructor fault injection (hidden from the player's panel unless in sandbox)
   */
  type: 'momentary' | 'maintained' | 'selector' | 'analog' | 'fault';
  default: boolean | number;
  positions?: string[];
  range?: [number, number];
  units?: string;
  description?: string;
  /** Keyboard shortcut hint for the UI, e.g. 'S'. */
  key?: string;
}

/** Observable plant values for tests, HUD and objectives. */
export interface ObservableDef {
  id: string;
  label: string;
  type: 'boolean' | 'number';
  units?: string;
  description?: string;
}

/** Headless plant model. `S` is the mutable scene state (plain object). */
export interface SceneLogic<S = unknown> {
  id: string;
  title: string;
  summary: string;
  hardware: HardwareConfig;
  io: IoPointDef[];
  controls: ControlDef[];
  observables: ObservableDef[];
  /** Extra tags (besides the I/O aliases) the scene's starter project should contain. */
  extraTags?: TagDef[];
  createState(): S;
  /**
   * Advance the physics by `dtMs` of simulated time. Read PLC outputs and write field inputs via `io`.
   * Must be deterministic for a given state + inputs sequence (no Math.random without a seeded PRNG in state).
   */
  step(state: S, dtMs: number, io: IoAccess): void;
  setControl(state: S, id: string, value: boolean | number): void;
  getControl(state: S, id: string): boolean | number;
  observe(state: S): Record<string, boolean | number>;
}

/** Props given to every scene 3D view (rendered inside an R3F <Canvas>). */
export interface SceneViewProps<S = unknown> {
  /** Mutable scene state: read it inside useFrame, don't copy it into React state. */
  state: S;
  runtime: SimRuntime;
}

export interface SceneDefinition<S = unknown> {
  logic: SceneLogic<S>;
  View: ComponentType<SceneViewProps<S>>;
  /** Camera presets for the view switcher. First is the default. */
  cameras: Array<{ id: string; label: string; position: [number, number, number]; target: [number, number, number] }>;
  /** Thumbnail accent colour for cards. */
  accent?: string;
  /** Stage lighting preset (see src/twin/Stage.tsx); default 'hall'. */
  environment?: 'hall' | 'street' | 'studio';
  /** Optional demo program (neutral text rungs) that makes the plant come alive in previews/showroom. */
  demoRungs?: string[];
}

/**
 * Couples a controller with a scene and runs them in lock-step with a fixed time step.
 * Implemented by `createSimRuntime()` in `src/sim/runtime.ts`.
 */
export interface SimRuntime {
  readonly controller: PlcController;
  readonly scene: SceneLogic<unknown>;
  readonly state: unknown;
  /** Simulated time since reset (ms). */
  readonly timeMs: number;
  /** Fixed step used for physics + PLC scan (default 10 ms). */
  readonly stepMs: number;
  speed: number;
  paused: boolean;
  /** Advance exactly `dtMs` (split into fixed steps). Each fixed step: scene.step -> controller.scan. */
  step(dtMs: number): void;
  /** Called from the animation loop with real elapsed ms; honours `speed` and `paused`; caps catch-up work. */
  tick(realDtMs: number): void;
  setControl(id: string, value: boolean | number): void;
  getControl(id: string): boolean | number;
  observe(): Record<string, boolean | number>;
  /** Reset the plant state (and optionally the controller tag values) without reloading the program. */
  resetScene(): void;
  /** Change notifications, throttled by the implementation to at most ~30 Hz for UI consumers. */
  subscribe(listener: () => void): () => void;
  /** Increments after every fixed step. */
  readonly version: number;
}
