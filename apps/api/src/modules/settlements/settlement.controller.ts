import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRoles } from '../../middlewares/auth-guard.js';

export interface SettlementInvoiceListPort {
  list(tenantId: string, merchantId: string): Promise<unknown[]>;
}

export interface SettlementGeneratorPort {
  generateWeeklySettlementInvoice(input: {
    tenantId: string;
    merchantId: string;
    periodStart: string;
    periodEnd: string;
  }): Promise<unknown>;
}

/** The payout service delegates every financial mutation to LedgerService. */
export interface SettlementPayoutPort {
  payout(input: {
    tenantId: string;
    merchantId: string;
    invoiceId: string;
    staffId: string;
    amount: number;
  }): Promise<{ journalId: string }>;
}

const payoutParams = z.object({ id: z.string().uuid(), invoiceId: z.string().uuid() });
const merchantParams = z.object({ id: z.string().uuid() });
const payoutBody = z.object({ amount: z.number().int().positive() });
const generateBody = z.object({
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function registerSettlementController(
  app: FastifyInstance,
  deps: { payout?: SettlementPayoutPort; invoices: SettlementInvoiceListPort; generator?: SettlementGeneratorPort },
) {
  app.get(
    '/v1/merchants/:id/settlement-invoices',
    { preHandler: requireRoles('ADMIN_PESANTREN') },
    async (req) => {
      const { id } = merchantParams.parse(req.params);
      return {
        success: true,
        data: { items: await deps.invoices.list(req.auth!.tenant_id!, id) },
        meta: { requestId: req.id, timestamp: new Date().toISOString() },
      };
    },
  );

  if (deps.generator) {
    app.post(
      '/v1/merchants/:id/settlement-invoices/generate',
      { preHandler: requireRoles('ADMIN_PESANTREN') },
      async (req) => {
        const { id: merchantId } = merchantParams.parse(req.params);
        const body = generateBody.parse(req.body);
        const invoice = await deps.generator!.generateWeeklySettlementInvoice({
          tenantId: req.auth!.tenant_id!,
          merchantId,
          periodStart: body.period_start,
          periodEnd: body.period_end,
        });
        return {
          success: true,
          data: invoice,
          meta: { requestId: req.id, timestamp: new Date().toISOString() },
        };
      },
    );
  }

  if (deps.payout) {
    app.post(
      '/v1/merchants/:id/settlement-invoices/:invoiceId/payout',
      { preHandler: requireRoles('ADMIN_PESANTREN') },
      async (req) => {
        const { id: merchantId, invoiceId } = payoutParams.parse(req.params);
        const { amount } = payoutBody.parse(req.body);
        const result = await deps.payout!.payout({
          tenantId: req.auth!.tenant_id!,
          merchantId,
          invoiceId,
          staffId: req.auth!.sub,
          amount,
        });
        return {
          success: true,
          data: { journal_id: result.journalId, status: 'SETTLED' },
          meta: { requestId: req.id, timestamp: new Date().toISOString() },
        };
      },
    );
  }
}
