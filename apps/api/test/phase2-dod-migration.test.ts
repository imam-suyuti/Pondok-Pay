import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(import.meta.dirname, '../prisma/migrations/20260726090000_phase2_dod_completion/migration.sql'),
  'utf8',
);

describe('phase 2 DoD completion migration', () => {
  it('adds billing and santri exit fields required by ledger closure flows', () => {
    expect(migration).toContain('card_fee_monthly');
    expect(migration).toContain('merchant_fee_monthly');
    expect(migration).toContain('daily_spend_limit');
    expect(migration).toContain('exit_reason');
    expect(migration).toContain('exited_at');
  });

  it('creates platform billing config and protects tenant platform invoices with RLS', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS platform_billing_config');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS platform_fee_invoices');
    expect(migration).toContain('ALTER TABLE platform_fee_invoices ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('tenant_isolation_platform_fee_invoices');
  });
});
