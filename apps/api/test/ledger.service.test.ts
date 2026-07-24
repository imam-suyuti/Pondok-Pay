import { describe, expect, it } from 'vitest';
import {
  LedgerError,
  LedgerService,
  type LedgerAccount,
  type LedgerCard,
  type LedgerEntry,
  type LedgerMerchant,
  type LedgerRepository,
  type LedgerSettlementInvoice,
  type LedgerTransaction,
} from '../src/modules/ledger/ledger.service.js';

class InMemoryLedgerRepository implements LedgerRepository {
  private queue = Promise.resolve();
  private serial = 0;
  readonly entries: LedgerEntry[] = [];
  readonly transactions: LedgerTransaction[] = [];
  readonly audits: unknown[] = [];
  card: LedgerCard = {
    id: 'card',
    tenantId: 'tenant',
    santriId: 'santri',
    status: 'ACTIVE',
    pinHash: 'pin',
  };
  merchant: LedgerMerchant = { id: 'merchant', tenantId: 'tenant', status: 'ACTIVE' };
  santriInactive?: { santriId: string; reason: 'GRADUATED' | 'WITHDRAWN' | 'OTHER' };
  waliRevokedFor?: string;
  settlementInvoice: LedgerSettlementInvoice = {
    id: 'invoice',
    tenantId: 'tenant',
    merchantId: 'merchant',
    closingBalance: 7000,
    status: 'ISSUED',
  };
  paidOut?: { invoiceId: string; staffId: string; amount: number; journalId: string };
  accounts: LedgerAccount[] = [
    { id: 'santri-account', tenantId: 'tenant', entityType: 'SANTRI', entityId: 'santri' },
    { id: 'merchant-account', tenantId: 'tenant', entityType: 'MERCHANT', entityId: 'merchant' },
    { id: 'operating-account', tenantId: 'tenant', entityType: 'PESANTREN_OPERATING_CASH', entityId: 'tenant' },
    { id: 'pool-account', tenantId: 'tenant', entityType: 'PESANTREN_POOL', entityId: 'tenant' },
    { id: 'payable-account', tenantId: 'tenant', entityType: 'PLATFORM_FEE_PAYABLE', entityId: 'tenant' },
  ];

  constructor(initialBalance = 10000) {
    if (initialBalance !== 0) {
      this.entries.push({
        journalId: 'opening',
        accountId: 'santri-account',
        entryType: 'KREDIT',
        amount: initialBalance,
        balanceSnapshot: initialBalance,
        description: 'opening',
      });
    }
  }

  async runSerializable<T>(_tenantId: string, work: () => Promise<T>) {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = next;
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }

  async findTransactionByIdempotency(key: string) {
    return this.transactions.find((transaction) => transaction.idempotencyKey === key);
  }

  async findTransactionById(id: string) {
    return this.transactions.find((transaction) => transaction.id === id);
  }

  async markTransactionVoided(id: string) {
    const transaction = this.transactions.find((row) => row.id === id);
    if (transaction) transaction.status = 'VOIDED';
  }

  async lockCard(id = 'card') {
    return id === this.card.id ? this.card : undefined;
  }

  async lockMerchant() {
    return this.merchant;
  }

  async activeCardIdsForSantri() {
    return this.card.status === 'ACTIVE' ? [this.card.id] : [];
  }

  async markCardInactive() {
    this.card.status = 'INACTIVE';
  }

  async markMerchantInactive(input: { unsettledReceivable: number }) {
    this.merchant.status = 'INACTIVE';
    (this.merchant as LedgerMerchant & { unsettledReceivable?: number }).unsettledReceivable = input.unsettledReceivable;
  }

  async markSantriInactive(santriId: string, reason: 'GRADUATED' | 'WITHDRAWN' | 'OTHER') {
    this.santriInactive = { santriId, reason };
  }

  async revokeWaliRelations(santriId: string) {
    this.waliRevokedFor = santriId;
  }

  async lockSettlementInvoice() {
    return this.settlementInvoice;
  }

