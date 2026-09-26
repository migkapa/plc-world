/** Home footer: quick links + trademark disclaimer. */
import { Cpu } from 'lucide-react';
import { Link } from 'wouter';
import { routes } from '../routes';

export function HomeFooter() {
  const links: Array<[string, string]> = [
    ['Campaign', routes.campaign],
    ['Sandbox', routes.sandbox()],
    ['Showroom', routes.showroom()],
    ['Instructions', routes.reference()],
    ['Profile', routes.profile],
  ];
  return (
    <footer className="border-t border-edge bg-panel/60">
      <div className="mx-auto flex max-w-[1280px] flex-col gap-6 px-5 py-8 sm:px-8 md:flex-row md:items-start md:justify-between">
        <div className="max-w-md">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-ab-red to-red-800">
              <Cpu size={13} className="text-white" />
            </span>
            <span className="text-[14px] font-bold tracking-tight">
              PLC<span className="text-ab-red">World</span>
            </span>
          </div>
          <p className="mt-3 text-[12.5px] leading-relaxed text-slate-400">
            A learning game: a Logix 5000-style controller, ladder editor and 3D training plants running entirely in your browser. Your progress is stored locally on this device.
          </p>
        </div>
        <nav className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
          {links.map(([label, href]) => (
            <Link key={href} href={href} className="text-slate-400 hover:text-white">
              {label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="border-t border-edge/70">
        <p className="mx-auto max-w-[1280px] px-5 py-4 text-[11.5px] leading-relaxed text-slate-400 sm:px-8">
          Not affiliated with Rockwell Automation. Allen-Bradley, ControlLogix, CompactLogix, Studio 5000, PowerFlex and PanelView are trademarks of Rockwell Automation.
        </p>
      </div>
    </footer>
  );
}
