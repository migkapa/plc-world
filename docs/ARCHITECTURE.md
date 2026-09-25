# PLC World — architecture

**PLC World** is a gamified, browser-based simulator for learning Allen-Bradley **Logix 5000**
ladder logic (Studio 5000 style) on realistic **3D digital twins** of ControlLogix / CompactLogix
hardware and the machines they control.

## Product pillars

1. **Authentic controller** — a Logix 5000-style runtime: tags (BOOL/SINT/INT/DINT/REAL/TIMER/COUNTER,
   arrays, alias tags, module I/O tags such as `Local:1:I.Data.0`), controller modes & key switch
   (RUN/REM/PROG), major/minor faults, forces, prescan, S:FS, online edits, and ~40 RLL instructions
   with correct Logix semantics.
2. **Studio 5000-like ladder editor** — rungs with power rails, contacts/coils/box instructions, branches,
   tag operands with descriptions, online power-flow animation, toggle-bit, rung comments, neutral-text
   (ASCII) rung editing, verification errors, controller organizer & tag monitor.
3. **Loyal 3D digital twins** — procedurally modeled (React Three Fiber) 1756 chassis & modules with
   working status LEDs and 4-character displays, 5380 CompactLogix, PowerFlex 525, PanelView 5310,
   800F push buttons, 855T stack lights, sensors, motors, conveyors, tanks… all live-wired to the
   simulated I/O.
4. **Gamified learning** — a campaign of chapters & missions with automated acceptance tests, stars,
   XP, ranks, achievements, hints, streaks; plus a free sandbox and a hardware showroom.

## Tech stack

- Vite 8 · React 19 · TypeScript 7 (`tsc` is the native compiler) · Tailwind CSS 4
- three.js r186 · @react-three/fiber 9 · @react-three/drei 10 · @react-three/postprocessing 3 (Bloom, N8AO)
- zustand 5 (state, with `persist` for player progress) · wouter 3 (routing) · lucide-react (icons)
- vitest 5 (unit tests, node environment)

No backend: everything runs client-side; progress persists to `localStorage`. **No runtime network
fetches** (no CDN HDRIs, no remote fonts) — lighting uses drei `<Environment>` with `<Lightformer>`s,
text uses canvas textures or bundled `@fontsource` fonts.

## Directory layout & ownership

```
src/
  plc/                 Logix runtime (headless, no React)
    types.ts           ★ contracts (controller, tags, AST, hardware)
    neutralText.ts     ★ rung text parser/serializer + AST helpers
    catalog.ts         module catalog + I/O data types (Local:x:I / O structures)
    tags.ts            TagDatabase implementation (operand resolution, conversions)
    instructions/      instruction metadata (InstructionInfo) + execution
    controller.ts      createController(): scan, modes, faults, forces, prescan, live state
    verify.ts          static verification
    *.test.ts
  sim/
    types.ts           ★ scene/runtime contracts
    runtime.ts         createSimRuntime(controller, scene)
    project.ts         createProjectForScene(scene, rungs?) — builds a Project with alias tags
    scenes/<id>/logic.ts   headless plant models (see docs/SCENES.md)
    scenes/<id>/View.tsx   3D scene composition
    scenes/index.ts        SCENE_LOGICS registry (headless)
    scenes/views.tsx       SCENES registry (logic + View + cameras)
  twin/
    common.tsx         ★ units, colors, materials, text textures, <Led>
    contracts.ts       ★ device component props
    devices/           device components (plc/, operator/, panel/, field/) + index.ts barrel
    live.ts            rackLiveFromController()
    lod.tsx            <DistanceLod> (distance / screen-size LOD; racks and scenes use it)
    dispose.ts         useDisposeOnUnmount() — StrictMode-safe disposal of memoised three.js resources
    Stage.tsx          shared <Canvas> setup: lights, environment, post-processing, controls, HUD framing
    hud.ts             hudRects(): the DOM HUD over a SceneCanvas as seen from inside it (tag chips avoid it)
    releaseRenderer.ts full WebGLRenderer release after R3F's unmount (no renderer / page DOM left behind)
  editor/              ladder editor, tag monitor, controller organizer (DOM/SVG, no three)
  game/
    types.ts           ★ mission/progress contracts
    chapters.ts, missions/**, achievements.ts, validation.ts (headless test runner), store.ts (zustand persist)
  ui/                  shared UI primitives (buttons, panels, toasts, modal)
  app/                 pages & routing: Home/Campaign, Mission workspace, Sandbox, Showroom, Reference, Profile
  audio/               WebAudio synthesized sound effects (no audio files)
  main.tsx, App.tsx, index.css
```

★ = shared contract; change only with care (other modules compile against it).

### Learning aids in the mission workspace (`src/app/workspace/onboarding/`)

- **Guided first rung** (mission 1-1): coach marks (`TourCoachMarks.tsx`: spotlight + callout, `Alt+G` returns the
  keyboard to the card) driven by the headless step judge `firstRungTour.ts` (plant → flip Switch 0 → click rung → XIC
  → Switch_0 → OTE → Light_0 → applied online → flip again → Verify & Test). Starts by itself on the first visit
  until finished or skipped (`profile.tutorials`, `useGame().finishTutorial()` → `tutorialFinished` game event), and
  replays from the mission bar's **?** menu (`HelpMenu.tsx`).
