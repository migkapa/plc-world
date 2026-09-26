/**
 * Device-highlight sources in the workspace DOM: I/O alias chips inside briefing Markdown, hover handlers for rows
 * (I/O table, objectives). Hovering / focusing highlights the physical device in the 3D view (pulsing outline, see
 * src/sim/scenes/overlay.ts); clicking — or Enter on a focused chip — flies the camera to it.
 *
 *   <AliasChipScope io={scene.io}> …<Markdown source={mission.briefing} />… </AliasChipScope>
 */
import { useCallback, useEffect, useMemo, useRef, type FocusEvent, type LiHTMLAttributes, type ReactNode } from 'react';
import { useSceneOverlay } from '../../../sim/scenes/overlay';
import type { IoPointDef } from '../../../sim/types';
import { cn, MarkdownCodeContext } from '../../../ui';
import { splitCode } from './aliases';

let seq = 0;

/**
 * Pointer + keyboard handlers that highlight `aliases` while the element is hovered or focused (and stop when it
 * unmounts). Spread them on the element: `<tr {...useHighlightHandlers(['Light_0'])}>`.
 */
export function useHighlightHandlers(aliases: ReadonlyArray<string>, kind = 'row') {
  const source = useMemo(() => `${kind}:${++seq}`, [kind]);
  const ref = useRef(aliases);
  ref.current = aliases;
  useEffect(() => () => useSceneOverlay.getState().clearHighlight(source), [source]);
  const on = useCallback(() => {
    if (ref.current.length > 0) useSceneOverlay.getState().setHighlight(ref.current, source);
  }, [source]);
  const off = useCallback(() => useSceneOverlay.getState().clearHighlight(source), [source]);
  return useMemo(
    () => ({
      onPointerEnter: on,
      onPointerLeave: off,
      // focus on the element or inside it (a row's chip / button) highlights it for keyboard players
      onFocus: on,
      onBlur: (e: FocusEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) off();
      },
    }),
    [on, off],
  );
}

/** One interactive tag inside a code span: hover / focus highlights its device, click shows it. */
export function AliasChip({ alias, children, className }: { alias: string; children: ReactNode; className?: string }) {
  const h = useHighlightHandlers([alias], 'chip');
  return (
    <button
      type="button"
      {...h}
      onClick={(e) => {
        e.stopPropagation();
        useSceneOverlay.getState().showDevice(alias);
      }}
      className={cn(
        'cursor-pointer rounded-[3px] border-b border-dashed border-cyan-400/60 font-[inherit] text-[inherit] transition-colors hover:border-solid hover:border-cyan-300 hover:bg-cyan-400/15 hover:text-cyan-100 focus-visible:bg-cyan-400/15 focus-visible:outline-1 focus-visible:outline-cyan-300',
        className,
      )}
      title={`${alias}: hover to find it in the 3D view · click to show it`}
      data-alias-chip={alias}
    >
      {children}
    </button>
  );
}

/** A Markdown code span whose I/O tags are alias chips. */
function CodeWithChips({ parts }: { parts: ReturnType<typeof splitCode> }) {
  return (
    <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[0.85em] text-emerald-300">
      {parts.map((p, i) => (p.alias ? <AliasChip key={i} alias={p.alias}>{p.text}</AliasChip> : <span key={i}>{p.text}</span>))}
    </code>
  );
}

/** Turns the I/O tags in every Markdown code span below it into alias chips (tags of `io`). */
export function AliasChipScope({ io, children }: { io: ReadonlyArray<IoPointDef>; children: ReactNode }) {
  const render = useCallback(
    (code: string): ReactNode => {
      const parts = splitCode(code, io);
      if (!parts.some((p) => p.alias)) return null;
      return <CodeWithChips parts={parts} />;
    },
    [io],
  );
  return <MarkdownCodeContext.Provider value={render}>{children}</MarkdownCodeContext.Provider>;
}

/** A list item that highlights the devices of `aliases` while hovered or focused within (e.g. an objective). */
export function HighlightLi({ aliases, className, children, ...rest }: { aliases: ReadonlyArray<string>; className?: string; children: ReactNode } & Omit<LiHTMLAttributes<HTMLLIElement>, 'className' | 'children'>) {
  const h = useHighlightHandlers(aliases, 'item');
  const has = aliases.length > 0;
  return (
    <li {...rest} {...(has ? h : {})} className={cn(className, has && '-mx-1.5 rounded-md px-1.5 transition-colors hover:bg-cyan-400/[0.06]')} data-aliases={has ? aliases.join(' ') : undefined}>
      {children}
    </li>
  );
}
