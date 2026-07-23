import {describe,expect,it} from 'vitest';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations/20260722190000_terminal_rls_bootstrap/migration.sql'),'utf8');
describe('terminal RLS bootstrap migration',()=>{it('uses a narrow security-definer function and revokes public access',()=>{expect(sql).toContain('SECURITY DEFINER');expect(sql).toContain('WHERE device_id = p_device_id');expect(sql).toContain('LIMIT 1');expect(sql).toContain('REVOKE ALL ON FUNCTION terminal_authentication_bootstrap');});});
