/**
 * Sandbox (/#/sandbox and /#/sandbox/:sceneId): pick a plant, then the full workspace without mission
 * chrome — every control incl. fault injection, example programs, save slots, neutral-text
 * export / import and shareable links (/#/sandbox/<scene>?p=<code>).
 */
import { ArrowLeft, BookOpenText, Box, Download, FilePlus2, FolderOpen, Loader2, Save, Share2, Sparkles, Upload, Workflow, Activity } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { sfx } from '../../audio/sfx';
import type { LadderEditorHandle } from '../../editor';
import { createProjectForScene } from '../../sim/project';
import { SCENE_LOGICS } from '../../sim/scenes';
import { SCENES } from '../../sim/scenes/views';
import type { SceneLogic } from '../../sim/types';
import { useSimLoop } from '../../sim/useSimLoop';
import { Badge, Button, Modal, toast } from '../../ui';
import { routes } from '../routes';
import { PlantHardware } from '../workspace/BriefingPanel';
import { useControlHotkeys } from '../workspace/ControlPad';
import { LeftDock } from '../workspace/Docks';
import { recordGameEvent } from '../workspace/gameEvents';
import { IoTable } from '../workspace/IoTable';
import { LadderPanel } from '../workspace/LadderPanel';
import type { ProgramSnapshot } from '../workspace/program';
import { decodeShareCode, encodeShareCode, exportProgramText, slugify, type ProgramDocument } from '../workspace/programText';
import { ImportModal, PlantMonitor, ScenePicker, ShareModal, SlotsModal, sceneAccent, sceneIcon } from '../workspace/SandboxParts';
import { backupWorkingCopy, getSlot, loadWorkingCopy, saveSlot, saveWorkingCopy, type SandboxSlot } from '../workspace/slots';
import { SpeedControl } from '../workspace/SpeedControl';
import { TwinPanel } from '../workspace/TwinPanel';
import { useWorkspaceRuntime } from '../workspace/useWorkspaceRuntime';
import { WorkspaceLayout } from '../workspace/WorkspaceLayout';
import '../workspace/anim.css';
import { PENDING_ROUTINES } from '../workspace/Docks';

/** Sandbox time is reported in chunks while the page is visible. */
const SANDBOX_TIME_CHUNK_MS = 30_000;

/** `?p=` / `?slot=` parameters of the hash route (#/sandbox/trainer?p=…). */
function hashParams(): URLSearchParams {
  const h = typeof location !== 'undefined' ? location.hash : '';
  const i = h.indexOf('?');
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : '');
}

/** A fresh sandbox program: one empty rung with a friendly, plant-specific comment. */
function emptyProgram(scene: SceneLogic<unknown>): ProgramSnapshot {
  const input = scene.io.find((p) => p.dir === 'input' && p.signal === 'digital')?.alias ?? 'Start_PB';
  const output = scene.io.find((p) => p.dir === 'output' && p.signal === 'digital')?.alias ?? 'Motor';
  return { rungs: [''], comments: [`Sandbox — build anything. Click the rung and type e.g. XIC ${input} OTE ${output} then Enter.`], tags: [] };
}

type Start = { sceneId: string; snap: ProgramSnapshot; name: string; slotId?: string; source: 'share' | 'slot' | 'wip' | 'new'; seq?: number };

let startSeq = 0;

