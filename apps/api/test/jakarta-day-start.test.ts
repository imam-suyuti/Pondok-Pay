import {describe,expect,it} from 'vitest';import {jakartaDayStart} from '../src/modules/ledger/ledger-time.js';
describe('Asia Jakarta daily limit boundary',()=>{it('maps a WIB calendar day to 17:00 UTC of prior day',()=>{expect(jakartaDayStart(new Date('2026-07-22T00:30:00+07:00')).toISOString()).toBe('2026-07-21T17:00:00.000Z');});});
