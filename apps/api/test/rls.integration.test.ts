import { describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const enabled = process.env.RUN_DB_INTEGRATION === '1';
const migrationsDir = resolve(import.meta.dirname, '../prisma/migrations');
const migration = (name: string) => readFileSync(resolve(migrationsDir, `${name}/migration.sql`), 'utf8');

describe.skipIf(!enabled)('PostgreSQL RLS integration', () => {
  it('hides tenant data through RLS and enforces immutable ledger/audit tables', async () => {
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();

    try {
      await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
      for (const name of readdirSync(migrationsDir).sort()) {
        await admin.query(migration(name));
      }

      await admin.query("DO $$ BEGIN CREATE ROLE pondokpay_rls_test LOGIN PASSWORD 'rls-test'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;");
      await admin.query('GRANT USAGE ON SCHEMA public TO pondokpay_rls_test;');
      await admin.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO pondokpay_rls_test;');
      await admin.query('GRANT EXECUTE ON FUNCTION terminal_authentication_bootstrap(VARCHAR) TO pondokpay_rls_test;');

      const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
      const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      const santriA = '11111111-1111-4111-8111-111111111111';
      const santriB = '22222222-2222-4222-8222-222222222222';
      const accountA = '33333333-3333-4333-8333-333333333333';
      const ledgerEntry = '44444444-4444-4444-8444-444444444444';
      const journal = '55555555-5555-4555-8555-555555555555';
      const auditLog = '66666666-6666-4666-8666-666666666666';
      const terminalId = '77777777-7777-4777-8777-777777777777';

      await admin.query('INSERT INTO tenants(id,name,slug) VALUES ($1,$2,$3),($4,$5,$6)', [
        tenantA,
        'Tenant A',
        'tenant-a',
        tenantB,
        'Tenant B',
        'tenant-b',
      ]);
      await admin.query('INSERT INTO santri(id,tenant_id,full_name) VALUES ($1,$2,$3),($4,$5,$6)', [
        santriA,
        tenantA,
        'Santri A',
        santriB,
        tenantB,
        'Santri B',
      ]);
      await admin.query('INSERT INTO accounts(id,tenant_id,entity_type,entity_id) VALUES ($1,$2,$3,$4)', [
        accountA,
        tenantA,
        'SANTRI',
        santriA,
      ]);
      await admin.query(
        'INSERT INTO ledger_entries(id,tenant_id,journal_id,account_id,entry_type,amount) VALUES ($1,$2,$3,$4,$5,$6)',
        [ledgerEntry, tenantA, journal, accountA, 'KREDIT', 1000],
      );
      await admin.query('INSERT INTO audit_logs(id,tenant_id,actor_type,action) VALUES ($1,$2,$3,$4)', [
        auditLog,
        tenantA,
        'SYSTEM',
        'TEST',
      ]);
      await admin.query(
        'INSERT INTO terminals(id,tenant_id,merchant_id,terminal_type,device_id,device_token_hash) VALUES ($1,$2,$3,$4,$5,$6)',
        [terminalId, tenantA, null, 'ADMIN', 'ADMIN-TERM-A', 'argon2-hash'],
      );

      await expect(admin.query('UPDATE ledger_entries SET description=$1 WHERE id=$2', ['forbidden', ledgerEntry])).rejects.toThrow(/immutable table/);
      await expect(admin.query('DELETE FROM audit_logs WHERE id=$1', [auditLog])).rejects.toThrow(/immutable table/);

      const appConnectionString = process.env.DATABASE_URL?.replace(/:\/\/[^:]+:[^@]+@/, '://pondokpay_rls_test:rls-test@');
      const app = new Client({ connectionString: appConnectionString });
      await app.connect();
      try {
        const bootstrap = await app.query('SELECT terminal_id,tenant_id FROM terminal_authentication_bootstrap($1)', [
          'ADMIN-TERM-A',
        ]);
        expect(bootstrap.rows).toEqual([{ terminal_id: terminalId, tenant_id: tenantA }]);

        await app.query("SELECT set_config('app.current_tenant_id',$1,false)", [tenantA]);
        const visibleToTenantA = await app.query('SELECT full_name FROM santri ORDER BY full_name');
        expect(visibleToTenantA.rows).toEqual([{ full_name: 'Santri A' }]);

        await app.query("SELECT set_config('app.current_tenant_id',$1,false)", [tenantB]);
        const visibleToTenantB = await app.query('SELECT full_name FROM santri ORDER BY full_name');
        expect(visibleToTenantB.rows).toEqual([{ full_name: 'Santri B' }]);
      } finally {
        await app.end();
      }
    } finally {
      await admin.end();
    }
  });
});
