import React from 'react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '@aicoe/aihub-platform/i18n';
import { AuthContext, type AuthState } from '@aicoe/aihub-platform/auth';
import { UseCasesContext } from '@aicoe/aihub-platform/usecases';
import { appConfig } from './config';
import { AppRoutes } from './routes';

const leaveApp = vi.fn();
vi.mock('./leaveApp', () => ({ leaveApp: (url: string) => leaveApp(url) }));

/**
 * The routing rules, with the pages stubbed so only the shell, the role gates
 * and the redirects are under test (App.test.tsx renders the real pages). The
 * app mounts without a router basename, so these pin where `/denied` lands and
 * what happens to a path the app does not own.
 */
vi.mock('../pages/ChatPage', () => ({ default: () => <p>chat page</p> }));
vi.mock('../pages/AgentPage', () => ({ default: () => <p>agent page</p> }));
vi.mock('../pages/AdminPage', () => ({ default: () => <p>admin page</p> }));

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
      <UseCasesContext.Provider value={[appConfig]}>
        <MemoryRouter initialEntries={[path]}>
          <AppRoutes />
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
  it('renders a route at its host path, inside the app shell', async () => {
    renderAt('/naas/agents/sre-monitor', ['NaaS.User']);

    expect(await screen.findByText('agent page')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'AI Hub' })).toHaveAttribute('href', '/');
  });

  it('keeps a refused user inside the app at /naas/denied', async () => {
    renderAt('/naas', []);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/naas/denied'));
    expect(screen.getByText('Access Denied')).toBeInTheDocument();
    expect(screen.getByText(/permission to access On-Demand NaaS/)).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it('applies the admin role on top of the app role at /naas/admin', async () => {
    renderAt('/naas/admin', ['NaaS.User']);

    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/naas/denied'));
    expect(screen.queryByText('admin page')).not.toBeInTheDocument();
  });

  it('opens /naas/admin for a NaaS user who is also an approver', async () => {
    renderAt('/naas/admin', ['NaaS.User', 'NaaS.Admin']);

    expect(await screen.findByText('admin page')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/naas\/admin$/);
  });

  it('sends an unknown path under the app back to its root', async () => {
    renderAt('/naas/no/such/page', ['NaaS.User']);

    expect(await screen.findByText('chat page')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/naas$/);
  });

  it('hands a path outside the app to a full page load', async () => {
    renderAt('/support?usecase=naas', ['NaaS.User']);

    await waitFor(() => expect(leaveApp).toHaveBeenCalledWith('/support?usecase=naas'));
  });
});
