/**
 * Small explanatory SVG illustrations for the glossary (dark theme, 360 × 150 viewBox).
 */
import type { ReactNode } from 'react';
import { MiniLadder } from '../../editor';
import type { GlossaryArtId } from './glossaryData';

const INK = '#94a3b8';
const DIM = '#475569';
const LINE = '#334155';
const GREEN = '#22c55e';
const RED = '#ef4444';
const AMBER = '#f59e0b';
const SKY = '#38bdf8';
const MONO = 'JetBrains Mono, ui-monospace, monospace';
const SANS = 'Inter Variable, Inter, system-ui, sans-serif';

function Frame({ children, title }: { children: ReactNode; title: string }) {
  return (
    <svg viewBox="0 0 360 150" className="block h-auto w-full" role="img" aria-label={title}>
      <defs>
        <marker id="ga-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={INK} />
        </marker>
        <marker id="ga-arrow-g" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L10 5 L0 10 z" fill={GREEN} />
        </marker>
      </defs>
      {children}
    </svg>
  );
}

const T = ({ x, y, children, size = 11, fill = INK, anchor = 'start', mono = false, weight = 500 }: { x: number; y: number; children: ReactNode; size?: number; fill?: string; anchor?: 'start' | 'middle' | 'end'; mono?: boolean; weight?: number }) => (
  <text x={x} y={y} fontSize={size} fill={fill} textAnchor={anchor} fontFamily={mono ? MONO : SANS} fontWeight={weight}>
    {children}
  </text>
);

function ScanArt() {
  const box = (x: number, n: string, a: string, b: [string, string], color: string) => (
    <g>
      <rect x={x} y={22} width={100} height={68} rx={10} fill="#111820" stroke={color} strokeWidth={1.5} />
      <circle cx={x + 16} cy={39} r={8} fill={color} />
      <T x={x + 16} y={43} size={10} fill="#0b0f14" anchor="middle" weight={800}>
        {n}
      </T>
      <T x={x + 30} y={43} size={11.5} fill="#e2e8f0" weight={700}>
        {a}
      </T>
      <T x={x + 12} y={66} size={9.5}>
        {b[0]}
      </T>
      <T x={x + 12} y={79} size={9.5}>
        {b[1]}
      </T>
    </g>
  );
  return (
    <Frame title="Scan cycle: read inputs, execute logic, write outputs, repeat">
      {box(8, '1', 'Inputs', ['field devices →', 'input image'], SKY)}
      {box(130, '2', 'Logic', ['rungs run', 'top → bottom'], GREEN)}
      {box(252, '3', 'Outputs', ['output image →', 'field devices'], AMBER)}
      <line x1={110} y1={57} x2={127} y2={57} stroke={INK} strokeWidth={1.5} markerEnd="url(#ga-arrow)" />
      <line x1={232} y1={57} x2={249} y2={57} stroke={INK} strokeWidth={1.5} markerEnd="url(#ga-arrow)" />
      <path d="M302 90 V112 Q302 122 292 122 H68 Q58 122 58 112 V92" fill="none" stroke={INK} strokeWidth={1.5} strokeDasharray="4 3" markerEnd="url(#ga-arrow)" />
      <T x={180} y={140} anchor="middle" size={10.5}>
        repeat forever · one pass = one scan (≈ 10 ms here)
      </T>
    </Frame>
  );
}

