/**
 * Workspace layout. Desktop (≥ 1024 px): resizable panels — left dock | center (3D twin over the
 * ladder) | right dock. The first layout depends on the window height (short laptop screens give the
 * ladder most of the center column); once the player drags a separator, that layout is remembered
 * (localStorage). Smaller screens: one panel at a time behind a tab strip (Twin / Ladder / Brief / Tests).
 */
import { useState, type ReactNode } from 'react';
import { Group, Panel, Separator, useDefaultLayout } from 'react-resizable-panels';
import { cn, Tabs, type TabDef } from '../../ui';
import { useMediaQuery } from './hooks';

export interface WorkspaceLayoutProps {
  /** Layout persistence id (e.g. 'mission', 'sandbox'). */
  id: string;
  left: ReactNode;
  twin: ReactNode;
  ladder: ReactNode;
  right?: ReactNode;
  /** Small screens: the tabs and what each shows. */
  mobileTabs: TabDef<string>[];
  renderMobile(tab: string): ReactNode;
  mobileTab?: string;
  onMobileTab?(tab: string): void;
  className?: string;
}

function storage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const ls = globalThis.localStorage;
    if (ls) return ls;
  } catch {
    // ignore
  }
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

function HSeparator() {
  return (
    <Separator className="group relative w-1.5 shrink-0 bg-panel outline-none data-[separator=active]:bg-sky-500/40 data-[separator=hover]:bg-sky-500/25">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-edge group-data-[separator=hover]:bg-sky-400/60" />
    </Separator>
  );
}

function VSeparator() {
  return (
    <Separator className="group relative h-1.5 shrink-0 bg-panel outline-none data-[separator=active]:bg-sky-500/40 data-[separator=hover]:bg-sky-500/25">
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-edge group-data-[separator=hover]:bg-sky-400/60" />
    </Separator>
  );
}

/** Share of the center column given to the 3D twin before the player resizes it (the rest is the ladder). */
export function defaultTwinShare(viewportHeight: number): number {
  if (viewportHeight < 900) return 38;
  if (viewportHeight < 1100) return 43;
  return 48;
}

function DesktopLayout({ id, left, twin, ladder, right }: Pick<WorkspaceLayoutProps, 'id' | 'left' | 'twin' | 'ladder' | 'right'>) {
  const store = storage();
  const hIds = right ? ['left', 'center', 'right'] : ['left', 'center'];
  // v2 keys: only layouts the player made by dragging are stored (v1 also stored the mount layout)
  const h = useDefaultLayout({ id: `plcw-${id}-v2-h${right ? '3' : '2'}`, panelIds: hIds, storage: store, onlySaveAfterUserInteractions: true });
  const v = useDefaultLayout({ id: `plcw-${id}-v2-v`, panelIds: ['twin', 'ladder'], storage: store, onlySaveAfterUserInteractions: true });
  const [twinShare] = useState(() => defaultTwinShare(typeof window !== 'undefined' ? window.innerHeight : 1000));
  return (
    <Group orientation="horizontal" className="h-full min-h-0 w-full" defaultLayout={h.defaultLayout} onLayoutChanged={h.onLayoutChanged}>
      <Panel id="left" defaultSize={right ? '23%' : '26%'} minSize={220} collapsible collapsedSize={0} className="min-w-0">
        <div className="h-full min-h-0 overflow-hidden">{left}</div>
      </Panel>
      <HSeparator />
      <Panel id="center" defaultSize={right ? '53%' : '74%'} minSize={360} className="min-w-0">
        <Group orientation="vertical" className="h-full min-h-0" defaultLayout={v.defaultLayout} onLayoutChanged={v.onLayoutChanged}>
          <Panel id="twin" defaultSize={`${twinShare}%`} minSize={120} collapsible collapsedSize={0}>
            <div className="h-full min-h-0 overflow-hidden">{twin}</div>
          </Panel>
          <VSeparator />
          <Panel id="ladder" defaultSize={`${100 - twinShare}%`} minSize={160}>
            <div className="h-full min-h-0 overflow-hidden">{ladder}</div>
          </Panel>
        </Group>
      </Panel>
      {right && (
        <>
          <HSeparator />
          <Panel id="right" defaultSize="24%" minSize={240} collapsible collapsedSize={0} className="min-w-0">
            <div className="h-full min-h-0 overflow-hidden">{right}</div>
          </Panel>
        </>
      )}
    </Group>
  );
}

export function WorkspaceLayout(props: WorkspaceLayoutProps) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [tabState, setTabState] = useState(props.mobileTabs[0]?.id ?? 'twin');
  const tab = props.mobileTab ?? tabState;
  const setTab = (t: string): void => {
    setTabState(t);
    props.onMobileTab?.(t);
  };
  if (desktop) {
    return (
      <div className={cn('h-full min-h-0', props.className)}>
        <DesktopLayout id={props.id} left={props.left} twin={props.twin} ladder={props.ladder} {...(props.right ? { right: props.right } : {})} />
      </div>
    );
  }
  return (
    <div className={cn('flex h-full min-h-0 flex-col', props.className)}>
      <Tabs tabs={props.mobileTabs} value={tab} onChange={setTab} className="shrink-0 bg-panel" />
      <div className="relative min-h-0 flex-1">{props.renderMobile(tab)}</div>
    </div>
  );
}
