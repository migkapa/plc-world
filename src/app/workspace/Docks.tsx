/**
 * Left-dock content shared by the Mission and Sandbox pages: the controller organizer and the tag
 * monitor, bound to the workspace controller, plus the dock's tab strip.
 */
import { BookOpenText, FolderTree, Tags as TagsIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { ControllerOrganizer, TagMonitor, type LadderEditorHandle, type OrganizerNode, type OrganizerSelection } from '../../editor';
import type { PlcController } from '../../plc/types';
import { MAIN_PROGRAM, MAIN_ROUTINE } from '../../sim/project';
import { Tabs, cn, toast } from '../../ui';
import { useControllerTick } from './hooks';

export type DockTab = 'brief' | 'organizer' | 'tags';

/** Organizer marker set for "MainRoutine has verification errors". */
export const PENDING_ROUTINES: ReadonlySet<string> = new Set([`${MAIN_PROGRAM}/${MAIN_ROUTINE}`]);

export function OrganizerPane({
  controller,
  errorRoutines,
  onOpenTags,
  editorRef,
}: {
  controller: PlcController;
  errorRoutines?: ReadonlySet<string>;
  onOpenTags(scope: string): void;
  editorRef?: { current: LadderEditorHandle | null };
}) {
  useControllerTick(controller);
  const [sel, setSel] = useState<OrganizerSelection>({ kind: 'routine', program: MAIN_PROGRAM, routine: MAIN_ROUTINE });
  const onSelect = (n: OrganizerNode): void => {
    setSel({ id: n.id });
    if (n.kind === 'controllerTags') onOpenTags('controller');
    else if (n.kind === 'programTags' && n.program) onOpenTags(n.program);
    else if (n.kind === 'routine') {
      if (n.routine && n.routine.toLowerCase() !== MAIN_ROUTINE.toLowerCase()) {
        toast({ tone: 'info', title: n.label, body: 'Only MainRoutine is edited in this workspace.' });
      } else editorRef?.current?.focus();
    } else if (n.kind === 'module') toast({ tone: 'info', title: n.label, body: 'Look at the rack in the 3D view: module status LEDs follow the live I/O.' });
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ControllerOrganizer project={controller.project} selected={sel} onSelect={onSelect} {...(errorRoutines ? { errorRoutines } : {})} className="min-h-0 flex-1" />
    </div>
  );
}

export function TagsPane({ controller, scope, onTagsChanged }: { controller: PlcController; scope: string; onTagsChanged(): void }) {
  return <TagMonitor key={scope} controller={controller} initialScope={scope} onTagsChanged={onTagsChanged} className="h-full min-h-0" />;
}

/** Tabbed left dock: first tab (briefing / plant info) + Organizer + Tags. */
export function LeftDock({
  first,
  firstLabel,
  controller,
  errorRoutines,
  onTagsChanged,
  editorRef,
  tab,
  onTab,
  className,
}: {
  first: ReactNode;
  firstLabel: string;
  controller: PlcController;
  errorRoutines?: ReadonlySet<string>;
  onTagsChanged(): void;
  editorRef?: { current: LadderEditorHandle | null };
  tab?: DockTab;
  onTab?(t: DockTab): void;
  className?: string;
}) {
  const [own, setOwn] = useState<DockTab>('brief');
  const [scope, setScope] = useState('controller');
  const current = tab ?? own;
  const set = (t: DockTab): void => {
    setOwn(t);
    onTab?.(t);
  };
  return (
    <div className={cn('flex h-full min-h-0 flex-col bg-panel', className)}>
      <Tabs
        tabs={[
          { id: 'brief', label: firstLabel, icon: <BookOpenText size={13} /> },
          { id: 'organizer', label: 'Organizer', icon: <FolderTree size={13} /> },
          { id: 'tags', label: 'Tags', icon: <TagsIcon size={13} /> },
        ]}
        value={current}
        onChange={(t) => set(t as DockTab)}
        className="shrink-0"
      />
      <div className="min-h-0 flex-1">
        {current === 'brief' && <div className="h-full overflow-y-auto">{first}</div>}
        {current === 'organizer' && (
          <OrganizerPane
            controller={controller}
            {...(errorRoutines ? { errorRoutines } : {})}
            {...(editorRef ? { editorRef } : {})}
            onOpenTags={(s) => {
              setScope(s);
              set('tags');
            }}
          />
        )}
        {current === 'tags' && <TagsPane controller={controller} scope={scope} onTagsChanged={onTagsChanged} />}
      </div>
    </div>
  );
}
