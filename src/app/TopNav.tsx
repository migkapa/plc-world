import { BookOpen, Box, Cpu, FlaskConical, Map, Volume2, VolumeX } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { sfx } from '../audio/sfx';
import { useGame } from '../game/store';
import { cn } from '../ui';
import { routes } from './routes';

function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const [loc] = useLocation();
  const active = href === '/' ? loc === '/' : loc.startsWith(href) || (href === routes.campaign && loc.startsWith('/mission'));
  return (
    <Link
      href={href}
      aria-label={typeof children === 'string' ? children : undefined}
      className={cn(
        'relative flex h-9 shrink-0 items-center gap-2 rounded-lg px-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none sm:px-2.5 md:px-3',
        active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
      )}
    >
      {icon}
      <span className="hidden md:inline">{children}</span>
      {active && <span className="absolute inset-x-2 -bottom-[7px] h-0.5 rounded-full bg-ab-red sm:inset-x-2.5 md:inset-x-3" />}
    </Link>
  );
}

/** Global top navigation bar. `right` is filled by the player HUD (XP, rank). */
export function TopNav({ right }: { right?: ReactNode }) {
  const sound = useGame((s) => s.profile.settings.sound);
  const setSettings = useGame((s) => s.setSettings);
  return (
    <nav className="relative z-30 flex h-12 shrink-0 items-center gap-0.5 border-b border-edge bg-panel/95 px-2 backdrop-blur sm:gap-1 sm:px-3">
      <Link href={routes.home} className="mr-1 flex shrink-0 items-center gap-2 sm:mr-3" aria-label="PLC World home">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-ab-red to-red-800 shadow-lg shadow-red-900/40">
          <Cpu size={16} className="text-white" />
        </span>
        <span className="hidden text-[15px] font-bold tracking-tight min-[400px]:inline">
          PLC<span className="text-ab-red">World</span>
        </span>
      </Link>
      <NavLink href={routes.campaign} icon={<Map size={16} />}>
        Campaign
      </NavLink>
      <NavLink href={routes.sandbox()} icon={<FlaskConical size={16} />}>
        Sandbox
      </NavLink>
      <NavLink href={routes.showroom()} icon={<Box size={16} />}>
        Showroom
      </NavLink>
      <NavLink href={routes.reference()} icon={<BookOpen size={16} />}>
        Instructions
      </NavLink>
      <div className="min-w-0 flex-1" />
      {right}
      <button
        type="button"
        aria-label={sound ? 'Mute sounds' : 'Enable sounds'}
        title={sound ? 'Mute sounds' : 'Enable sounds'}
        className="flex h-9 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:outline-none sm:w-9"
        onClick={() => {
          const next = !sound;
          setSettings({ sound: next });
          sfx.setEnabled(next);
          if (next) sfx.play('click');
        }}
      >
        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
    </nav>
  );
}
