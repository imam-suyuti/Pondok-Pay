import {describe,expect,it} from 'vitest';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations/20260722150000_card_pin_reset_sessions/migration.sql'),'utf8');
describe('PIN reset session database isolation',()=>{it('creates an expiring tenant-bound session with forced RLS',()=>{expect(sql).toContain('expires_at TIMESTAMPTZ NOT NULL');expect(sql).toContain('ALTER TABLE card_pin_reset_sessions FORCE ROW LEVEL SECURITY');expect(sql).toContain('tenant_isolation_card_pin_reset_sessions');});});
