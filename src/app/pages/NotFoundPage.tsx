/** Unknown route: say so, and offer the ways back. */
import { BookOpen, Home, Map as MapIcon, TriangleAlert } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { routes } from '../routes';
import { useDocumentTitle } from '../useDocumentTitle';

export default function NotFoundPage() {
  const [location] = useLocation();
  useDocumentTitle('Page not found');
  const link = 'inline-flex items-center gap-1.5 rounded-lg border border-edge bg-panel-2 px-3 py-2 text-sm font-semibold text-slate-200 hover:border-slate-500 hover:text-white';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-slate-400" data-testid="not-found">
      <TriangleAlert size={36} className="text-amber-400" />
      <h1 className="text-xl font-semibold text-slate-100">Page not found</h1>
      <p className="max-w-md text-sm">
        There is nothing at <span className="font-mono text-slate-300">#{location}</span>. The link may be old or mistyped.
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <Link href={routes.home} className={link}>
          <Home size={15} /> Home
        </Link>
        <Link href={routes.campaign} className={link}>
          <MapIcon size={15} /> Campaign
        </Link>
        <Link href={routes.reference()} className={link}>
          <BookOpen size={15} /> Instruction reference
        </Link>
      </div>
    </div>
  );
}
