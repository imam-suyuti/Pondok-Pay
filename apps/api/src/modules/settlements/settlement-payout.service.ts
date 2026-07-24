export interface SettlementPayoutCommand {
  tenantId: string;
  merchantId: string;
  invoiceId: string;
  staffId: string;
  amount: number;
}

/**
 * Settlement owns the use-case boundary; LedgerService owns the complete
 * SERIALIZABLE transaction and is the only writer of ledger_entries.
 */
export interface SettlementPayoutLedgerPort {
  payoutSettlementInvoice(command: SettlementPayoutCommand): Promise<{ journalId: string }>;
}

export class SettlementPayoutService {
  constructor(private readonly ledger: SettlementPayoutLedgerPort) {}

  async payout(command: SettlementPayoutCommand) {
    return this.ledger.payoutSettlementInvoice(command);
  }
}
