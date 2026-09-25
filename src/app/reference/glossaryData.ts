/**
 * Glossary of Logix concepts for the reference page. Headless data; illustrations live in GlossaryArt.tsx.
 */
export type GlossaryArtId = 'scan' | 'nonc' | 'sealin' | 'alias' | 'moduletags' | 'prescan' | 'forces' | 'onlineedit' | 'faults' | 'rpi';

export interface GlossaryEntry {
  id: string;
  term: string;
  /** One-liner (markdown inline). */
  short: string;
  /** Bullet points (markdown inline). */
  points: string[];
  art: GlossaryArtId;
  /** Instruction mnemonics to link to. */
  instructions?: string[];
  /** Showroom device ids to link to. */
  devices?: string[];
  /** Mission ids that teach it. */
  missions?: string[];
}

export const GLOSSARY: GlossaryEntry[] = [
  {
    id: 'scan-cycle',
    term: 'Scan cycle',
    short: 'The controller runs its program over and over: **inputs → logic → outputs**, typically every few milliseconds.',
    points: [
      'Rungs execute **top to bottom, left to right**. A later rung can overwrite what an earlier rung wrote — the last rung wins.',
      'Logix exchanges I/O data asynchronously at each module’s RPI, so “read – execute – write” is a mental model. PLC World simplifies to fixed 10 ms steps: plant → one scan.',
      'A one-shot (ONS, OSR, OSF) is on for exactly **one scan** — blink and you miss it (the timing diagram samples every scan).',
    ],
    art: 'scan',
    instructions: ['OTE', 'ONS'],
    missions: ['1-1'],
  },
  {
    id: 'no-nc',
    term: 'N.O. / N.C. wiring',
    short: 'A **normally-open** contact closes when operated; a **normally-closed** contact opens when operated. The PLC only sees voltage: 1 or 0.',
    points: [
      'START buttons are N.O.: the input is 1 only while pressed.',
      'STOP buttons, E-stops and overload contacts are N.C.: the input is **1 at rest**, 0 when operated — and 0 when a wire breaks, so a fault stops the machine (fail-safe).',
      '`XIC` means “the bit is 1”, `XIO` means “the bit is 0” — independent of how the device is wired. A healthy N.C. stop is therefore examined with **XIC**.',
    ],
    art: 'nonc',
    instructions: ['XIC', 'XIO'],
    devices: ['push-buttons-800f', 'estop-800fm'],
    missions: ['1-5', '7-2'],
  },
  {
    id: 'seal-in',
    term: 'Seal-in (3-wire control)',
    short: 'A START contact in parallel with the output’s own contact keeps the output on after START is released; the N.C. STOP in series breaks the seal.',
    points: [
      'The branch around START “seals in” the motor: `[XIC(Start_PB),XIC(Motor)]XIC(Stop_PB)OTE(Motor)`.',
      'After a power loss or PROG → RUN the seal drops: the motor needs a new START — **no automatic restart**, unlike a latched OTL.',
      'Stop, E-stop and overload conditions in series all break the seal.',
    ],
    art: 'sealin',
    instructions: ['XIC', 'OTE', 'OTL'],
    devices: ['contactor-100c'],
    missions: ['2-1', '2-3'],
  },
  {
    id: 'alias-tags',
    term: 'Alias tags',
    short: 'An alias is a second name for another tag or I/O point: `Start_PB` → `Local:1:I.Data.0`.',
    points: [
      'Logic reads like the machine (`Start_PB`) instead of like the rack (`Local:1:I.Data.0`).',
      'If a device is re-wired to another terminal, change only the alias target — the logic stays the same.',
      'Reading or writing the alias is exactly the same as using its base tag.',
    ],
    art: 'alias',
    devices: ['1756-ib16'],
    missions: ['1-1'],
  },
  {
    id: 'module-tags',
    term: 'Module-defined tags',
    short: 'Adding a module to the I/O configuration creates its tags automatically: `Local:slot:I` (input data), `Local:slot:O` (output data) and `Local:slot:C` (configuration).',
    points: [
      '`Local` means “in the controller’s own chassis / local bus”; remote modules use their adapter’s name instead.',
      '1756 digital: `Local:1:I.Data.3` · 1756 analog: `Local:3:I.Ch0Data` · 5069: `Local:1:I.Pt03.Data`, `Local:2:O.Ch00.Data`.',
      'The structure (data types) is defined by the module — you cannot edit it, only alias it.',
    ],
    art: 'moduletags',
    devices: ['controllogix-rack', '5069-ib16'],
  },
  {
    id: 'prescan',
    term: 'Prescan & S:FS',
    short: 'On the transition to Run the controller **prescans** the logic once; then the first real scan runs with the first-scan bit **S:FS** = 1.',
    points: [
      'Prescan puts instructions in a safe initial state: OTE bits are cleared and TON timers reset. **ONS/OSR** storage bits are **set** (so a rung that is already true does not fire on the first scan); **OSF**’s storage bit is **cleared** (so a rung that is already false does not fire either).',
      'OTL/OTU bits are **not** touched by prescan: a latched motor bit is still 1 when the controller goes back to Run.',
      'Use `XIC(S:FS)OTU(Motor)` (or initialisation logic) to start from a known state.',
    ],
    art: 'prescan',
    instructions: ['OTL', 'OTU', 'ONS'],
    missions: ['2-4'],
  },
  {
    id: 'forces',
    term: 'Forces',
    short: 'A force overrides an I/O value regardless of the field or the logic. The controller’s **FORCE** LED flashes when forces are installed and is steady when they are enabled.',
    points: [
      'A forced **input** tag shows the forced value — but the input module’s ST LED still shows the real terminal voltage.',
      'A forced **output** drives the field device even if the logic says otherwise.',
      'Forces are a troubleshooting tool: they can move machinery unexpectedly. Remove them when you are done.',
    ],
    art: 'forces',
    devices: ['1756-l85e', '1756-ib16'],
    missions: ['7-6'],
  },
  {
    id: 'online-edits',
    term: 'Online edits',
    short: 'Changing the program while the controller keeps running. Studio 5000 uses pending edits: **edit → accept → test → assemble**.',
    points: [
      'A pending edit is marked in the rung margin; after *accept* the new rung is downloaded, *test* runs it (you can untest back to the old one), *assemble* makes it permanent.',
      'Tag values are kept — only the logic changes.',
      'PLC World applies a rung edit immediately (all steps at once). On a real machine, think about what happens between two edits.',
    ],
    art: 'onlineedit',
  },
  {
    id: 'faults',
    term: 'Major & minor faults',
    short: 'A **major fault** stops the logic and turns the outputs off (OK LED flashing red); a **minor fault** is logged while the controller keeps running.',
    points: [
      'Major example: **T04:C20** — array subscript out of range. The display scrolls `Major Fault T04:C20`.',
      'Minor example: **T04:C04** — arithmetic overflow (also sets S:V).',
      'Clear a major fault with *Clear Majors* (or the key switch PROG → RUN → PROG) after fixing the cause; a fault routine can handle some faults in logic.',
    ],
    art: 'faults',
    devices: ['1756-l85e'],
    missions: ['7-6'],
  },
  {
    id: 'rpi',
    term: 'RPI — Requested Packet Interval',
    short: 'How often an I/O module and its owner-controller exchange data (e.g. every 10 ms), independent of the program scan.',
    points: [
      'Input data can arrive **in the middle of a scan**: two rungs reading the same input may see different values. Copy inputs to internal tags at the start of a routine when consistency matters.',
      'Digital inputs can also send data on change of state (COS).',
      'Shorter RPI = fresher data but more network/backplane load. PLC World updates I/O once per 10 ms step, before each scan.',
    ],
    art: 'rpi',
    devices: ['1756-ib16', '1756-en2t'],
  },
];

export const getGlossaryEntry = (id: string): GlossaryEntry | undefined => GLOSSARY.find((g) => g.id === id);

/** Deep link to one glossary term (the route has a single segment: `/reference/glossary:<id>`). */
export function glossaryHref(id?: string): string {
  return id ? `/reference/glossary:${id}` : '/reference/glossary';
}

/** Parses the reference route segment: `glossary` or `glossary:<id>` → { term }, anything else → null. */
export function parseGlossaryParam(raw: string | undefined): { term?: string } | null {
  if (!raw) return null;
  const m = /^glossary(?::([a-z0-9-]+))?$/i.exec(raw);
  if (!m) return null;
  const term = m[1]?.toLowerCase();
  return { term: term && GLOSSARY.some((g) => g.id === term) ? term : undefined };
}
