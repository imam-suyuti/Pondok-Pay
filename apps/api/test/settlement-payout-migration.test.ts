import {describe,expect,it} from 'vitest';import {readFileSync} from 'node:fs';import {resolve} from 'node:path';
const sql=readFileSync(resolve(import.meta.dirname,'../prisma/migrations/20260722250000_settlement_payout_metadata/migration.sql'),'utf8');
describe('settlement payout metadata migration',()=>{it('records payout amount, journal, approver, and timestamp',()=>{for(const column of ['paid_out_amount','paid_out_journal_id','settled_by','settled_at'])expect(sql).toContain(column);});});
