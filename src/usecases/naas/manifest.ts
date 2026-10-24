import { lazy } from 'react';
import { Network, SquareCheckBig } from 'lucide-react';
import type { UseCaseManifest } from '../base';
import en from './i18n/en.json';
import ja from './i18n/ja.json';

export const ROLE_NAAS = ['NaaS.User', 'Platform.Admin'] as const;
/**
 * The NaaS ticket-approval panel, where approving places a real, irreversible
 * Ethernet Port order. Approvers are `NaaS.Admin` and `Platform.Admin`
 * (platform owner's decision, 2026-10-24). This is the same set as Apigee's
 * `RF-NaaSAdminRoleRequired`, the BFF manifest's `path_roles` and the
 * backend's `ADMIN_ROLES`. Change all four together, or the UI shows a link the
 * gateway then 403s.
 */
export const ROLE_NAAS_ADMIN = ['NaaS.Admin', 'Platform.Admin'] as const;

export const manifest: UseCaseManifest = {
  slug: 'naas',
  order: 30,
  roles: ROLE_NAAS,
  routes: [
    { path: 'naas', component: lazy(() => import('./ui/NaasChatScreen')) },
    { path: 'naas/agents/:agentId', component: lazy(() => import('./ui/NaasAgentScreen')) },
    // Needs an approver role (NaaS.Admin or Platform.Admin). Apigee gates /naas/v1/admin/** the
    // same way, so without this a non-admin typing the URL would load the panel
    // and then see every request 403.
    {
      path: 'naas/admin',
      component: lazy(() => import('./ui/NaasAdmin')),
      roles: ROLE_NAAS_ADMIN,
      deniedAs: 'naas-admin',
    },
  ],
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
};
