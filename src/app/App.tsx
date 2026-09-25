import { lazy, Suspense } from 'react';
import { Route, Router, Switch } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { Toaster } from '../ui';
import { GameListeners } from './hud/GameListeners';
import { PlayerHud } from './hud/PlayerHud';
import { RouteErrorBoundary } from './RouteErrorBoundary';
import { TopNav } from './TopNav';

const HomePage = lazy(() => import('./pages/HomePage'));
const CampaignPage = lazy(() => import('./pages/CampaignPage'));
const MissionPage = lazy(() => import('./pages/MissionPage'));
const SandboxPage = lazy(() => import('./pages/SandboxPage'));
const ShowroomPage = lazy(() => import('./pages/ShowroomPage'));
const ReferencePage = lazy(() => import('./pages/ReferencePage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-ab-red" />
    </div>
  );
}

export default function App() {
  return (
    <Router hook={useHashLocation}>
      <div className="flex h-full flex-col">
        <TopNav right={<PlayerHud />} />
        <main className="relative min-h-0 flex-1">
          <RouteErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Switch>
              <Route path="/" component={HomePage} />
              <Route path="/campaign" component={CampaignPage} />
              <Route path="/mission/:id" component={MissionPage} />
              <Route path="/sandbox/:sceneId?" component={SandboxPage} />
              <Route path="/showroom/:device?" component={ShowroomPage} />
              <Route path="/reference/:mnemonic?" component={ReferencePage} />
              <Route path="/profile" component={ProfilePage} />
              <Route component={NotFoundPage} />
            </Switch>
          </Suspense>
          </RouteErrorBoundary>
        </main>
        <Toaster />
        <GameListeners />
      </div>
    </Router>
  );
}
