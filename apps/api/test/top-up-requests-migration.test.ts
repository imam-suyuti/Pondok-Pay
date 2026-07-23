import {describe,expect,it} from 'vitest';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations/20260722210000_top_up_requests/migration.sql'),'utf8');
describe('top up request migration',()=>{it('requires positive amounts and forces tenant RLS',()=>{expect(sql).toContain('CHECK(amount > 0)');expect(sql).toContain('ALTER TABLE top_up_requests FORCE ROW LEVEL SECURITY');expect(sql).toContain('tenant_isolation_top_up_requests');});});