  async markSettlementInvoicePaidOut(invoiceId: string, staffId: string, amount: number, journalId: string) {
    this.settlementInvoice.status = 'SETTLED';
    this.paidOut = { invoiceId, staffId, amount, journalId };
  }

  async isAdminInTenant() {
    return true;
  }

  async verifyPin(pin: string) {
    return pin === 'valid';
  }

  async lockAccount(_tenantId: string, type: LedgerAccount['entityType'], id: string) {
    return this.accounts.find((account) => account.entityType === type && account.entityId === id);
  }

  async runningBalance(accountId: string) {
    return this.entries
      .filter((entry) => entry.accountId === accountId)
      .reduce((balance, entry) => balance + (entry.entryType === 'KREDIT' ? entry.amount : -entry.amount), 0);
  }

  async successfulSalesToday() {
    return this.transactions.reduce((total, transaction) => total + transaction.amount, 0);
  }

  async dailyLimit() {
    return 1_000_000;
  }

  async cardFee() {
    return 2000;
  }

  async merchantFee() {
    return 25_000;
  }

  async manualFeeCutoffDay() {
    return 12;
  }

  async merchantDeactivationWriteoffThreshold() {
    return 50_000;
  }

  async cashTopupLimit() {
    return 500_000;
  }

  async cashWithdrawalLimit() {
    return 200_000;
  }

  async appendBalancedEntries(entries: [LedgerEntry, LedgerEntry]) {
    this.entries.push(...entries);
  }

  async createTransaction(transaction: LedgerTransaction) {
    this.transactions.push(transaction);
  }

  async appendAudit(input: unknown) {
    this.audits.push(input);
  }

  credit(accountId: string, amount: number) {
    this.entries.push({ journalId: `seed-${accountId}`, accountId, entryType: 'KREDIT', amount, balanceSnapshot: amount, description: 'seed' });
  }

  debit(accountId: string, amount: number) {
    this.entries.push({ journalId: `seed-${accountId}`, accountId, entryType: 'DEBIT', amount, balanceSnapshot: -amount, description: 'seed' });
  }

  uuid() {
    return `00000000-0000-4000-8000-${String(++this.serial).padStart(12, '0')}`;
  }
}