- **Live objectives** (`liveObjectives.ts`, `useLiveObjectives.ts`, `LiveChip.tsx`): ~800 ms after each accepted
  online edit / tag change the mission's tests re-run in the background (`startTestRun` in idle-time slices of
  4 ms, paused during Verify & Test) and `objectiveStates` marks what the current program already does — soft
  dashed "live" marks, never graded; a "Looks good — press Verify & Test" nudge when everything passes.
- **Try it now** (`tryIt.ts`, `TryItNow.tsx`): after an online edit, a callout at the operator control that
  exercises the edited rung (control → input alias and its at-rest / operated value found by probing the headless
  plant; tests give the order). Series contacts that are false at rest are all named — an AND needs every input
  ("Flip Switch 2 and Switch 3…"); switches already in place are skipped. It waits while a ladder operand / value box
  is open, and in picture-in-picture (no pad) offers **Show the controls** (`requestSplitView()` in `layoutPrefs.ts`).
- Per-device switches for both (live checks, tips) live in `assistStore.ts` (the **?** menu).

### Editing layout & "where is this device?" (`WorkspaceLayout.tsx`, `TwinLayout.tsx`, `workspace/highlight/`)

- **Picture-in-picture twin** (desktop): the twin toolbar's PiP button (and its menu: Split / Picture-in-picture /
  Auto) collapses the twin panel so the ladder gets the whole center column; the same twin node becomes a fixed,
  still-live panel in a corner of the ladder's rung area (never remounted). Click / Enter restores the split, drag or
  arrow keys move it to another corner, the inner-corner grip or +/- resizes it; dragging the splitter down also
  restores. **Auto**: PiP after 2 s of keyboard focus inside the ladder, split again when the player clicks / tabs
  out of it (dialogs opened from the ladder don't count). A test replay (`twinWanted`) always shows the split view.
  Remembered per device in `layoutPrefs.ts` (`plcw-layout-prefs-v1`); the PiP / Auto choice per workspace page (the
  `WorkspaceLayout` id: a mission PiP never hides the sandbox's operator pad), corner, size and the ladder's **compact
  labels** (`LadderEditor compactLabels`: tag names only, descriptions / alias addresses in the hover card) for all.
  A bottom-right PiP moves the ladder's "Edits applied online" chip beside it (`pipChipVars`).
- **3D device highlight**: hovering (or focusing) an I/O table row, an alias chip in the briefing / objectives /
  hints (`AliasChips.tsx`: I/O tags in Markdown code spans become buttons via `MarkdownCodeContext`) or an objective
  (`objectiveDevices.ts`: the tags it names, else the devices its proving tests operate / check, ranked by its
  words) sets `useSceneOverlay().setHighlight(...)`; the scene kits outline the devices (see docs/SCENES.md). When
  the device is off-screen (outside the view, behind a wall, under the operator pad) the twin shows **Show
  <alias>** at the edge it is beyond (not during a test replay: its banner owns that space, and a chip clicked
  then also turns the replay's automatic camera off); clicking it — or a chip — flies the camera there (`DeviceCamera.tsx`: the
  scene's `focus` preset if it really shows the device, else the preset showing it best, else a computed close-up;
  every candidate checked for framing inside the HUD-free band and line of sight). Reduced motion: camera cuts,
  static outline.

## Runtime data flow

```
 operator click / test step ──► scene.setControl()
                                   │
     every 10 ms simulated:  scene.step(state, 10, io) ──► io.writeBool('Local:1:I.Data.0', …)   (field → input image)
                             controller.scan(10)         ──► executes MainTask programs (RLL)
                             io.readBool('Local:2:O.Data.0') ◄── output image (0 unless running)
                                   │
 React UI ◄── runtime.subscribe() (~30 Hz)      3D views ◄── useFrame reads scene state & controller
```

The simulation runs in fixed 10 ms steps (`SimRuntime.tick` accumulates real time × speed). Mission
validation runs the exact same logic headless and fast (no rendering).

## Commands

- `npm run dev` — dev server
- `npm run typecheck` — `tsc --noEmit`
- `npm test` — vitest (headless engine, scenes, mission solutions)
- `npm run build` — typecheck + production build

## Coding conventions

- Strict TypeScript, no `any` in public APIs (internal `unknown` + narrowing is fine).
- Components: function components + hooks. Per-frame values go through refs/getters, never React state.
- Keep headless modules (`plc/`, `sim/**/logic.ts`, `sim/runtime.ts`, `sim/project.ts`, `game/validation.ts`,
  `game/missions/**`) free of React/DOM/three imports so they run in vitest's node environment.
- Visual theme: dark "control room" UI (slate/zinc) with an industrial accent (Rockwell-like red `#e0252b`
  used sparingly, safety amber `#f5c400`, LED green `#22c55e`); ladder editor mimics Studio 5000 online
  colors (energized paths in green).
- Not affiliated with Rockwell Automation. Use catalog numbers for authenticity, but **do not reproduce
  the Allen-Bradley or Rockwell logos**; module fronts carry generic white label text instead.
