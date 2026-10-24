import { describe, expect, it } from 'vitest';
import { useCase } from './useCase';

/**
 * The entitlement list must equal the roles Apigee's gate accepts for
 * /naas/**, no more and no fewer: an extra role renders a page the gateway then
 * 403s, a missing one locks out someone the gateway would let in.
 * Platform.Admin is entitled to every vertical.
 */
describe('naas roles match the Apigee gate', () => {
  it('is entitled to exactly NaaS.User and Platform.Admin', () => {
    expect([...useCase.roles].sort()).toEqual(['NaaS.User', 'Platform.Admin'].sort());
  });

  it('gates only /naas/admin further, on the approver roles NaaS.Admin and Platform.Admin', () => {
    const gated = useCase.routes.filter((route) => route.roles);
    expect(gated.map((route) => [route.path, route.roles])).toEqual([
      ['naas/admin', ['NaaS.Admin', 'Platform.Admin']],
    ]);
  });
});
