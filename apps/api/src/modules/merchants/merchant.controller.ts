import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRoles } from '../../middlewares/auth-guard.js';

export interface MerchantDeactivatePort {
  deactivate(
    tenantId: string,
    merchantId: string,
    staffId: string,
    dayOfMonth: number,
  ): Promise<{ feeCharged: number; settleAmount: number; unsettledReceivable: number }>;
}
export interface MerchantReceivablePort {
  resolve(tenantId: string, merchantId: string, staffId: string, note: string): Promise<void>;
  list(tenantId: string, staffId: string): Promise<unknown[]>;
}

const params = z.object({ id: z.string().uuid() });
const resolveBody = z.object({ note: z.string().trim().min(1).max(1000) });

export async function registerMerchantController(
  app: FastifyInstance,
  deps: { deactivation?: MerchantDeactivatePort; receivables: MerchantReceivablePort; now: () => Date },
) {
  const admin = requireRoles('ADMIN_PESANTREN');

  if (deps.deactivation) {
    app.post('/v1/merchants/:id/deactivate', { preHandler: admin }, async (req) => {
      const { id } = params.parse(req.params);
      const auth = req.auth!;
      const result = await deps.deactivation!.deactivate(auth.tenant_id!, id, auth.sub, deps.now().getDate());
      return { success: true, data: result, meta: { requestId: req.id, timestamp: new Date().toISOString() } };
    });
  }

  app.get('/v1/merchants/unsettled-receivables', { preHandler: admin }, async (req) => {
    const rows = await deps.receivables.list(req.auth!.tenant_id!, req.auth!.sub);
    return { success: true, data: { items: rows }, meta: { requestId: req.id, timestamp: new Date().toISOString() } };
  });

  app.post('/v1/merchants/:id/resolve-receivable', { preHandler: admin }, async (req) => {
    const { id } = params.parse(req.params);
    const { note } = resolveBody.parse(req.body);
    await deps.receivables.resolve(req.auth!.tenant_id!, id, req.auth!.sub, note);
    return { success: true, data: { resolved: true }, meta: { requestId: req.id, timestamp: new Date().toISOString() } };
  });
}
