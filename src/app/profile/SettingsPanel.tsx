/** Profile: settings (sound + volume, 3D quality, reduced motion) and the reset-progress danger zone. */
import { Box, Gauge, Settings2, Sparkles, TriangleAlert, Volume2, VolumeX, Wind } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { sfx } from '../../audio/sfx';
import { useGame } from '../../game/store';
import type { PlayerProfile } from '../../game/types';
import { Button, cn, Modal, toast } from '../../ui';
import { fmt, usePlayerSummary } from '../hud/player';
import { useUiPrefs } from '../hud/prefs';

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none',
        checked ? 'border-emerald-400/50 bg-emerald-500/80' : 'border-slate-600 bg-slate-800',
      )}
    >
      <span className={cn('inline-block h-4.5 w-4.5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-[3px]')} />
    </button>
  );
}

function Row({ icon, title, desc, children }: { icon: ReactNode; title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-3 text-slate-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold text-slate-100">{title}</div>
        {desc && <div className="mt-0.5 text-[12px] leading-snug text-slate-400">{desc}</div>}
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

const QUALITY: Array<{ id: PlayerProfile['settings']['quality']; label: string; hint: string }> = [
  { id: 'low', label: 'Low', hint: 'No shadows or post-processing, native resolution — best for older laptops.' },
  { id: 'medium', label: 'Medium', hint: 'Shadows (1024 maps) and bloom, up to 1.5× resolution.' },
  {
    id: 'high',
    label: 'High',
    hint: 'Ambient occlusion, sharper shadows (2048 maps), bloom and anti-aliasing, up to 2× resolution. Drops to Medium automatically if the frame rate suffers.',
  },
];

/** Segmented control with radio semantics: one tab stop, arrow keys move the selection. */
function QualityPicker({ value, onChange }: { value: PlayerProfile['settings']['quality']; onChange: (v: PlayerProfile['settings']['quality']) => void }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = Math.max(0, QUALITY.findIndex((x) => x.id === value));
  const move = (i: number): void => {
    const n = (i + QUALITY.length) % QUALITY.length;
    onChange(QUALITY[n]!.id);
    refs.current[n]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="3D quality"
      aria-describedby="quality-hint"
      className="mt-3 ml-11 grid grid-cols-3 rounded-lg border border-edge bg-panel p-0.5"
      onKeyDown={(e) => {
        const k = e.key;
        if (k === 'ArrowRight' || k === 'ArrowDown') move(index + 1);
        else if (k === 'ArrowLeft' || k === 'ArrowUp') move(index - 1);
        else if (k === 'Home') move(0);
        else if (k === 'End') move(QUALITY.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {QUALITY.map((opt, i) => {
        const checked = value === opt.id;
        return (
          <button
            key={opt.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(opt.id)}
            className={cn(
              'flex cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-[12.5px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none',
              checked ? 'bg-sky-500/20 text-sky-200 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.4)]' : 'text-slate-400 hover:text-slate-200',
            )}
          >
            {opt.id === 'low' ? <Gauge size={13} /> : opt.id === 'medium' ? <Box size={13} /> : <Sparkles size={13} />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function SettingsPanel() {
  const settings = useGame((s) => s.profile.settings);
  const setSettings = useGame((s) => s.setSettings);
  const volume = useUiPrefs((s) => s.volume);
  const setVolume = useUiPrefs((s) => s.setVolume);
  const q = QUALITY.find((x) => x.id === settings.quality) ?? QUALITY[2]!;

  return (
    <section className="rounded-2xl border border-edge bg-panel-2/80 p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-white">
        <Settings2 size={17} className="text-slate-300" /> Settings
      </h2>
      <div className="mt-1 divide-y divide-edge">
        <div>
        <Row icon={settings.sound ? <Volume2 size={16} /> : <VolumeX size={16} />} title="Sound effects" desc="Clicks, contactors, motors and fanfares — all synthesized.">
          <Switch
            label="Sound effects"
            checked={settings.sound}
            onChange={(v) => {
              setSettings({ sound: v });
              sfx.setEnabled(v);
              if (v) sfx.play('toggle');
            }}
          />
        </Row>
        <div className={cn('flex items-center gap-3 pb-3.5 pl-11 transition-opacity', !settings.sound && 'pointer-events-none opacity-40')}>
          <VolumeX size={14} className="shrink-0 text-slate-500" />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(volume * 100)}
            aria-label="Volume"
            disabled={!settings.sound}
            onChange={(e) => setVolume(Number(e.target.value) / 100)}
            onPointerUp={() => sfx.play('beep')}
            onKeyUp={() => sfx.play('beep')}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-emerald-500"
          />
          <Volume2 size={14} className="shrink-0 text-slate-500" />
          <span className="w-9 text-right font-mono text-[11.5px] text-slate-400">{Math.round(volume * 100)}%</span>
        </div>

        </div>

        <div className="py-3.5">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-panel-3 text-slate-300">
              <Box size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-slate-100">3D quality</div>
              <div id="quality-hint" className="mt-0.5 text-[12px] leading-snug text-slate-400">
                {q.hint}
              </div>
            </div>
          </div>
          <QualityPicker
            value={settings.quality}
            onChange={(v) => {
              if (v === settings.quality) return;
              setSettings({ quality: v });
              sfx.play('click');
            }}
          />
        </div>

        <Row icon={<Wind size={16} />} title="Reduced motion" desc="Calms pulsing nodes, camera sway and celebrations.">
          <Switch label="Reduced motion" checked={settings.reducedMotion} onChange={(v) => setSettings({ reducedMotion: v })} />
        </Row>
      </div>
    </section>
  );
}

export function DangerZone() {
  const [open, setOpen] = useState(false);
  const reset = useGame((s) => s.resetProgress);
  const p = usePlayerSummary();
  return (
    <section className="rounded-2xl border border-red-500/25 bg-red-500/[0.04] p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-red-200">
        <TriangleAlert size={17} className="text-red-400" /> Danger zone
      </h2>
      <p className="mt-2 text-[12.5px] leading-relaxed text-slate-400">Wipe missions, stars, XP, achievements, streak and stats. Your name and settings are kept. This cannot be undone.</p>
      <Button variant="danger" size="sm" className="mt-3" onClick={() => setOpen(true)}>
        Reset progress…
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            <TriangleAlert size={18} className="text-red-400" /> Reset all progress?
          </span>
        }
        footer={
          <>
            <Button variant="ghost" data-autofocus onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                reset();
                setOpen(false);
                sfx.play('fault');
                toast({ tone: 'warning', title: 'Progress reset', body: 'Fresh hard hat, fresh start. Mission 1-1 is waiting.' });
              }}
            >
              Yes, reset everything
            </Button>
          </>
        }
      >
        <p className="text-[13.5px] leading-relaxed text-slate-300">You will lose:</p>
        <ul className="mt-2 space-y-1 text-[13px] text-slate-400">
          <li>
            • <span className="font-mono text-white">{p.missionsDone}</span> completed {p.missionsDone === 1 ? 'mission' : 'missions'} and <span className="font-mono text-white">{p.stars}</span> {p.stars === 1 ? 'star' : 'stars'}
          </li>
          <li>
            • <span className="font-mono text-white">{fmt(p.xp)}</span> XP (level {p.level.level}, {p.level.title})
          </li>
          <li>
            • <span className="font-mono text-white">{p.achievements}</span> {p.achievements === 1 ? 'achievement' : 'achievements'} and your <span className="font-mono text-white">{p.streak.days}</span>-day streak
          </li>
          <li>• Saved programs in every mission</li>
        </ul>
      </Modal>
    </section>
  );
}
