/**
 * Profile (/profile): rank insignia, editable name, level & XP, stats, achievements, settings, reset.
 */
import { AchievementsGrid } from '../profile/AchievementsGrid';
import { ProfileHero } from '../profile/ProfileHero';
import { DangerZone, SettingsPanel } from '../profile/SettingsPanel';
import { StatsPanel } from '../profile/StatsPanel';

export default function ProfilePage() {
  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-[#0b0f14]">
      <ProfileHero />
      <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-5 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <StatsPanel />
        </div>
        <aside className="space-y-5 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <SettingsPanel />
          <DangerZone />
        </aside>
        <div className="min-w-0 lg:col-start-1 lg:row-start-2">
          <AchievementsGrid />
        </div>
      </div>
    </div>
  );
}
