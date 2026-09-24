/**
 * Static project verification ("Verify Controller" in Studio 5000).
 *
 * Errors (block Run): unknown instructions, wrong operand counts, '?' operands, undefined tags,
 * operand data type / kind mismatches, literal or constant destinations, rungs that do not end in an
 * output instruction, JSR to undefined routines, JMP to undefined labels, duplicate labels,
 * LBL/SBR placement, missing main routines, tag definitions that cannot be created (invalid name, unknown
 * data type, duplicate name, system tag) and aliases that do not resolve. Everything is re-evaluated on
 * each call, so a problem fixed online (tag created, alias target added) disappears immediately.
 * Warnings: duplicate destructive bit references (two OTEs on the same bit), shorted branches.
 *
 * Messages follow the Studio 5000 "Errors" window wording: `TON, Operand 0: Invalid data type…`.
 * Project-level problems use rungIndex -1.
 */
import { compileOperandsFor, getInstruction, type CompileEnv, type Runtime } from './instructions';
import type { LogixTagDatabase } from './tags';
import type { InstructionNode, Program, Project, Routine, RungElement, TagDef, VerifyError } from './types';

const lower = (s: string): string => s.toLowerCase();

/** Runtime stub: compile() only captures it; nothing executes during verification. */
const VERIFY_RUNTIME: Runtime = {
  now: 0,
  timerStamps: new WeakMap(),
  arith: () => undefined,
  minorFault: () => undefined,
  majorFault: () => {
    throw new Error('not executable during verify');
  },
  jsr: () => undefined,
  sbr: () => undefined,
  ret: () => undefined,
  jmp: () => undefined,
  tnd: () => undefined,
  mcr: () => undefined,
  prescanRoutine: () => undefined,
};

function isOutput(el: InstructionNode): boolean {
  const def = getInstruction(el.op);
  return def ? def.kind === 'output' : true; // unknown instructions are reported separately
}

/**
 * Logix rule: a rung must end in an output instruction; when it ends with a branch, every leg of that
 * branch must end in an output instruction (recursively). Returns the offending element.
 */
function endProblem(series: RungElement[], inBranch = false): { el: RungElement; inBranch: boolean } | undefined {
  const last = series[series.length - 1];
  if (!last) return undefined;
  if (last.kind === 'instr') return isOutput(last) ? undefined : { el: last, inBranch };
  for (const leg of last.legs) {
    if (leg.length === 0) return { el: last, inBranch: true };
    const p = endProblem(leg, true);
    if (p) return p;
  }
  return undefined;
}

function hasEmptyLeg(series: RungElement[], out: RungElement[]): void {
  for (const el of series) {
    if (el.kind !== 'branch') continue;
    if (el.legs.some((l) => l.length === 0)) out.push(el);
    for (const leg of el.legs) hasEmptyLeg(leg, out);
  }
}

function forEachInstr(series: RungElement[], fn: (i: InstructionNode) => void): void {
  for (const el of series) {
    if (el.kind === 'instr') fn(el);
    else for (const leg of el.legs) forEachInstr(leg, fn);
  }
}

interface OteRef {
  program: string;
  routine: string;
  rungIndex: number;
  elementId: string;
}

/** Project-level tag problems (rungIndex -1; controller scope uses program ''). */
function verifyTags(project: Project, db: LogixTagDatabase, out: VerifyError[]): void {
  const scopes: Array<[TagDef[], string | undefined]> = [
    [project.tags, undefined],
    ...project.programs.map((p): [TagDef[], string | undefined] => [p.tags, p.name]),
  ];
  for (const [defs, program] of scopes) {
    const seen = new Set<string>();
    for (const def of defs) {
      const err = (message: string): void => {
        out.push({ program: program ?? '', routine: '', rungIndex: -1, message: `Tag '${def.name}': ${message}`, severity: 'error' });
      };
      const key = lower(def.name);
      if (seen.has(key)) {
        err(`Duplicate tag name in ${program === undefined ? 'controller scope' : `program '${program}'`}.`);
        continue;
      }
      seen.add(key);
      if (def.system) {
        err('system tags are created by the controller.');
        continue;
      }
      if (!db.getDefExact(def.name, program)) {
        err(db.checkDef(def) ?? 'The tag could not be created.');
        continue;
      }
      if (def.aliasFor) {
        try {
          db.ref(def.name, program);
        } catch (e) {
          err(e instanceof Error ? e.message : String(e));
        }
      }
    }
  }
}

