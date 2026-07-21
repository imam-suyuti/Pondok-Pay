# PROMPT: BANGUN PLATFORM PONDOKPAY (BACKEND + FRONTEND)

Kamu adalah AI coding agent yang bertugas membangun **backend dan frontend web** untuk
PondokPay — platform pembayaran closed-loop berbasis kartu RFID untuk lingkungan pesantren.
Dokumen ini adalah **satu-satunya sumber kebenaran (single source of truth)** untuk seluruh
kebutuhan software (backend API + web dashboard). Baca seluruhnya sebelum menulis kode apapun.

Di luar scope kamu: firmware/hardware terminal ESP32 (dikerjakan tim terpisah). Kamu tetap
membangun endpoint yang akan dikonsumsi terminal fisik (`/v1/terminal/*`), tapi tidak menulis
kode firmware itu sendiri.

## ATURAN KERAS (TIDAK BOLEH DILANGGAR)

1. **Ledger bersifat immutable.** Tidak ada baris di `ledger_entries` dan `audit_logs` yang
   boleh di-`UPDATE` atau `DELETE`, termasuk lewat migrasi data. Koreksi selalu berupa entri
   penyesuaian baru (reversal entry).
2. **Setiap tabel bertenant wajib punya `tenant_id`** dan wajib diproteksi PostgreSQL
   Row-Level Security (RLS). Tidak ada query yang boleh bypass RLS kecuali proses internal
   Super Admin di luar konteks tenant.
3. Modul `ledger/` di backend TIDAK BOLEH diimpor langsung oleh modul lain kecuali lewat
   `LedgerService`. Tidak ada modul lain yang boleh menulis langsung ke `ledger_entries`.
4. Jika kamu menemukan kebutuhan yang tidak tercakup di dokumen ini: JANGAN improvisasi.
   Tandai `// TODO: OPEN QUESTION` di kode, lanjutkan dengan asumsi paling konservatif
   (paling aman/ketat), dan laporkan di ringkasan akhir pekerjaanmu.
5. Semua kode, nama tabel, nama kolom, dan endpoint API pakai **bahasa Inggris**. Dokumentasi
   dan pesan UI/UX pakai **bahasa Indonesia**.
6. Setiap endpoint API WAJIB mengikuti format response standar di bagian "Format Response API"
   — tidak ada endpoint yang mengembalikan format ad-hoc.
7. Ikuti urutan fase di bagian "Roadmap & Definition of Done" — jangan mulai fase berikutnya
   sebelum DoD fase sebelumnya terpenuhi.
8. **Prinsip prabayar berlaku ketat untuk transaksi santri (SALE, WITHDRAWAL_TERMINAL) — saldo
   TIDAK BOLEH minus.** Satu-satunya pengecualian yang diizinkan: potongan biaya platform
   otomatis (`PLATFORM_FEE_CARD_DEBIT`, lihat §6.8) BOLEH mendorong saldo santri jadi minus.
   Jangan generalisasi pengecualian ini ke transaksi lain manapun.
9. **Saat `tenants.status = 'SUSPENDED'`, kunci total tanpa pengecualian** — termasuk area
   Wali Santri dan penarikan saldo. Satu-satunya endpoint yang tetap boleh diakses adalah login
   Admin Pesantren dan endpoint pembayaran tagihan platform (§9), supaya tenant punya jalan
   keluar dari suspensi. Jangan tambahkan pengecualian lain tanpa instruksi eksplisit.

---

## 1. VISI & RUANG LINGKUP

PondokPay mengeliminasi uang tunai fisik di tangan santri lewat kartu RFID prabayar. Setiap
mutasi dana tercatat di **double-entry ledger** yang immutable, terpusat di cloud, terisolasi
logis per tenant (pesantren). Wali santri memantau & membatasi jajan lewat dashboard web.
Operator merchant memproses transaksi lewat terminal fisik.

**Di luar scope MVP:** multi-currency, marketplace pihak ketiga, sistem kredit/cicilan pada
kartu (murni prabayar — saldo harus tersedia sebelum transaksi disetujui).

---

## 2. AKTOR & RBAC

**Aktor:** Super Admin (platform-wide) · Admin Pesantren (penuh dalam 1 tenant, mencakup
fungsi keuangan yang sebelumnya milik "Bendahara" — role itu tidak ada, sengaja digabung
untuk menyederhanakan operasional) · Operator Merchant (terbatas, lewat terminal fisik,
tidak login ke dashboard web) · Wali Santri (dashboard web area khusus, mobile-first) ·
Santri (tanpa login, pemegang kartu fisik).

**Matriks Izin** (✅ Penuh · (T) Terbatas · ❌ Tidak ada akses):

| Resource / Action | Super Admin | Admin Pesantren | Operator | Wali Santri |
|---|---|---|---|---|
| Kelola tenant (create/suspend) | ✅ | ❌ | ❌ | ❌ |
| Konfigurasi limit global platform | ✅ | ❌ | ❌ | ❌ |
| Konfigurasi fee subscription per kartu (default & override per tenant) | ✅ | ❌ | ❌ | ❌ |
| Kelola master data merchant | ❌ | ✅ | ❌ | ❌ |
| Registrasi/pemetaan kartu RFID | ❌ | ✅ | ❌ | ❌ |
| Freeze/replace kartu hilang | ❌ | ✅ | (T) freeze darurat | (T) lapor saja |
| Alokasi terminal ke merchant | ❌ | ✅ | ❌ | ❌ |
| Proses transaksi charge di terminal | ❌ | ❌ | ✅ | ❌ |
| Top-up tunai via terminal | ❌ | ❌ | (T) maks nominal per transaksi | ❌ |
| Penarikan saldo via terminal | ❌ | ❌ | (T) maks nominal, wajib PIN santri | ❌ |
| Void/refund (window terbatas) | ❌ | ✅ | (T) maks Rp X / N menit | ❌ |
| Approval & pencairan settlement merchant | ❌ | ✅ | ❌ | ❌ |
| Ekspor laporan & audit log | ❌ | ✅ | ❌ | ❌ |
| Set limit jajan harian | ❌ | (T) default tenant | ❌ | ✅ (santri diampu) |
| Top-up saldo santri (non-tunai) | ❌ | ✅ manual | ❌ | ✅ via gateway |
| Lihat riwayat transaksi santri | ❌ | ✅ semua | ❌ | ✅ diampu saja |
| Lihat & kelola invoice settlement merchant | ❌ | ✅ | ❌ | ❌ |

Representasi database: tabel `role_permissions` (data-driven, bukan hardcode). Frontend WAJIB
menyembunyikan/menonaktifkan UI berdasarkan role dari JWT, TAPI backend tetap satu-satunya
penegak aturan sebenarnya — menyembunyikan tombol bukan security boundary.

---

## 3. TECH STACK

| Layer | Teknologi |
|---|---|
| Backend Framework | Node.js LTS + TypeScript (strict mode wajib) |
| Backend Web Framework | Fastify (direkomendasikan) atau Express — pilih satu, konsisten |
| Database | PostgreSQL 15+, RLS aktif di semua tabel bertenant |
| ORM | Prisma atau Drizzle ORM — migrasi terkontrol, tidak ada raw SQL manual tanpa review |
| Cache/Session | Redis — refresh token blacklist, rate limiting, idempotency cache |
| Realtime (Terminal↔Cloud) | WebSocket (`ws`/Socket.IO) dan/atau MQTT broker (Mosquitto/EMQX) |
| Frontend Web | Next.js (App Router) + TypeScript + Tailwind CSS |
| Data-fetching Frontend | React Query atau SWR |
| Auth | JWT access token pendek + Refresh Token rotasi |
| Password/PIN Hash | Argon2id (server-side) |
| Payment Gateway | Midtrans atau Xendit — desain adapter agar mudah ganti |
| Notifikasi | WhatsApp Business API (resmi) + Web Push |
| Deployment | Docker + Docker Compose (dev), target cloud AWS/GCP dengan managed PostgreSQL |
| CI/CD | GitHub Actions: Lint → Test → Build → Deploy |
| Monitoring | Prometheus + Grafana, Sentry untuk error tracking |

---

## 4. STRUKTUR PROYEK

```
pondokpay/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   ├── tenants/
│   │   │   │   ├── cards/
│   │   │   │   ├── terminals/
│   │   │   │   ├── ledger/          # PALING KRITIS, lihat Aturan Keras #3
│   │   │   │   ├── merchants/
│   │   │   │   ├── santri/
│   │   │   │   ├── wali-santri/
│   │   │   │   ├── settlements/     # invoice settlement merchant
│   │   │   │   ├── billing/         # subscription fee platform
│   │   │   │   ├── reports/
│   │   │   │   └── audit/
│   │   │   ├── db/{schema,migrations}/
│   │   │   ├── middlewares/         # authGuard, tenantGuard, rateLimiter
│   │   │   └── shared/
│   │   └── test/
│   └── dashboard-web/               # Next.js: Super Admin, Admin Pesantren, Wali Santri
├── packages/
│   ├── shared-types/                # Kontrak DTO/Zod schema dipakai backend & frontend
│   └── config/                      # ESLint, TSConfig bersama
└── docker-compose.yml
```

Setiap modul backend wajib punya `*.controller.ts` (HTTP layer), `*.service.ts` (business
logic), `*.repository.ts` (query layer). Tidak ada query database langsung di controller.

---

## 5. SKEMA DATABASE (DDL LENGKAP)

