import { describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { registerSettlementController } from '../src/modules/settlements/settlement.controller.js';

type RegisteredRoute = {
  method: 'GET' | 'POST';
  url: string;
  handler: (request: any) => Promise<any>;
};

function routeRecorder() {
  const routes: RegisteredRoute[] = [];
  const app = {
    get(url: string, _options: unknown, handler: (request: any) => Promise<any>) {
      routes.push({ method: 'GET', url, handler });
    },
    post(url: string, _options: unknown, handler: (request: any) => Promise<any>) {
      routes.push({ method: 'POST', url, handler });
    },
  } as unknown as FastifyInstance;
  return { app, routes };
}

describe('settlement controller', () => {
  it('passes manual generation period and merchant path parameter to the settlement service', async () => {
    const { app, routes } = routeRecorder();
    const command: unknown[] = [];
    await registerSettlementController(app, {
      invoices: { list: async () => [] },
      generator: {
        generateWeeklySettlementInvoice: async (input) => {
          command.push(input);
          return { id: 'invoice-id', closingBalance: 1000 };
        },
      },
    });

    const route = routes.find((candidate) => candidate.url.endsWith('/generate'));
    const result = await route!.handler({
      id: 'request-id',
      auth: { tenant_id: '11111111-1111-4111-8111-111111111111' },
      params: { id: '33333333-3333-4333-8333-333333333333' },
      body: { period_start: '2026-07-01', period_end: '2026-07-07' },
    });

    expect(command).toEqual([
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        merchantId: '33333333-3333-4333-8333-333333333333',
        periodStart: '2026-07-01',
        periodEnd: '2026-07-07',
      },
    ]);
    expect(result).toMatchObject({ success: true, data: { id: 'invoice-id' }, meta: { requestId: 'request-id' } });
  });

  it('passes the tenant, merchant path parameter, invoice, and staff identity to the payout service', async () => {
    const { app, routes } = routeRecorder();
    const command: unknown[] = [];
    await registerSettlementController(app, {
      invoices: { list: async () => [] },
      payout: {
        payout: async (input) => {
          command.push(input);
          return { journalId: 'journal-id' };
        },
      },
    });

    const route = routes.find((candidate) => candidate.method === 'POST');
    const result = await route!.handler({
      id: 'request-id',
      auth: { tenant_id: '11111111-1111-4111-8111-111111111111', sub: '22222222-2222-4222-8222-222222222222' },
      params: {
        id: '33333333-3333-4333-8333-333333333333',
        invoiceId: '44444444-4444-4444-8444-444444444444',
      },
      body: { amount: 50000 },
    });

    expect(command).toEqual([
      {
        tenantId: '11111111-1111-4111-8111-111111111111',
        merchantId: '33333333-3333-4333-8333-333333333333',
        invoiceId: '44444444-4444-4444-8444-444444444444',
        staffId: '22222222-2222-4222-8222-222222222222',
        amount: 50000,
      },
    ]);
    expect(result).toMatchObject({
      success: true,
      data: { journal_id: 'journal-id', status: 'SETTLED' },
      meta: { requestId: 'request-id' },
    });
  });
});