export default function SandboxPage() {
  const params = useParams<{ sceneId?: string }>();
  const [, navigate] = useLocation();
  const raw = decodeURIComponent(params.sceneId ?? '');
  const sceneId = raw.split('?')[0] ?? '';
  const [slotsOpen, setSlotsOpen] = useState(false);
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scene = sceneId ? SCENE_LOGICS[sceneId] : undefined;
  const resolved = useRef<string | null>(null);

  // Resolve the start program (share code / slot / working copy) whenever the scene changes.
  useEffect(() => {
    if (!scene) {
      resolved.current = null;
      setStart(null);
      return;
    }
    let alive = true;
    const q = hashParams();
    const code = q.get('p');
    const slotId = q.get('slot');
    // the URL was just cleaned after loading (or nothing asks for another program): keep the workspace
    if (!code && !slotId && resolved.current === scene.id) return;
    resolved.current = scene.id;
    setError(null);
    const clean = (): void => navigate(routes.sandbox(scene.id), { replace: true });
    if (code) {
      setStart(null);
      decodeShareCode(code).then(
        (doc) => {
          if (!alive) return;
          const snap = { rungs: doc.rungs.length ? doc.rungs : [''], comments: doc.comments, tags: doc.tags };
          // the shared program becomes this plant's working copy: keep the player's unsaved work first
          const kept = backupWorkingCopy(scene.id, scene.title, snap);
          setStart({ sceneId: scene.id, seq: ++startSeq, snap, name: doc.name ?? 'Shared program', source: 'share' });
          toast({
            tone: 'success',
            title: 'Shared program loaded',
            body: kept ? `It is a copy — save it to a slot to keep it. Your previous unsaved program was kept in the slot “${kept.name}”.` : 'It is a copy — save it to a slot to keep it.',
            duration: kept ? 8000 : 4000,
          });
          clean();
        },
        (e: unknown) => {
          if (!alive) return;
          setError(e instanceof Error ? e.message : String(e));
          clean();
        },
      );
      return () => {
        alive = false;
      };
    }
    const slot = slotId ? getSlot(slotId) : undefined;
    if (slot && slot.sceneId === scene.id) {
      const kept = backupWorkingCopy(scene.id, scene.title, slot);
      if (kept) toast({ tone: 'info', title: 'Unsaved work kept', body: `Your previous unsaved ${scene.title} program was saved as “${kept.name}”.`, duration: 7000 });
      setStart({ sceneId: scene.id, seq: ++startSeq, snap: slot, name: slot.name, slotId: slot.id, source: 'slot' });
      clean();
      return;
    }
    const wip = loadWorkingCopy(scene.id);
    if (wip) setStart({ sceneId: scene.id, seq: ++startSeq, snap: wip, name: wip.name ?? 'Untitled', ...(wip.slotId ? { slotId: wip.slotId } : {}), source: 'wip' });
    else setStart({ sceneId: scene.id, seq: ++startSeq, snap: emptyProgram(scene), name: 'Untitled', source: 'new' });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, raw]);

  const loadSlot = (s: SandboxSlot): void => {
    setSlotsOpen(false);
    navigate(`${routes.sandbox(s.sceneId)}?slot=${encodeURIComponent(s.id)}`);
  };

  if (!sceneId || !scene) {
    return (
      <div className="relative h-full" data-testid="sandbox-page">
        {sceneId && !scene && (
          <div className="absolute inset-x-0 top-2 z-10 mx-auto w-fit rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1.5 text-sm text-amber-200">Unknown plant “{sceneId}” — pick one below.</div>
        )}
        <ScenePicker onOpenSlots={() => setSlotsOpen(true)} />
        <SlotsModal open={slotsOpen} onClose={() => setSlotsOpen(false)} onLoad={loadSlot} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" data-testid="sandbox-page">
        <div className="text-lg font-semibold text-slate-100">That share link could not be opened</div>
        <p className="text-sm text-slate-400">{error}</p>
        <Button variant="primary" onClick={() => setError(null)}>
          Open {scene.title} anyway
        </Button>
      </div>
    );
  }
  if (!start || start.sceneId !== scene.id) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-slate-400" data-testid="sandbox-page">
        <Loader2 size={18} className="animate-spin" /> Loading program…
      </div>
    );
  }
  return <SandboxWorkspace key={`${scene.id}:${start.seq ?? 0}`} scene={scene} start={start} onLoadSlot={loadSlot} />;
}

