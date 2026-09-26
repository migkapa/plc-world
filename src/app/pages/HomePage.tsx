/**
 * Home (/): live 3D hero, player summary, "how it works", chapter carousel and the trademark footer.
 */
import { ChapterCarousel } from '../home/ChapterCarousel';
import { FeatureCards } from '../home/FeatureCards';
import { HomeFooter } from '../home/HomeFooter';
import { HomeHero } from '../home/HomeHero';
import { PlayerStrip } from '../home/PlayerStrip';
import { useDocumentTitle } from '../useDocumentTitle';

export default function HomePage() {
  useDocumentTitle();
  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[#0b0f14]">
      <HomeHero />
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <div className="relative z-10 -mt-6 sm:-mt-8">
          <PlayerStrip />
        </div>

        <section className="pt-16 sm:pt-20">
          <div className="mb-6 max-w-2xl">
            <div className="font-mono text-[11px] font-bold tracking-[0.2em] text-ab-red uppercase">How it works</div>
            <h2 className="mt-1 text-[24px] font-bold tracking-tight text-white sm:text-[28px]">A real controls job, minus the downtime</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-slate-400">
              Read the briefing, write the rungs, download to the controller and test against the plant. The same engine runs the 3D twin and grades your work.
            </p>
          </div>
          <FeatureCards />
        </section>

        <section className="pt-16 pb-16 sm:pt-20 sm:pb-20">
          <ChapterCarousel />
        </section>
      </div>
      <HomeFooter />
    </div>
  );
}
