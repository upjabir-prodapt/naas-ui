import { Network, SquareCheckBig } from 'lucide-react';
import type { UseCaseDescriptor } from '@aicoe/aihub-platform/usecases';
import en from '../i18n/en.json';
import ja from '../i18n/ja.json';

/**
 * Who may use the app. Must equal the roles Apigee's gate accepts for
 * /naas/** (see config.test.ts). Platform.Admin is entitled to every use case.
 */
export const ROLE_NAAS = ['NaaS.User', 'Platform.Admin'] as const;

/**
 * The NaaS ticket-approval panel, where approving places a real, irreversible
 * Ethernet Port order. Approvers are `NaaS.Admin` and `Platform.Admin`
 * (platform owner's decision, 2026-10-24). This is the same set as Apigee's
 * `RF-NaaSAdminRoleRequired`, the BFF manifest's `path_roles` and the
 * backend's `ADMIN_ROLES`. Change all four together, or the UI shows a link the
 * gateway then 403s.
 *
 * The one constant both the `/naas/admin` route guard (routes.tsx) and the
 * navbar's Admin link (components/Navbar.tsx) read.
 */
export const ROLE_NAAS_ADMIN = ['NaaS.Admin', 'Platform.Admin'] as const;

/** Names the admin panel in the access-denied page's location state. */
export const ADMIN_DENIED_AS = 'naas-admin';

/**
 * What `@aicoe/aihub-platform` needs to know about this app: its slug (the
 * `/naas` path segment, the `/api/naas/` quota prefix), its roles, its
 * sidebar, its translations, and the display name the shell's breadcrumb and
 * access-denied page use (`hub.name`). The platform's `UseCaseDescriptor`
 * type requires the rest of `hub`; this app does not render it.
 */
export const appConfig = {
  slug: 'naas',
  roles: ROLE_NAAS,
  // No job tracker: NaaS is conversational and has no batch runs to track.
  nav: [{ id: 'naas', label: 'On-Demand NaaS', icon: SquareCheckBig, path: '/naas' }],
  i18n: { en, ja },
  hub: {
    name: 'On-Demand NaaS',
    category: 'Network',
    description: 'Chat with specialist agents to qualify, order, and monitor network services.',
    tags: ['chat', 'agents'],
    icon: Network,
  },
} satisfies UseCaseDescriptor;

/** The app's root on the shared host. The load balancer sends `/naas/*` here. */
export const BASE_PATH = `/${appConfig.slug}`;
