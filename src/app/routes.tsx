import React, { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AccessDenied, RequireRole } from '@aicoe/aihub-platform/auth';
import { AppShell, pathMatches } from '@aicoe/aihub-platform/shell';
import { ADMIN_DENIED_AS, appConfig, BASE_PATH, ROLE_NAAS_ADMIN } from './config';
import { leaveApp } from './leaveApp';

/**
 * This app's routes.
 *
 * There is deliberately NO router `basename`. The routes (`naas/agents/:agentId`),
 * the sidebar entries and the app's own links (`<Link to="/naas">`,
 * `<Link to="/naas/admin">`) are all written as paths on the shared host. A
 * basename of `/naas` would prefix every one of them a second time
 * (`/naas/naas`). The load balancer only ever sends `/naas/*` here, so host
 * paths and router paths are the same thing.
 *
 * Two consequences handled below:
 *
 *   `/denied`  RequireRole redirects to the absolute `/denied`, which on this
 *              host belongs to the hub. It is forwarded to `/naas/denied` so
 *              the page stays in this app (and survives a reload here).
 *   other      A client-side navigation out of `/naas` (e.g. a "back" calling
 *              `navigate('/')`) cannot be rendered by this app, so it becomes a
 *              full-page load that the load balancer routes to whichever app
 *              owns that path.
 */

// Each page is its own chunk; nothing loads until its route is hit.
const ChatPage = lazy(() => import('../pages/ChatPage'));
const AgentPage = lazy(() => import('../pages/AgentPage'));
const AdminPage = lazy(() => import('../pages/AdminPage'));

/**
 * `null` matches RequireRole, which also renders nothing rather than flashing
 * a spinner between the session probe and the first paint.
 */
const Lazy: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Suspense fallback={null}>{children}</Suspense>
);

/** Keeps RequireRole's `state.service` so the page can name what was refused. */
const DeniedRedirect: React.FC = () => {
  const location = useLocation();
  return <Navigate to={`${BASE_PATH}/denied`} replace state={location.state} />;
};

/** No route matched: back to the app root, or out to the app that owns the path. */
const Unmatched: React.FC = () => {
  const { pathname, search, hash } = useLocation();
  const inside = pathMatches(pathname, BASE_PATH, false);

  useEffect(() => {
    if (!inside) leaveApp(`${pathname}${search}${hash}`);
  }, [inside, pathname, search, hash]);

  return inside ? <Navigate to={BASE_PATH} replace /> : null;
};

export const AppRoutes: React.FC = () => (
  <Routes>
    <Route
      element={
        <AppShell
          appSlug={appConfig.slug}
          basePath={BASE_PATH}
          appLabel={appConfig.hub.name}
          navItems={appConfig.nav}
        />
      }
    >
      <Route element={<RequireRole anyOf={appConfig.roles} service={appConfig.slug} />}>
        <Route
          path="naas"
          element={
            <Lazy>
              <ChatPage />
            </Lazy>
          }
        />
        <Route
          path="naas/agents/:agentId"
          element={
            <Lazy>
              <AgentPage />
            </Lazy>
          }
        />
        {/*
         * The admin panel is more privileged than the rest of the app. Apigee
         * gates /naas/v1/admin/** the same way, so without this nesting a
         * non-admin typing the URL would load the panel and then see every
         * request 403.
         */}
        <Route element={<RequireRole anyOf={ROLE_NAAS_ADMIN} service={ADMIN_DENIED_AS} />}>
          <Route
            path="naas/admin"
            element={
              <Lazy>
                <AdminPage />
              </Lazy>
            }
          />
        </Route>
      </Route>

      <Route path={`${BASE_PATH}/denied`} element={<AccessDenied />} />
    </Route>

    <Route path="/denied" element={<DeniedRedirect />} />
    <Route path="*" element={<Unmatched />} />
  </Routes>
);
