import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { ZodError } from 'zod';
import { apiError, apiSuccess } from '@pondokpay/shared-types';
import { authController } from './modules/auth/auth.controller.js';
import { issueWaliTenantAccessToken } from './modules/auth/auth-token.service.js';
import { PrismaStaffActionPinRepository } from './modules/auth/staff-action-pin.repository.js';
import { StaffActionPinService } from './modules/auth/staff-action-pin.service.js';
import { registerCardController } from './modules/cards/card.controller.js';
import { CardDeactivationService } from './modules/cards/card-deactivation.service.js';
import { PrismaCardFreezeRepository } from './modules/cards/card-freeze.repository.js';
import { CardFreezeService } from './modules/cards/card-freeze.service.js';
import { registerCardPinController } from './modules/cards/card-pin.controller.js';
import { PrismaCardPinRepository } from './modules/cards/card-pin.repository.js';
import { CardPinService } from './modules/cards/card-pin.service.js';
import { PrismaCardPinResetSessionRepository } from './modules/cards/card-pin-reset-session.repository.js';
import { CardPinResetSessionService } from './modules/cards/card-pin-reset-session.service.js';
import { registerCardRegistrationController } from './modules/cards/card-registration.controller.js';
import { PrismaCardRegistrationRepository } from './modules/cards/card-registration.repository.js';
import { CardRegistrationService } from './modules/cards/card-registration.service.js';
import { LedgerError, LedgerService } from './modules/ledger/ledger.service.js';
import { PrismaLedgerRepository } from './modules/ledger/ledger.repository.js';
import { registerMerchantController } from './modules/merchants/merchant.controller.js';
import { MerchantDeactivationService } from './modules/merchants/merchant-deactivation.service.js';
import { PrismaMerchantReceivableRepository } from './modules/merchants/merchant-receivable.repository.js';
import { MerchantReceivableService } from './modules/merchants/merchant-receivable.service.js';
import { registerReportController } from './modules/reports/report.controller.js';
import { PrismaReconciliationRepository } from './modules/reports/reconciliation.repository.js';
import { ReconciliationService } from './modules/reports/reconciliation.service.js';
import { registerSantriController } from './modules/santri/santri.controller.js';
import { PrismaDailyLimitRepository } from './modules/santri/daily-limit.repository.js';
import { SantriExitService } from './modules/santri/santri-exit.service.js';
import { DailyLimitService } from './modules/santri/daily-limit.service.js';
import { registerSettlementController } from './modules/settlements/settlement.controller.js';
import { SettlementPayoutService } from './modules/settlements/settlement-payout.service.js';
import { PrismaSettlementRepository, listMerchantSettlementInvoices } from './modules/settlements/settlement.repository.js';
import { SettlementService } from './modules/settlements/settlement.service.js';
import { registerTerminalAdminController } from './modules/terminals/terminal-admin.controller.js';
import { PrismaTerminalProvisioningRepository } from './modules/terminals/terminal-provisioning.repository.js';
import { TerminalProvisioningService } from './modules/terminals/terminal-provisioning.service.js';
import { registerTerminalController } from './modules/terminals/terminal.controller.js';
import { PrismaTerminalAuthRepository } from './modules/terminals/terminal-auth.repository.js';
import { TerminalAuthService } from './modules/terminals/terminal-auth.service.js';
import { registerTerminalHeartbeatController } from './modules/terminals/terminal-heartbeat.controller.js';
import { PrismaTerminalHeartbeatRepository } from './modules/terminals/terminal-heartbeat.repository.js';
import { TerminalHeartbeatService } from './modules/terminals/terminal-heartbeat.service.js';
import { PrismaOperatorPinManagementRepository } from './modules/terminals/operator-pin-management.repository.js';
import { OperatorPinManagementService } from './modules/terminals/operator-pin-management.service.js';
import { registerOperatorController } from './modules/terminals/operator.controller.js';
import { PrismaOperatorProvisioningRepository } from './modules/terminals/operator-provisioning.repository.js';
import { OperatorProvisioningService } from './modules/terminals/operator-provisioning.service.js';
import { registerTransactionController } from './modules/transactions/transaction.controller.js';
import { PrismaTenantStatusRepository } from './modules/tenants/tenant-status.repository.js';
import { TenantStatusService } from './modules/tenants/tenant-status.service.js';
import { registerWaliTenantController } from './modules/wali-santri/wali-tenant.controller.js';
import { PrismaWaliTenantSessionRepository } from './modules/wali-santri/wali-tenant-session.repository.js';
import { WaliTenantSessionService } from './modules/wali-santri/wali-tenant-session.service.js';
import { createTerminalRateLimiter } from './middlewares/terminal-rate-limit.factory.js';
import { AppError } from './shared/errors.js';

