import React, { lazy } from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Activity, Boxes } from 'lucide-react';
import '@aicoe/aihub-platform/i18n';
import { AuthContext, type AuthState } from '@aicoe/aihub-platform/auth';
import { UseCasesContext } from '@aicoe/aihub-platform/usecases';
import type { UseCaseManifest } from './usecases/base';
import { AppRoutes } from './AppRoutes';

const leaveApp = vi.fn();
vi.mock('./leaveApp', () => ({ leaveApp: (url: string) => leaveApp(url) }));

/**
 * The standalone app mounts the vertical without a router basename, so its
 * manifest's host-absolute paths work unchanged. These pin the parts of that
 * which differ from the hub: where `/denied` lands, and what happens to a path
 * the app does not own.
 *
 * A stand-in manifest, so the shell is tested independently of the vertical.
 */
const DEMO: UseCaseManifest = {
  slug: 'demo',
  roles: ['Demo.User'],
  routes: [
    { path: 'demo', component: lazy(async () => ({ default: () => <p>demo home</p> })) },
    {
      path: 'demo/tracker',
      component: lazy(async () => ({ default: () => <p>demo tracker</p> })),
    },
    {
      path: 'demo/admin',
      component: lazy(async () => ({ default: () => <p>demo admin</p> })),
      roles: ['Demo.Admin'],
      deniedAs: 'demo-admin',
    },
  ],
  nav: [
    { id: 'demo', label: 'Demo', icon: Boxes, path: '/demo', end: true },
    { id: 'demo-tracker', label: 'Job Tracker', icon: Activity, path: '/demo/tracker' },
  ],
  hub: {
    name: 'Demo App',
    category: 'Test',
    description: 'A stand-in vertical.',
    tags: [],
    icon: Boxes,
  },
};

function authAs(roles: string[]): AuthState {
  return {
    status: 'authenticated',
    user: {
      subjectId: 'subject-1',
      email: 'person@colt.net',
      name: 'A Person',
      department: null,
      companyName: null,
      roles,
      csrfToken: 'csrf',
      absoluteExpiresAt: '2030-01-01T00:00:00Z',
    },
    error: null,
    roles,
    hasRole: (...wanted: string[]) => wanted.some((role) => roles.includes(role)),
    refresh: async () => {},
    logout: async () => {},
  };
}

const CurrentPath: React.FC = () => <output data-testid="path">{useLocation().pathname}</output>;

function renderAt(path: string, roles: string[]) {
  return render(
    <AuthContext.Provider value={authAs(roles)}>
      <UseCasesContext.Provider value={[DEMO]}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes useCase={DEMO} />
          <CurrentPath />
        </MemoryRouter>
      </UseCasesContext.Provider>
    </AuthContext.Provider>,
  );
}

beforeEach(() => {
  leaveApp.mockReset();
  // The shell's user menu polls the hub's unread-ticket count.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tickets: [], unreadCount: 0 }), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

describe('AppRoutes', () => {
  it('renders the manifest route at its host path, inside the app shell', async () => {
    renderAt('/demo/tracker', ['Demo.User']);

    expect(await screen.findByText('demo tracker')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI Hub' })).toHaveAttribute('href', '/');
  });

  it('keeps a refused user inside the app at /<slug>/denied', async () => {
    renderAt('/demo', []);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/demo/denied'));
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/permission to access Demo App/)).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it('applies a route-level role on top of the vertical role', async () => {
    renderAt('/demo/admin', ['Demo.User']);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/demo/denied'));
    expect(screen.queryByText('demo admin')).not.toBeInTheDocument();
  });

  it('sends an unknown path under the app back to its root', async () => {
    renderAt('/demo/no/such/page', ['Demo.User']);

    expect(await screen.findByText('demo home')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/demo$/);
  });

  it('hands a path outside the app to a full page load', async () => {
    renderAt('/support?usecase=demo', ['Demo.User']);

    await waitFor(() => expect(leaveApp).toHaveBeenCalledWith('/support?usecase=demo'));
  });
});
