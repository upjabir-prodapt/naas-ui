import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { addUseCaseResources } from '@aicoe/aihub-platform/i18n';
import App from './App';
import { appConfig } from './config';

const leaveApp = vi.fn();
vi.mock('./leaveApp', () => ({ leaveApp: (url: string) => leaveApp(url) }));

// As main.tsx does before the first render: the app's own strings.
addUseCaseResources(appConfig.i18n);

/**
 * The whole app as main.tsx mounts it, at the path the load balancer forwards
 * here, with only the BFF faked. Proves the composition (router, descriptor,
 * platform providers, shell, role gate, lazy route) hangs together;
 * the routing rules themselves are pinned in routes.test.tsx.
 *
 * `/auth/session` answers with the given roles; the admin ticket lists are
 * empty, and every other call gets the shell's empty unread-ticket count.
 */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function sessionFor(roles: string[]) {
  return {
    subjectId: 'subject-1',
    email: 'person@colt.net',
    name: 'A Person',
    department: null,
    companyName: null,
    roles,
    csrfToken: 'csrf',
    absoluteExpiresAt: '2030-01-01T00:00:00Z',
  };
}

let roles: string[] = [];

const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith('/auth/session')) return jsonResponse(sessionFor(roles));
  if (url.startsWith('/api/naas/v1/admin/tickets/')) return jsonResponse([]);
  return jsonResponse({ tickets: [], unreadCount: 0 });
});

function renderAt(path: string, withRoles: string[]) {
  roles = withRoles;
  window.history.replaceState(null, '', path);
  return render(<App />);
}

/**
 * The first visit to a route compiles its lazy chunk; NaaS pulls in MapLibre and
 * the markdown renderer, which takes longer than Testing Library's 1 s default.
 * The per-test timeout leaves room for that wait (beyond Vitest's 5 s) on a
 * slow runner.
 */
const LAZY_ROUTE = { timeout: 10_000 };
const TEST_TIMEOUT = 20_000;

function requestedPaths(): string[] {
  return fetchMock.mock.calls.map(([input]) => String(input));
}

beforeAll(() => {
  // The chat transcript scrolls itself to the latest message; jsdom has no layout.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
});

beforeEach(() => {
  leaveApp.mockReset();
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

describe('App', () => {
  it('signs in from /auth/session and renders NaaS at /naas inside its own shell', async () => {
    renderAt('/naas', ['NaaS.User']);

    expect(await screen.findByText('How can I help you today?', {}, LAZY_ROUTE)).toBeInTheDocument();
    expect(requestedPaths()).toContain('/auth/session');

    // The app's own sidebar, with the way back to the hub as a full-page link.
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByRole('link', { name: 'AI Hub' })).toHaveAttribute('href', '/');
    expect(window.location.pathname).toBe('/naas');
    expect(leaveApp).not.toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it("follows the app's own host-absolute admin link without prefixing it twice", async () => {
    renderAt('/naas', ['NaaS.User', 'NaaS.Admin']);

    fireEvent.click(await screen.findByRole('link', { name: /Admin/ }, LAZY_ROUTE));

    expect(await screen.findByText('Service Order Tickets', {}, LAZY_ROUTE)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/naas/admin');
    expect(requestedPaths()).toContain('/api/naas/v1/admin/tickets/pending');
    expect(leaveApp).not.toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it('keeps a NaaS user without NaaS.Admin inside the app at /naas/denied', async () => {
    renderAt('/naas/admin', ['NaaS.User']);

    await waitFor(() => expect(window.location.pathname).toBe('/naas/denied'));
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
    expect(screen.queryByText('Service Order Tickets')).not.toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  }, TEST_TIMEOUT);

  it('lets Platform.Admin use NaaS and reach the admin panel as an approver', async () => {
    renderAt('/naas', ['Platform.Admin']);

    fireEvent.click(await screen.findByRole('link', { name: /Admin/ }, LAZY_ROUTE));

    expect(await screen.findByText('Service Order Tickets', {}, LAZY_ROUTE)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/naas/admin');
    expect(requestedPaths()).toContain('/api/naas/v1/admin/tickets/pending');
  }, TEST_TIMEOUT);

  it('opens /naas/admin directly for Platform.Admin', async () => {
    renderAt('/naas/admin', ['Platform.Admin']);

    expect(await screen.findByText('Service Order Tickets', {}, LAZY_ROUTE)).toBeInTheDocument();
    expect(window.location.pathname).toBe('/naas/admin');
  }, TEST_TIMEOUT);

  it('refuses NaaS to NaaS.Admin without NaaS.User, as Apigee does', async () => {
    renderAt('/naas', ['NaaS.Admin']);

    await waitFor(() => expect(window.location.pathname).toBe('/naas/denied'));
    expect(await screen.findByText('Access Denied')).toBeInTheDocument();
  }, TEST_TIMEOUT);
});
