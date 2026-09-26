/**
 * Map-backed `IoAccess` for testing scene logic without the controller engine.
 *
 * Tests drive the OUTPUT image (what the PLC would energise) with `setOutput()` and assert the INPUT
 * image the scene wrote with `input()` / `inputBool()` / `inputNumber()`. Operands may be given as
 * full I/O operands ('Local:1:I.Data.0') or, when the FakeIo was built from a scene's `io` list, as
 * alias names ('Start_PB').
 *
 * When built from an `io` list the FakeIo is STRICT: reading an operand that is not a wired output,
 * writing one that is not a wired input, or using the wrong signal kind (writeBool on an analog
 * channel...) throws. That catches operand typos in scene models.
 *
 * Besides the wired points, a scene may drive the per-channel STATUS bits of a wired analog input
 * channel (as the module itself would, e.g. an open 4–20 mA loop): 'Local:3:I.Ch0Fault',
 * 'Local:3:I.Ch0Underrange', 'Local:3:I.Ch0Overrange' for a wired 'Local:3:I.Ch0Data' (1756 style),
 * or 'Local:3:I.Ch00.Fault' … for a wired 'Local:3:I.Ch00.Data' (5069 style). These are BOOL inputs.
 */
import type { IoAccess, IoPointDef } from '../types';

/** 1756-style channel status member → [channel prefix, status]. */
const STATUS_1756 = /^(Local:\d+:I\.Ch\d+)(Fault|Underrange|Overrange)$/;
/** 5069-style channel status member → [channel prefix, status]. */
const STATUS_5069 = /^(Local:\d+:I\.Ch\d+)\.(Fault|Underrange|Overrange)$/;

export class FakeIo implements IoAccess {
  /** Output image as driven by the (fake) controller. */
  readonly outputs = new Map<string, boolean | number>();
  /** Input image as last written by the scene. */
  readonly inputs = new Map<string, boolean | number>();
  /** Operands written since the last `clearWritten()`. */
  readonly written = new Set<string>();
  /** Total writes (cheap activity counter). */
  writeCount = 0;
  /** When false the controller is "not running": every output reads false / 0 (like PROG mode). */
  running = true;

  private readonly points = new Map<string, IoPointDef>();
  private readonly aliases = new Map<string, string>();
  /** Channel status members resolved so far (see the class notes). */
  private readonly statusPoints = new Map<string, IoPointDef | null>();

  constructor(io?: readonly IoPointDef[]) {
    for (const p of io ?? []) {
      this.points.set(p.operand, p);
      this.aliases.set(p.alias.toLowerCase(), p.operand);
    }
  }

  /** True when built from a scene `io` list (operand validation enabled). */
  get strict(): boolean {
    return this.points.size > 0;
  }

  /** Resolve an alias to its operand (operands pass through unchanged). */
  resolve(operandOrAlias: string): string {
    return this.aliases.get(operandOrAlias.toLowerCase()) ?? operandOrAlias;
  }

  /** Operands of all wired inputs (strict mode only). */
  inputOperands(): string[] {
    return [...this.points.values()].filter((p) => p.dir === 'input').map((p) => p.operand);
  }

  // --- test side ------------------------------------------------------------

  /** Drive an output point/channel as the controller would. */
  setOutput(operandOrAlias: string, value: boolean | number): void {
    const op = this.resolve(operandOrAlias);
    this.check(op, 'output', typeof value === 'boolean' ? 'digital' : undefined);
    this.outputs.set(op, value);
  }

  /** Turn every output off. */
  clearOutputs(): void {
    this.outputs.clear();
  }

  /** Last value the scene wrote to an input (throws if it was never written). */
  input(operandOrAlias: string): boolean | number {
    const op = this.resolve(operandOrAlias);
    const v = this.inputs.get(op);
    if (v === undefined) throw new Error(`Input '${operandOrAlias}' was never written by the scene`);
    return v;
  }

  inputBool(operandOrAlias: string): boolean {
    const v = this.input(operandOrAlias);
    if (typeof v !== 'boolean') throw new Error(`Input '${operandOrAlias}' is analog (${v}), expected BOOL`);
    return v;
  }

  inputNumber(operandOrAlias: string): number {
    const v = this.input(operandOrAlias);
    return typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }

  clearWritten(): void {
    this.written.clear();
  }

  // --- scene side (IoAccess) -----------------------------------------------

  readBool(operand: string): boolean {
    this.check(operand, 'output', 'digital');
    if (!this.running) return false;
    const v = this.outputs.get(operand);
    return typeof v === 'number' ? v !== 0 : v === true;
  }

  readNumber(operand: string): number {
    this.check(operand, 'output');
    if (!this.running) return 0;
    const v = this.outputs.get(operand);
    return typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? 0);
  }

  writeBool(operand: string, value: boolean): void {
    this.check(operand, 'input', 'digital');
    this.store(operand, value);
  }

  writeNumber(operand: string, value: number): void {
    this.check(operand, 'input', 'analog');
    if (!Number.isFinite(value)) throw new Error(`Non-finite value ${value} written to '${operand}'`);
    this.store(operand, value);
  }

  private store(operand: string, value: boolean | number): void {
    this.inputs.set(operand, value);
    this.written.add(operand);
    this.writeCount++;
  }

  /** Status BOOL of a wired analog input channel, e.g. 'Local:3:I.Ch0Fault' (null if not one). */
  private statusPoint(operand: string): IoPointDef | null {
    const cached = this.statusPoints.get(operand);
    if (cached !== undefined) return cached;
    let point: IoPointDef | null = null;
    const m1756 = STATUS_1756.exec(operand);
    const m5069 = m1756 ? null : STATUS_5069.exec(operand);
    const m = m1756 ?? m5069;
    if (m) {
      const channel = this.points.get(m1756 ? `${m[1]}Data` : `${m[1]}.Data`);
      if (channel && channel.dir === 'input' && channel.signal === 'analog') {
        point = {
          operand,
          alias: `${channel.alias}_${m[2]}`,
          dir: 'input',
          signal: 'digital',
          device: channel.device,
          description: `${m[2]} status bit of ${channel.alias}`,
        };
      }
    }
    this.statusPoints.set(operand, point);
    return point;
  }

  private check(operand: string, dir: IoPointDef['dir'], signal?: IoPointDef['signal']): void {
    if (!this.strict) return;
    const p = this.points.get(operand) ?? this.statusPoint(operand);
    if (!p) throw new Error(`Operand '${operand}' is not wired in this scene`);
    if (p.dir !== dir) throw new Error(`Operand '${operand}' is an ${p.dir}, not an ${dir}`);
    if (signal && p.signal !== signal) throw new Error(`Operand '${operand}' is ${p.signal}, not ${signal}`);
  }
}
