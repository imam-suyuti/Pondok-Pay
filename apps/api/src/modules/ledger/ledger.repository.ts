import { AsyncLocalStorage } from 'node:async_hooks';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { jakartaDayStart } from './ledger-time.js';
import type {
  LedgerAccount,
  LedgerCard,
  LedgerEntry,
  LedgerMerchant,
  LedgerRepository,
  LedgerSettlementInvoice,
  LedgerTransaction,
  SantriExitCommand,
  TransactionType,
} from './ledger.service.js';

const context = new AsyncLocalStorage<{ tx: Prisma.TransactionClient; tenantId: string }>();
const number = (value: unknown) => Number(value ?? 0);

/**
 * Approved, parameterized raw SQL is limited to FOR UPDATE and running-balance
 * reads; see docs/LEDGER_SQL_REVIEW.md.
 */
export class PrismaLedgerRepository implements LedgerRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private tx() {
    const state = context.getStore();
    if (!state) {
      throw new Error('Ledger repository method called outside serializable transaction.');
    }
    return state.tx;
  }

  private tenantId() {
    const state = context.getStore();
    if (!state) {
      throw new Error('Ledger repository method called outside serializable transaction.');
    }
    return state.tenantId;
  }

  async runSerializable<T>(tenantId: string, work: () => Promise<T>) {
    return this.client.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
        return context.run({ tx, tenantId }, work);
      },
      // Prisma's generated type does not export the enum in this client version.
      { isolationLevel: 'Serializable' as any },
    );
  }

  async findTransactionByIdempotency(key: string) {
    const row = await this.tx().transaction.findUnique({ where: { idempotencyKey: key } });
    return row ? this.transaction(row) : undefined;
  }

  async findTransactionById(id: string) {
    const row = await this.tx().transaction.findUnique({ where: { id } });
    return row ? this.transaction(row) : undefined;
  }

  async markTransactionVoided(id: string, staffId: string, reason: string) {
    await this.tx().transaction.update({
      where: { id },
      data: { status: 'VOIDED', voidedBy: staffId, voidedReason: reason },
    });
  }

  async lockCard(id: string, tenantId: string) {
    const rows = await this.tx().$queryRaw<
      { id: string; tenant_id: string; santri_id: string; status: LedgerCard['status']; pin_hash: string }[]
    >`SELECT id, tenant_id, santri_id, status, pin_hash
      FROM cards
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          santriId: row.santri_id,
          status: row.status,
          pinHash: row.pin_hash,
        }
      : undefined;
  }

  async lockMerchant(id: string, tenantId: string): Promise<LedgerMerchant | undefined> {
    const rows = await this.tx().$queryRaw<
      { id: string; tenant_id: string; status: LedgerMerchant['status'] }[]
    >`SELECT id, tenant_id, status
      FROM merchants
      WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    return row ? { id: row.id, tenantId: row.tenant_id, status: row.status } : undefined;
  }

  async activeCardIdsForSantri(tenantId: string, santriId: string) {
    const rows = await this.tx().$queryRaw<{ id: string }[]>`
      SELECT id
      FROM cards
      WHERE tenant_id = ${tenantId}::uuid AND santri_id = ${santriId}::uuid AND status = 'ACTIVE'
      ORDER BY issued_at ASC
      FOR UPDATE`;
    return rows.map((row: { id: string }) => row.id);
  }

  async markCardInactive(cardId: string, reason: 'MANUAL' | 'AUTO_NONPAYMENT') {
    await this.tx().card.update({
      where: { id: cardId },
      data: { status: 'INACTIVE', deactivationReason: reason, deactivatedAt: new Date() },
    });
  }

  async markMerchantInactive(input: { merchantId: string; unsettledReceivable: number }) {
    await this.tx().merchant.update({
      where: { id: input.merchantId },
      data: {
        status: 'INACTIVE',
        deactivationReason: 'MANUAL',
        deactivatedAt: new Date(),
        hasUnsettledReceivable: input.unsettledReceivable > 0,
        unsettledReceivableAmount: input.unsettledReceivable > 0 ? input.unsettledReceivable : null,
      },
    });
  }

  async markSantriInactive(santriId: string, reason: SantriExitCommand['reason']) {
    await this.tx().santri.update({
      where: { id: santriId },
      data: { status: 'INACTIVE', exitReason: reason, exitedAt: new Date() },
    });
  }

  async revokeWaliRelations(santriId: string) {
    await this.tx().waliSantriRelation.updateMany({
      where: { santriId },
      data: { status: 'REVOKED' },
    });
  }

  async lockSettlementInvoice(invoiceId: string): Promise<LedgerSettlementInvoice | undefined> {
    const rows = await this.tx().$queryRaw<
      {
        id: string;
        tenant_id: string;
        merchant_id: string;
        closing_balance: unknown;
        status: LedgerSettlementInvoice['status'];
      }[]
    >`SELECT id, tenant_id, merchant_id, closing_balance, status
      FROM merchant_settlement_invoices
      WHERE id = ${invoiceId}::uuid AND tenant_id = ${this.tenantId()}::uuid
      FOR UPDATE`;
    const row = rows[0];
    return row
      ? {
          id: row.id,
          tenantId: row.tenant_id,
          merchantId: row.merchant_id,
          closingBalance: number(row.closing_balance),
          status: row.status,
        }
      : undefined;
  }

  async markSettlementInvoicePaidOut(
    invoiceId: string,
    staffId: string,
    amount: number,
    journalId: string,
  ) {
    await this.tx().merchantSettlementInvoice.update({
      where: { id: invoiceId },
      data: {
        status: 'SETTLED',
        settlementAction: 'PAID_OUT',
        paidOutAmount: amount,
        paidOutJournalId: journalId,
        settledBy: staffId,
        settledAt: new Date(),
      },
    });
  }

  async isAdminInTenant(staffId: string, tenantId: string) {
    return Boolean(
      await this.tx().staffUser.findFirst({
        where: { id: staffId, tenantId, role: 'ADMIN_PESANTREN', status: 'ACTIVE' },
        select: { id: true },
      }),
    );
  }

  async verifyPin(value: string, hash: string) {
    return argon2.verify(hash, value);
  }

  async lockAccount(tenantId: string, entityType: LedgerAccount['entityType'], entityId: string) {
    const rows = await this.tx().$queryRaw<
      { id: string; tenant_id: string; entity_type: LedgerAccount['entityType']; entity_id: string }[]
    >`SELECT id, tenant_id, entity_type, entity_id
      FROM accounts
      WHERE tenant_id = ${tenantId}::uuid
        AND entity_type = ${entityType}
        AND entity_id = ${entityId}::uuid
      FOR UPDATE`;
    const row = rows[0];
    return row
      ? { id: row.id, tenantId: row.tenant_id, entityType: row.entity_type, entityId: row.entity_id }
      : undefined;
  }

  async runningBalance(accountId: string) {
    const rows = await this.tx().$queryRaw<{ balance: unknown }[]>`
      SELECT COALESCE(SUM(CASE WHEN entry_type = 'KREDIT' THEN amount ELSE -amount END), 0) AS balance
      FROM ledger_entries
      WHERE account_id = ${accountId}::uuid`;
    return number(rows[0]?.balance ?? 0);
  }

  async successfulSalesToday(tenantId: string, santriId: string, now: Date) {
    const start = jakartaDayStart(now);
    const result = await this.tx().transaction.aggregate({
      where: {
        tenantId,
        santriId,
        transactionType: 'SALE',
        status: 'SUCCESS',
        createdAt: { gte: start },
      },
      _sum: { amount: true },
    });
    return number(result._sum.amount ?? 0);
  }

  async dailyLimit(tenantId: string, santriId: string) {
    const santri = await this.tx().santri.findUnique({
      where: { id: santriId },
      select: { dailySpendLimit: true },
    });
    if (santri?.dailySpendLimit !== null && santri?.dailySpendLimit !== undefined) {
      return number(santri.dailySpendLimit);
    }

    const tenant = await this.tx().tenant.findUnique({
      where: { id: tenantId },
      select: { defaultDailyLimit: true },
    });
    return number(tenant?.defaultDailyLimit ?? 0);
  }

  async cardFee(tenantId: string) {
    const tenant = await this.tx().tenant.findUnique({ where: { id: tenantId }, select: { cardFeeMonthly: true } });
    if (tenant?.cardFeeMonthly !== null && tenant?.cardFeeMonthly !== undefined) {
      return number(tenant.cardFeeMonthly);
    }
    const config = await this.platformBillingConfig();
    return number(config.defaultCardFeeMonthly);
  }

  async merchantFee(tenantId: string) {
    const tenant = await this.tx().tenant.findUnique({ where: { id: tenantId }, select: { merchantFeeMonthly: true } });
    if (tenant?.merchantFeeMonthly !== null && tenant?.merchantFeeMonthly !== undefined) {
      return number(tenant.merchantFeeMonthly);
    }
    const config = await this.platformBillingConfig();
    return number(config.defaultMerchantFeeMonthly);
  }

  async manualFeeCutoffDay() {
    const config = await this.platformBillingConfig();
    return Number(config.manualDeactivationFeeCutoffDay);
  }

  async merchantDeactivationWriteoffThreshold() {
    const config = await this.platformBillingConfig();
    return number(config.merchantDeactivationWriteoffThreshold);
  }

  async appendBalancedEntries(entries: [LedgerEntry, LedgerEntry]) {
    await this.tx().ledgerEntry.createMany({
      data: entries.map((entry) => ({
        tenantId: this.tenantId(),
        journalId: entry.journalId,
        accountId: entry.accountId,
        entryType: entry.entryType,
        amount: entry.amount,
        balanceSnapshot: entry.balanceSnapshot,
        description: entry.description,
      })),
    });
  }

  async createTransaction(transaction: LedgerTransaction) {
    await this.tx().transaction.create({
      data: {
        id: transaction.id,
        tenantId: transaction.tenantId,
        journalId: transaction.journalId,
        transactionType: transaction.type,
        cardId: null,
        santriId: transaction.santriId,
        merchantId: transaction.merchantId,
        terminalId: transaction.terminalId,
        operatorId: transaction.operatorId,
        withdrawalReason: transaction.withdrawalReason,
        amount: transaction.amount,
        status: transaction.status,
        idempotencyKey: transaction.idempotencyKey,
        createdAt: transaction.createdAt,
      },
    });
  }

  async cashTopupLimit(tenantId: string) {
    const tenant = await this.tx().tenant.findUnique({
      where: { id: tenantId },
      select: { cashTopupLimitPerTx: true },
    });
    return number(tenant?.cashTopupLimitPerTx ?? 0);
  }

  async cashWithdrawalLimit(tenantId: string) {
    const tenant = await this.tx().tenant.findUnique({
      where: { id: tenantId },
      select: { cashWithdrawalLimitPerTx: true },
    });
    return number(tenant?.cashWithdrawalLimitPerTx ?? 0);
  }

  async appendAudit(input: {
    tenantId: string;
    actorType: 'SYSTEM' | 'STAFF';
    actorId?: string;
    action:
      | 'TRANSACTION_CHARGE'
      | 'TERMINAL_TOPUP'
      | 'TERMINAL_WITHDRAWAL'
      | 'TRANSACTION_VOID'
      | 'SETTLEMENT_PAYOUT'
      | 'CARD_DEACTIVATED_MANUAL'
      | 'MERCHANT_DEACTIVATED_MANUAL'
      | 'MERCHANT_DEACTIVATED_WITH_RECEIVABLE'
      | 'SANTRI_EXIT';
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }) {
    await this.tx().auditLog.create({
      data: {
        tenantId: input.tenantId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        metadata: input.metadata,
      },
    });
  }

  uuid() {
    return crypto.randomUUID();
  }

  private async platformBillingConfig() {
    const config = await this.tx().platformBillingConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (config) {
      return config;
    }
    return this.tx().platformBillingConfig.create({ data: {} });
  }

  private transaction(row: {
    id: string;
    journalId: string;
    idempotencyKey: string;
    tenantId: string;
    santriId: string;
    amount: unknown;
    transactionType: TransactionType;
    status: 'SUCCESS' | 'VOIDED';
    merchantId: string | null;
    terminalId: string | null;
    operatorId: string | null;
    withdrawalReason: string | null;
    createdAt: Date;
  }): LedgerTransaction {
    return {
      id: row.id,
      journalId: row.journalId,
      idempotencyKey: row.idempotencyKey,
      tenantId: row.tenantId,
      santriId: row.santriId,
      amount: number(row.amount),
      type: row.transactionType,
      status: row.status,
      merchantId: row.merchantId,
      terminalId: row.terminalId ?? undefined,
      operatorId: row.operatorId ?? undefined,
      withdrawalReason: row.withdrawalReason ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