/** A push-button contact drawn open or closed between two terminals. */
function Contact({ x, y, closed, color }: { x: number; y: number; closed: boolean; color: string }) {
  return (
    <g>
      <line x1={x - 26} y1={y} x2={x - 12} y2={y} stroke={DIM} strokeWidth={2} />
      <line x1={x + 12} y1={y} x2={x + 26} y2={y} stroke={DIM} strokeWidth={2} />
      <circle cx={x - 12} cy={y} r={2.6} fill={INK} />
      <circle cx={x + 12} cy={y} r={2.6} fill={INK} />
      <line x1={x - 14} y1={closed ? y - 3 : y - 11} x2={x + 14} y2={closed ? y - 3 : y - 11} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
      <line x1={x} y1={closed ? y - 3 : y - 11} x2={x} y2={closed ? y - 13 : y - 21} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

function NoNcArt() {
  const cell = (x: number, y: number, closed: boolean, color: string) => (
    <g>
      <Contact x={x} y={y} closed={closed} color={color} />
      <T x={x + 38} y={y + 4} mono size={12} weight={700} fill={closed ? GREEN : DIM}>
        {closed ? '1' : '0'}
      </T>
    </g>
  );
  return (
    <Frame title="Normally open and normally closed contacts at rest and when pressed">
      <T x={110} y={18} anchor="middle" size={11} fill="#e2e8f0" weight={700}>
        N.O. — START
      </T>
      <T x={262} y={18} anchor="middle" size={11} fill="#e2e8f0" weight={700}>
        N.C. — STOP
      </T>
      <T x={8} y={62} size={10.5}>
        at rest
      </T>
      <T x={8} y={116} size={10.5}>
        pressed
      </T>
      <line x1={186} y1={26} x2={186} y2={132} stroke={LINE} />
      <line x1={60} y1={84} x2={352} y2={84} stroke={LINE} />
      {cell(98, 64, false, SKY)}
      {cell(250, 64, true, RED)}
      {cell(98, 118, true, SKY)}
      {cell(250, 118, false, RED)}
      <T x={180} y={146} anchor="middle" size={10}>
        input bit = contact closed? · a broken wire reads 0 → N.C. is fail-safe
      </T>
    </Frame>
  );
}

function AliasArt() {
  return (
    <Frame title="Alias tag Start_PB points to Local:1:I.Data.0">
      <rect x={10} y={40} width={104} height={34} rx={8} fill="#0f2a1c" stroke={GREEN} />
      <T x={62} y={62} anchor="middle" mono size={12.5} weight={700} fill="#86efac">
        Start_PB
      </T>
      <line x1={116} y1={57} x2={176} y2={57} stroke={INK} strokeWidth={1.5} markerEnd="url(#ga-arrow)" />
      <T x={146} y={50} anchor="middle" size={10}>
        alias for
      </T>
      <rect x={180} y={40} width={170} height={34} rx={8} fill="#111820" stroke={DIM} />
      <T x={265} y={62} anchor="middle" mono size={12} weight={600} fill="#e2e8f0">
        Local:1:I.Data.0
      </T>
      <line x1={265} y1={76} x2={265} y2={100} stroke={INK} strokeWidth={1.5} markerEnd="url(#ga-arrow)" />
      <rect x={214} y={104} width={102} height={30} rx={6} fill="#1c242d" stroke={DIM} />
      <T x={265} y={123} anchor="middle" size={10.5}>
        slot 1 · IB16 · IN-0
      </T>
      <T x={62} y={100} anchor="middle" size={10}>
        what the logic uses
      </T>
      <T x={62} y={114} anchor="middle" size={10}>
        (readable)
      </T>
    </Frame>
  );
}

function ModuleTagsArt() {
  const rows: Array<[number, string, string, string?]> = [
    [0, 'Local:1:I', 'input data · slot 1 (IB16)'],
    [1, '.Data', 'DINT', '.0 … .15 = points'],
    [0, 'Local:2:O', 'output data · slot 2 (OB16E)'],
    [1, '.Data', 'DINT', '.0 … .15'],
    [0, 'Local:3:I', 'analog in · slot 3 (IF8)'],
    [1, '.Ch0Data', 'REAL', 'engineering units'],
  ];
  return (
    <Frame title="Module-defined tags created from the I/O configuration">
      {rows.map(([lvl, name, type, extra], i) => {
        const y = 22 + i * 20;
        const x = 14 + lvl * 22;
        return (
          <g key={i}>
            {lvl === 1 && <path d={`M${x - 14} ${y - 18} V${y - 4} H${x - 4}`} fill="none" stroke={DIM} />}
            <T x={x} y={y} mono size={11.5} weight={lvl === 0 ? 700 : 500} fill={lvl === 0 ? '#e2e8f0' : '#cbd5e1'}>
              {name}
            </T>
            <T x={lvl === 0 ? 110 : 120} y={y} size={10} fill={lvl === 0 ? INK : SKY} mono={lvl === 1}>
              {type}
            </T>
            {extra && (
              <T x={170} y={y} size={10}>
                {extra}
              </T>
            )}
          </g>
        );
      })}
      <T x={14} y={144} size={10} fill={DIM}>
        created automatically — read-only structure
      </T>
    </Frame>
  );
}

function PrescanArt() {
  const seg = (x: number, w: number, label: string, fill: string, text = '#0b0f14') => (
    <g>
      <rect x={x} y={20} width={w} height={22} rx={4} fill={fill} />
      <T x={x + w / 2} y={35} anchor="middle" size={10} weight={700} fill={text}>
        {label}
      </T>
    </g>
  );
  const wave = (y: number, d: string, color: string) => <path d={d.replace(/Y0/g, String(y + 12)).replace(/Y1/g, String(y))} fill="none" stroke={color} strokeWidth={2} />;
  return (
    <Frame title="Prescan clears OTE bits but not OTL bits; S:FS is on for the first scan">
      {seg(70, 70, 'PROG', '#334155', '#cbd5e1')}
      {seg(142, 44, 'prescan', AMBER)}
      {seg(188, 60, 'scan 1', GREEN)}
      {seg(250, 48, 'scan 2', '#166534', '#dcfce7')}
      {seg(300, 52, 'scan …', '#14532d', '#bbf7d0')}
      <T x={8} y={68} mono size={10.5} fill="#cbd5e1">
        S:FS
      </T>
      {wave(58, 'M70 Y0 H188 V Y1 H248 V Y0 H352', GREEN)}
      <T x={8} y={98} mono size={10.5} fill="#cbd5e1">
        OTE bit
      </T>
      {wave(88, 'M70 Y1 H142 V Y0 H352', SKY)}
      <T x={8} y={128} mono size={10.5} fill="#cbd5e1">
        OTL bit
      </T>
      {wave(118, 'M70 Y1 H352', RED)}
      <T x={356} y={146} anchor="end" size={10}>
        OTE cleared by prescan · OTL keeps its 1 → may restart!
      </T>
    </Frame>
  );
}

function ForcesArt() {
  return (
    <Frame title="A forced input: terminal 0 V, force value 1, tag reads 1">
      <rect x={8} y={36} width={84} height={44} rx={8} fill="#111820" stroke={DIM} />
      <T x={50} y={54} anchor="middle" size={10}>
        terminal
      </T>
      <T x={50} y={71} anchor="middle" mono size={12} weight={700} fill={DIM}>
        0 V
      </T>
      <line x1={94} y1={58} x2={134} y2={58} stroke={INK} strokeWidth={1.5} markerEnd="url(#ga-arrow)" />
      <rect x={138} y={30} width={84} height={56} rx={8} fill="#2a1f05" stroke={AMBER} />
      <T x={180} y={52} anchor="middle" size={10.5} fill={AMBER} weight={700}>
        FORCE
      </T>
      <T x={180} y={72} anchor="middle" mono size={13} weight={800} fill="#fde68a">
        1
      </T>
      <line x1={224} y1={58} x2={264} y2={58} stroke={GREEN} strokeWidth={1.5} markerEnd="url(#ga-arrow-g)" />
      <rect x={268} y={36} width={84} height={44} rx={8} fill="#0f2a1c" stroke={GREEN} />
      <T x={310} y={54} anchor="middle" size={10}>
        tag / logic
      </T>
      <T x={310} y={71} anchor="middle" mono size={12} weight={700} fill="#86efac">
        1
      </T>
      <circle cx={24} cy={112} r={5} fill={AMBER} opacity={0.45} />
      <T x={36} y={116} size={10.5}>
        flashing = installed
      </T>
      <circle cx={170} cy={112} r={5} fill={AMBER} />
      <T x={182} y={116} size={10.5}>
        steady = enabled (active!)
      </T>
      <T x={8} y={140} size={10} fill={DIM}>
        the input module’s ST LED still shows the real 0 V
      </T>
    </Frame>
  );
}

function OnlineEditArt() {
  const steps: Array<[string, string, string]> = [
    ['Edit', 'pending rung (i / r)', SKY],
    ['Accept', 'downloaded', AMBER],
    ['Test', 'new rung runs', GREEN],
    ['Assemble', 'old rung gone', '#a78bfa'],
  ];
  return (
    <Frame title="Studio 5000 online edit sequence: edit, accept, test, assemble">
      {steps.map(([a, b, c], i) => {
        const x = 6 + i * 88;
        return (
          <g key={a}>
            <path d={`M${x} 34 H${x + 76} L${x + 86} 56 L${x + 76} 78 H${x} L${x + 10} 56 Z`} fill="#111820" stroke={c} strokeWidth={1.5} />
            <T x={x + 45} y={58} anchor="middle" size={12} weight={700} fill="#e2e8f0">
              {a}
            </T>
            <T x={x + 45} y={100} anchor="middle" size={9.5}>
              {b}
            </T>
          </g>
        );
      })}
      <T x={180} y={132} anchor="middle" size={10.5}>
        PLC World: every rung edit is applied at once, tag values kept
      </T>
    </Frame>
  );
}

function FaultsArt() {
  const card = (x: number, title: string, led: string, lines: string[], accent: string) => (
    <g>
      <rect x={x} y={14} width={168} height={120} rx={10} fill="#111820" stroke={accent} strokeOpacity={0.7} />
      <T x={x + 12} y={34} size={12} weight={800} fill="#e2e8f0">
        {title}
      </T>
      <circle cx={x + 148} cy={30} r={5} fill={led} />
      <T x={x + 136} y={34} size={9.5} anchor="end">
        OK
      </T>
      {lines.map((l, i) => (
        <T key={i} x={x + 12} y={58 + i * 18} size={10.5} mono={i === 0} fill={i === 0 ? '#fca5a5' : INK}>
          {l}
        </T>
      ))}
    </g>
  );
  return (
    <Frame title="Major fault stops the logic; minor fault is logged">
      {card(6, 'Major fault', RED, ['T04:C20', 'logic STOPPED', 'outputs OFF', 'clear → Program mode'], RED)}
      {card(186, 'Minor fault', GREEN, ['T04:C04', 'overflow, S:V = 1', 'logged in the', 'fault list · keeps running'], AMBER)}
    </Frame>
  );
}

function RpiArt() {
  const scans = [
    [60, 70],
    [132, 56],
    [190, 78],
    [270, 62],
  ];
  return (
    <Frame title="Input data arrives every RPI, asynchronously to the program scans">
      <T x={8} y={46} size={10.5} fill="#cbd5e1">
        scans
      </T>
      {scans.map(([x, w], i) => (
        <rect key={i} x={x} y={32} width={w! - 3} height={20} rx={3} fill="#14532d" stroke={GREEN} strokeOpacity={0.6} />
      ))}
      <T x={8} y={96} size={10.5} fill="#cbd5e1">
        RPI 10 ms
      </T>
      <line x1={60} y1={92} x2={352} y2={92} stroke={LINE} />
      {Array.from({ length: 8 }, (_, i) => 70 + i * 40).map((x, i) => (
        <g key={x}>
          <line x1={x} y1={80} x2={x} y2={104} stroke={i === 3 ? AMBER : SKY} strokeWidth={i === 3 ? 2.5 : 1.5} />
          {i === 3 && <line x1={x} y1={56} x2={x} y2={78} stroke={AMBER} strokeWidth={1} strokeDasharray="3 3" />}
        </g>
      ))}
      <T x={190} y={124} anchor="middle" size={10.5} fill={AMBER}>
        new input data can land mid-scan
      </T>
      <T x={190} y={142} anchor="middle" size={10}>
        buffer inputs at the start of a routine when it matters
      </T>
    </Frame>
  );
}

export function GlossaryArt({ id }: { id: GlossaryArtId }) {
  switch (id) {
    case 'scan':
      return <ScanArt />;
    case 'nonc':
      return <NoNcArt />;
    case 'sealin':
      return (
        <div className="flex min-h-[150px] flex-col items-center justify-center gap-2 py-2">
          <MiniLadder text="[XIC(Start_PB),XIC(Motor)]XIC(Stop_PB)OTE(Motor);" width={340} />
          <div className="text-center text-[11px] text-slate-400">
            START (N.O.) in parallel with the motor’s own contact · STOP (N.C. → XIC) in series
          </div>
        </div>
      );
    case 'alias':
      return <AliasArt />;
    case 'moduletags':
      return <ModuleTagsArt />;
    case 'prescan':
      return <PrescanArt />;
    case 'forces':
      return <ForcesArt />;
    case 'onlineedit':
      return <OnlineEditArt />;
    case 'faults':
      return <FaultsArt />;
    case 'rpi':
      return <RpiArt />;
  }
}