describe('LedgerService processCharge', () => {
  it('creates immutable balanced entries and returns its idempotent result', async () => {
    const repo = new InMemoryLedgerRepository();
    const service = new LedgerService(repo);
    const command = {
      tenantId: 'tenant',
      cardId: 'card',
      encryptedPin: 'valid',
      merchantId: 'merchant',
      amount: 5000,
      idempotencyKey: 'one',
    };

    const first = await service.processCharge(command);
    const replay = await service.processCharge(command);

    expect(first.newBalance).toBe(5000);
    expect(replay).toMatchObject({ ...first, idempotent: true });
    expect(repo.entries).toHaveLength(3);
    expect(repo.entries.slice(-2).map((entry) => entry.entryType)).toEqual(['DEBIT', 'KREDIT']);
    expect(repo.transactions).toHaveLength(1);
  });

  it('allows only one of 50 concurrent charges against an exact balance', async () => {
    const repo = new InMemoryLedgerRepository(10_000);
    const service = new LedgerService(repo);
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, index) =>
        service.processCharge({
          tenantId: 'tenant',
          cardId: 'card',
          encryptedPin: 'valid',
          merchantId: 'merchant',
          amount: 10_000,
          idempotencyKey: `concurrent-${index}`,
        }),
      ),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (result) => result.status === 'rejected' && (result.reason as LedgerError).code === 'INSUFFICIENT_BALANCE',
      ),
    ).toHaveLength(49);
    expect(await repo.runningBalance('santri-account')).toBe(0);
  });

  it('pays out an issued invoice through one immutable settlement journal and settles it', async () => {
    const repo = new InMemoryLedgerRepository(0);
    repo.credit('merchant-account', 7000);

    const result = await new LedgerService(repo).payoutSettlementInvoice({
      tenantId: 'tenant',
      merchantId: 'merchant',
      invoiceId: 'invoice',
      staffId: 'staff',
      amount: 7000,
    });

    expect(await repo.runningBalance('merchant-account')).toBe(0);
    expect(await repo.runningBalance('operating-account')).toBe(7000);
    expect(repo.paidOut).toEqual({ invoiceId: 'invoice', staffId: 'staff', amount: 7000, journalId: result.journalId });
    expect(repo.settlementInvoice.status).toBe('SETTLED');
    expect(repo.audits).toContainEqual(expect.objectContaining({ action: 'SETTLEMENT_PAYOUT', resourceId: result.journalId }));
  });

  it('rejects an invoice that does not belong to the merchant in the URL', async () => {
    const repo = new InMemoryLedgerRepository();
    await expect(
      new LedgerService(repo).payoutSettlementInvoice({
        tenantId: 'tenant',
        merchantId: 'another-merchant',
        invoiceId: 'invoice',
        staffId: 'staff',
        amount: 1000,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(repo.paidOut).toBeUndefined();
  });

  it('tops up through an Admin terminal by debiting PESANTREN_POOL, not a merchant, and replays idempotently', async () => {
    const repo = new InMemoryLedgerRepository(0);
    const command = {
      tenantId: 'tenant',
      cardId: 'card',
      amount: 5000,
      merchantId: null,
      terminalType: 'ADMIN' as const,
      terminalId: 'admin-terminal',
      operatorId: 'operator',
      idempotencyKey: 'admin-topup',
    };
    const result = await new LedgerService(repo).processTerminalTopup(command);
    const replay = await new LedgerService(repo).processTerminalTopup(command);

    expect(result.newBalance).toBe(5000);
    expect(replay).toMatchObject({ transactionId: result.transactionId, journalId: result.journalId, idempotent: true });
    expect(repo.entries.slice(-2)).toMatchObject([
      { accountId: 'santri-account', entryType: 'KREDIT' },
      { accountId: 'pool-account', entryType: 'DEBIT' },
    ]);
  });

  it('requires PIN and prevents terminal withdrawal beyond its configured limit', async () => {
    const service = new LedgerService(new InMemoryLedgerRepository(300000));
    await expect(
      service.processTerminalWithdrawal({
        tenantId: 'tenant',
        cardId: 'card',
        encryptedPin: 'invalid',
        amount: 1,
        reason: 'Keperluan pulang',
        merchantId: 'merchant',
        terminalId: 'terminal',
        operatorId: 'operator',
        idempotencyKey: 'bad-pin',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_PIN' });
    await expect(
      service.processTerminalWithdrawal({
        tenantId: 'tenant',
        cardId: 'card',
        encryptedPin: 'valid',
        amount: 200001,
        reason: 'Keperluan pulang',
        merchantId: 'merchant',
        terminalId: 'terminal',
        operatorId: 'operator',
        idempotencyKey: 'over-limit',
      }),
    ).rejects.toMatchObject({ code: 'WITHDRAWAL_LIMIT_EXCEEDED' });
  });

  it('replays a successful terminal withdrawal idempotently', async () => {
    const repo = new InMemoryLedgerRepository(10000);
    const service = new LedgerService(repo);
    const command = {
      tenantId: 'tenant',
      cardId: 'card',
      encryptedPin: 'valid',
      amount: 3000,
      reason: 'Uang saku',
      merchantId: 'merchant',
      terminalId: 'terminal',
      operatorId: 'operator',
      idempotencyKey: 'withdrawal-once',
    };
    const first = await service.processTerminalWithdrawal(command);
    const replay = await service.processTerminalWithdrawal(command);
    expect(replay).toMatchObject({ transactionId: first.transactionId, journalId: first.journalId, idempotent: true });
    expect(await repo.runningBalance('santri-account')).toBe(7000);
  });

  it('voids a sale with reversal entries without deleting the original transaction', async () => {
    const repo = new InMemoryLedgerRepository();
    const service = new LedgerService(repo);
    const sale = await service.processCharge({
      tenantId: 'tenant',
      cardId: 'card',
      encryptedPin: 'valid',
      merchantId: 'merchant',
      amount: 5000,
      idempotencyKey: 'voidable',
      now: new Date('2026-07-01T00:00:00Z'),
    });
    const reversal = await service.voidTransaction({
      tenantId: 'tenant',
      transactionId: sale.transactionId,
      staffId: 'staff',
      reason: 'Salah input',
      now: new Date('2026-07-01T00:05:00Z'),
      voidWindowMinutes: 15,
    });

    expect(reversal.journalId).not.toBe(sale.journalId);
    expect(repo.transactions[0].status).toBe('VOIDED');
    expect(repo.entries).toHaveLength(5);
    expect(await repo.runningBalance('santri-account')).toBe(10000);
  });

  it.each([
    { day: 5, balance: 5000, expected: { feeCharged: 0, refundAmount: 5000 } },
    { day: 12, balance: 5000, expected: { feeCharged: 2000, refundAmount: 3000 } },
    { day: 12, balance: 1000, expected: { feeCharged: 1000, refundAmount: 0 } },
    { day: 12, balance: -1000, expected: { feeCharged: 0, refundAmount: 0 } },
  ])('deactivates card manually for cutoff/balance combination %#', async ({ day, balance, expected }) => {
    const repo = new InMemoryLedgerRepository(0);
    if (balance > 0) repo.credit('santri-account', balance);
    if (balance < 0) repo.debit('santri-account', Math.abs(balance));

    const result = await new LedgerService(repo).deactivateCardManual({
      tenantId: 'tenant',
      cardId: 'card',
      staffId: 'staff',
      dayOfMonth: day,
    });

    expect(result).toEqual(expected);
    expect(repo.card.status).toBe('INACTIVE');
    expect(repo.audits).toContainEqual(expect.objectContaining({ action: 'CARD_DEACTIVATED_MANUAL' }));
  });

  it.each([
    { day: 5, balance: 60_000, expected: { feeCharged: 0, settleAmount: 60_000, unsettledReceivable: 0 } },
    { day: 12, balance: 60_000, expected: { feeCharged: 25_000, settleAmount: 35_000, unsettledReceivable: 0 } },
    { day: 12, balance: 10_000, expected: { feeCharged: 10_000, settleAmount: 0, unsettledReceivable: 0 } },
    { day: 12, balance: -60_000, expected: { feeCharged: 0, settleAmount: 0, unsettledReceivable: 60_000 } },
  ])('deactivates merchant manually for cutoff/balance combination %#', async ({ day, balance, expected }) => {
    const repo = new InMemoryLedgerRepository(0);
    if (balance > 0) repo.credit('merchant-account', balance);
    if (balance < 0) repo.debit('merchant-account', Math.abs(balance));

    const result = await new LedgerService(repo).deactivateMerchantManual({
      tenantId: 'tenant',
      merchantId: 'merchant',
      staffId: 'staff',
      dayOfMonth: day,
    });

    expect(result).toEqual(expected);
    expect(repo.merchant.status).toBe('INACTIVE');
    if (expected.unsettledReceivable > 0) {
      expect(repo.audits).toContainEqual(expect.objectContaining({ action: 'MERCHANT_DEACTIVATED_WITH_RECEIVABLE' }));
      expect(await repo.runningBalance('merchant-account')).toBe(-60_000);
    }
  });

  it('deactivates all active cards and revokes wali access during santri exit in the same ledger transaction', async () => {
    const repo = new InMemoryLedgerRepository(5000);
    const result = await new LedgerService(repo).deactivateSantriExit({
      tenantId: 'tenant',
      santriId: 'santri',
      staffId: 'staff',
      reason: 'GRADUATED',
      dayOfMonth: 12,
    });

    expect(result.cardsDeactivated).toEqual([{ feeCharged: 2000, refundAmount: 3000 }]);
    expect(repo.card.status).toBe('INACTIVE');
    expect(repo.santriInactive).toEqual({ santriId: 'santri', reason: 'GRADUATED' });
    expect(repo.waliRevokedFor).toBe('santri');
    expect(repo.audits).toContainEqual(expect.objectContaining({ action: 'SANTRI_EXIT' }));
  });
});
