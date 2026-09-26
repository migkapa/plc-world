/** Home: "How it works" feature cards, each with a small live-looking illustration. */
import { Box, Check, Cpu, Gauge, KeyRound, ListChecks, Monitor, SquareTerminal, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { MiniLadder } from '../../editor/InstructionHelp';
import { MISSIONS } from '../../game/missions';
import { INSTRUCTIONS } from '../../plc/instructions';
import { cn } from '../../ui';

const INSTRUCTION_COUNT = Object.keys(INSTRUCTIONS).length;

function Card({ icon, accent, title, children, art, index }: { icon: ReactNode; accent: string; title: string; children: ReactNode; art: ReactNode; index: number }) {
  return (
    <div className="pw-fade-up flex" style={{ animationDelay: `${index * 70}ms` }}>
    <article className="group relative flex flex-1 flex-col overflow-hidden rounded-2xl border border-edge bg-panel-2/70 transition-all duration-300 hover:-translate-y-1 hover:border-slate-600 hover:shadow-2xl hover:shadow-black/40">
      <div className="relative flex h-[188px] items-center justify-center overflow-hidden border-b border-edge bg-[#0b0f14]" style={{ backgroundImage: `radial-gradient(80% 90% at 50% 100%, ${accent}1f, transparent 70%)` }}>
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage: 'linear-gradient(rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.06) 1px, transparent 1px)',
            backgroundSize: '20px 20px',
          }}
        />
        <div className="relative">{art}</div>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${accent}1f`, color: accent, boxShadow: `inset 0 0 0 1px ${accent}40` }}>
            {icon}
          </span>
          <h3 className="text-[16px] font-bold tracking-tight text-white">{title}</h3>
        </div>
        <p className="mt-3 text-[13.5px] leading-relaxed text-slate-400">{children}</p>
      </div>
    </article>
    </div>
  );
}

function ControllerArt() {
  return (
    <div className="flex items-center gap-4">
      <div className="w-[132px] rounded-lg border border-slate-600/60 bg-gradient-to-b from-[#2a2f36] to-[#1b1f24] p-2.5 shadow-xl">
        <div className="rounded border border-black/60 bg-[#0a0d08] px-2 py-1.5 font-mono text-[13px] tracking-wider text-[#9dff6a] shadow-[inset_0_0_8px_rgba(0,0,0,0.8)] [text-shadow:0_0_6px_rgba(157,255,106,0.7)]">
          Rem Run
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1 font-mono text-[7.5px] text-slate-400">
          {[
            ['RUN', 'bg-emerald-400 shadow-[0_0_6px_#34d399]'],
            ['FORCE', 'bg-slate-700'],
            ['SD', 'bg-slate-700'],
            ['OK', 'bg-emerald-400 shadow-[0_0_6px_#34d399]'],
          ].map(([l, c]) => (
            <span key={l} className="flex flex-col items-center gap-0.5">
              <span className={cn('h-1.5 w-3 rounded-[1px]', c)} />
              {l}
            </span>
          ))}
        </div>
        <div className="mt-2 flex items-center justify-center gap-1 rounded bg-black/30 py-1 font-mono text-[8px] text-slate-400">
          <span>RUN</span>
          <span className="rounded bg-slate-300 px-1 text-black">REM</span>
          <span>PROG</span>
        </div>
      </div>
      {/* a healthy controller: Rem Run, RUN + OK solid green, no forces; the last major fault is history */}
      <div className="space-y-1.5 font-mono text-[10.5px]">
        <div className="text-slate-400">
          scan <span className="text-white">10 ms</span>
        </div>
        <div className="text-slate-400">
          prescan <span className="text-emerald-300">✓</span>
        </div>
        <div className="text-slate-400">
          S:FS <span className="text-emerald-300">first scan ✓</span>
        </div>
        <div className="text-slate-400">
          forces <span className="text-amber-300">disabled</span>
        </div>
        <div className="leading-tight text-slate-400">
          last fault
          <br />
          <span className="text-red-300/90">T04:C20</span> · <span className="text-emerald-300">cleared</span>
        </div>
      </div>
    </div>
  );
}

function LadderArt() {
  return (
    <div className="w-[272px] overflow-hidden rounded-lg border border-white/10 bg-[#0f1419] shadow-2xl shadow-black/60">
      <div className="flex items-center gap-2 border-b border-white/5 px-2.5 py-1.5 font-mono text-[9.5px] text-slate-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_#34d399]" />
        MainRoutine
        <span className="ml-auto text-emerald-300">ONLINE · RUN</span>
      </div>
      <div className="p-1.5">
        <MiniLadder text="[XIC(Start_PB),XIC(Motor_Starter)]XIC(Stop_PB)OTE(Motor_Starter);" width={256} className="border-0" />
      </div>
      <div className="border-t border-white/5 px-2.5 py-1.5 font-mono text-[9.5px] text-slate-400">
        <span className="text-sky-300">[XIC</span>(Start_PB)<span className="text-sky-300">,XIC</span>(Motor_Starter)<span className="text-sky-300">]XIC</span>(Stop_PB)…
      </div>
    </div>
  );
}

function TwinsArt() {
  const items: Array<[ReactNode, string]> = [
    [<Cpu size={13} key="c" />, '1756-L85E'],
    [<Box size={13} key="b" />, '5069-L320ER'],
    [<Gauge size={13} key="g" />, 'PowerFlex 525'],
    [<Monitor size={13} key="m" />, 'PanelView 5310'],
  ];
  return (
    <div className="flex items-center gap-5">
      {/* 855T stack light */}
      <div className="flex flex-col items-center">
        <span className="h-2 w-5 rounded-t-md bg-slate-500" />
        <span className="h-6 w-6 rounded-sm bg-red-500/25" />
        <span className="mt-px h-6 w-6 rounded-sm bg-amber-400/25" />
        <span className="mt-px h-6 w-6 rounded-sm bg-emerald-400 shadow-[0_0_18px_#34d399]" />
        <span className="h-4 w-6 rounded-b-sm bg-slate-600" />
        <span className="h-6 w-1.5 bg-slate-500" />
        <span className="mt-1 font-mono text-[8px] text-slate-400">855T</span>
      </div>
      <div className="grid gap-1.5">
        {items.map(([icon, label]) => (
          <span key={label} className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-mono text-[10.5px] text-slate-300">
            <span className="text-sky-300">{icon}</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function TestsArt() {
  const rows: Array<[boolean, string]> = [
    [true, 'Start seals the motor in'],
    [true, 'Stop always wins'],
    [false, 'E-stop drops the seal'],
    [true, 'No restart after reset'],
  ];
  return (
    <div className="w-[236px] rounded-lg border border-white/10 bg-[#0f1419] p-2.5 shadow-2xl shadow-black/60">
      <div className="mb-1.5 flex items-center justify-between font-mono text-[9.5px] text-slate-400">
        <span>ACCEPTANCE TESTS</span>
        <span className="text-emerald-300">3/4</span>
      </div>
      <ul className="space-y-1">
        {rows.map(([ok, t]) => (
          <li key={t} className={cn('flex items-center gap-1.5 rounded px-1.5 py-1 text-[11px]', ok ? 'text-slate-300' : 'bg-red-500/10 text-red-200')}>
            {ok ? <Check size={12} className="text-emerald-400" strokeWidth={3} /> : <X size={12} className="text-red-400" strokeWidth={3} />}
            {t}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 truncate pl-5 font-mono text-[9.5px] text-red-300/80">Motor_Starter stayed ON (1)</div>
    </div>
  );
}

export function FeatureCards() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card index={0} icon={<Cpu size={17} />} accent="#e0252b" title="Real Logix 5000 engine" art={<ControllerArt />}>
        Tags, aliases and module I/O like <code className="font-mono text-[12px] text-emerald-300">Local:1:I.Data.0</code>, the RUN/REM/PROG key switch, prescan, forces, major faults — and{' '}
        {INSTRUCTION_COUNT} RLL instructions with correct Logix semantics.
      </Card>
      <Card index={1} icon={<SquareTerminal size={17} />} accent="#22c55e" title="Studio 5000-style ladder editor" art={<LadderArt />}>
        Contacts, coils, branches and box instructions with tag descriptions, online power-flow animation, toggle bit and neutral-text rung editing.
      </Card>
      <Card index={2} icon={<KeyRound size={17} />} accent="#38bdf8" title="Loyal 3D digital twins" art={<TwinsArt />}>
        Procedurally modeled 1756 chassis & modules with working LEDs, CompactLogix 5380, PowerFlex drives, 800F buttons, stack lights, conveyors and tanks — all live-wired to your I/O.
      </Card>
      <Card index={3} icon={<ListChecks size={17} />} accent="#f5c400" title={`${MISSIONS.length} missions, instant feedback`} art={<TestsArt />}>
        Every mission runs automated acceptance tests against the simulated plant in milliseconds. Pass them all, beat par and skip the hints for three stars.
      </Card>
    </div>
  );
}