> **Model billing (baca sebelum implementasi §6.8–§6.12):** biaya kartu dan biaya merchant
> dipotong OTOMATIS dari saldo masing-masing (ledger internal, bukan uang keluar dari
> pesantren), terkumpul di akun `PLATFORM_FEE_PAYABLE` per tenant. Akumulasi itu lalu jadi
> `platform_fee_invoices` yang WAJIB dibayar Admin Pesantren dengan uang sungguhan lewat
> payment gateway ke pemilik platform. Telat bayar melewati `due_date` → tenant `SUSPENDED`
> total (lihat Aturan Keras #9).

```sql
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(150) NOT NULL,
  slug VARCHAR(60) UNIQUE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED
  subscription_plan VARCHAR(30) NOT NULL DEFAULT 'BASIC',
  card_fee_monthly NUMERIC(15,2),     -- NULL = pakai default platform_billing_config
  merchant_fee_monthly NUMERIC(15,2), -- NULL = pakai default platform_billing_config
  default_daily_limit NUMERIC(15,2) NOT NULL DEFAULT 50000,
  cash_topup_limit_per_tx NUMERIC(15,2) NOT NULL DEFAULT 500000,
  cash_withdrawal_limit_per_tx NUMERIC(15,2) NOT NULL DEFAULT 200000,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Konfigurasi platform-wide, hanya 1 baris, dikelola Super Admin
CREATE TABLE platform_billing_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  default_card_fee_monthly NUMERIC(15,2) NOT NULL DEFAULT 2000,
  default_merchant_fee_monthly NUMERIC(15,2) NOT NULL DEFAULT 25000,
  card_fee_debit_day INT NOT NULL DEFAULT 1,      -- tanggal potong biaya kartu (1-28)
  merchant_fee_debit_day INT NOT NULL DEFAULT 1,  -- tanggal potong biaya merchant (1-28)
  payment_deadline_days INT NOT NULL DEFAULT 7,   -- batas waktu bayar invoice sebelum suspend
  max_consecutive_negative_debits INT NOT NULL DEFAULT 2,
    -- berapa kali berturut-turut kartu boleh minus tanpa top-up sebelum auto-nonaktif;
    -- lihat algoritma §6.7 untuk mekanisme persis
  manual_deactivation_fee_cutoff_day INT NOT NULL DEFAULT 12,
    -- penonaktifan manual sebelum tanggal ini di bulan berjalan = fee kartu/merchant tidak
    -- dikenakan; pada/setelah tanggal ini = fee tetap dikenakan (lihat §6.12, §6.13)
  merchant_deactivation_writeoff_threshold NUMERIC(15,2) NOT NULL DEFAULT 50000,
    -- kalau merchant dinonaktifkan dengan saldo minus SAMPAI ambang ini, ditulis-hapus seperti
    -- biasa. Kalau minusnya LEBIH BESAR dari ini, TIDAK ditulis-hapus otomatis — dicatat
    -- sebagai piutang yang wajib ditagih manual (lihat §6.13)
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID
);

-- Tagihan platform ke tenant: akumulasi potongan biaya kartu + merchant, wajib dibayar
-- sungguhan via payment gateway oleh Admin Pesantren.
CREATE TABLE platform_fee_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  period_year INT NOT NULL,
  period_month INT NOT NULL,
  active_card_count INT NOT NULL,
  card_fee_per_unit NUMERIC(15,2) NOT NULL,
  total_card_fee_amount NUMERIC(15,2) NOT NULL,
  active_merchant_count INT NOT NULL,
  merchant_fee_per_unit NUMERIC(15,2) NOT NULL,
  total_merchant_fee_amount NUMERIC(15,2) NOT NULL,
  total_amount NUMERIC(15,2) NOT NULL, -- total_card_fee_amount + total_merchant_fee_amount
  due_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, OVERDUE
  payment_reference VARCHAR(100), -- referensi dari payment gateway
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, period_year, period_month)
);

CREATE TABLE staff_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id), -- NULL untuk Super Admin
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  phone VARCHAR(20),
  password_hash TEXT NOT NULL,
  role VARCHAR(30) NOT NULL, -- SUPER_ADMIN, ADMIN_PESANTREN, OPERATOR_MERCHANT
  merchant_scope UUID[],
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(30) NOT NULL,
  resource VARCHAR(60) NOT NULL,
  scope VARCHAR(20) NOT NULL DEFAULT 'FULL',
  constraint_json JSONB,
  UNIQUE(role, resource)
);

CREATE TABLE santri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  full_name VARCHAR(150) NOT NULL,
  nis VARCHAR(30),
  gender CHAR(1),
  dormitory VARCHAR(60),
  daily_spend_limit NUMERIC(15,2),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE (lulus/keluar, lihat §6.16)
  exit_reason VARCHAR(30), -- GRADUATED, WITHDRAWN, OTHER — hanya terisi jika status=INACTIVE
  exited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE wali_santri (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) UNIQUE NOT NULL,
  email VARCHAR(150),
  password_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Satu santri HANYA punya satu wali (UNIQUE santri_id) — satu wali boleh mengampu >1 santri.
CREATE TABLE wali_santri_relations (
  wali_id UUID NOT NULL REFERENCES wali_santri(id),
  santri_id UUID NOT NULL REFERENCES santri(id),
  relation_type VARCHAR(20) DEFAULT 'PARENT',
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, REVOKED (dicabut saat santri exit, §6.16)
  PRIMARY KEY (wali_id, santri_id),
  UNIQUE (santri_id)
);

CREATE TABLE cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  santri_id UUID NOT NULL REFERENCES santri(id),
  card_uid VARCHAR(40) NOT NULL,
  pin_hash TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    -- ACTIVE, FROZEN, REPLACED, REVOKED, INACTIVE (nonaktif billing — manual atau auto)
  deactivation_reason VARCHAR(30), -- MANUAL, AUTO_NONPAYMENT — hanya terisi jika status=INACTIVE
  deactivated_at TIMESTAMPTZ,
  consecutive_negative_debits INT NOT NULL DEFAULT 0,
    -- counter berapa kali berturut-turut saldo masih minus setelah potong fee kartu;
    -- reset ke 0 begitu satu siklus potong berakhir dengan saldo >= 0. SAAT PENGGANTIAN KARTU
    -- (§6.14), NILAI INI DIBAWA ke kartu baru, TIDAK di-reset — mencegah celah "lapor hilang"
    -- untuk mereset ambang batas auto-nonaktif.
  issued_at TIMESTAMPTZ DEFAULT now(),
  replaced_from_card_id UUID REFERENCES cards(id),
  UNIQUE(tenant_id, card_uid)
);

CREATE TABLE merchants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name VARCHAR(150) NOT NULL,
  category VARCHAR(50),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, INACTIVE
  deactivation_reason VARCHAR(30), -- MANUAL — hanya terisi jika status=INACTIVE
  deactivated_at TIMESTAMPTZ,
  has_unsettled_receivable BOOLEAN NOT NULL DEFAULT false,
    -- true jika merchant dinonaktifkan dengan saldo minus di atas ambang batas tulis-hapus —
    -- piutang ini WAJIB ditagih manual oleh Admin di luar sistem, bukan hilang diam-diam
  unsettled_receivable_amount NUMERIC(15,2),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE terminals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  merchant_id UUID REFERENCES merchants(id), -- NULL jika terminal_type='ADMIN'
  terminal_type VARCHAR(20) NOT NULL DEFAULT 'MERCHANT', -- MERCHANT, ADMIN
  device_id VARCHAR(80) UNIQUE NOT NULL,
  device_token_hash TEXT NOT NULL,
  firmware_version VARCHAR(20),
  mode VARCHAR(20) NOT NULL DEFAULT 'STANDALONE', -- STANDALONE, INTEGRATED
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE, OFFLINE, SUSPENDED
  last_heartbeat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  CHECK (
    (terminal_type = 'MERCHANT' AND merchant_id IS NOT NULL) OR
    (terminal_type = 'ADMIN' AND merchant_id IS NULL)
  )
);

-- Sesi handshake pendaftaran kartu baru: terminal baca UID → dashboard Admin pilih santri →
-- terminal terima sinyal untuk minta santri buat PIN. Lihat alur lengkap di §6.14.
CREATE TABLE card_registration_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  terminal_id UUID NOT NULL REFERENCES terminals(id),
  card_uid VARCHAR(40) NOT NULL,
  santri_id UUID REFERENCES santri(id), -- terisi setelah Admin pilih di web
  status VARCHAR(20) NOT NULL DEFAULT 'SCANNED',
    -- SCANNED, SANTRI_SELECTED, PIN_SET, COMPLETED, EXPIRED, CANCELLED
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL -- sesi kedaluwarsa 5 menit sejak dibuat
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  entity_type VARCHAR(30) NOT NULL, -- SANTRI, MERCHANT, PESANTREN_POOL, GATEWAY_SETTLEMENT,
                                     -- PLATFORM_REVENUE, PESANTREN_OPERATING_CASH, PLATFORM_FEE_PAYABLE
  entity_id UUID NOT NULL,
  currency VARCHAR(3) DEFAULT 'IDR',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, entity_type, entity_id)
);

CREATE TABLE ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  journal_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES accounts(id),
  entry_type VARCHAR(6) NOT NULL CHECK (entry_type IN ('DEBIT','KREDIT')),
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  balance_snapshot NUMERIC(15,2),
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_ledger_account_date ON ledger_entries(account_id, created_at DESC);
CREATE INDEX idx_ledger_journal ON ledger_entries(journal_id);

CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  journal_id UUID NOT NULL UNIQUE,
  transaction_type VARCHAR(30) NOT NULL DEFAULT 'SALE', -- SALE, TOPUP_TERMINAL, WITHDRAWAL_TERMINAL
  card_id UUID REFERENCES cards(id),
  santri_id UUID REFERENCES santri(id),
  merchant_id UUID REFERENCES merchants(id),
  terminal_id UUID REFERENCES terminals(id),
  operator_id UUID REFERENCES staff_users(id),
  withdrawal_reason VARCHAR(50),
  amount NUMERIC(15,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
  idempotency_key VARCHAR(80) UNIQUE NOT NULL,
  voided_by UUID REFERENCES staff_users(id),
  voided_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_transactions_santri_date ON transactions(santri_id, created_at DESC);
CREATE INDEX idx_transactions_merchant_type_date ON transactions(merchant_id, transaction_type, created_at DESC);

CREATE TABLE merchant_settlement_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  merchant_id UUID NOT NULL REFERENCES merchants(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  opening_balance NUMERIC(15,2) NOT NULL,
  total_sales NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_withdrawals_paid NUMERIC(15,2) NOT NULL DEFAULT 0,
  total_topup_collected NUMERIC(15,2) NOT NULL DEFAULT 0,
  closing_balance NUMERIC(15,2) NOT NULL, -- positif = pondok berutang merchant, negatif = sebaliknya
  settlement_action VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID_OUT, CARRIED_FORWARD
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT', -- DRAFT, ISSUED, SETTLED
  paid_out_amount NUMERIC(15,2),
  paid_out_journal_id UUID,
  settled_by UUID REFERENCES staff_users(id),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, merchant_id, period_start, period_end)
);

CREATE TABLE top_up_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  santri_id UUID NOT NULL REFERENCES santri(id),
  initiated_by_type VARCHAR(20) NOT NULL, -- ADMIN_PESANTREN, WALI_SANTRI
  initiated_by_id UUID NOT NULL,
  amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
  channel VARCHAR(20) NOT NULL, -- MANUAL, QRIS, VIRTUAL_ACCOUNT
  gateway_reference VARCHAR(100),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING', -- PENDING, SUCCESS, FAILED, EXPIRED
  journal_id UUID REFERENCES ledger_entries(journal_id),
  created_at TIMESTAMPTZ DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  actor_type VARCHAR(20) NOT NULL, -- STAFF, WALI_SANTRI, SYSTEM, TERMINAL
  actor_id UUID,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(50),
  resource_id UUID,
  ip_address INET,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  recipient_type VARCHAR(20) NOT NULL, -- WALI_SANTRI, STAFF
  recipient_id UUID NOT NULL,
  channel VARCHAR(20) NOT NULL, -- WHATSAPP, PUSH, EMAIL
  template VARCHAR(50) NOT NULL,
  payload JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'QUEUED',
  created_at TIMESTAMPTZ DEFAULT now()
);
```

RLS wajib di semua tabel bertenant, contoh pola:
```sql
ALTER TABLE santri ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_santri ON santri
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
-- Terapkan pola sama ke: cards, merchants, terminals, accounts, ledger_entries,
-- transactions, top_up_requests, notifications, staff_users, merchant_settlement_invoices
```

Setiap request API wajib menetapkan `app.current_tenant_id` di awal transaksi database
(lewat middleware `tenantGuard`) sebelum query apapun dijalankan.

---

## 6. LEDGER ENGINE — ALGORITMA WAJIB

Formula saldo: `Saldo(t) = Σ(Kredit) − Σ(Debit) + Σ(Penyesuaian)`. Saldo TIDAK PERNAH dibaca
dari kolom mutable — selalu dihitung dari akumulasi `ledger_entries`. `balance_snapshot`
hanya optimasi baca, bukan sumber kebenaran.

### 6.1 processCharge (jual, di terminal)
```
FUNCTION processCharge(tenantId, cardId, pin, amount, merchantId, idempotencyKey):
  BEGIN DB TRANSACTION (ISOLATION LEVEL: SERIALIZABLE)
    SET app.current_tenant_id = tenantId
    existing = SELECT * FROM transactions WHERE idempotency_key = idempotencyKey
    IF existing EXISTS: COMMIT AND RETURN existing

    card = SELECT * FROM cards WHERE id=cardId AND tenant_id=tenantId FOR UPDATE
    IF card.status != 'ACTIVE': ABORT 'CARD_NOT_ACTIVE'
    IF NOT verifyPin(pin, card.pin_hash): ABORT 'INVALID_PIN'

    santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id FOR UPDATE
    merchantAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=merchantId FOR UPDATE

    currentBalance = getRunningBalance(santriAccount.id)
    IF currentBalance < amount: ABORT 'INSUFFICIENT_BALANCE'

    spentToday = SUM(amount) FROM transactions WHERE santri_id=card.santri_id AND status='SUCCESS'
      AND transaction_type='SALE' AND created_at >= today_00:00_tenant_timezone
    dailyLimit = card.santri.daily_spend_limit OR tenant.default_daily_limit
    IF (spentToday + amount) > dailyLimit: ABORT 'DAILY_LIMIT_EXCEEDED'

    journalId = generateUUID()
    INSERT ledger_entries (journal_id, account_id=santriAccount.id, entry_type='DEBIT', amount, balance_snapshot=currentBalance-amount)
    INSERT ledger_entries (journal_id, account_id=merchantAccount.id, entry_type='KREDIT', amount, balance_snapshot=getRunningBalance(merchantAccount.id)+amount)
    INSERT transactions (journal_id, transaction_type='SALE', card_id, santri_id=card.santri_id, merchant_id, terminal_id, amount, status='SUCCESS', idempotency_key)
    INSERT audit_logs (action='TRANSACTION_CHARGE', resource_id=journalId, ...)
  COMMIT
  ENQUEUE notification ke wali_santri (async)
  RETURN { status:'SUCCESS', journalId, newBalance: currentBalance-amount }
```
Mitigasi race condition: `SELECT ... FOR UPDATE` mengunci baris `accounts`. Isolation level
`SERIALIZABLE`; retry otomatis maks 3x dengan backoff pada serialization failure sebelum
return error. `idempotency_key` di-generate per percobaan (bukan per retry).

### 6.2 voidTransaction (reversal, bukan delete)
```
FUNCTION voidTransaction(transactionId, staffId, reason):
  original = SELECT * FROM transactions WHERE id=transactionId
  IF original.status != 'SUCCESS': ABORT 'CANNOT_VOID'
  IF now() - original.created_at > VOID_WINDOW_MINUTES: ABORT 'VOID_WINDOW_EXPIRED'
  BEGIN TRANSACTION
    reversalJournalId = generateUUID()
    INSERT ledger_entries (journal_id=reversalJournalId, account_id=santriAccount, entry_type='KREDIT', amount=original.amount, ...)
    INSERT ledger_entries (journal_id=reversalJournalId, account_id=merchantAccount, entry_type='DEBIT', amount=original.amount, ...)
    UPDATE transactions SET status='VOIDED', voided_by=staffId, voided_reason=reason WHERE id=transactionId
    -- SATU-SATUNYA UPDATE yang diizinkan di tabel transactions. ledger_entries TIDAK PERNAH diubah/dihapus.
    INSERT audit_logs (action='TRANSACTION_VOID', ...)
  COMMIT
```

### 6.3 processTerminalTopup (top-up tunai di kasir merchant ATAU di terminal Admin Pesantren)
Arah ledger KEBALIKAN dari charge: pihak yang memegang cash di-DEBIT, santri di-KREDIT. Tidak
perlu PIN — wajib tap kartu untuk identifikasi + idempotency. Kalau dilakukan dari **terminal
merchant** (`terminal_type='MERCHANT'`), yang di-DEBIT adalah akun merchant tersebut. Kalau
dari **terminal Admin Pesantren** (`terminal_type='ADMIN'`, `merchantId` NULL), yang di-DEBIT
adalah `PESANTREN_POOL` milik tenant — karena cash-nya diterima langsung oleh pihak pondok,
bukan lewat merchant.
```
FUNCTION processTerminalTopup(tenantId, cardId, amount, merchantId, terminalId, operatorId, idempotencyKey):
  BEGIN DB TRANSACTION (SERIALIZABLE)
    SET app.current_tenant_id = tenantId
    existing = SELECT * FROM transactions WHERE idempotency_key=idempotencyKey
    IF existing EXISTS: COMMIT AND RETURN existing
    card = SELECT * FROM cards WHERE id=cardId AND tenant_id=tenantId FOR UPDATE
    IF card.status != 'ACTIVE': ABORT 'CARD_NOT_ACTIVE'
    tenantConfig = SELECT cash_topup_limit_per_tx FROM tenants WHERE id=tenantId
    IF amount > tenantConfig.cash_topup_limit_per_tx: ABORT 'TOPUP_LIMIT_EXCEEDED'
    santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id FOR UPDATE

    IF merchantId IS NOT NULL:
      cashSourceAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=merchantId FOR UPDATE
    ELSE:
      cashSourceAccount = SELECT * FROM accounts WHERE entity_type='PESANTREN_POOL' AND tenant_id=tenantId FOR UPDATE

    journalId = generateUUID()
    INSERT ledger_entries (journal_id, account_id=santriAccount.id, entry_type='KREDIT', amount, ...)
    INSERT ledger_entries (journal_id, account_id=cashSourceAccount.id, entry_type='DEBIT', amount, ...)
    INSERT transactions (journal_id, transaction_type='TOPUP_TERMINAL', card_id, santri_id=card.santri_id, merchant_id=merchantId, terminal_id, operator_id, amount, status='SUCCESS', idempotency_key)
    INSERT audit_logs (action='TERMINAL_TOPUP', actor_id=operatorId, resource_id=journalId, ...)
  COMMIT
  RETURN { status:'SUCCESS', journalId, newBalance: getRunningBalance(santriAccount.id) }
```

### 6.4 processTerminalWithdrawal (tarik saldo di kasir)
Arah ledger SAMA seperti charge (santri DEBIT, merchant KREDIT). WAJIB PIN santri.
```
FUNCTION processTerminalWithdrawal(tenantId, cardId, pin, amount, reason, merchantId, terminalId, operatorId, idempotencyKey):
  BEGIN DB TRANSACTION (SERIALIZABLE)
    SET app.current_tenant_id = tenantId
    existing = SELECT * FROM transactions WHERE idempotency_key=idempotencyKey
    IF existing EXISTS: COMMIT AND RETURN existing
    card = SELECT * FROM cards WHERE id=cardId AND tenant_id=tenantId FOR UPDATE
    IF card.status != 'ACTIVE': ABORT 'CARD_NOT_ACTIVE'
    IF NOT verifyPin(pin, card.pin_hash): ABORT 'INVALID_PIN'
    tenantConfig = SELECT cash_withdrawal_limit_per_tx FROM tenants WHERE id=tenantId
    IF amount > tenantConfig.cash_withdrawal_limit_per_tx: ABORT 'WITHDRAWAL_LIMIT_EXCEEDED'
    santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id FOR UPDATE
    merchantAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=merchantId FOR UPDATE
    currentBalance = getRunningBalance(santriAccount.id)
    IF currentBalance < amount: ABORT 'INSUFFICIENT_BALANCE'
    -- Catatan: TIDAK dipotong dari daily_spend_limit (itu untuk belanja, bukan tarik tunai)
    journalId = generateUUID()
    INSERT ledger_entries (journal_id, account_id=santriAccount.id, entry_type='DEBIT', amount, ...)
    INSERT ledger_entries (journal_id, account_id=merchantAccount.id, entry_type='KREDIT', amount, ...)
    INSERT transactions (journal_id, transaction_type='WITHDRAWAL_TERMINAL', card_id, santri_id=card.santri_id, merchant_id, terminal_id, operator_id, withdrawal_reason=reason, amount, status='SUCCESS', idempotency_key)
    INSERT audit_logs (action='TERMINAL_WITHDRAWAL', actor_id=operatorId, resource_id=journalId, ...)
  COMMIT
  RETURN { status:'SUCCESS', journalId, newBalance: currentBalance-amount }
```

### 6.5 generateWeeklySettlementInvoice (cron mingguan, netting otomatis)
Karena arah debit/kredit SALE dan WITHDRAWAL_TERMINAL sama (KREDIT merchant), dan
TOPUP_TERMINAL berlawanan (DEBIT merchant), saldo akun merchant SUDAH otomatis netto — fungsi
ini murni snapshot pelaporan.
```
FUNCTION generateWeeklySettlementInvoice(tenantId, merchantId, periodStart, periodEnd):
  prevInvoice = SELECT * FROM merchant_settlement_invoices WHERE merchant_id=merchantId AND period_end=periodStart-1day
  openingBalance = prevInvoice ? prevInvoice.closing_balance : 0
  totalSales = SUM(amount) FROM transactions WHERE merchant_id=merchantId AND transaction_type='SALE' AND status='SUCCESS' AND created_at BETWEEN periodStart AND periodEnd
  totalWithdrawals = SUM(amount) FROM transactions WHERE merchant_id=merchantId AND transaction_type='WITHDRAWAL_TERMINAL' AND status='SUCCESS' AND created_at BETWEEN periodStart AND periodEnd
  totalTopup = SUM(amount) FROM transactions WHERE merchant_id=merchantId AND transaction_type='TOPUP_TERMINAL' AND status='SUCCESS' AND created_at BETWEEN periodStart AND periodEnd
  closingBalance = openingBalance + totalSales + totalWithdrawals - totalTopup
  -- Saldo NEGATIF di-netting otomatis, TIDAK memaksa setor tunai segera.
  settlementAction = closingBalance < 0 ? 'CARRIED_FORWARD' : 'PENDING'
  INSERT merchant_settlement_invoices (tenant_id, merchant_id, period_start=periodStart, period_end=periodEnd,
    opening_balance=openingBalance, total_sales=totalSales, total_withdrawals_paid=totalWithdrawals,
    total_topup_collected=totalTopup, closing_balance=closingBalance, settlement_action=settlementAction, status='ISSUED')
  RETURN invoice
```

### 6.6 payoutSettlementInvoice (Admin cairkan saldo positif ke merchant)
```
FUNCTION payoutSettlementInvoice(invoiceId, staffId, payoutAmount):
  invoice = SELECT * FROM merchant_settlement_invoices WHERE id=invoiceId
  IF invoice.closing_balance <= 0: ABORT 'NOTHING_TO_PAY_OUT'
  IF payoutAmount > invoice.closing_balance: ABORT 'PAYOUT_EXCEEDS_BALANCE'
  BEGIN TRANSACTION
    journalId = generateUUID()
    merchantAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=invoice.merchant_id FOR UPDATE
    operatingCashAccount = SELECT * FROM accounts WHERE entity_type='PESANTREN_OPERATING_CASH' AND tenant_id=invoice.tenant_id FOR UPDATE
    INSERT ledger_entries (journal_id=journalId, account_id=merchantAccount.id, entry_type='DEBIT', amount=payoutAmount, ...)
    INSERT ledger_entries (journal_id=journalId, account_id=operatingCashAccount.id, entry_type='KREDIT', amount=payoutAmount, ...)
    UPDATE merchant_settlement_invoices SET status='SETTLED', settlement_action='PAID_OUT', paid_out_amount=payoutAmount, paid_out_journal_id=journalId, settled_by=staffId, settled_at=now() WHERE id=invoiceId
    INSERT audit_logs (action='SETTLEMENT_PAYOUT', actor_id=staffId, resource_id=journalId, ...)
  COMMIT
```

### 6.7 debitCardFee (cron terjadwal — `card_fee_debit_day`, PENGECUALIAN saldo boleh minus)

> Satu-satunya fungsi di seluruh sistem yang boleh mendorong saldo santri jadi negatif
> (lihat Aturan Keras #8). Tidak wajib PIN — ini debit sistem, bukan transaksi atas perintah
> santri. Tidak masuk hitungan `daily_spend_limit`.
>
> **Ambang batas auto-nonaktif:** `platformConfig.max_consecutive_negative_debits` (N) adalah
> jumlah siklus berturut-turut kartu BOLEH berakhir minus sebelum siklus berikutnya
> menonaktifkan kartu alih-alih memotong lagi. Pengecekan terjadi DI AWAL setiap siklus per
> kartu — kalau `consecutive_negative_debits >= N`, kartu langsung dinonaktifkan dan **fee
> siklus ini tidak pernah dipotong** (bukan dipotong-lalu-dihapus, tapi memang tidak pernah
> disentuh) — itu yang membuatnya tidak masuk hitungan `platform_fee_invoices`.
> Contoh N=2: minus di siklus 1 dan 2 (counter jadi 2) → di siklus 3, counter(2) >= N(2) →
> nonaktifkan, fee siklus 3 tidak dipotong. Contoh N=1: minus di siklus 1 (counter jadi 1) →
> di siklus 2, counter(1) >= N(1) → nonaktifkan, fee siklus 2 tidak dipotong.

```
FUNCTION debitCardFee(tenantId, periodYear, periodMonth):
  tenant = SELECT * FROM tenants WHERE id=tenantId
  platformConfig = SELECT * FROM platform_billing_config LIMIT 1
  feePerCard = tenant.card_fee_monthly OR platformConfig.default_card_fee_monthly
  N = platformConfig.max_consecutive_negative_debits
  payableAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_FEE_PAYABLE' AND tenant_id=tenantId FOR UPDATE

  cardsProcessed = 0
  cardsAutoDeactivated = 0
  totalDebited = 0

  FOR EACH card IN (SELECT * FROM cards WHERE tenant_id=tenantId AND status='ACTIVE'):
    BEGIN TRANSACTION
      lockedCard = SELECT * FROM cards WHERE id=card.id FOR UPDATE

      IF lockedCard.consecutive_negative_debits >= N:
        -- Ambang batas tercapai: JANGAN potong siklus ini, langsung nonaktifkan
        UPDATE cards SET status='INACTIVE', deactivation_reason='AUTO_NONPAYMENT',
          deactivated_at=now(), consecutive_negative_debits=0 WHERE id=card.id
        INSERT audit_logs (action='CARD_AUTO_DEACTIVATED_NONPAYMENT', resource_type='card',
          resource_id=card.id, metadata={consecutiveNegativeDebits: lockedCard.consecutive_negative_debits}, ...)
        ENQUEUE notification ke wali_santri (template: 'kartu_nonaktif_otomatis', async)
        cardsAutoDeactivated += 1
      ELSE:
        santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id FOR UPDATE
        journalId = generateUUID()
        INSERT ledger_entries (journal_id=journalId, account_id=santriAccount.id, entry_type='DEBIT', amount=feePerCard, description='Biaya langganan kartu bulanan')
        -- TIDAK ADA pengecekan currentBalance >= feePerCard di sini — lihat Aturan Keras #8
        INSERT ledger_entries (journal_id=journalId, account_id=payableAccount.id, entry_type='KREDIT', amount=feePerCard, ...)
        INSERT audit_logs (action='PLATFORM_FEE_CARD_DEBIT', resource_type='card', resource_id=card.id, metadata={amount: feePerCard}, ...)

        newBalance = getRunningBalance(santriAccount.id)
        IF newBalance < 0:
          UPDATE cards SET consecutive_negative_debits = lockedCard.consecutive_negative_debits + 1 WHERE id=card.id
          ENQUEUE notification ke wali_santri (template: 'saldo_minus_biaya_kartu', async) -- wajib, transparansi ke wali
        ELSE:
          UPDATE cards SET consecutive_negative_debits = 0 WHERE id=card.id

        cardsProcessed += 1
        totalDebited += feePerCard
    COMMIT

  RETURN { cardsProcessed, cardsAutoDeactivated, totalDebited }
```

### 6.8 debitMerchantFee (cron terjadwal — `merchant_fee_debit_day`)

```
FUNCTION debitMerchantFee(tenantId, periodYear, periodMonth):
  tenant = SELECT * FROM tenants WHERE id=tenantId
  platformConfig = SELECT * FROM platform_billing_config LIMIT 1
  feePerMerchant = tenant.merchant_fee_monthly OR platformConfig.default_merchant_fee_monthly
  payableAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_FEE_PAYABLE' AND tenant_id=tenantId FOR UPDATE

  FOR EACH merchant IN (SELECT * FROM merchants WHERE tenant_id=tenantId AND status='ACTIVE'):
    BEGIN TRANSACTION
      merchantAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=merchant.id FOR UPDATE
      journalId = generateUUID()
      INSERT ledger_entries (journal_id=journalId, account_id=merchantAccount.id, entry_type='DEBIT', amount=feePerMerchant, description='Biaya langganan merchant bulanan')
      INSERT ledger_entries (journal_id=journalId, account_id=payableAccount.id, entry_type='KREDIT', amount=feePerMerchant, ...)
      INSERT audit_logs (action='PLATFORM_FEE_MERCHANT_DEBIT', resource_type='merchant', resource_id=merchant.id, metadata={amount: feePerMerchant}, ...)
    COMMIT
    -- Merchant BOLEH negatif tanpa pengecualian khusus — sudah konsisten dengan desain netting settlement (§6.5)

  RETURN { merchantsProcessed: count, totalDebited: count * feePerMerchant }
```

### 6.9 generatePlatformFeeInvoice (cron bulanan, setelah §6.7 dan §6.8 selesai)

```
FUNCTION generatePlatformFeeInvoice(tenantId, periodYear, periodMonth, cardResult, merchantResult):
  platformConfig = SELECT * FROM platform_billing_config LIMIT 1
  totalAmount = cardResult.totalDebited + merchantResult.totalDebited
  dueDate = today() + platformConfig.payment_deadline_days

  INSERT platform_fee_invoices (tenant_id=tenantId, period_year=periodYear, period_month=periodMonth,
    active_card_count=cardResult.cardsProcessed, card_fee_per_unit=feePerCard, total_card_fee_amount=cardResult.totalDebited,
    active_merchant_count=merchantResult.merchantsProcessed, merchant_fee_per_unit=feePerMerchant, total_merchant_fee_amount=merchantResult.totalDebited,
    total_amount=totalAmount, due_date=dueDate, status='PENDING')

  ENQUEUE notification ke Admin Pesantren (template: 'tagihan_platform_baru', async)
```

### 6.10 payPlatformFeeInvoice (dipicu webhook payment gateway setelah Admin Pesantren bayar)

```
FUNCTION payPlatformFeeInvoice(invoiceId, gatewayReference, amountPaid):
  invoice = SELECT * FROM platform_fee_invoices WHERE id=invoiceId
  IF invoice.status = 'PAID': RETURN invoice -- idempotent terhadap webhook duplikat
  IF amountPaid < invoice.total_amount: ABORT 'PAYMENT_AMOUNT_MISMATCH'

  BEGIN TRANSACTION
    journalId = generateUUID()
    payableAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_FEE_PAYABLE' AND tenant_id=invoice.tenant_id FOR UPDATE
    platformRevenueAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_REVENUE' AND tenant_id=invoice.tenant_id FOR UPDATE
    INSERT ledger_entries (journal_id=journalId, account_id=payableAccount.id, entry_type='DEBIT', amount=invoice.total_amount, description='Pelunasan tagihan platform via gateway')
    INSERT ledger_entries (journal_id=journalId, account_id=platformRevenueAccount.id, entry_type='KREDIT', amount=invoice.total_amount, ...)
    UPDATE platform_fee_invoices SET status='PAID', payment_reference=gatewayReference, paid_at=now() WHERE id=invoiceId
    -- Jika tenant sedang SUSPENDED karena invoice ini, pulihkan aksesnya
    UPDATE tenants SET status='ACTIVE' WHERE id=invoice.tenant_id AND status='SUSPENDED'
    INSERT audit_logs (action='PLATFORM_INVOICE_PAID', resource_id=journalId, metadata={invoiceId, gatewayReference}, ...)
  COMMIT
```

### 6.11 suspendOverdueTenants (cron harian, kunci total — Aturan Keras #9)

```
FUNCTION suspendOverdueTenants():
  overdueInvoices = SELECT * FROM platform_fee_invoices
    WHERE status='PENDING' AND due_date < today()

  FOR EACH invoice IN overdueInvoices:
    UPDATE platform_fee_invoices SET status='OVERDUE' WHERE id=invoice.id
    UPDATE tenants SET status='SUSPENDED' WHERE id=invoice.tenant_id
    INSERT audit_logs (action='TENANT_SUSPENDED_NONPAYMENT', tenant_id=invoice.tenant_id, actor_type='SYSTEM', metadata={invoiceId: invoice.id}, ...)
    ENQUEUE notification ke Admin Pesantren (template: 'tenant_disuspend', async)
```

### 6.12 deactivateCardManual (Admin Pesantren nonaktifkan kartu secara manual)

> Aturan penutupan: kalau saldo minus → fee TIDAK dikenakan (tidak ada yang bisa ditagih dari
> saldo negatif). Kalau tanggal hari ini SEBELUM `manual_deactivation_fee_cutoff_day` → fee
> TIDAK dikenakan sama sekali, sisa saldo (berapapun) dikembalikan tunai penuh. Kalau tanggal
> hari ini PADA/SETELAH cutoff → fee dikenakan: jika saldo cukup, potong fee lalu sisanya
> dikembalikan tunai; jika saldo ada tapi kurang dari fee, SELURUH sisa saldo itu jadi fee
> (kekurangannya ditulis-hapus, TIDAK ditagih ke pesantren).

```
FUNCTION deactivateCardManual(cardId, staffId):
  card = SELECT * FROM cards WHERE id=cardId FOR UPDATE
  IF card.status != 'ACTIVE': ABORT 'CARD_ALREADY_INACTIVE'
  santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id FOR UPDATE
  currentBalance = getRunningBalance(santriAccount.id)
  tenant = SELECT * FROM tenants WHERE id=card.tenant_id
  platformConfig = SELECT * FROM platform_billing_config LIMIT 1
  feePerCard = tenant.card_fee_monthly OR platformConfig.default_card_fee_monthly
  chargeFee = day_of_month(today()) >= platformConfig.manual_deactivation_fee_cutoff_day

  IF NOT chargeFee OR currentBalance < 0:
    feeCharged = 0
    refundAmount = MAX(currentBalance, 0)
  ELSE IF currentBalance >= feePerCard:
    feeCharged = feePerCard
    refundAmount = currentBalance - feePerCard
  ELSE:
    feeCharged = MAX(currentBalance, 0) -- seluruh sisa saldo jadi fee, kekurangan ditulis-hapus
    refundAmount = 0

  BEGIN TRANSACTION
    IF feeCharged > 0:
      journalId = generateUUID()
      payableAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_FEE_PAYABLE' AND tenant_id=card.tenant_id FOR UPDATE
      INSERT ledger_entries (journal_id=journalId, account_id=santriAccount.id, entry_type='DEBIT', amount=feeCharged, description='Fee penutupan kartu')
      INSERT ledger_entries (journal_id=journalId, account_id=payableAccount.id, entry_type='KREDIT', amount=feeCharged, ...)
    IF refundAmount > 0:
      refundJournalId = generateUUID()
      operatingCashAccount = SELECT * FROM accounts WHERE entity_type='PESANTREN_OPERATING_CASH' AND tenant_id=card.tenant_id FOR UPDATE
      INSERT ledger_entries (journal_id=refundJournalId, account_id=santriAccount.id, entry_type='DEBIT', amount=refundAmount, description='Refund tunai penutupan kartu')
      INSERT ledger_entries (journal_id=refundJournalId, account_id=operatingCashAccount.id, entry_type='KREDIT', amount=refundAmount, ...)
    UPDATE cards SET status='INACTIVE', deactivation_reason='MANUAL', deactivated_at=now() WHERE id=cardId
    INSERT audit_logs (action='CARD_DEACTIVATED_MANUAL', actor_id=staffId, resource_id=cardId, metadata={feeCharged, refundAmount}, ...)
  COMMIT
  RETURN { feeCharged, refundAmount }
```

### 6.13 deactivateMerchantManual (Admin Pesantren nonaktifkan merchant secara manual)

> Aturan sama seperti kartu (§6.12), tapi sisi "refund" di sini adalah settlement akhir ke
> merchant (bukan refund tunai ke santri) — konsisten dengan arah saldo merchant yang sudah
> ada (positif = pondok berutang ke merchant).
>
> **Piutang saat saldo minus (fix celah #8):** kalau saldo merchant minus SAMPAI
> `merchant_deactivation_writeoff_threshold`, tetap ditulis-hapus seperti sebelumnya (jumlahnya
> kecil, tidak sepadan diurus manual). Tapi kalau minusnya LEBIH BESAR dari ambang itu, JANGAN
> ditulis-hapus otomatis — itu piutang riil yang harus ditagih Admin di luar sistem (transfer
> bank, dsb). Sistem hanya mencatatnya sebagai `has_unsettled_receivable=true` supaya tidak
> hilang tanpa jejak, dan memberi tahu Admin lewat notifikasi + daftar khusus di dashboard.

```
FUNCTION deactivateMerchantManual(merchantId, staffId):
  merchant = SELECT * FROM merchants WHERE id=merchantId FOR UPDATE
  IF merchant.status != 'ACTIVE': ABORT 'MERCHANT_ALREADY_INACTIVE'
  merchantAccount = SELECT * FROM accounts WHERE entity_type='MERCHANT' AND entity_id=merchantId FOR UPDATE
  currentBalance = getRunningBalance(merchantAccount.id)
  tenant = SELECT * FROM tenants WHERE id=merchant.tenant_id
  platformConfig = SELECT * FROM platform_billing_config LIMIT 1
  feePerMerchant = tenant.merchant_fee_monthly OR platformConfig.default_merchant_fee_monthly
  chargeFee = day_of_month(today()) >= platformConfig.manual_deactivation_fee_cutoff_day

  IF currentBalance < 0 AND ABS(currentBalance) > platformConfig.merchant_deactivation_writeoff_threshold:
    -- Piutang terlalu besar untuk ditulis-hapus diam-diam
    BEGIN TRANSACTION
      UPDATE merchants SET status='INACTIVE', deactivation_reason='MANUAL', deactivated_at=now(),
        has_unsettled_receivable=true, unsettled_receivable_amount=ABS(currentBalance) WHERE id=merchantId
      INSERT audit_logs (action='MERCHANT_DEACTIVATED_WITH_RECEIVABLE', actor_id=staffId,
        resource_id=merchantId, metadata={receivableAmount: ABS(currentBalance)}, ...)
    COMMIT
    ENQUEUE notification ke Admin Pesantren (template: 'merchant_nonaktif_ada_piutang', async)
    RETURN { feeCharged: 0, settleAmount: 0, unsettledReceivable: ABS(currentBalance) }

  IF NOT chargeFee OR currentBalance < 0:
    feeCharged = 0
    settleAmount = MAX(currentBalance, 0)
  ELSE IF currentBalance >= feePerMerchant:
    feeCharged = feePerMerchant
    settleAmount = currentBalance - feePerMerchant
  ELSE:
    feeCharged = MAX(currentBalance, 0)
    settleAmount = 0

  BEGIN TRANSACTION
    IF feeCharged > 0:
      journalId = generateUUID()
      payableAccount = SELECT * FROM accounts WHERE entity_type='PLATFORM_FEE_PAYABLE' AND tenant_id=merchant.tenant_id FOR UPDATE
      INSERT ledger_entries (journal_id=journalId, account_id=merchantAccount.id, entry_type='DEBIT', amount=feeCharged, description='Fee penutupan merchant')
      INSERT ledger_entries (journal_id=journalId, account_id=payableAccount.id, entry_type='KREDIT', amount=feeCharged, ...)
    IF settleAmount > 0:
      settleJournalId = generateUUID()
      operatingCashAccount = SELECT * FROM accounts WHERE entity_type='PESANTREN_OPERATING_CASH' AND tenant_id=merchant.tenant_id FOR UPDATE
      INSERT ledger_entries (journal_id=settleJournalId, account_id=merchantAccount.id, entry_type='DEBIT', amount=settleAmount, description='Settlement akhir penutupan merchant')
      INSERT ledger_entries (journal_id=settleJournalId, account_id=operatingCashAccount.id, entry_type='KREDIT', amount=settleAmount, ...)
    UPDATE merchants SET status='INACTIVE', deactivation_reason='MANUAL', deactivated_at=now() WHERE id=merchantId
    INSERT audit_logs (action='MERCHANT_DEACTIVATED_MANUAL', actor_id=staffId, resource_id=merchantId, metadata={feeCharged, settleAmount}, ...)
  COMMIT
  RETURN { feeCharged, settleAmount }
```

### 6.13b resolveMerchantReceivable (Admin tandai piutang sudah tertagih manual)

```
FUNCTION resolveMerchantReceivable(merchantId, staffId, note):
  merchant = SELECT * FROM merchants WHERE id=merchantId FOR UPDATE
  IF NOT merchant.has_unsettled_receivable: ABORT 'NO_UNSETTLED_RECEIVABLE'
  UPDATE merchants SET has_unsettled_receivable=false, unsettled_receivable_amount=NULL WHERE id=merchantId
  INSERT audit_logs (action='MERCHANT_RECEIVABLE_RESOLVED', actor_id=staffId, resource_id=merchantId, metadata={note}, ...)
```

### 6.14 Alur Pendaftaran Kartu Baru (via Terminal Admin Pesantren, handshake 2 arah)

> PIN tidak pernah diinput lewat web (konsisten dengan kontrak firmware). Karena itu
> pendaftaran kartu memakai sesi handshake: terminal baca UID → dorong ke dashboard Admin yang
> sedang login (WebSocket) → Admin pilih santri di web → sinyal balik ke terminal → santri buat
> PIN langsung di terminal.

```
STEP 1 — Terminal kirim UID (dipicu operator pilih menu "Daftar Kartu Baru" + tap kartu):
FUNCTION handleCardScan(tenantId, terminalId, cardUid):
  terminal = SELECT * FROM terminals WHERE id=terminalId AND tenant_id=tenantId
  IF terminal.terminal_type != 'ADMIN': ABORT 'TERMINAL_TYPE_NOT_ALLOWED'
  existingCard = SELECT * FROM cards WHERE tenant_id=tenantId AND card_uid=cardUid AND status != 'INACTIVE'
  IF existingCard EXISTS: ABORT 'CARD_ALREADY_REGISTERED'

  session = INSERT card_registration_sessions (tenant_id=tenantId, terminal_id=terminalId,
    card_uid=cardUid, status='SCANNED', expires_at=now()+5min)
  PUSH via WebSocket ke dashboard Admin Pesantren yang login di tenant ini: { event: 'card_scanned', sessionId: session.id, cardUid }
  RETURN { sessionId: session.id }

STEP 2 — Admin pilih santri di web:
FUNCTION selectSantriForRegistration(sessionId, santriId, staffId):
  session = SELECT * FROM card_registration_sessions WHERE id=sessionId FOR UPDATE
  IF session.status != 'SCANNED': ABORT 'REGISTRATION_SESSION_EXPIRED'
  IF now() > session.expires_at: UPDATE ... SET status='EXPIRED'; ABORT 'REGISTRATION_SESSION_EXPIRED'
  UPDATE card_registration_sessions SET santri_id=santriId, status='SANTRI_SELECTED' WHERE id=sessionId
  PUSH via WebSocket ke terminal: { event: 'ready_for_pin', sessionId }

STEP 3 — Terminal minta santri buat PIN, kirim payload final:
FUNCTION finalizeCardRegistration(sessionId, pinHashLocal, terminalId):
  session = SELECT * FROM card_registration_sessions WHERE id=sessionId FOR UPDATE
  IF session.status != 'SANTRI_SELECTED': ABORT 'REGISTRATION_SESSION_EXPIRED'
  BEGIN TRANSACTION
    -- Deteksi otomatis: apakah ini pendaftaran baru atau penggantian kartu hilang/rusak?
    existingCard = SELECT * FROM cards WHERE santri_id=session.santri_id AND status IN ('ACTIVE','FROZEN') FOR UPDATE

    IF existingCard EXISTS:
      -- PENGGANTIAN: bawa counter, JANGAN reset (fix celah #3 — cegah "reset" ambang batas
      -- auto-nonaktif dengan pura-pura lapor kartu hilang)
      UPDATE cards SET status='REPLACED' WHERE id=existingCard.id
      carriedOverCounter = existingCard.consecutive_negative_debits
      replacedFromId = existingCard.id
    ELSE:
      carriedOverCounter = 0
      replacedFromId = NULL

    newCard = INSERT cards (tenant_id=session.tenant_id, santri_id=session.santri_id, card_uid=session.card_uid,
      pin_hash=Argon2id(pinHashLocal), status='ACTIVE', replaced_from_card_id=replacedFromId,
      consecutive_negative_debits=carriedOverCounter)
    -- Saldo TIDAK perlu dipindah manual — account terikat ke santri_id, bukan card_id, jadi
    -- otomatis lanjut begitu kartu baru dipakai transaksi.
    UPDATE card_registration_sessions SET status='COMPLETED' WHERE id=sessionId
    INSERT audit_logs (action=(existingCard EXISTS ? 'CARD_REPLACED' : 'CARD_REGISTERED'),
      resource_type='card', resource_id=newCard.id,
      metadata={santriId: session.santri_id, carriedOverCounter}, ...)
  COMMIT
  PUSH via WebSocket ke dashboard: { event: 'registration_completed', sessionId }
  RETURN { status: 'SUCCESS' }
```

Sesi yang tidak diselesaikan dalam 5 menit otomatis kedaluwarsa (`status='EXPIRED'`) lewat cron
ringan atau lazy-check saat diakses — operator harus mulai ulang dari tap kartu.

### 6.15 resetCardPin (khusus Terminal Admin — kartu lama masih di tangan santri)

> Beda dengan §6.14: santri masih pegang kartu fisiknya, cuma lupa PIN. Tidak perlu handshake
> ke web sama sekali karena identitas santri sudah pasti dari `card_uid` yang di-tap — satu
> langkah penuh di terminal.

```
FUNCTION resetCardPin(tenantId, cardUid, newPinHashLocal, terminalId, staffId):
  terminal = SELECT * FROM terminals WHERE id=terminalId AND tenant_id=tenantId
  IF terminal.terminal_type != 'ADMIN': ABORT 'TERMINAL_TYPE_NOT_ALLOWED'
  card = SELECT * FROM cards WHERE tenant_id=tenantId AND card_uid=cardUid AND status='ACTIVE' FOR UPDATE
  IF card NOT FOUND: ABORT 'CARD_NOT_ACTIVE'
  UPDATE cards SET pin_hash=Argon2id(newPinHashLocal) WHERE id=card.id
  INSERT audit_logs (action='CARD_PIN_RESET', actor_id=staffId, resource_type='card', resource_id=card.id, ...)
  RETURN { status:'SUCCESS', santriName: (SELECT full_name FROM santri WHERE id=card.santri_id) }
```

> **Catatan kebijakan (di luar sistem):** sistem tidak bisa memverifikasi identitas fisik
> santri. Admin tetap wajib memastikan yang tap kartu benar santri pemiliknya (lihat buku
> induk/wajah) sebelum menekan konfirmasi reset — ini kontrol prosedural, bukan kontrol sistem.

### 6.16 deactivateSantriExit (satu aksi: kartu + status santri + akses wali — fix celah #2)

> Sebelumnya nonaktifkan kartu, ubah status santri, dan cabut akses wali adalah 3 langkah
> manual terpisah yang gampang ada yang kelewat (misal santri sudah lulus tapi status masih
> ACTIVE sehingga masih ikut kena `debitCardFee` bulan berikutnya). Fungsi ini menyatukan
> ketiganya jadi satu aksi.

```
FUNCTION deactivateSantriExit(santriId, staffId, exitReason):
  activeCards = SELECT * FROM cards WHERE santri_id=santriId AND status='ACTIVE'
  cardResults = []
  FOR EACH card IN activeCards:
    cardResults.append(deactivateCardManual(card.id, staffId)) -- pakai aturan fee/refund §6.12 apa adanya

  BEGIN TRANSACTION
    UPDATE santri SET status='INACTIVE', exit_reason=exitReason, exited_at=now() WHERE id=santriId
    UPDATE wali_santri_relations SET status='REVOKED' WHERE santri_id=santriId
    INSERT audit_logs (action='SANTRI_EXIT', actor_id=staffId, resource_type='santri',
      resource_id=santriId, metadata={exitReason, cardsDeactivated: activeCards.length}, ...)
  COMMIT
  RETURN { cardsDeactivated: cardResults }
```

`exitReason` salah satu dari: `GRADUATED`, `WITHDRAWN`, `OTHER`. Setelah dijalankan, Wali
Santri yang tadinya mengampu santri ini otomatis tidak lagi bisa melihat/mengakses data santri
tersebut (relasi berstatus `REVOKED`, bukan dihapus — riwayat tetap ada untuk audit).

### 6.17 notifyUpcomingCardFeeDebit (cron harian, H-3 — fix celah #4)

> Semua notifikasi lain di sistem ini reaktif (dikirim SETELAH kejadian). Ini satu-satunya
> yang preventif — wajib ada supaya wali santri punya kesempatan top-up SEBELUM kartu berisiko
> auto-nonaktif, bukan baru tahu setelah kejadian.

```
FUNCTION notifyUpcomingCardFeeDebit():
  FOR EACH tenant WHERE status='ACTIVE':
    platformConfig = SELECT * FROM platform_billing_config LIMIT 1
    targetDebitDay = tenant.card_fee_debit_day OR platformConfig.card_fee_debit_day
    IF day_of_month(today() + 3 days) != targetDebitDay: CONTINUE

    feePerCard = tenant.card_fee_monthly OR platformConfig.default_card_fee_monthly
    N = platformConfig.max_consecutive_negative_debits

    FOR EACH card IN (SELECT * FROM cards WHERE tenant_id=tenant.id AND status='ACTIVE'):
      santriAccount = SELECT * FROM accounts WHERE entity_type='SANTRI' AND entity_id=card.santri_id
      balance = getRunningBalance(santriAccount.id)
      IF balance < feePerCard:
        isUrgent = card.consecutive_negative_debits >= (N - 1)
          -- siklus berikutnya berpotensi jadi siklus terakhir sebelum auto-nonaktif
        template = isUrgent ? 'peringatan_kartu_risiko_nonaktif' : 'peringatan_saldo_kurang_biaya_kartu'
        ENQUEUE notification ke wali_santri (template, metadata={balance, feePerCard, debitDate: targetDebitDay}, async)
```

**Catatan implementasi:** jadwalkan `debitCardFee` dan `debitMerchantFee` sesuai
`card_fee_debit_day`/`merchant_fee_debit_day` per tenant (bisa beda tanggal per tenant kalau
Super Admin mau), `generatePlatformFeeInvoice` berjalan setelah keduanya selesai di hari yang
sama, dan `suspendOverdueTenants` berjalan setiap hari (bukan cuma awal bulan) supaya deteksi
telat bayar tidak molor. `notifyUpcomingCardFeeDebit` (§6.17) berjalan setiap hari, independen
dari jadwal potong. Semua sebagai cron job (`node-cron`/BullMQ+Redis), bukan trigger HTTP
manual dari user biasa. `generateWeeklySettlementInvoice` (§6.5) tetap terjadwal tiap hari
Senin. Sediakan juga endpoint manual trigger khusus Super Admin/Admin untuk re-run kalau cron
gagal.

**Penegakan kunci total di middleware `tenantGuard`:** kalau `tenant.status = 'SUSPENDED'`,
TOLAK SEMUA request dengan `error.code: TENANT_SUSPENDED` KECUALI dua endpoint:
`POST /v1/auth/login` (khusus role `ADMIN_PESANTREN`) dan `POST /v1/platform-invoices/:id/pay`
+ `GET /v1/tenants/:id/platform-invoices`. Tidak ada pengecualian untuk Wali Santri, Operator,
atau endpoint terminal manapun — sesuai keputusan bisnis di Aturan Keras #9.

---

## 7. AUTENTIKASI & KEAMANAN

### JWT Access Token (15 menit)
```json
{ "sub": "staff_user_id/wali_santri_id", "role": "ADMIN_PESANTREN",
  "tenant_id": "uuid atau null untuk SUPER_ADMIN", "merchant_scope": ["uuid"], "iat": 0, "exp": 0 }
```
Refresh token 7 hari, disimpan hashed, rotasi tiap pemakaian — reuse token lama = revoke
seluruh sesi user (indikasi pencurian token). Frontend: access token di memory, refresh token
di httpOnly cookie — JANGAN localStorage (risiko XSS).

### Autentikasi Terminal
Bukan JWT. Header `X-Device-Token` + `X-Device-Id`, dicocokkan ke `terminals.device_token_hash`.
Hanya Admin Pesantren yang bisa terbitkan ulang device token.

### Alur PIN
Terminal hash lokal `SHA-256(card_uid + salt_tenant + pin)` → kirim via HTTPS TLS 1.3 →
server bandingkan `Argon2id(encrypted_pin)` dengan `cards.pin_hash`. PIN tidak pernah plain
text di titik manapun, dan tidak pernah diinput lewat web (hanya di terminal fisik).

---

## 8. FORMAT RESPONSE API STANDAR

**Sukses:**
```json
{ "success": true, "data": { }, "meta": { "requestId": "uuid", "timestamp": "ISO8601" } }
```
**Gagal:**
```json
{ "success": false, "error": { "code": "INSUFFICIENT_BALANCE", "message": "...", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" } }
```
**Kode error baku** (jangan buat kode baru tanpa menambah ke daftar ini):
`INVALID_PIN`, `CARD_NOT_ACTIVE`, `INSUFFICIENT_BALANCE`, `DAILY_LIMIT_EXCEEDED`,
`DUPLICATE_REQUEST`, `TENANT_SUSPENDED`, `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`,
`RATE_LIMITED`, `VOID_WINDOW_EXPIRED`, `TOPUP_LIMIT_EXCEEDED`, `WITHDRAWAL_LIMIT_EXCEEDED`,
`PAYMENT_AMOUNT_MISMATCH`, `CARD_ALREADY_INACTIVE`, `MERCHANT_ALREADY_INACTIVE`,
`TERMINAL_TYPE_NOT_ALLOWED`, `CARD_ALREADY_REGISTERED`, `REGISTRATION_SESSION_EXPIRED`,
`NO_UNSETTLED_RECEIVABLE`.

> Catatan `TENANT_SUSPENDED`: dikembalikan oleh middleware `tenantGuard` untuk SEMUA endpoint
> saat tenant nonaktif karena telat bayar, kecuali dua endpoint di §9 yang eksplisit dikecualikan.

---

## 9. DAFTAR ENDPOINT API

| Method | Endpoint | Konsumen |
|---|---|---|
| POST | `/v1/auth/login` | Web |
| POST | `/v1/auth/refresh` | Web |
| POST | `/v1/auth/logout` | Web |
| POST | `/v1/terminal/charge` | Terminal fisik (merchant) |
| POST | `/v1/terminal/topup` | Terminal fisik (merchant & admin) |
| POST | `/v1/terminal/withdrawal` | Terminal fisik (merchant) |
| POST | `/v1/terminal/card-scan` | Terminal fisik (admin) |
| POST | `/v1/registration-sessions/:id/select-santri` | Web (Admin) |
| POST | `/v1/terminal/registration-sessions/:id/finalize` | Terminal fisik (admin) |
| POST | `/v1/terminal/pin-reset` | Terminal fisik (admin) |
| POST | `/v1/payment` | POS pihak ketiga |
| POST | `/v1/payment/webhook-status` | POS pihak ketiga |
| POST | `/v1/transactions/:id/void` | Web (Admin) |
| GET | `/v1/santri/:id/balance` | Web (Admin/Wali*) |
| GET | `/v1/santri/:id/transactions` | Web (Admin/Wali*) |
| POST | `/v1/cards` | Web (Admin) — pendaftaran non-terminal (edge case/darurat), lihat catatan §10 |
| POST | `/v1/cards/:id/freeze` | Web (Admin, Wali* lapor) |
| POST | `/v1/cards/:id/deactivate` | Web (Admin) |
| POST | `/v1/santri/:id/exit` | Web (Admin) |
| POST | `/v1/merchants/:id/deactivate` | Web (Admin) |
| POST | `/v1/merchants/:id/resolve-receivable` | Web (Admin) |
| GET | `/v1/merchants/unsettled-receivables` | Web (Admin) |
| POST | `/v1/top-ups/manual` | Web (Admin) |
| POST | `/v1/top-ups/gateway` | Web (Wali*) |
| POST | `/v1/top-ups/gateway/callback` | Payment Gateway |
| PATCH | `/v1/santri/:id/daily-limit` | Web (Admin/Wali*) |
| GET | `/v1/reports/reconciliation` | Web (Admin) |
| GET | `/v1/merchants/:id/settlement-invoices` | Web (Admin) |
| POST | `/v1/merchants/:id/settlement-invoices/:invoiceId/payout` | Web (Admin) |
| GET | `/v1/terminals/:id/heartbeat` | Terminal fisik |
| POST | `/v1/terminals/:id/ota` | Web (Admin) |
| PATCH | `/v1/platform-billing-config` | Web (Super Admin) |
| PATCH | `/v1/tenants/:id/fee-override` | Web (Super Admin) |
| GET | `/v1/tenants/:id/platform-invoices` | Web (Admin/Super Admin) — **tetap bisa diakses saat SUSPENDED** |
| POST | `/v1/platform-invoices/:id/pay` | Web (Admin) — **tetap bisa diakses saat SUSPENDED** |
| POST | `/v1/platform-invoices/:id/webhook` | Payment Gateway |

*Wali Santri diakses lewat area khusus di Web Dashboard yang sama (mobile-first), bukan
aplikasi terpisah. Endpoint tetap generik agar mobile app native bisa jadi konsumen tambahan
di kemudian hari tanpa perlu ubah backend.

### Contoh Kontrak: `POST /v1/terminal/charge`
Request:
```json
{ "device_id": "AA:BB:CC:DD:EE:FF", "card_uid": "04A3B2C1", "encrypted_pin": "sha256-hex",
  "amount": 15000, "idempotency_key": "term-AABBCC-1721369999-01" }
```
Response 200:
```json
{ "success": true, "data": { "transaction_id": "uuid", "journal_id": "uuid",
  "santri_name": "Ahmad Fauzi", "amount": 15000, "new_balance": 85000, "merchant_name": "Kantin Putra" },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:00:00Z" } }
```
Response 422:
```json
{ "success": false, "error": { "code": "INSUFFICIENT_BALANCE", "message": "Saldo santri tidak mencukupi.",
  "details": { "current_balance": 5000, "requested_amount": 15000 } },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:00:00Z" } }
```

### Timeout & Retry
Integrated mode: santri tidak tap dalam 90 detik → status `EXPIRED`. Standalone mode: terminal
tidak dapat response dalam 10 detik → retry dengan `idempotency_key` sama (bukan baru); server
mengembalikan hasil transaksi pertama tanpa proses ulang.

---

## 10. MODUL FRONTEND PER ROLE (Next.js Dashboard)

Karena Wali Santri kemungkinan besar akses dari HP, area/route Wali Santri **wajib responsive
mobile-first**, idealnya sebagai PWA (installable, push notification via Web Push).

### Super Admin
- CRUD tenant (create, suspend, resume manual di luar alur nonpayment)
- **Konfigurasi biaya platform** (`PATCH /v1/platform-billing-config`): default biaya per
  kartu, default biaya per merchant, tanggal potong kartu, tanggal potong merchant, batas hari
  pembayaran sebelum suspend, **ambang batas minus berturut-turut sebelum auto-nonaktif**
  (`max_consecutive_negative_debits`), **tanggal cutoff fee penonaktifan manual**
  (`manual_deactivation_fee_cutoff_day`). Plus override per tenant
  (`PATCH /v1/tenants/:id/fee-override`). Tampilkan preview estimasi tagihan (jumlah kartu
  aktif × fee kartu + jumlah merchant aktif × fee merchant) sebelum simpan.
- Monitor tagihan seluruh tenant: daftar `platform_fee_invoices` lintas tenant, highlight yang
  `OVERDUE`/mendekati jatuh tempo
- Monitoring performa sistem lintas tenant (agregat, bukan detail transaksi per santri)

### Admin Pesantren
*(mencakup seluruh fungsi keuangan, tidak ada role Bendahara terpisah)*
- Master data merchant (CRUD)
- **Pendaftaran & penggantian kartu RFID (real-time via Terminal Admin):** halaman "Daftar/Ganti
  Kartu" yang membuka koneksi WebSocket dan menunggu event `card_scanned` dari terminal
  `terminal_type='ADMIN'` (lihat §6.14). Begitu event masuk, tampilkan form cari/pilih santri —
  Backend otomatis mendeteksi apakah ini pendaftaran baru atau penggantian kartu lama (kalau
  santri yang dipilih sudah punya kartu ACTIVE/FROZEN), jadi Admin tidak perlu memilih jenis
  aksi secara manual. Setelah Admin submit (`POST /v1/registration-sessions/:id/select-santri`),
  tampilkan status "Menunggu santri buat PIN di terminal..." sampai event `registration_completed`
  masuk. `POST /v1/cards` langsung (tanpa terminal) hanya untuk kondisi darurat (mis. terminal
  admin belum terpasang) — beri peringatan jelas di UI bahwa jalur ini butuh cara lain untuk
  komunikasikan PIN ke santri karena tidak bisa lewat web.
- **Reset PIN kartu** (`POST /v1/terminal/pin-reset`, dipicu dari Terminal Admin, bukan dari
  web — lihat §6.15): tampilkan riwayat reset PIN di halaman detail kartu (dari `audit_logs`)
  untuk transparansi, tapi aksinya sendiri hanya bisa dilakukan fisik di terminal.
- Freeze kartu hilang (`POST /v1/cards/:id/freeze`) — penggantian fisik kartunya sendiri lewat
  alur "Daftar/Ganti Kartu" di atas, bukan endpoint terpisah.
- **Nonaktifkan kartu/merchant secara manual** (`POST /v1/cards/:id/deactivate`,
  `POST /v1/merchants/:id/deactivate`) — tampilkan preview sebelum konfirmasi: apakah fee akan
  dikenakan (berdasarkan tanggal hari ini vs `manual_deactivation_fee_cutoff_day`), estimasi
  refund tunai/settlement yang akan diterima. Kartu dengan status `INACTIVE` tampil dengan
  label alasan (`Manual` atau `Otomatis — Tunggakan`) di daftar kartu.
- **Exit Santri** (`POST /v1/santri/:id/exit`, lihat §6.16) — satu tombol yang otomatis
  menonaktifkan seluruh kartu aktif santri tersebut, mengubah status santri, dan mencabut akses
  Wali Santri terkait. Tampilkan preview dampaknya (jumlah kartu yang akan terpengaruh, estimasi
  refund) sebelum konfirmasi, sama seperti nonaktifkan kartu manual.
- **Piutang Merchant Belum Selesai** (`GET /v1/merchants/unsettled-receivables`) — daftar
  merchant yang dinonaktifkan dengan saldo minus di atas ambang tulis-hapus
  (`has_unsettled_receivable=true`). Tampilkan nominal dan tanggal nonaktif. Setelah Admin
  menagih manual di luar sistem, tombol "Tandai Selesai" (`POST /v1/merchants/:id/resolve-receivable`)
  dengan kolom catatan wajib diisi (untuk jejak audit).
- Alokasi terminal ke merchant ATAU ke Admin Pesantren sendiri (pilih `terminal_type` saat
  provisioning), trigger OTA
- Konfigurasi limit top-up/withdrawal tunai per terminal (`cash_topup_limit_per_tx`,
  `cash_withdrawal_limit_per_tx`)
- Top-up manual non-tunai (dari web, tanpa terminal — untuk kasus tanpa tap kartu fisik), void
  transaksi dalam window waktu
- **Invoice Settlement Merchant:** breakdown per periode (opening balance, sales, withdrawal,
  top-up, closing balance). Closing balance positif → tombol "Cairkan"
  (`POST .../settlement-invoices/:invoiceId/payout`). Closing balance negatif → label
  "Dibawa ke periode berikutnya (netting otomatis)", TANPA tombol aksi.
- **Tagihan Platform** (`GET /v1/tenants/:id/platform-invoices`) — halaman paling kritis,
  HARUS tetap bisa diakses meski tenant `SUSPENDED`:
  - Ringkasan: total dari potongan kartu, total dari potongan merchant, total keseluruhan,
    tanggal jatuh tempo dengan badge status (`Lunas` / `Jatuh Tempo N hari lagi` / `Terlambat`)
  - Tombol "Bayar Sekarang" → `POST /v1/platform-invoices/:id/pay`, buka QRIS/VA dari gateway
  - Riwayat invoice sebelumnya beserta status pembayaran
  - **Kalau tenant `SUSPENDED`:** ganti SELURUH layout dashboard (bukan cuma halaman ini) jadi
    banner kunci penuh — hanya halaman Tagihan Platform yang tetap render normal dan bisa
    diklik. Semua menu/navigasi lain nonaktif dengan pesan "Sistem nonaktif karena tagihan
    belum dibayar." Begitu backend konfirmasi `status='PAID'` (via §6.10), refresh otomatis
    kembalikan akses penuh.
- Laporan rekonsiliasi harian/mingguan/bulanan, ekspor data pembukuan, audit log viewer

### Wali Santri
Route terpisah, mobile-first, minim navigasi:
- Beranda/Saldo per santri yang diampu (selector/tab jika >1 santri)
- Riwayat transaksi (infinite scroll, jangan tarik semua sekaligus)
- Set limit jajan harian
- Top-up via payment gateway (QR/redirect sesuai SDK), polling/push saat status `SUCCESS`
- Lapor kartu hilang (hanya memicu laporan, Admin yang verifikasi)
- Notifikasi (WhatsApp/Web Push): transaksi sukses, saldo rendah, top-up berhasil, kartu dibekukan,
  **peringatan H-3 sebelum potong biaya kartu bulanan kalau saldo diperkirakan tidak cukup**
  (§6.17 — satu-satunya notifikasi yang sifatnya preventif, bukan reaktif; wajib ditampilkan
  menonjol di beranda, bukan cuma di riwayat notifikasi, karena ada konsekuensi kartu auto-nonaktif)
- **Kalau tenant `SUSPENDED`:** SEMUA endpoint di atas menolak dengan `TENANT_SUSPENDED` — tidak
  ada pengecualian (Aturan Keras #9). Tampilkan satu layar penuh generik: "Sistem sedang tidak
  tersedia. Hubungi pihak pesantren untuk informasi lebih lanjut." JANGAN sebut nominal
  tunggakan atau detail internal billing pesantren ke Wali Santri — itu urusan Admin Pesantren,
  bukan konsumsi publik.

### Aturan UI RBAC
Ambil `role` dari JWT, render menu/aksi sesuai matriks di bagian 2. Backend tetap penegak
aturan sebenarnya — sembunyikan tombol hanya untuk UX, bukan security.

### Error Handling Frontend
Buat satu util `handleApiError(error)` terpusat yang memetakan `error.code` ke pesan bahasa
Indonesia ramah pengguna — jangan tampilkan `error.code` mentah ke user.

---

## 11. KEBUTUHAN NON-FUNGSIONAL

| Dimensi | Ketentuan |
|---|---|
| Availability | ≥99.9%/bulan, DR multi-region |
| Data Integrity | `SERIALIZABLE`, retry maks 3x pada serialization failure |
| Security Audit | Semua mutasi kritis → `audit_logs` dengan timestamp ISO 8601 + IP |
| Rate Limiting | 60 req/menit per IP terminal; 120 req/menit per API key POS pihak ketiga |
| Performa | p95 < 800ms untuk `/v1/terminal/charge` |

---

## 12. KONVENSI CODING

- TypeScript strict mode wajib aktif di seluruh proyek.
- `camelCase` variabel/fungsi, `snake_case` kolom database, `PascalCase` tipe/class.
- Validasi input wajib pakai Zod (atau setara) di boundary API.
- Commit message: Conventional Commits (`feat:`, `fix:`, `chore:`).
- Setiap PR yang menyentuh modul `ledger/` wajib menyertakan test konkurensi baru atau
  referensi ke test yang sudah mencakup skenario terkait.

---

## 13. ENVIRONMENT VARIABLES

```
DATABASE_URL=postgresql://user:pass@host:5432/pondokpay
REDIS_URL=redis://host:6379

JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

PAYMENT_GATEWAY_PROVIDER=midtrans
PAYMENT_GATEWAY_SERVER_KEY=
PAYMENT_GATEWAY_CLIENT_KEY=

WHATSAPP_API_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

MQTT_BROKER_URL=
WS_PORT=

NODE_ENV=development
API_RATE_LIMIT_PER_MINUTE=60
VOID_WINDOW_MINUTES=15
```

---

## 14. STRATEGI TESTING

| Level | Fokus | Tools |
|---|---|---|
| Unit | `LedgerService`, PIN verification, limit harian | Jest/Vitest |
| Integration | Endpoint end-to-end dengan database test | Supertest + testcontainers PostgreSQL |
| Concurrency | 50 request charge paralel ke kartu bersaldo pas-pasan → hanya 1 sukses | k6/Artillery |
| RLS Security | Query lintas tenant harus gagal | Test otomatis |
| Settlement | `closing_balance` = `opening_balance` + net pergerakan periode; saldo negatif ter-netting tanpa entri ledger ekstra | Test otomatis |
| Platform Fee Billing | Kartu `FROZEN`/`REVOKED` tidak ikut dipotong di `debitCardFee`; saldo santri BOLEH minus setelah `debitCardFee` tapi TIDAK BOLEH minus setelah `processCharge` biasa | Test otomatis |
| Suspensi | Tenant `OVERDUE` → SEMUA endpoint selain login Admin & bayar invoice menolak dengan `TENANT_SUSPENDED`; setelah `payPlatformFeeInvoice` sukses, akses pulih otomatis tanpa restart | Test otomatis, wajib mencakup endpoint Wali Santri dan terminal |
| Auto-nonaktif kartu | Simulasi N=1 dan N=2 menghasilkan kartu `INACTIVE` tepat di siklus yang sesuai contoh §6.7; fee siklus pemicu terbukti tidak masuk `platform_fee_invoices` | Test otomatis |
| Penggantian kartu | `consecutive_negative_debits` ikut pindah ke kartu baru (TIDAK reset ke 0); saldo santri tetap utuh tanpa migrasi manual karena terikat `santri_id` | Test otomatis |
| Exit Santri | `deactivateSantriExit` menonaktifkan SEMUA kartu aktif santri dan mengubah `wali_santri_relations.status` jadi `REVOKED` dalam satu transaksi, bukan langkah terpisah | Test otomatis |
| Piutang Merchant | Saldo minus ≤ `merchant_deactivation_writeoff_threshold` ditulis-hapus; di atas ambang itu TIDAK ditulis-hapus, muncul di `unsettled-receivables` sampai di-resolve | Test otomatis |

---

## 15. ROADMAP & DEFINITION OF DONE

**Fase 1 (Bulan 1–2) — Core Foundation:** Auth (JWT+refresh+RBAC), arsitektur multi-tenant+RLS,
skema tabel dasar. DoD: Login 3 role menghasilkan token dengan `tenant_id`/`merchant_scope`
benar; RLS terbukti isolasi antar tenant lewat test otomatis; menu frontend ter-render sesuai RBAC.

**Fase 2 (Bulan 3–4) — Ledger Core:** Ledger Engine lengkap (§6.1–6.4, §6.12–6.17), top-up
manual, invoice settlement merchant, laporan rekonsiliasi, alur pendaftaran/penggantian kartu
via Terminal Admin. DoD: test konkurensi 50 paralel lolos; tidak ada mutasi pada `ledger_entries`;
`processTerminalTopup`/`Withdrawal` lolos test idempotency & limit (termasuk top-up dari
Terminal Admin yang men-debit `PESANTREN_POOL`, bukan merchant); `generateWeeklySettlementInvoice`
benar untuk saldo merchant positif maupun negatif; dashboard invoice settlement & tombol
"Cairkan" berfungsi end-to-end; handshake pendaftaran kartu (§6.14) berhasil dari scan UID di
terminal sampai kartu aktif, termasuk skenario sesi kedaluwarsa DAN skenario penggantian kartu
(counter `consecutive_negative_debits` terbukti ikut pindah ke kartu baru, tidak reset ke 0);
`resetCardPin` (§6.15) berfungsi tanpa perlu langkah web; `deactivateSantriExit` (§6.16)
terbukti menonaktifkan seluruh kartu aktif santri DAN mencabut akses Wali Santri terkait dalam
satu transaksi; `deactivateCardManual` dan `deactivateMerchantManual` benar untuk keempat
kombinasi (sebelum/sesudah cutoff × saldo cukup/tidak cukup untuk fee); `deactivateMerchantManual`
terbukti TIDAK menulis-hapus piutang di atas `merchant_deactivation_writeoff_threshold` —
piutang besar muncul di `GET /v1/merchants/unsettled-receivables` sampai di-resolve manual.

**Fase 3 (Bulan 5) — Ekosistem Integrasi:** Dokumentasi REST API publik (OpenAPI/Swagger),
webhook system untuk POS pihak ketiga. DoD: Swagger auto-generated & ter-deploy untuk seluruh
endpoint publik termasuk platform fee invoice, settlement invoice, dan pendaftaran kartu.

**Fase 4 (Bulan 6+) — Area Wali Santri & Billing Platform Otomatis:** Integrasi Payment Gateway
untuk top-up santri DAN untuk pembayaran tagihan platform, notifikasi WhatsApp real-time,
`debitCardFee`/`debitMerchantFee`/`generatePlatformFeeInvoice`/`suspendOverdueTenants` berjalan
otomatis via cron. DoD: top-up santri via gateway → saldo bertambah <30 detik; notifikasi <5
detik setelah transaksi sukses; simulasi end-to-end penuh — potong fee kartu & merchant di
tanggal terjadwal → invoice terbit dengan `due_date` benar → simulasi telat bayar → tenant
`SUSPENDED` dan SEMUA akses (Admin/Terminal/Wali) terkunci sesuai Aturan Keras #9 → bayar via
gateway → akses pulih otomatis tanpa intervensi manual; simulasi ambang batas auto-nonaktif
dengan N=1 dan N=2 menghasilkan kartu `INACTIVE` pada siklus yang tepat sesuai contoh di §6.7,
dan fee siklus pemicu terbukti TIDAK masuk `platform_fee_invoices`; Super Admin bisa ubah
seluruh parameter billing (fee kartu, fee merchant, tanggal potong, batas hari bayar, ambang
batas minus, cutoff fee penonaktifan manual) dan lihat monitor tagihan lintas tenant.

---

## INSTRUKSI EKSEKUSI

Mulai dari Fase 1. Jangan lompat fase — setiap fase harus memenuhi Definition of Done sebelum
lanjut ke fase berikutnya. Di akhir tiap fase, laporkan: (1) apa yang selesai, (2) hasil test
yang relevan dengan DoD fase itu, (3) daftar `// TODO: OPEN QUESTION` yang muncul selama
pengerjaan. Kalau ada bagian dokumen ini yang ambigu atau bentrok, hentikan dan tanyakan
sebelum melanjutkan — jangan menebak untuk hal yang menyangkut uang (ledger, saldo, PIN, RBAC).
