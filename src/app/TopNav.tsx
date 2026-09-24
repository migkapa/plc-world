import { BookOpen, Box, Cpu, FlaskConical, Map, Volume2, VolumeX } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { sfx } from '../audio/sfx';
import { cn } from '../ui';
import { routes } from './routes';

function NavLink({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  const [loc] = useLocation();
  const active = href === '/' ? loc === '/' : loc.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        'flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
        active ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
      )}
    >
      {icon}
      <span className="hidden md:inline">{children}</span>
    </Link>
  );
}

/** Global top navigation bar. `right` is filled by the player HUD (XP, rank). */
export function TopNav({ right }: { right?: ReactNode }) {
  const [sound, setSound] = useState(sfx.isEnabled());
  return (
    <nav className="flex h-12 shrink-0 items-center gap-1 border-b border-edge bg-panel/95 px-3 backdrop-blur">
      <Link href={routes.home} className="mr-3 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-ab-red to-red-800 shadow-lg shadow-red-900/40">
          <Cpu size={16} className="text-white" />
        </span>
        <span className="text-[15px] font-bold tracking-tight">
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
      <div className="flex-1" />
      {right}
      <button
        type="button"
        aria-label={sound ? 'Mute sounds' : 'Enable sounds'}
        title={sound ? 'Mute sounds' : 'Enable sounds'}
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg text-slate-400 hover:bg-white/5 hover:text-white"
        onClick={() => {
          sfx.setEnabled(!sound);
          setSound(!sound);
          if (!sound) sfx.play('click');
        }}
      >
        {sound ? <Volume2 size={16} /> : <VolumeX size={16} />}
      </button>
    </nav>
  );
}
