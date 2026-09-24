/**
 * Mission briefing tab: story & spec (Markdown), objectives checklist, concept chips (linking to the
 * instruction reference), revealed hints and the plant's I/O table with live values.
 */
import { BookOpen, CheckCircle2, Circle, Cpu, Lightbulb, ListChecks, Plug, XCircle } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import { Link } from 'wouter';
import type { MissionDef, TestResult } from '../../game/types';
import type { PlcController } from '../../plc/types';
import type { SceneLogic, SimRuntime } from '../../sim/types';
import { Badge, Markdown, cn } from '../../ui';
import { routes } from '../routes';
import { IoTable } from './IoTable';

export type ObjectiveState = 'pending' | 'passed' | 'failed';

/**
 * Objective states from the latest test results: objective i ↔ test i when the counts match,
 * otherwise every objective is met only when every test passed.
 */
export function objectiveStates(mission: Pick<MissionDef, 'objectives' | 'tests'>, results: ReadonlyArray<TestResult | undefined>, completed: boolean): ObjectiveState[] {
  const n = mission.objectives.length;
  const ran = results.length > 0 && results.every((r) => r !== undefined) && results.length === mission.tests.length;
  if (!ran) return new Array<ObjectiveState>(n).fill(completed ? 'passed' : 'pending');
  if (n === mission.tests.length) return results.map((r) => (r!.passed ? 'passed' : 'failed'));
  const all = results.every((r) => r!.passed);
  return new Array<ObjectiveState>(n).fill(all ? 'passed' : 'pending');
}

function Section({ icon, title, children, className }: { icon: ReactNode; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2', className)}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ConceptChips({ concepts }: { concepts: ReadonlyArray<string> }) {
  if (concepts.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {concepts.map((c) => (
        <Link
          key={c}
          href={routes.reference(c.toUpperCase())}
          className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 font-mono text-[11.5px] font-semibold text-sky-200 hover:border-sky-400/60 hover:bg-sky-500/20"
          title={`Open the ${c} instruction reference`}
        >
          {c}
        </Link>
      ))}
    </div>
  );
}

export function PlantHardware({ scene }: { scene: SceneLogic<unknown> }) {
  const hw = scene.hardware;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
      <Badge tone="neutral">
        <Cpu size={11} /> {hw.platform}
      </Badge>
      {hw.modules
        .slice()
        .sort((a, b) => a.slot - b.slot)
        .map((m) => (
          <span key={m.slot} className="rounded border border-edge bg-panel-3/60 px-1.5 py-0.5 font-mono text-[10.5px] text-slate-300" title={`Slot ${m.slot}`}>
            {m.slot}: {m.catalog}
          </span>
        ))}
    </div>
  );
}

export interface BriefingPanelProps {
  mission: MissionDef;
  scene: SceneLogic<unknown>;
  controller: PlcController;
  runtime: SimRuntime;
  results: ReadonlyArray<TestResult | undefined>;
  completed: boolean;
  hintsRevealed: ReadonlyArray<string>;
  onShowHints?(): void;
}

/** The briefing Markdown only depends on the mission (not re-parsed when results arrive). */
const BriefingText = memo(function BriefingText({ source }: { source: string }) {
  return <Markdown source={source} />;
});

function BriefingPanelImpl({ mission, scene, controller, runtime, results, completed, hintsRevealed, onShowHints }: BriefingPanelProps) {
  const states = objectiveStates(mission, results, completed);
  return (
    <div className="space-y-5 p-4" data-testid="briefing">
      <div className="flex flex-wrap items-center gap-1.5">
        {mission.kind === 'boss' && <Badge tone="red">Boss</Badge>}
        {mission.kind === 'troubleshoot' && <Badge tone="amber">Troubleshooting</Badge>}
        <Badge tone="neutral" title="Difficulty">
          {'●'.repeat(mission.difficulty)}
          <span className="text-slate-600">{'●'.repeat(5 - mission.difficulty)}</span>
        </Badge>
        <Badge tone="violet">{mission.xp} XP</Badge>
        {mission.parInstructions !== undefined && <Badge tone="blue">par {mission.parInstructions} instr.</Badge>}
      </div>

      <BriefingText source={mission.briefing} />

      <Section icon={<ListChecks size={13} />} title="Objectives">
        <ul className="space-y-1.5" data-testid="objectives">
          {mission.objectives.map((o, i) => {
            const st = states[i] ?? 'pending';
            return (
              <li key={i} className="flex items-start gap-2 text-[13px]">
                <span className="mt-0.5 shrink-0">
                  {st === 'passed' ? <CheckCircle2 size={15} className="text-emerald-400" /> : st === 'failed' ? <XCircle size={15} className="text-red-400" /> : <Circle size={15} className="text-slate-600" />}
                </span>
                <Markdown source={o} className={cn('text-[13px]', st === 'passed' ? 'text-slate-400' : 'text-slate-200')} />
              </li>
            );
          })}
        </ul>
      </Section>

      {mission.concepts.length > 0 && (
        <Section icon={<BookOpen size={13} />} title="Concepts">
          <ConceptChips concepts={mission.concepts} />
          {mission.allowedInstructions && (
            <p className="text-[11px] text-slate-500">
              Instruction palette: <span className="font-mono text-slate-400">{mission.allowedInstructions.join(' ')}</span>
            </p>
          )}
        </Section>
      )}

      {hintsRevealed.length > 0 && (
        <Section icon={<Lightbulb size={13} />} title={`Hints (${hintsRevealed.length}/${mission.hints.length})`}>
          <ol className="space-y-1.5">
            {hintsRevealed.map((h, i) => (
              <li key={i} className="rounded-lg border border-amber-400/25 bg-amber-400/[0.06] px-2.5 py-1.5">
                <Markdown source={h} className="text-[12.5px]" />
              </li>
            ))}
          </ol>
          {hintsRevealed.length < mission.hints.length && onShowHints && (
            <button type="button" onClick={onShowHints} className="cursor-pointer text-[12px] text-amber-300 hover:underline">
              Need another hint?
            </button>
          )}
        </Section>
      )}

      <Section icon={<Plug size={13} />} title={`I/O — ${scene.title}`}>
        <PlantHardware scene={scene} />
        <IoTable io={scene.io} controller={controller} runtime={runtime} />
      </Section>
    </div>
  );
}

export const BriefingPanel = memo(BriefingPanelImpl);
