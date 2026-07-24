import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRoles } from '../../middlewares/auth-guard.js';

export interface SantriExitPort {
  deactivateSantriExit(
    tenantId: string,
    santriId: string,
    staffId: string,
    reason: 'GRADUATED' | 'WITHDRAWN' | 'OTHER',
    dayOfMonth: number,
  ): Promise<{ cardsDeactivated: unknown[] }>;
}
export interface DailyLimitPort {
  setLimit(input: {
    tenantId: string;
    actor: { id: string; type: 'STAFF' | 'WALI_SANTRI' };
    santriId: string;
    amount: number;
  }): Promise<void>;
}

const params = z.object({ id: z.string().uuid() });
const body = z.object({ amount: z.number().int().nonnegative() });
const exitBody = z.object({ reason: z.enum(['GRADUATED', 'WITHDRAWN', 'OTHER']) });

export async function registerSantriController(
  app: FastifyInstance,
  deps: { dailyLimit: DailyLimitPort; exit?: SantriExitPort; now?: () => Date },
) {
  app.patch('/v1/santri/:id/daily-limit', { preHandler: requireRoles('ADMIN_PESANTREN', 'WALI_SANTRI') }, async (req) => {
    const { id } = params.parse(req.params);
    const { amount } = body.parse(req.body);
    const auth = req.auth!;
    await deps.dailyLimit.setLimit({
      tenantId: auth.tenant_id!,
      actor: { id: auth.sub, type: auth.role === 'WALI_SANTRI' ? 'WALI_SANTRI' : 'STAFF' },
      santriId: id,
      amount,
    });
    return {
      success: true,
      data: { santri_id: id, daily_spend_limit: amount },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    };
  });

  if (deps.exit) {
    app.post('/v1/santri/:id/exit', { preHandler: requireRoles('ADMIN_PESANTREN') }, async (req) => {
      const { id } = params.parse(req.params);
      const { reason } = exitBody.parse(req.body);
      const auth = req.auth!;
      const result = await deps.exit!.deactivateSantriExit(
        auth.tenant_id!,
        id,
        auth.sub,
        reason,
        (deps.now ?? (() => new Date()))().getDate(),
      );
      return {
        success: true,
        data: { santri_id: id, cards_deactivated: result.cardsDeactivated.length },
        meta: { requestId: req.id, timestamp: new Date().toISOString() },
      };
    });
  }
}
