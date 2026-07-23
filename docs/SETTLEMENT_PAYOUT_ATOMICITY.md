# Atomic Settlement Payout

Settlement payout must run as one PostgreSQL `SERIALIZABLE` transaction owned by `LedgerService`.

1. Set `app.current_tenant_id`.
2. Lock the settlement invoice with `FOR UPDATE`.
3. Validate `ISSUED` and positive closing balance.
4. Lock the merchant and `PESANTREN_OPERATING_CASH` accounts.
5. Insert immutable debit/credit ledger entries.
6. Update the invoice with `SETTLED`, payout journal, amount, staff, and timestamp.
7. Insert `SETTLEMENT_PAYOUT` audit log.
8. Commit.

Any error rolls back every step. No controller or settlement module may insert ledger entries directly.
