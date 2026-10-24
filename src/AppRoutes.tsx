import React, { Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AccessDenied, RequireRole } from '@aicoe/aihub-platform/auth';
import { AppShell, pathMatches } from '@aicoe/aihub-platform/shell';
import type { UseCaseManifest, UseCaseRoute } from './usecases/base';
import { leaveApp } from './leaveApp';

/**
 * This app's routes, mounted exactly as the hub mounts the same vertical today
 * (the hub's router.tsx, `UseCaseShell`), so the page renders identically
 * before and after the split.
 *
 * There is deliberately NO router `basename`. The manifest's routes
 * (`naas/agents/:agentId`), its sidebar entries (`/sales/tracker`) and the
 * vertical's own links (`<Link to="/naas">`, `navigate('/sales/tracker')`) are
 * all written as paths on the shared host, because that is what they are in
 * the hub. A basename of `/<slug>` would prefix every one of them a second
 * time (`/naas/naas`). The load balancer only ever sends `/<slug>/*` here, so
 * host paths and router paths are the same thing.
 *
 * Two consequences handled below:
 *
 *   `/denied`  RequireRole redirects to the absolute `/denied`, which on this
 *              host belongs to the hub. It is forwarded to `/<slug>/denied` so
 *              the page stays in this app (and survives a reload here).
 *   other      A client-side navigation out of `/<slug>` (e.g. a vertical's
 *              "back" calling `navigate('/')`) cannot be rendered by this app,
 *              so it becomes a full-page load that the load balancer routes
 *              to whichever app owns that path.
 */

/** The route's component is its own chunk; nothing loads until it is hit. */
const LazyRoute: React.FC<{ route: UseCaseRoute }> = ({ route }) => {
  const Component = route.component;
  // `null` matches RequireRole, which also renders nothing rather than
  // flashing a spinner between the session probe and the first paint.
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
};

/** Keeps RequireRole's `state.service` so the page can name what was refused. */
const DeniedRedirect: React.FC<{ basePath: string }> = ({ basePath }) => {
  const location = useLocation();
  return <Navigate to={`${basePath}/denied`} replace state={location.state} />;
};

/** No route matched: back to the app root, or out to the app that owns the path. */
const Unmatched: React.FC<{ basePath: string }> = ({ basePath }) => {
  const { pathname, search, hash } = useLocation();
  const inside = pathMatches(pathname, basePath, false);

  useEffect(() => {
    if (!inside) leaveApp(`${pathname}${search}${hash}`);
  }, [inside, pathname, search, hash]);

  return inside ? <Navigate to={basePath} replace /> : null;
};

export const AppRoutes: React.FC<{ useCase: UseCaseManifest }> = ({ useCase }) => {
  const basePath = `/${useCase.slug}`;
  return (
    <Routes>
      <Route
        element={
          <AppShell
            appSlug={useCase.slug}
            basePath={basePath}
            appLabel={useCase.hub?.name ?? useCase.slug}
            navItems={useCase.nav ?? []}
          />
        }
      >
        <Route element={<RequireRole anyOf={useCase.roles} service={useCase.slug} />}>
          {useCase.routes.map((route) =>
            route.roles ? (
              // A surface more privileged than the rest of the vertical, e.g.
              // the NaaS admin panel. Apigee gates the matching API the same
              // way, so without this nesting a non-admin typing the URL would
              // load the panel and then see every request 403.
              <Route
                key={route.path}
                element={
                  <RequireRole anyOf={route.roles} service={route.deniedAs ?? useCase.slug} />
                }
              >
                <Route path={route.path} element={<LazyRoute route={route} />} />
              </Route>
            ) : (
              <Route key={route.path} path={route.path} element={<LazyRoute route={route} />} />
            ),
          )}
        </Route>

        <Route path={`${basePath}/denied`} element={<AccessDenied />} />
      </Route>

      <Route path="/denied" element={<DeniedRedirect basePath={basePath} />} />
      <Route path="*" element={<Unmatched basePath={basePath} />} />
    </Routes>
  );
};
