import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppStateProvider } from './state/AppState';
import { Layout } from './components/Layout';
import { Loading } from './components/ui';
import { ErrorBoundary } from './components/ErrorBoundary';

// Each page is its own chunk, so the first screen loads only what it needs.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Explore = lazy(() => import('./pages/Explore'));
const World = lazy(() => import('./pages/World'));
const Outlook = lazy(() => import('./pages/Outlook'));
const Reports = lazy(() => import('./pages/Reports'));
const Method = lazy(() => import('./pages/Method'));
const Integrate = lazy(() => import('./pages/Integrate'));
const Embed = lazy(() => import('./pages/Embed'));

const TITLES: Record<string, string> = {
  dashboard: 'Dashboard', explore: 'Explore', global: 'World', outlook: 'Outlook', reports: 'Reports', method: 'Method', integrate: 'Integrate',
};
function TitleAndScroll() {
  const { pathname } = useLocation();
  useEffect(() => {
    const key = pathname.split('/')[1] || 'dashboard';
    document.title = `${TITLES[key] || 'Dashboard'} · Fire Calendar`;
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <HashRouter>
      <AppStateProvider>
        <Routes>
          {/* Embeddable widget: no app chrome */}
          <Route path="/embed" element={<Suspense fallback={<Loading />}><Embed /></Suspense>} />
          <Route path="*" element={
            <Layout>
              <TitleAndScroll />
              <ErrorBoundary>
              <Suspense fallback={<Loading />}>
                <Routes>
                  <Route path="/" element={<Navigate to="/dashboard" replace />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/explore" element={<Explore />} />
                  <Route path="/global" element={<World />} />
                  <Route path="/outlook" element={<Outlook />} />
                  <Route path="/reports" element={<Reports />} />
                  <Route path="/method" element={<Method />} />
                  <Route path="/integrate" element={<Integrate />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
            </Layout>
          } />
        </Routes>
      </AppStateProvider>
    </HashRouter>
  );
}
