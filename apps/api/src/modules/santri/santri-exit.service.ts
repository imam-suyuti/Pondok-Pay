export type SantriExitReason = 'GRADUATED' | 'WITHDRAWN' | 'OTHER';

export interface SantriExitLedgerPort {
  deactivateSantriExit(input: {
    tenantId: string;
    santriId: string;
    staffId: string;
    reason: SantriExitReason;
    dayOfMonth: number;
  }): Promise<{ cardsDeactivated: unknown[] }>;
}

/** One public operation for §6.16; LedgerService keeps card closure + santri/wali updates atomic. */
export class SantriExitService {
  constructor(private readonly ledger: SantriExitLedgerPort) {}

  async deactivateSantriExit(
    tenantId: string,
    santriId: string,
    staffId: string,
    reason: SantriExitReason,
    dayOfMonth: number,
  ) {
    return this.ledger.deactivateSantriExit({ tenantId, santriId, staffId, reason, dayOfMonth });
  }
}
