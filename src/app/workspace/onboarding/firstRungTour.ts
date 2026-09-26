/**
 * The guided first rung (mission 1-1), headless: step texts, where each step points, and when it is done — judged
 * from what the player actually did (editor rungs & selection, the running logic, operator controls, the plant,
 * the test run). The React coach marks (`TourCoachMarks.tsx`) feed it a `TourWorld` a few times per second.
 *
 *  plant → flip Switch 0 (nothing happens) → click the rung → XIC → Switch_0 → OTE → Light_0 → watch it apply
 *  online → flip Switch 0 again (lamp lights, rung goes green) → Verify & Test.
 */
import { serializeRung } from '../../../plc/neutralText';
import type { InstructionNode, Rung, RungElement } from '../../../plc/types';

export const FIRST_RUNG_TOUR = 'first-rung';
/** The mission that hosts the tour. */
export const FIRST_RUNG_MISSION = '1-1';

/** Which workspace panel a step needs on screen (phones show one panel at a time). */
export type TourPanel = 'twin' | 'ladder' | 'bar';

export type TourStepId = 'plant' | 'flip' | 'rung' | 'xic' | 'switch' | 'ote' | 'light' | 'apply' | 'try' | 'verify';

/** Where the spotlight goes (resolved against the DOM by the component). */
export type TourTarget =
  | { kind: 'twin' }
  | { kind: 'control'; id: string }
  | { kind: 'rung'; index: number }
  | { kind: 'palette'; op: string }
  | { kind: 'operand'; op: string }
  | { kind: 'edits' }
  | { kind: 'verify' };

/** "Show me": what the tour does for the player. */
export type TourAction =
  | { kind: 'flip'; id: string; value: boolean }
  | { kind: 'flipCycle'; id: string }
  | { kind: 'selectRung'; index: number }
  | { kind: 'insert'; op: string }
  | { kind: 'operand'; op: string; value: string }
  | { kind: 'run' };

export interface TourWorld {
  /** Editor rungs (may be ahead of the running logic). */
  rungs: ReadonlyArray<Rung>;
  /** Editor selection (rung id), null when nothing is selected. */
  selectedRungId: string | null;
  /** Neutral text of the rungs the controller is running. */
  running: ReadonlyArray<string>;
  /** Why the editor rungs are not running yet (see useWorkspaceRuntime), null when applied. */
  pendingReason: 'errors' | 'branch' | null;
  /** Switch 0 is ON. */
  sw0: boolean;
  /** Light 0 is lit (the plant, not the tag). */
  light0: boolean;
  /** A Verify & Test run is active. */
  testsRunning: boolean;
}

/** What happened since the step started. */
export interface TourSince {
  /** Switch 0 was switched ON since the step started. */
  sw0On: number;
  /** Switch 0 was switched OFF since the step started. */
  sw0Off: number;
  /** State of Switch 0 when the step started. */
  sw0AtStart: boolean;
  /** The player clicked a rung / focused the ladder editor since the step started. */
  ladder?: number;
  /** The controller already ran the finished first rung when the step started (a replay with the program kept). */
  rungRunningAtStart?: boolean;
}

export interface TourStepDef {
  id: TourStepId;
  title: string;
  panel: TourPanel;
  target: TourTarget;
  /** Info step: only the Next button advances it. */
  manual?: boolean;
  /** How long the "done" text stays before moving on by itself (0 = at once). */
  beatMs: number;
  /** Where the card goes around the target, in order of preference (default below, above, right, left). */
  place?: ReadonlyArray<'below' | 'above' | 'right' | 'left'>;
  showMe?: TourAction;
}

export const FIRST_RUNG_STEPS: ReadonlyArray<TourStepDef> = [
  { id: 'plant', title: 'This is your plant', panel: 'twin', target: { kind: 'twin' }, manual: true, beatMs: 0 },
  { id: 'flip', title: 'Flip Switch 0', panel: 'twin', target: { kind: 'control', id: 'sw0' }, beatMs: 2600, showMe: { kind: 'flip', id: 'sw0', value: true } },
  { id: 'rung', title: 'This is the ladder', panel: 'ladder', target: { kind: 'rung', index: 0 }, beatMs: 0, showMe: { kind: 'selectRung', index: 0 } },
  // the ladder steps keep the rung itself in view: the card goes above the palette / beside the operand list
  { id: 'xic', title: 'Add an XIC contact', panel: 'ladder', target: { kind: 'palette', op: 'XIC' }, beatMs: 0, showMe: { kind: 'insert', op: 'XIC' }, place: ['above', 'below', 'right', 'left'] },
  { id: 'switch', title: 'Choose Switch_0', panel: 'ladder', target: { kind: 'operand', op: 'XIC' }, beatMs: 0, showMe: { kind: 'operand', op: 'XIC', value: 'Switch_0' }, place: ['right', 'left', 'above', 'below'] },
  { id: 'ote', title: 'Add the output: OTE', panel: 'ladder', target: { kind: 'palette', op: 'OTE' }, beatMs: 0, showMe: { kind: 'insert', op: 'OTE' }, place: ['above', 'below', 'right', 'left'] },
  { id: 'light', title: 'Choose Light_0', panel: 'ladder', target: { kind: 'operand', op: 'OTE' }, beatMs: 0, showMe: { kind: 'operand', op: 'OTE', value: 'Light_0' }, place: ['left', 'right', 'above', 'below'] },
  { id: 'apply', title: 'Watch it apply online', panel: 'ladder', target: { kind: 'edits' }, beatMs: 3200, place: ['above', 'below', 'right', 'left'] },
  { id: 'try', title: 'Flip Switch 0 again', panel: 'twin', target: { kind: 'control', id: 'sw0' }, beatMs: 3200, showMe: { kind: 'flipCycle', id: 'sw0' } },
  { id: 'verify', title: 'Prove it: Verify & Test', panel: 'bar', target: { kind: 'verify' }, beatMs: 0, showMe: { kind: 'run' } },
];

