# Review Raw SQL Ledger

Disetujui oleh product owner pada sesi pengembangan ini untuk menggunakan raw SQL **terbatas** di repository `apps/api/src/modules/ledger/` guna memenuhi kontrak:

- `SERIALIZABLE` transaction;
- `SELECT ... FOR UPDATE` untuk kartu dan akun;
- kalkulasi running balance dari `ledger_entries`;
- idempotency lookup yang konsisten.

Batas wajib:

1. Semua parameter wajib memakai Prisma tagged template/parameter binding; tidak ada string interpolation SQL.
2. Tidak ada raw SQL di controller atau modul selain repository ledger.
3. `ledger_entries` hanya `INSERT`; tidak ada `UPDATE`/`DELETE`.
4. Setiap query tenant dilakukan setelah `app.current_tenant_id` diatur transaction-local.
5. Perubahan repository ledger wajib disertai atau mempertahankan test concurrency.
