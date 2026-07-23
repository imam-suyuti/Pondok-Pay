# Sumber Top-up PondokPay

PondokPay hanya memiliki dua sumber top-up saldo santri:

1. **Terminal yang telah diprovisioning** — Terminal `ADMIN` atau `MERCHANT` memakai `POST /v1/terminal/topup`.
   - Terminal `MERCHANT`: akun `MERCHANT` didebit, akun `SANTRI` dikredit.
   - Terminal `ADMIN`: akun `PESANTREN_POOL` didebit, akun `SANTRI` dikredit.
   - Operator/Admin individual wajib diotorisasi dengan PIN tindakan.
   - Tidak ada endpoint top-up web manual yang langsung memutasi ledger.

2. **Payment gateway oleh Wali Santri** — request gateway dibuat terlebih dahulu dan hanya mengubah saldo setelah callback gateway yang tervalidasi.
   Implementasi gateway berada pada Fase 4 sesuai roadmap.

`top_up_requests` dipakai untuk lifecycle payment gateway; top-up terminal tercatat sebagai `transactions` bertipe `TOPUP_TERMINAL` dan tidak memerlukan request web terpisah.