export async function buildApp() {
  const app = Fastify({ logger: true, genReqId: () => crypto.randomUUID() });
  await app.register(cookie);
  await app.register(cors, { origin: true, credentials: true });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError) {
      return reply
        .status(422)
        .send(apiError('VALIDATION_ERROR', 'Data yang dikirim tidak valid.', req.id, { issues: error.flatten() }));
    }
    if (error instanceof LedgerError) {
      const statusCode = error.code === 'FORBIDDEN' ? 403 : 422;
      return reply.status(statusCode).send(apiError(error.code, error.message, req.id, error.details));
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(apiError(error.code, error.message, req.id, error.details));
    }
    if (error instanceof Error && 'code' in error && typeof (error as { code?: unknown }).code === 'string') {
      const code = (error as { code: string }).code;
      const statusCode = code === 'FORBIDDEN' ? 403 : code === 'UNAUTHORIZED' ? 401 : 422;
      return reply.status(statusCode).send(apiError(code, error.message, req.id));
    }

    req.log.error(error);
    return reply.status(500).send(apiError('VALIDATION_ERROR', 'Terjadi kesalahan pada server.', req.id));
  });

  app.get('/health', async (req) => apiSuccess({ status: 'ok' }, req.id));
  await app.register(authController);

  const waliTenants = new WaliTenantSessionService(new PrismaWaliTenantSessionRepository());
  await registerWaliTenantController(app, {
    selector: waliTenants,
    tenants: waliTenants,
    tokens: { issueWaliTenantAccessToken },
  });

  await registerTerminalAdminController(app, {
    provisioning: new TerminalProvisioningService(new PrismaTerminalProvisioningRepository()),
  });

  const terminalAuth = new TerminalAuthService(new PrismaTerminalAuthRepository());
  const tenantGuard = new TenantStatusService(new PrismaTenantStatusRepository());
  const rateLimit = createTerminalRateLimiter();
  const ledger = new LedgerService(new PrismaLedgerRepository());

  await registerTerminalController(app, {
    terminalAuth,
    tenantGuard,
    rateLimit,
    topupAuthorization: new StaffActionPinService(new PrismaStaffActionPinRepository()),
    ledger,
  });
  await registerTransactionController(app, {
    ledger,
    voidWindowMinutes: Number(process.env.VOID_WINDOW_MINUTES ?? 15),
  });
  await registerReportController(app, {
    reconciliation: new ReconciliationService(new PrismaReconciliationRepository()),
  });
  await registerSettlementController(app, {
    invoices: { list: listMerchantSettlementInvoices },
    generator: new SettlementService(new PrismaSettlementRepository()),
    payout: new SettlementPayoutService(ledger),
  });
  await registerSantriController(app, {
    dailyLimit: new DailyLimitService(new PrismaDailyLimitRepository()),
    exit: new SantriExitService(ledger),
    now: () => new Date(),
  });
  await registerCardController(app, {
    freeze: new CardFreezeService(new PrismaCardFreezeRepository()),
    deactivation: new CardDeactivationService(ledger),
    now: () => new Date(),
  });
  await registerCardRegistrationController(app, {
    terminalAuth,
    tenantGuard,
    registration: new CardRegistrationService(new PrismaCardRegistrationRepository()),
  });
  await registerCardPinController(app, {
    terminalAuth,
    tenantGuard,
    actionPin: new StaffActionPinService(new PrismaStaffActionPinRepository()),
    cardPin: new CardPinService(new PrismaCardPinRepository()),
    sessions: new CardPinResetSessionService(new PrismaCardPinResetSessionRepository()),
  });

  const receivables = new MerchantReceivableService(new PrismaMerchantReceivableRepository());
  await registerMerchantController(app, {
    deactivation: new MerchantDeactivationService(ledger),
    receivables,
    now: () => new Date(),
  });
  await registerOperatorController(app, {
    provisioning: new OperatorProvisioningService(new PrismaOperatorProvisioningRepository()),
    pinManagement: new OperatorPinManagementService(new PrismaOperatorPinManagementRepository()),
  });
  await registerTerminalHeartbeatController(app, {
    terminalAuth,
    tenantGuard,
    rateLimit,
    heartbeat: new TerminalHeartbeatService(new PrismaTerminalHeartbeatRepository()),
  });

  return app;
}
