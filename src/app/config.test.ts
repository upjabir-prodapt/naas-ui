import { describe, expect, it } from 'vitest';
import { appConfig, ROLE_NAAS_ADMIN } from './config';

/**
 * The entitlement list must equal the roles Apigee's gate accepts for
 * /naas/**, no more and no fewer: an extra role renders a page the gateway then
 * 403s, a missing one locks out someone the gateway would let in.
 * Platform.Admin is entitled to every use case. That routes.tsx applies these
 * constants where they belong is pinned in routes.test.tsx.
 */
describe('naas roles match the Apigee gate', () => {
  it('is entitled to exactly NaaS.User and Platform.Admin', () => {
    expect([...appConfig.roles].sort()).toEqual(['NaaS.User', 'Platform.Admin'].sort());
  });

  it('gates /naas/admin on the approver roles NaaS.Admin and Platform.Admin', () => {
    expect([...ROLE_NAAS_ADMIN]).toEqual(['NaaS.Admin', 'Platform.Admin']);
  });
});