/** Verify a whole project against a tag database that already holds its tags. */
export function verifyProject(project: Project, db: LogixTagDatabase): VerifyError[] {
  const out: VerifyError[] = [];
  const otes = new Map<string, { shown: string; refs: OteRef[] }>();
  verifyTags(project, db, out);

  for (const program of project.programs) {
    if (!program.routines.some((r) => lower(r.name) === lower(program.mainRoutine))) {
      out.push({
        program: program.name,
        routine: program.mainRoutine,
        rungIndex: -1,
        message: `Program '${program.name}': main routine '${program.mainRoutine}' does not exist.`,
        severity: 'error',
      });
    }
    for (const routine of program.routines) verifyRoutine(program, routine, db, out, otes);
  }

  for (const task of project.tasks) {
    for (const name of task.programs) {
      if (!project.programs.some((p) => lower(p.name) === lower(name))) {
        out.push({
          program: name,
          routine: '',
          rungIndex: -1,
          message: `Task '${task.name}' schedules program '${name}', which does not exist.`,
          severity: 'error',
        });
      }
    }
  }

  for (const { shown, refs } of otes.values()) {
    if (refs.length < 2) continue;
    for (const r of refs) {
      out.push({
        ...r,
        operandIndex: 0,
        message: `OTE, Operand 0: Duplicate destructive bit reference to '${shown}' (written by ${refs.length} OTE instructions).`,
        severity: 'warning',
      });
    }
  }
  return out;
}

function verifyRoutine(
  program: Program,
  routine: Routine,
  db: LogixTagDatabase,
  out: VerifyError[],
  otes: Map<string, { shown: string; refs: OteRef[] }>,
): void {
  const routineNames = new Set(program.routines.map((r) => lower(r.name)));
  const labels = new Map<string, number>();
  routine.rungs.forEach((rung, i) => {
    const first = rung.elements[0];
    if (first?.kind === 'instr' && first.op === 'LBL' && first.operands[0]) {
      const k = lower(first.operands[0].trim());
      if (!labels.has(k)) labels.set(k, i);
    }
  });
  const env: CompileEnv = {
    db,
    program: program.name,
    hasRoutine: (n) => routineNames.has(lower(n)),
    hasLabel: (n) => labels.has(lower(n)),
  };
  const base = { program: program.name, routine: routine.name };
  const seenLabels = new Map<string, number>();

  routine.rungs.forEach((rung, rungIndex) => {
    const err = (message: string, elementId?: string, operandIndex?: number, severity: 'error' | 'warning' = 'error'): void => {
      out.push({
        ...base,
        rungIndex,
        ...(elementId !== undefined ? { elementId } : {}),
        ...(operandIndex !== undefined ? { operandIndex } : {}),
        message,
        severity,
      });
    };
    if (rung.elements.length === 0) return;

    const bad = endProblem(rung.elements);
    if (bad) {
      err(
        bad.inBranch
          ? 'Every branch leg at the end of a rung must end with an output instruction.'
          : 'Rung must end with an output instruction.',
        bad.el.id,
      );
    }
    const empty: RungElement[] = [];
    hasEmptyLeg(rung.elements, empty);
    for (const b of empty) {
      if (b !== bad?.el) err('Shorted branch detected: a branch leg contains no instructions.', b.id, undefined, 'warning');
    }

    let first = true;
    forEachInstr(rung.elements, (node) => {
      const isFirst = first;
      first = false;
      const def = getInstruction(node.op);
      if (!def) {
        err(`Unknown instruction '${node.op}'.`, node.id);
        return;
      }
      const { ops, issues } = compileOperandsFor(def, node, env);
      for (const issue of issues) err(issue.message, node.id, issue.operandIndex);
      if (ops) {
        try {
          def.compile(ops, VERIFY_RUNTIME);
        } catch (e) {
          err(e instanceof Error ? e.message : String(e), node.id);
        }
      }

      if (def.mnemonic === 'LBL') {
        const name = node.operands[0]?.trim();
        if (!isFirst || rung.elements[0] !== node) err('LBL, Operand 0: LBL must be the first instruction of the rung.', node.id, 0);
        if (name) {
          const k = lower(name);
          if (seenLabels.has(k)) err(`LBL, Operand 0: Duplicate label '${name}' (also on rung ${seenLabels.get(k)}).`, node.id, 0);
          else seenLabels.set(k, rungIndex);
        }
      }
      if (def.mnemonic === 'SBR' && !(rungIndex === 0 && isFirst && rung.elements[0] === node)) {
        err('SBR must be the first instruction of the routine.', node.id);
      }
      if (def.mnemonic === 'OTE' && ops) {
        const r = ops.ref(0);
        // Same resolved tag = same scope + path (program-scoped tags of different programs are distinct).
        const key = `${lower(r.scope)}\u0000${lower(r.path)}`;
        let entry = otes.get(key);
        if (!entry) {
          entry = { shown: r.path, refs: [] };
          otes.set(key, entry);
        }
        entry.refs.push({ ...base, rungIndex, elementId: node.id });
      }
    });
  });
}

/** Studio 5000 style one-line rendering: `Error: MainProgram - MainRoutine, Rung 3, TON, Operand 0: …`. */
export function formatVerifyError(e: VerifyError): string {
  const sev = e.severity === 'error' ? 'Error' : 'Warning';
  const where = [e.program, e.routine].filter((s) => s !== '').join(' - ');
  const rung = e.rungIndex >= 0 ? `Rung ${e.rungIndex}, ` : '';
  return `${sev}: ${where ? `${where}, ` : ''}${rung}${e.message}`;
}