// ---------------------------------------------------------------------------
// Rung inspection
// ---------------------------------------------------------------------------

function instructions(elements: ReadonlyArray<RungElement>, out: InstructionNode[] = []): InstructionNode[] {
  for (const el of elements) {
    if (el.kind === 'instr') out.push(el);
    else for (const leg of el.legs) instructions(leg, out);
  }
  return out;
}

/** Instructions `op` of the first rung. */
export function firstRungInstr(rungs: ReadonlyArray<Rung>, op: string): InstructionNode[] {
  const r = rungs[0];
  return r ? instructions(r.elements).filter((i) => i.op === op) : [];
}

const SWITCH_0 = /^(switch_0|local:1:i\.data\.0)$/i;
const LIGHT_0 = /^(light_0|local:2:o\.data\.0)$/i;

const hasOperand = (list: InstructionNode[], re: RegExp): boolean => list.some((i) => re.test((i.operands[0] ?? '').trim()));
/** An operand the player typed that is not the one we want (for a gentle correction). */
const wrongOperand = (list: InstructionNode[], re: RegExp): string | undefined =>
  list.map((i) => (i.operands[0] ?? '').trim()).find((o) => o !== '' && o !== '?' && !re.test(o));

/** The running logic reads Switch_0 with an XIC and drives Light_0 with an OTE on one rung. */
export function runningHasFirstRung(running: ReadonlyArray<string>): boolean {
  return running.some((t) => /XIC\(\s*(Switch_0|Local:1:I\.Data\.0)\s*\)/i.test(t) && /OTE\(\s*(Light_0|Local:2:O\.Data\.0)\s*\)/i.test(t));
}

/** The running logic writes Light_0 somewhere (OTE / OTL / OTU), whatever drives it. */
export function runningWritesLight0(running: ReadonlyArray<string>): boolean {
  return running.some((t) => /\b(OTE|OTL|OTU)\(\s*(Light_0|Local:2:O\.Data\.0)\s*\)/i.test(t));
}

/** The editor already holds the finished first rung (a replay of the tour with the program kept). */
export function editorHasFirstRung(rungs: ReadonlyArray<Rung>): boolean {
  return rungs.length > 0 && runningHasFirstRung([serializeRung(rungs[0]!)]);
}

// ---------------------------------------------------------------------------
// Step state
// ---------------------------------------------------------------------------

export interface TourStepView {
  done: boolean;
  /** Body text (a few sentences; `code` in backticks, **bold**). */
  body: string;
  /** Extra line when the player did something unexpected. */
  hint?: string;
}

