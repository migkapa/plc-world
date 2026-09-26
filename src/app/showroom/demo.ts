/**
 * Tiny observable key/value store shared by a device's 3D stage (reads values every frame through getters)
 * and its DOM demo controls (React re-renders through useSyncExternalStore). Headless.
 */
import { useSyncExternalStore } from 'react';

export type DemoValue = boolean | number | string | boolean[];

export class DemoStore {
  private values: Record<string, DemoValue>;
  private listeners = new Set<() => void>();
  /** Increments on every change (cheap change detection). */
  version = 0;

  constructor(initial: Record<string, DemoValue>) {
    this.values = structuredClone(initial);
  }

  get(key: string): DemoValue | undefined {
    return this.values[key];
  }

  bool(key: string): boolean {
    return this.values[key] === true;
  }

  num(key: string): number {
    const v = this.values[key];
    return typeof v === 'number' ? v : 0;
  }

  str(key: string): string {
    const v = this.values[key];
    return typeof v === 'string' ? v : '';
  }

  bits(key: string): boolean[] {
    const v = this.values[key];
    return Array.isArray(v) ? v : [];
  }

  bit(key: string, index: number): boolean {
    return this.bits(key)[index] === true;
  }

  set(key: string, value: DemoValue): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.emit();
  }

  toggle(key: string): void {
    this.set(key, !this.bool(key));
  }

  setBit(key: string, index: number, value: boolean): void {
    const next = [...this.bits(key)];
    next[index] = value;
    this.set(key, next);
  }

  patch(values: Record<string, DemoValue>): void {
    let changed = false;
    for (const [k, v] of Object.entries(values)) {
      if (this.values[k] !== v) {
        this.values[k] = v;
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit(): void {
    this.version++;
    for (const l of this.listeners) l();
  }
}

/** Re-render when the store changes; returns the store version. */
export function useDemoVersion(store: DemoStore): number {
  return useSyncExternalStore(store.subscribe, () => store.version, () => store.version);
}

// ---------------------------------------------------------------------------
// Demo control definitions (rendered by <DemoControls/>)
// ---------------------------------------------------------------------------

export type ControlTone = 'green' | 'red' | 'amber' | 'blue' | 'neutral';

export type DemoControl =
  /** Maintained on/off switch. */
  | { kind: 'toggle'; key: string; label: string; hint?: string; tone?: ControlTone }
  /** Held while the pointer / key is down. */
  | { kind: 'momentary'; key: string; label: string; hint?: string; tone?: ControlTone }
  /** Segmented choice. */
  | {
      kind: 'select';
      key: string;
      label: string;
      options: Array<{ value: string; label: string }>;
      hint?: string;
      /** Custom setter (default: store.set(key, value)). */
      onSet?: (store: DemoStore, value: string) => void;
      /** Custom getter of the selected option (default: String(store.get(key))). */
      value?: (store: DemoStore) => string;
      /** Grey the whole choice out (e.g. remote mode while the key is not in REM). */
      disabled?: (store: DemoStore) => boolean;
    }
  | { kind: 'slider'; key: string; label: string; min: number; max: number; step: number; unit?: string; digits?: number; hint?: string }
  /** Grid of toggle bits (I/O points). */
  | { kind: 'points'; key: string; label: string; count: number; prefix?: string; readOnly?: boolean; hint?: string }
  /** One-shot button. */
  | { kind: 'action'; label: string; run: (store: DemoStore) => void; tone?: ControlTone; disabled?: (store: DemoStore) => boolean; hint?: string }
  /** Read-only live readout (e.g. what the PLC input reads). */
  | { kind: 'readout'; label: string; value: (store: DemoStore) => string; tone?: (store: DemoStore) => ControlTone };
