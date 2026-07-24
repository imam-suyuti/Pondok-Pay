export interface CardDeactivationLedgerPort {
  deactivateCardManual(input: {
    tenantId: string;
    cardId: string;
    staffId: string;
    dayOfMonth: number;
  }): Promise<{ feeCharged: number; refundAmount: number }>;
}

/**
 * Card module owns the HTTP/use-case boundary; LedgerService owns the complete
 * SERIALIZABLE financial transaction and is the only writer of ledger_entries.
 */
export class CardDeactivationService {
  constructor(private readonly ledger: CardDeactivationLedgerPort) {}

  async deactivate(tenantId: string, cardId: string, staffId: string, dayOfMonth: number) {
    return this.ledger.deactivateCardManual({ tenantId, cardId, staffId, dayOfMonth });
  }
}
