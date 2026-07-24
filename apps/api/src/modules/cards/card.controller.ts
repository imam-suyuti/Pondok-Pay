import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRoles } from '../../middlewares/auth-guard.js';

export interface CardDeactivationPort {
  deactivate(tenantId: string, cardId: string, staffId: string, dayOfMonth: number): Promise<{ feeCharged: number; refundAmount: number }>;
}
export interface CardFreezePort {
  requestFreeze(input: {
    tenantId: string;
    actor: { id: string; type: 'STAFF' | 'WALI_SANTRI' };
    cardId: string;
  }): Promise<{ status: 'FROZEN' | 'REPORTED' }>;
}

const params = z.object({ id: z.string().uuid() });

export async function registerCardController(
  app: FastifyInstance,
  deps: { freeze: CardFreezePort; deactivation?: CardDeactivationPort; now: () => Date },
) {
  app.post('/v1/cards/:id/freeze', { preHandler: requireRoles('ADMIN_PESANTREN', 'WALI_SANTRI') }, async (req) => {
    const { id } = params.parse(req.params);
    const auth = req.auth!;
    const result = await deps.freeze.requestFreeze({
      tenantId: auth.tenant_id!,
      actor: { id: auth.sub, type: auth.role === 'WALI_SANTRI' ? 'WALI_SANTRI' : 'STAFF' },
      cardId: id,
    });
    return {
      success: true,
      data: { card_id: id, status: result.status },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };
  });

  if (deps.deactivation) {
    app.post('/v1/cards/:id/deactivate', { preHandler: requireRoles('ADMIN_PESANTREN') }, async (req) => {
      const { id } = params.parse(req.params);
      const auth = req.auth!;
      const result = await deps.deactivation!.deactivate(auth.tenant_id!, id, auth.sub, deps.now().getDate());
      return { success: true, data: result, meta: { requestId: req.id, timestamp: new Date().toISOString() } };
    });
  }
}
