import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const migration=readFileSync(resolve(import.meta.dirname,'../prisma/migrations/20260721100000_phase1_foundation/migration.sql'),'utf8');
describe('tenant RLS migration',()=>{for(const table of ['staff_users','santri','audit_logs']) it(`enables and forces RLS for ${table}`,()=>{expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);expect(migration).toContain(`tenant_isolation_${table}`);});it('uses transaction tenant setting in every tenant policy',()=>expect((migration.match(/current_setting\('app\.current_tenant_id', true\)/g)??[]).length).toBeGreaterThanOrEqual(6));});
