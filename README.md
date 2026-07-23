# PondokPay

Fondasi monorepo untuk platform pembayaran RFID pesantren. Implementasi saat ini adalah **Fase 1 — Core Foundation**.

## Isi Fase 1
- API Fastify + TypeScript strict dan dashboard Next.js.
- Model database awal Prisma serta migrasi PostgreSQL: tenant, staf, wali, santri, relasi wali, RBAC data-driven, refresh token, dan audit log.
- PostgreSQL RLS pada tabel bertenant yang tersedia pada fase ini (`staff_users`, `santri`, `audit_logs`), dengan helper `withTenant()` untuk menetapkan `app.current_tenant_id` secara transaction-local.
- Login JWT 15 menit, refresh token rotasi dalam cookie httpOnly, logout, dan hashing Argon2id.
- UI dashboard awal yang menyaring menu berdasarkan peran JWT, serta halaman Wali Santri mobile-first.
- Kontrak respons API tunggal dan pemetaan error UI bahasa Indonesia.

## Menjalankan lokal

```bash
cp .env.example .env
npm install
docker compose up -d
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run dev --workspace=@pondokpay/api
npm run dev --workspace=@pondokpay/dashboard-web
```

API berjalan pada `http://localhost:3001`; dashboard pada port default Next.js.

> Sebelum produksi, buat PostgreSQL role aplikasi yang tidak memiliki `BYPASSRLS`, serta gunakan koneksi/migrasi terpisah dengan hak administrasi. Semua query tenant berikutnya wajib memakai `withTenant()`.
