# PLC World

**Learn Allen-Bradley PLCs by playing.** PLC World is a gamified, browser-based simulator for
Logix 5000 ladder logic. You write rungs in a Studio 5000-style editor and download them to a
simulated ControlLogix or CompactLogix controller. Then you watch live 3D digital twins of real
machines respond: motors, conveyors, tanks, traffic lights and parking gates.

> Not affiliated with Rockwell Automation. Allen-Bradley, ControlLogix, CompactLogix, Studio 5000,
> PowerFlex and PanelView are trademarks of Rockwell Automation. Catalog numbers are used for
> educational realism; no logos are reproduced.

## What's inside

| | |
|---|---|
| **Logix 5000 engine** | Tags, alias tags and module-defined I/O tags (`Local:1:I.Data.0`, `Local:1:I.Pt00.Data`), 57 RLL instructions with Logix semantics, the CPT/CMP expression evaluator, key switch and modes (RUN/REM/PROG), prescan and `S:FS`, major and minor faults, forces, online edits and verification. Studio 5000 neutral-text rungs are supported (`XIC(Start)[XIC(Motor),]XIO(Stop)OTE(Motor);`). |
| **Ladder editor** | SVG ladder drawn like Studio 5000, with an online power-flow animation. It supports ASCII quick entry, operand autocomplete, branches, drag and drop, context menus, undo/redo, toggle bit and forces. Also included: the Controller Organizer, tag monitor/editor, online toolbar and instruction help. Classic (light) and dark themes. |
| **3D digital twins** | Procedural React Three Fiber models:<br>• Controllers and I/O: the 1756 chassis, power supplies, L8x controller (dot-matrix display, clickable key switch), EN2T, IB16/OB16E/IF8/OF8 with wired terminal blocks, the 5380 controller and Compact 5000 I/O.<br>• Drive and HMI: PowerFlex 525, PanelView 5310.<br>• Operator and panel devices: 800F operators, 855T stack lights, contactor/overload.<br>• Field devices: motors, photo-eyes, cylinders, valves, a conveyor, a mixing tank, traffic signals, barrier gates and cars. |
| **Six training plants** | A trainer bench, motor control station, box sorting conveyor, mixing & heating tank, four-way intersection and parking garage. Each is fully wired to PLC I/O and has a control cabinet with the live rack, clickable operator devices and an I/O tag overlay. |
| **Campaign** | 7 chapters and 41 missions, from your first `XIC` to fixing the night shift's broken programs. Each mission comes with a story, hints and a debrief, and automated acceptance tests grade your program on a fresh controller. You earn stars, XP, ranks and 37 achievements, and can keep a daily streak. |
| **Sandbox** | Free programming on any plant, with fault injection, save slots, import/export and share links. |
| **Showroom & reference** | Explore 36 devices in 3D, with hotspots and spec cards. The instruction browser has a live playground and timing diagrams. |

## Run it

Requires **Node.js 20.19+ or 22.12+** and a WebGL-capable browser.

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | |
|---|---|
| `npm run dev` | Vite dev server with HMR |
| `npm test` | Vitest suite: engine, plants, all 41 missions and hundreds of "wrong answer" programs, editor, app |
| `npm run typecheck` | TypeScript 7 (native `tsc`) |
| `npm run build` / `npm run preview` | Production build / serve it |

Dev harness pages (served by `npm run dev`):

- `/gallery.html`: every 3D device model on its own (`?p=<preview name>`)
- `/scene-dev.html?scene=motor-station`: a full plant running a demo program (`&cam=`, `&ctrl=`, `&tap=`, `&warm=`)
- `/editor-dev.html`: the ladder editor online against a live controller

Player progress is stored in the browser (`localStorage`). There is no backend, and the app makes no
network requests at runtime.

## How it works

```
operator click / test step ─► scene.setControl()
every 10 ms of simulated time:
   scene.step()        field devices ─► input image  (io.writeBool('Local:1:I.Data.0', …))
   controller.scan()   prescan / programs / JSR / timers / faults / forces
   outputs             output image ─► field devices (0 unless the controller is running)
UI ◄── runtime.subscribe() (~30 Hz)      3D views ◄── useFrame reads plant state + controller
```

Mission validation runs the exact same engine and plant models headless. Each test gets a fresh
controller, and invariants (e.g. "never both directions green") are checked on every 10 ms step.

## Project layout

```
src/plc/      Logix runtime (headless): tags, instructions, controller, verify, neutral text
src/sim/      simulation runtime + the six plant models (logic.ts) and their 3D views (View.tsx)
src/twin/     3D digital-twin device library, shared stage (lighting, post FX, camera presets)
src/editor/   ladder editor, tag monitor, controller organizer, online toolbar
src/game/     missions, validation runner, progress store, ranks, achievements
src/app/      pages: home, campaign, mission workspace, sandbox, showroom, reference, profile
src/ui/       UI kit          src/audio/  synthesized sound effects (WebAudio)
docs/         ARCHITECTURE.md, ENGINE.md, SCENES.md, CURRICULUM.md
```

## Tech

Vite 8 · React 19 · TypeScript 7 · Tailwind CSS 4 · three.js r186 · @react-three/fiber 9 ·
@react-three/drei 10 · @react-three/postprocessing · zustand 5 · wouter 3 · Vitest 5 · Playwright