/** Is `step` done in `world`, and what does its card say? */
export function tourStepView(step: TourStepId, w: TourWorld, since: TourSince): TourStepView {
  const r0 = w.rungs[0];
  const xics = firstRungInstr(w.rungs, 'XIC');
  const otes = firstRungInstr(w.rungs, 'OTE');
  switch (step) {
    case 'plant':
      return {
        done: false,
        body: 'A live **digital twin** of the trainer bench: a ControlLogix PLC with an input card (switches) and an output card (pilot lights). Drag to look around, scroll to zoom.',
      };
    case 'flip': {
      const done = since.sw0On > 0 && w.sw0;
      if (done) {
        // judged from the running logic, not only the lamp: the lamp follows one sim step + scan after the flip, and
        // this text is kept for the rest of the step (a kept program must never be told "nothing happens")
        return {
          done,
          body:
            w.light0 || runningHasFirstRung(w.running)
              ? 'Light 0 lit up — your program already drives it. Let’s look at the rung that does it.'
              : runningWritesLight0(w.running)
                ? 'Light 0 stays dark — but your program already writes `Light_0`. Let’s look at the ladder and see why.'
                : '**Nothing happens.** The input card sees the switch, but the controller has no logic for `Light_0` yet. Let’s write that logic.',
        };
      }
      return {
        done,
        body: since.sw0AtStart
          ? 'Switch 0 is already ON: flip it **OFF and ON again** on the operator panel (or click the switch on the bench) and watch Light 0.'
          : 'Click **Switch 0** on the operator panel (or the switch itself on the bench) and watch Light 0, the green lamp.',
      };
    }
    case 'rung': {
      // the editor starts with rung 0 selected: the player's own click (or focus) is what counts
      const done = ((since.ladder ?? 0) > 0 && r0 !== undefined && w.selectedRungId === r0.id) || (r0?.elements.length ?? 0) > 0;
      return {
        done,
        body: 'Each **rung** reads left to right: power flows from the left rail through the conditions to the output on the right rail. Rung 0 is empty — **click it** to select it.',
      };
    }
    case 'xic': {
      const done = xics.length > 0;
      const other = r0 ? instructions(r0.elements).find((i) => i.op !== 'XIC') : undefined;
      return {
        done,
        body: 'Click **XIC** in the instruction palette — or just type `XIC` and press Enter. XIC (*Examine If Closed*) is true while its bit is 1: the switch is ON.',
        ...(other && !done ? { hint: `That’s ${other.op}. This lamp needs an XIC in front — right-click an instruction to delete it (or press Delete).` } : {}),
      };
    }
    case 'switch': {
      const done = hasOperand(xics, SWITCH_0);
      const wrong = done ? undefined : wrongOperand(xics, SWITCH_0);
      return {
        done,
        body: 'Type `sw` to filter the list, then pick **Switch_0** (click it, or Enter). It’s the alias tag of input `Local:1:I.Data.0` — the switch you just flipped.',
        ...(wrong ? { hint: `Your XIC reads \`${wrong}\`. Light 0 must follow Switch 0: double-click the operand and choose Switch_0.` } : {}),
      };
    }
    case 'ote': {
      const done = otes.length > 0;
      return {
        done,
        body: 'Now the output: click **OTE** (*Output Energize*). It lands at the right end of the rung and writes the rung’s result to its bit on every scan.',
      };
    }
    case 'light': {
      const done = hasOperand(otes, LIGHT_0);
      const wrong = done ? undefined : wrongOperand(otes, LIGHT_0);
      return {
        done,
        body: 'Choose **Light_0** from the list — the green pilot light on output `Local:2:O.Data.0`.',
        ...(wrong ? { hint: `Your OTE writes \`${wrong}\`. Double-click the operand and choose Light_0.` } : {}),
      };
    }
    case 'apply': {
      const done = w.pendingReason === null && runningHasFirstRung(w.running);
      if (done && since.rungRunningAtStart) {
        // the tour was replayed with the program kept: nothing new was applied just now
        return {
          done,
          body: '**Already running online.** Your rung was applied earlier — the edits status reads *No Edits* because the controller runs exactly what the editor shows. Every rung edit is verified and applied like that, with no download: Studio 5000 calls it an *online edit*.',
        };
      }
      if (done) {
        return {
          done,
          body: '**Applied online!** The editor verified your rung and the running controller took it — no download, the plant never stopped. Studio 5000 calls this an *online edit*.',
        };
      }
      return {
        done,
        body: 'Watch the edit status here: the editor verifies the rung and applies it to the running controller by itself.',
        ...(w.pendingReason === 'errors'
          ? { hint: 'Not applied yet: the rung has a verification error (red e marker). Make it read XIC(Switch_0) OTE(Light_0).' }
          : !editorHasFirstRung(w.rungs)
            ? { hint: 'Rung 0 should read XIC(Switch_0) OTE(Light_0) — check both operands.' }
            : {}),
      };
    }
    case 'try': {
      const done = since.sw0On > 0 && w.sw0 && w.light0;
      if (done) {
        return {
          done,
          body: '**There it is!** Light 0 follows Switch 0, and the rung turns **green** wherever power flows — that’s how you read a program online.',
        };
      }
      const on = w.sw0;
      return {
        done,
        body: on
          ? since.sw0Off > 0
            ? 'Now flip Switch 0 back **ON**…'
            : 'Switch 0 is still ON — see Light 0 lit and the rung green? Flip Switch 0 **OFF** and watch both go dark, then **ON** again.'
          : 'Flip **Switch 0** ON and watch Light 0 and the rung.',
        ...(since.sw0On > 0 && on && !w.light0 ? { hint: 'Light 0 stays dark? The rung must read XIC(Switch_0) OTE(Light_0) — and be applied.' } : {}),
      };
    }
    case 'verify':
      return {
        done: w.testsRunning,
        body: 'You tried it by hand; now let the acceptance tests prove it. They flip the switches for you and check the lamp. Press **Verify & Test** (Ctrl+Enter).',
      };
  }
}