function SandboxWorkspace({ scene, start, onLoadSlot }: { scene: SceneLogic<unknown>; start: Start; onLoadSlot(s: SandboxSlot): void }) {
  const [, navigate] = useLocation();
  const definition = SCENES[scene.id];
  const editorRef = useRef<LadderEditorHandle>(null);
  const [name, setName] = useState(start.name);
  const [slotId, setSlotId] = useState<string | undefined>(start.slotId);
  const meta = useRef({ name, slotId });
  meta.current = { name, slotId };

  const ws = useWorkspaceRuntime({
    scene,
    initial: start.snap,
    buildProject: (s) => createProjectForScene(scene, s.rungs, { comments: s.comments, tags: s.tags }),
    onEvent: recordGameEvent,
    onSave: (s) => saveWorkingCopy(scene.id, { ...s, name: meta.current.name, ...(meta.current.slotId ? { slotId: meta.current.slotId } : {}) }),
  });
  useSimLoop(ws.runtime);
  const padControls = useMemo(() => scene.controls.filter((c) => c.type !== 'fault'), [scene]);
  const faults = useMemo(() => scene.controls.filter((c) => c.type === 'fault'), [scene]);
  useControlHotkeys(ws.runtime, scene.controls, true);

  // keep the working copy's name / slot in sync — only when they really changed (not on mount, and
  // not on StrictMode's second effect run: a share link must not overwrite the working copy by itself)
  const lastMeta = useRef<{ name: string; slotId: string | undefined }>({ name: start.name, slotId: start.slotId });
  useEffect(() => {
    if (lastMeta.current.name === name && lastMeta.current.slotId === slotId) return;
    lastMeta.current = { name, slotId };
    saveWorkingCopy(scene.id, { ...ws.snapshot(), name, ...(slotId ? { slotId } : {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, slotId]);

  // sandbox time for the "Tinkerer" achievement (visible time only)
  useEffect(() => {
    let acc = 0;
    let last = performance.now();
    const tick = (): void => {
      const now = performance.now();
      if (document.visibilityState === 'visible') acc += Math.min(now - last, 2 * SANDBOX_TIME_CHUNK_MS);
      last = now;
      if (acc >= SANDBOX_TIME_CHUNK_MS) {
        recordGameEvent({ type: 'sandboxTime', ms: Math.round(acc) });
        acc = 0;
      }
    };
    const h = window.setInterval(tick, 5000);
    const onVis = (): void => {
      last = performance.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(h);
      document.removeEventListener('visibilitychange', onVis);
      tick();
      if (acc > 1000) recordGameEvent({ type: 'sandboxTime', ms: Math.round(acc) });
    };
  }, []);

  const [slotsOpen, setSlotsOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [confirm, setConfirm] = useState<{ title: string; body: string; action: () => void } | null>(null);
  const [nameOpen, setNameOpen] = useState(false);
  const [nameText, setNameText] = useState('');
  const [mobileTab, setMobileTab] = useState('twin');

  const hasProgram = (): boolean => ws.snapshot().rungs.some((r) => r.replace(/[;\s]/g, '') !== '');
  const guarded = (title: string, body: string, action: () => void): void => {
    if (hasProgram()) setConfirm({ title, body, action });
    else action();
  };

  const saveTo = useCallback(
    (slotName: string, id?: string) => {
      const snap = ws.snapshot();
      const slot = saveSlot({ ...(id ? { id } : {}), name: slotName, sceneId: scene.id, ...snap });
      if (!slot) {
        toast({ tone: 'error', title: 'Could not save', body: 'Browser storage is full or disabled.' });
        return;
      }
      setName(slot.name);
      setSlotId(slot.id);
      sfx.play('click');
      toast({ tone: 'success', title: `Saved “${slot.name}”`, body: `${snap.rungs.length} rung${snap.rungs.length === 1 ? '' : 's'} · ${scene.title}` });
    },
    [ws, scene],
  );

  const onSave = (): void => {
    if (slotId && getSlot(slotId)) saveTo(name, slotId);
    else {
      setNameText(name === 'Untitled' ? '' : name);
      setNameOpen(true);
    }
  };

  /** Download a program document; the name / slot only change when the controller accepted it. */
  const loadDoc = (doc: ProgramDocument, label: string): boolean => {
    if (!ws.loadProgram({ rungs: doc.rungs.length ? doc.rungs : [''], comments: doc.comments, tags: doc.tags })) return false;
    setName(doc.name ?? label);
    setSlotId(undefined);
    return true;
  };

  const onImport = async (doc: ProgramDocument): Promise<void> => {
    setImportOpen(false);
    if (doc.sceneId && doc.sceneId !== scene.id) {
      if (!SCENE_LOGICS[doc.sceneId]) {
        toast({ tone: 'warning', title: `Unknown plant “${doc.sceneId}”`, body: `Loading the program into ${scene.title} instead.` });
      } else {
        const code = await encodeShareCode(doc);
        toast({ tone: 'info', title: `This program is for ${SCENE_LOGICS[doc.sceneId]!.title}`, body: 'Switching plants…' });
        navigate(`${routes.sandbox(doc.sceneId)}?p=${code}`);
        return;
      }
    }
    if (!loadDoc(doc, 'Imported program')) return;
    toast({ tone: 'success', title: 'Program imported', body: `${doc.rungs.length} rung${doc.rungs.length === 1 ? '' : 's'}${doc.tags.length ? `, ${doc.tags.length} tag${doc.tags.length === 1 ? '' : 's'}` : ''}` });
  };

  const onExport = (): void => {
    const snap = ws.snapshot();
    const text = exportProgramText({ ...snap, sceneId: scene.id, name }, { sceneTitle: scene.title });
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(name)}-${scene.id}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const onShare = async (): Promise<void> => {
    setShareUrl(null);
    setShareOpen(true);
    const code = await encodeShareCode({ ...ws.snapshot(), sceneId: scene.id, name });
    setShareUrl(`${location.origin}${location.pathname}${location.search}#${routes.sandbox(scene.id)}?p=${code}`);
  };

  const accent = sceneAccent(scene.id);

  const bar = (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-edge bg-panel-2 px-2 py-1 sm:px-3" data-testid="sandbox-bar">
      <Link href={routes.sandbox()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-[12px] text-slate-400 hover:bg-white/5 hover:text-white" title="All plants">
        <ArrowLeft size={15} />
      </Link>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-black" style={{ background: accent }}>
        {sceneIcon(scene.id, 15)}
      </span>
      <div className="min-w-[9rem] flex-1 basis-40">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[14px] font-semibold text-white">{scene.title}</h1>
          <span className="hidden md:inline">
            <Badge tone="neutral">{scene.hardware.platform}</Badge>
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setNameText(name);
            setNameOpen(true);
          }}
          className="block max-w-56 cursor-pointer truncate text-left text-[11.5px] text-slate-400 hover:text-white"
          title="Rename the program"
          data-testid="program-name"
        >
          {name}
          {slotId ? '' : ' · not saved to a slot'}
        </button>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-1">
      <Button size="sm" variant="ghost" icon={<Sparkles size={14} className="text-amber-300" />} disabled={!definition?.demoRungs?.length} onClick={() => guarded('Load the example program?', 'Your current program is replaced (it stays in its save slot if you saved it).', () => { if (loadDoc({ rungs: definition?.demoRungs ?? [''], comments: [], tags: [] }, 'Example program')) toast({ tone: 'info', title: 'Example program loaded', body: 'Operate the plant and watch the rungs light up.' }); })} data-testid="load-example" title="Load the plant's demo program">
        <span className="hidden lg:inline">Example</span>
      </Button>
      <Button size="sm" variant="ghost" icon={<FilePlus2 size={14} />} onClick={() => guarded('Start a new program?', 'The current program is replaced by an empty routine.', () => loadDoc({ ...emptyProgram(scene) }, 'Untitled'))} title="New empty program">
        <span className="hidden lg:inline">New</span>
      </Button>
      <Button size="sm" variant="ghost" icon={<FolderOpen size={14} />} onClick={() => setSlotsOpen(true)} title="Saved programs" data-testid="open-slots">
        <span className="hidden lg:inline">Open</span>
      </Button>
      <Button size="sm" variant="secondary" icon={<Save size={14} />} onClick={onSave} title="Save to a slot" data-testid="save-slot">
        <span className="hidden sm:inline">Save</span>
      </Button>
      <span className="mx-0.5 h-6 w-px shrink-0 bg-edge" />
      <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={onExport} title="Export as neutral text (.txt)" data-testid="export">
        <span className="hidden xl:inline">Export</span>
      </Button>
      <Button size="sm" variant="ghost" icon={<Upload size={14} />} onClick={() => setImportOpen(true)} title="Import neutral text" data-testid="import">
        <span className="hidden xl:inline">Import</span>
      </Button>
      <Button size="sm" variant="primary" icon={<Share2 size={14} />} onClick={() => void onShare()} title="Copy a link to this program" data-testid="share">
        <span className="hidden sm:inline">Share</span>
      </Button>
      </div>
    </div>
  );

  const twin = (
    <TwinPanel
      scene={scene}
      definition={definition}
      runtime={ws.runtime}
      viewKey="live"
      controls={padControls}
      faults={faults}
      ioHint="the Plant tab"
      tools={<SpeedControl runtime={ws.runtime} onResetPlant={ws.resetPlant} />}
    />
  );
  const ladder = <LadderPanel ws={ws} editorRef={editorRef} onEvent={recordGameEvent} allowKeySwitch />;
  const plantInfo = (
    <div className="space-y-4 p-4" data-testid="plant-info">
      <p className="text-[13px] leading-relaxed text-slate-300">{scene.summary}</p>
      <PlantHardware scene={scene} />
      <IoTable io={scene.io} controller={ws.controller} runtime={ws.runtime} />
      <div>
        <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Controls</div>
        <ul className="space-y-1 text-[12px] text-slate-400">
          {scene.controls.map((c) => (
            <li key={c.id}>
              <span className="font-semibold text-slate-200">{c.label}</span> <span className="text-slate-500">({c.type})</span>
              {c.key && <span className="ml-1 font-mono text-[11px] text-slate-500">[{c.key.toUpperCase()}]</span>}
              {c.description && <span> — {c.description}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
  const left = <LeftDock first={plantInfo} firstLabel="Plant" controller={ws.controller} {...(ws.pendingReason === 'errors' ? { errorRoutines: PENDING_ROUTINES } : {})} onTagsChanged={ws.reverify} editorRef={editorRef} />;
  const monitor = <PlantMonitor scene={scene} runtime={ws.runtime} faults={faults} />;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="sandbox-page">
      {bar}
      <WorkspaceLayout
        id="sandbox"
        className="min-h-0 flex-1"
        left={left}
        twin={twin}
        ladder={ladder}
        right={monitor}
        mobileTabs={[
          { id: 'twin', label: 'Twin', icon: <Box size={13} /> },
          { id: 'ladder', label: 'Ladder', icon: <Workflow size={13} /> },
          { id: 'brief', label: 'Plant', icon: <BookOpenText size={13} /> },
          { id: 'tests', label: 'Monitor', icon: <Activity size={13} /> },
        ]}
        mobileTab={mobileTab}
        onMobileTab={setMobileTab}
        renderMobile={(t) => (t === 'twin' ? twin : t === 'ladder' ? ladder : t === 'brief' ? left : monitor)}
      />

      <SlotsModal
        open={slotsOpen}
        onClose={() => setSlotsOpen(false)}
        currentScene={scene.id}
        {...(slotId ? { currentSlotId: slotId } : {})}
        onLoad={(s) => {
          if (s.sceneId === scene.id) {
            setSlotsOpen(false);
            guarded(`Load “${s.name}”?`, 'The current program is replaced (save it first if you want to keep it).', () => {
              // a refused download (key switch in RUN…) must not switch the name / slot: Save would
              // then overwrite that slot with the program still in the editor
              if (!ws.loadProgram(s)) return;
              setName(s.name);
              setSlotId(s.id);
            });
          } else onLoadSlot(s);
        }}
        onSaveAs={(n) => saveTo(n)}
        onRenamed={(id, n) => {
          if (id === slotId) setName(n);
        }}
        onDeleted={(id) => {
          if (id === slotId) setSlotId(undefined);
        }}
      />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onImport={(d) => void onImport(d)} />
      <ShareModal open={shareOpen} url={shareUrl} onClose={() => setShareOpen(false)} />
      <Modal
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title={slotId ? 'Rename program' : 'Save program'}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setNameOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!nameText.trim()}
              onClick={() => {
                setNameOpen(false);
                saveTo(nameText.trim(), slotId && getSlot(slotId) ? slotId : undefined);
              }}
              data-testid="save-name-confirm"
            >
              Save
            </Button>
          </>
        }
      >
        <input
          autoFocus
          value={nameText}
          onChange={(e) => setNameText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && nameText.trim()) {
              setNameOpen(false);
              saveTo(nameText.trim(), slotId && getSlot(slotId) ? slotId : undefined);
            }
          }}
          placeholder="Program name, e.g. Blinking lamps"
          maxLength={80}
          className="h-10 w-full rounded-lg border border-edge bg-panel px-3 text-sm text-slate-100 outline-none focus:border-sky-500"
          aria-label="Program name"
          data-testid="save-name"
        />
      </Modal>
      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.title}
        size="sm"
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                const a = confirm?.action;
                setConfirm(null);
                a?.();
              }}
              data-testid="confirm-replace"
            >
              Replace program
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">{confirm?.body}</p>
      </Modal>
    </div>
  );
}
