# PROMPT: BANGUN FIRMWARE & HARDWARE PONDOKPAY TERMINAL

Kamu adalah AI coding agent yang bertugas membangun **firmware ESP32** untuk PondokPay
Terminal — perangkat fisik pembaca kartu RFID yang dipakai Operator Merchant (kasir kantin,
laundry, toko pesantren) untuk memproses transaksi santri. Dokumen ini adalah **satu-satunya
sumber kebenaran** untuk seluruh kebutuhan firmware & hardware. Baca seluruhnya sebelum
menulis kode apapun.

Di luar scope kamu: backend API dan dashboard web (dikerjakan tim/agent terpisah). Kamu HANYA
berbicara dengan backend lewat kontrak endpoint yang didefinisikan di dokumen ini — tidak ada
jalur lain, dan kamu tidak berasumsi tentang struktur database atau logika bisnis di baliknya.

## ATURAN KERAS (TIDAK BOLEH DILANGGAR)

1. **PIN santri tidak pernah disimpan atau ditransmisikan sebagai plain text** di titik
   manapun. Selalu di-hash lokal (`SHA-256`) sebelum dikirim — lihat bagian Keamanan PIN.
2. **Firmware tidak pernah memutuskan approve/reject transaksi secara lokal.** Semua keputusan
   (saldo cukup/tidak, limit harian, validasi PIN terhadap hash tersimpan) ada di Backend.
   Firmware hanya mengirim data mentah terenkripsi dan menampilkan hasil dari response API.
3. Seluruh komunikasi ke Backend WAJIB HTTPS TLS 1.3, TANPA bypass sertifikat dalam kondisi
   apapun — termasuk saat development (pakai sertifikat self-signed lokal yang tetap
   divalidasi, bukan `verify: false`).
4. OTA wajib pakai dual partition bootloader dan verifikasi tanda tangan digital SEBELUM
   ditulis ke partisi cadangan — kegagalan update TIDAK BOLEH mem-brick perangkat.
5. Setiap percobaan transaksi WAJIB punya `idempotency_key` unik. Kalau tidak ada response
   dalam 10 detik, retry dengan `idempotency_key` YANG SAMA (bukan generate baru).
6. Jika kamu menemukan kebutuhan yang tidak tercakup di dokumen ini: JANGAN improvisasi.
   Tandai `// TODO: OPEN QUESTION` di kode, lanjutkan dengan asumsi paling konservatif, dan
   laporkan di ringkasan akhir pekerjaanmu.

---

## 1. CAKUPAN

Ada **dua jenis terminal** dengan firmware sama (kode identik, perilaku menu berbeda
berdasarkan `terminal_type` yang didapat dari Backend saat provisioning/heartbeat):

- **Terminal Merchant** (`terminal_type='MERCHANT'`, terpasang di kasir kantin/laundry/toko):
  menangani **Jual/Charge**, **Top-Up Tunai**, dan **Tarik Saldo**. Mendukung juga mode
  terintegrasi dengan POS pihak ketiga untuk transaksi Jual/Charge.
- **Terminal Admin** (`terminal_type='ADMIN'`, terpasang di kantor Admin Pesantren): menangani
  **Pendaftaran Kartu Baru** dan **Top-Up Tunai**. TIDAK bisa melakukan Jual/Charge atau Tarik
  Saldo — kalau operator mencoba, Backend akan menolak dengan `TERMINAL_TYPE_NOT_ALLOWED`, jadi
  firmware cukup TIDAK menampilkan menu itu sama sekali untuk `terminal_type='ADMIN'`.

Firmware WAJIB mengambil `terminal_type` dari Backend (lewat response awal provisioning atau
heartbeat pertama) dan menyesuaikan menu yang ditampilkan — jangan hardcode satu jenis menu.

---

## 2. KOMPONEN FISIK

| Komponen | Spesifikasi |
|---|---|
| Core Processor | ESP32-WROOM-32E (Dual-core 240MHz, 4MB Flash), Wi-Fi & Bluetooth bawaan |
| RFID Reader | MFRC522 atau PN532, 13.56 MHz HF, MIFARE Classic 1K / MIFARE DESFire |
| Display | LCD 16x2 I2C, atau OLED 0.96" SPI |
| Input | Matrix Keypad 4x4 berbahan membran karet atau tombol taktil mekanik |
| Secure Element (opsional Fase 3+) | ATECC608A — kunci privat HTTPS & tanda tangan digital lokal |
| Printer (opsional) | Thermal printer untuk struk — jika tidak ada, tampilkan status sukses/gagal di layar |

## Tech Stack Firmware

- **ESP-IDF** (direkomendasikan atas Arduino framework, untuk kontrol OTA & partisi lebih presisi)
- TLS 1.3 wajib untuk semua komunikasi ke Backend
- Library RFID: driver MFRC522/PN532 sesuai reader yang dipakai
- HTTP client: `esp_http_client` (ESP-IDF native) untuk request ke Backend
- WebSocket/MQTT client untuk mode Integrated, heartbeat, DAN handshake pendaftaran kartu
  (Terminal Admin — lihat §4.5)

---

## 3. MENU OPERATOR DI TERMINAL

Operator memilih jenis transaksi di layar awal sebelum santri tap kartu — WAJIB langkah
eksplisit terpisah (bukan otomatis dideteksi dari nominal), untuk mencegah salah pencet.
Menu berbeda tergantung `terminal_type`:

**Terminal Merchant:**
```
[1] JUAL / CHARGE      → wajib PIN santri
[2] TOP-UP TUNAI        → tidak perlu PIN, tapi wajib tap kartu untuk identifikasi santri
[3] TARIK SALDO         → wajib PIN santri, wajib pilih alasan dari daftar tetap
                          (Kartu Akan Ditutup / Kelebihan Top-Up / Lainnya)
```

**Terminal Admin:**
```
[1] DAFTAR/GANTI KARTU  → tidak perlu PIN saat scan, PIN dibuat santri di langkah akhir.
                          Backend otomatis tahu ini pendaftaran baru atau penggantian kartu
                          hilang (tidak perlu operator memilih jenisnya)
[2] TOP-UP TUNAI         → sama seperti Terminal Merchant, tapi tidak terikat merchant_id
[3] RESET PIN            → kartu LAMA masih ada di tangan santri (bukan hilang), cukup buat
                          PIN baru — satu langkah, tidak ada handshake ke web
```

---

## 4. ALUR KERJA FIRMWARE

### 4.1 Mode Standalone — Jual/Charge
1. Operator pilih menu `[1] JUAL`, input nominal di keypad.
2. Tampilkan "Silakan Tap Kartu Anda".
3. Santri tap kartu RFID → baca UID.
4. Minta input PIN 4–6 digit di keypad.
5. Hitung `SHA-256(card_uid + salt_tenant + pin)` secara lokal (lihat §6 Keamanan PIN).
6. Kirim payload ke `POST /v1/terminal/charge` (kontrak lengkap di §7).
7. Tampilkan hasil: sukses (hijau, cetak struk jika ada printer) / gagal (tampilkan
   `error.message` dari response, JANGAN tampilkan `error.code` mentah ke operator/santri).

### 4.2 Top-Up Tunai
1. Operator pilih menu `[2] TOP-UP TUNAI`, input nominal yang diterima secara fisik dari
   wali/santri.
2. Tampilkan "Silakan Tap Kartu Anda" — **tidak ada langkah input PIN**.
3. Santri tap kartu RFID → baca UID.
4. Kirim payload `{device_id, card_uid, amount, idempotency_key}` ke `POST /v1/terminal/topup`.
5. Jika response `TOPUP_LIMIT_EXCEEDED`, tampilkan pesan limit dan arahkan operator ke Admin
   Pesantren untuk top-up di atas batas.
6. Tampilkan hasil & cetak struk sebagai bukti serah-terima uang tunai (struk ini penting
   sebagai kontrol kas, bukan sekadar formalitas — kalau tidak ada printer, wajib tampilkan
   konfirmasi visual yang jelas dan cukup lama di layar sebelum kembali ke menu utama).

### 4.3 Tarik Saldo (Withdrawal)
1. Operator pilih menu `[3] TARIK SALDO`, input nominal yang akan dibayarkan tunai ke santri.
2. Operator/santri pilih **alasan penarikan** dari daftar tetap di layar (bukan free-text).
3. Tampilkan "Silakan Tap Kartu Anda".
4. Santri tap kartu RFID → baca UID.
5. Minta input PIN santri — **wajib**, sama seperti Charge, karena ini mengurangi saldo.
6. Kirim payload `{device_id, card_uid, encrypted_pin, amount, reason, idempotency_key}` ke
   `POST /v1/terminal/withdrawal`.
7. Jika sukses, operator baru menyerahkan uang tunai fisik ke santri **setelah** menerima
   konfirmasi sukses dari layar (bukan sebelumnya) — mencegah situasi uang sudah keluar tapi
   sistem gagal mencatat.
8. Tampilkan hasil & cetak struk.

### 4.4 Mode Integrated (dengan POS pihak ketiga) — hanya untuk Jual/Charge
1. Terima push nominal via WebSocket/MQTT dari Backend.
2. Tampilkan nominal, tunggu tap kartu (timeout 90 detik → kirim status `EXPIRED`, sesi
   transaksi ditutup, `idempotency_key` tersebut tidak boleh dipakai ulang).
3. Proses sama seperti Standalone Jual/Charge langkah 3–7.

> Top-up dan tarik saldo tunai HANYA tersedia di mode Standalone — tidak relevan untuk mode
> Integrated karena POS pihak ketiga tidak menangani uang tunai pesantren.

### 4.5 Daftar/Ganti Kartu (khusus Terminal Admin)

Ini alur DUA ARAH — terminal tidak menyelesaikan pendaftaran sendirian, karena memilih santri
dari ratusan nama tidak praktis lewat keypad 4x4. Admin menyelesaikan bagian pemilihan santri
di dashboard web; terminal hanya menangani pembacaan kartu dan pembuatan PIN (karena PIN wajib
dibuat di terminal, tidak pernah lewat web). Alur ini dipakai baik untuk kartu benar-benar baru
maupun mengganti kartu yang hilang — Backend yang menentukan otomatis, operator tidak perlu tahu
bedanya.

1. Operator pilih menu `[1] DAFTAR/GANTI KARTU`.
2. Tampilkan "Tap kartu (baru/pengganti) yang akan didaftarkan".
3. Kartu di-tap → baca UID.
4. Kirim `{device_id, card_uid}` ke `POST /v1/terminal/card-scan`. Kalau kartu ternyata sudah
   terdaftar DAN masih aktif, Backend akan menolak dengan `CARD_ALREADY_REGISTERED` — tampilkan
   pesan tersebut dan kembali ke menu utama.
5. Kalau berhasil, tampilkan "Kartu terbaca. Silakan lanjutkan pemilihan santri di dashboard
   Admin." dan **tunggu** (jangan timeout terlalu cepat — beri waktu minimal 5 menit, sesuai
   masa berlaku sesi di Backend).
6. Backend akan mendorong sinyal `ready_for_pin` lewat WebSocket setelah Admin memilih santri
   di web. Begitu sinyal diterima, tampilkan "Santri, silakan buat PIN baru (4-6 digit)".
7. Minta input PIN dua kali (konfirmasi) di keypad — kalau tidak cocok, ulangi dari awal
   langkah ini (jangan kirim apapun ke Backend sebelum dua input PIN cocok).
8. Hitung `SHA-256(card_uid + salt_tenant + pin)` secara lokal (sama seperti §6), kirim ke
   `POST /v1/terminal/registration-sessions/:id/finalize`.
9. Tampilkan hasil sukses/gagal. Kalau sukses, kartu langsung aktif dan siap dipakai santri.
   Kalau ini penggantian kartu lama, saldo santri otomatis ikut (tidak perlu langkah tambahan
   apapun di firmware — itu ditangani Backend berdasarkan `santri_id`).

Kalau operator membatalkan (tombol batal) sebelum langkah 6, atau sesi kedaluwarsa (5 menit)
sebelum Admin memilih santri di web, tampilkan "Sesi pendaftaran berakhir, ulangi dari awal"
dan kembali ke menu utama — jangan retry otomatis untuk alur ini (beda dengan §5, karena ini
menunggu aksi manusia di sisi web, bukan kegagalan jaringan sesaat).

### 4.6 Reset PIN (khusus Terminal Admin, kartu LAMA masih di tangan santri)

Beda dengan §4.5: santri tidak kehilangan kartu, cuma lupa PIN. Karena kartu fisiknya masih
ada dan terbaca, identitas santri sudah pasti — TIDAK perlu handshake ke web sama sekali, satu
langkah penuh di terminal.

1. Operator pilih menu `[3] RESET PIN`.
2. Tampilkan "Tap kartu yang PIN-nya akan direset".
3. Kartu di-tap → baca UID.
4. Backend cek kartu (lewat `card_uid`) dan kembalikan nama santri pemiliknya — tampilkan di
   layar: "Reset PIN untuk [Nama Santri]? Pastikan benar orangnya." Operator konfirmasi (tombol
   OK) sebelum lanjut — ini pengecekan prosedural manual, sistem tidak bisa verifikasi wajah.
5. Minta santri input PIN baru dua kali (konfirmasi) di keypad.
6. Hitung `SHA-256(card_uid + salt_tenant + pin)` secara lokal, kirim
   `{device_id, card_uid, new_pin_hash_local}` ke `POST /v1/terminal/pin-reset`.
7. Tampilkan hasil sukses/gagal.

---

## 5. IDEMPOTENCY & RETRY

- Setiap percobaan transaksi punya `idempotency_key` unik, format bebas asal unik (contoh:
  `{device_id}-{unix_timestamp}-{counter}`).
- Jika tidak ada response dalam **10 detik**, retry dengan `idempotency_key` **yang sama**
  (bukan generate baru) — Backend akan mengembalikan hasil transaksi pertama tanpa memproses
  ulang.
- Jangan retry lebih dari 3x berturut-turut; setelah itu tampilkan error koneksi ke operator
  dan hentikan sesi transaksi (operator harus mulai ulang dari menu).

---

## 6. KEAMANAN PIN (WAJIB, TIDAK BISA DITAWAR)

```
[Terminal/Firmware]                          [Backend]
card_uid + salt_tenant + pin_input
  → SHA-256 (lokal, sebelum transmisi)
  → dikirim sebagai "encrypted_pin" via HTTPS TLS 1.3
                                              → terima encrypted_pin
                                              → bandingkan dengan Argon2id(encrypted_pin)
                                                yang tersimpan di database
                                              → MATCH / NO MATCH
```

- PIN **tidak pernah** disimpan di flash memory device dalam bentuk apapun setelah transaksi
  selesai (hapus dari memory segera setelah request terkirim).
- `salt_tenant` diambil dari konfigurasi device saat provisioning awal, disimpan terenkripsi
  di flash (idealnya di ATECC608A jika tersedia).
- Top-up tunai (§4.2) **tidak memerlukan PIN** — hanya Charge dan Withdrawal yang wajib PIN,
  karena keduanya mengurangi saldo santri.

---

## 7. KONTRAK API — DETAIL LENGKAP

### 7.1 Format Response Standar (berlaku di semua endpoint Backend)

Sukses:
```json
{ "success": true, "data": { }, "meta": { "requestId": "uuid", "timestamp": "ISO8601" } }
```
Gagal:
```json
{ "success": false, "error": { "code": "INSUFFICIENT_BALANCE", "message": "...", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "ISO8601" } }
```

Kode error yang relevan untuk firmware (tampilkan `error.message`, bukan `error.code`, ke
operator): `INVALID_PIN`, `CARD_NOT_ACTIVE`, `INSUFFICIENT_BALANCE`, `DAILY_LIMIT_EXCEEDED`,
`DUPLICATE_REQUEST`, `TENANT_SUSPENDED`, `TOPUP_LIMIT_EXCEEDED`, `WITHDRAWAL_LIMIT_EXCEEDED`,
`RATE_LIMITED`, `TERMINAL_TYPE_NOT_ALLOWED`, `CARD_ALREADY_REGISTERED`,
`REGISTRATION_SESSION_EXPIRED`.

### 7.2 Autentikasi Terminal

Terminal TIDAK memakai JWT. Setiap request ke Backend wajib menyertakan header:
```
X-Device-Id: AA:BB:CC:DD:EE:FF   (MAC address atau hardware ID unik)
X-Device-Token: <device_token>   (token statis panjang, diterbitkan Admin Pesantren)
```
Device token hanya bisa diterbitkan ulang oleh Admin Pesantren lewat dashboard web (di luar
scope firmware) — kalau device token invalid/dicabut, Backend akan menolak semua request
dengan `error.code: UNAUTHORIZED`, dan firmware wajib menampilkan pesan "Terminal tidak
terdaftar, hubungi Admin Pesantren" lalu berhenti mencoba request otomatis (hindari retry loop
tak terbatas pada kasus ini).

### 7.3 `POST /v1/terminal/charge`

Request:
```json
{
  "device_id": "AA:BB:CC:DD:EE:FF",
  "card_uid": "04A3B2C1",
  "encrypted_pin": "sha256-hex-string",
  "amount": 15000,
  "idempotency_key": "term-AABBCC-1721369999-01"
}
```
Response 200:
```json
{
  "success": true,
  "data": {
    "transaction_id": "uuid", "journal_id": "uuid",
    "santri_name": "Ahmad Fauzi", "amount": 15000,
    "new_balance": 85000, "merchant_name": "Kantin Putra"
  },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:00:00Z" }
}
```
Response 422 (contoh saldo kurang):
```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_BALANCE", "message": "Saldo santri tidak mencukupi.",
    "details": { "current_balance": 5000, "requested_amount": 15000 } },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:00:00Z" }
}
```

### 7.4 `POST /v1/terminal/topup`

> Sama untuk Terminal Merchant maupun Terminal Admin — payload identik, Backend yang
> menentukan arah ledger berdasarkan `terminal_type` yang terdaftar untuk `device_id` tersebut
> (lihat §1). Firmware tidak perlu mengirim field tambahan apapun untuk membedakannya.

Request:
```json
{
  "device_id": "AA:BB:CC:DD:EE:FF",
  "card_uid": "04A3B2C1",
  "amount": 50000,
  "idempotency_key": "term-AABBCC-1721370050-02"
}
```
Response 200:
```json
{
  "success": true,
  "data": { "transaction_id": "uuid", "journal_id": "uuid",
    "santri_name": "Ahmad Fauzi", "amount": 50000, "new_balance": 135000 },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:05:00Z" }
}
```
Response 422 (limit terlampaui):
```json
{
  "success": false,
  "error": { "code": "TOPUP_LIMIT_EXCEEDED", "message": "Nominal top-up melebihi batas per transaksi.",
    "details": { "limit": 500000, "requested_amount": 750000 } },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:05:00Z" }
}
```

### 7.4b `POST /v1/terminal/card-scan` (khusus Terminal Admin, langkah 1 pendaftaran kartu)

Request:
```json
{ "device_id": "AA:BB:CC:DD:EE:FF", "card_uid": "04A3B2C1" }
```
Response 200:
```json
{ "success": true, "data": { "session_id": "uuid" },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:10:00Z" } }
```
Response 422 (kartu sudah terdaftar):
```json
{ "success": false, "error": { "code": "CARD_ALREADY_REGISTERED",
  "message": "Kartu ini sudah terdaftar pada santri lain.", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:10:00Z" } }
```

Setelah `session_id` didapat, firmware menunggu event WebSocket `ready_for_pin` dengan
`session_id` yang sama sebelum lanjut ke langkah PIN (lihat §4.5 langkah 6).

### 7.4c `POST /v1/terminal/registration-sessions/:id/finalize` (langkah akhir pendaftaran kartu)

Request:
```json
{ "device_id": "AA:BB:CC:DD:EE:FF", "pin_hash_local": "sha256-hex-string" }
```
Response 200:
```json
{ "success": true, "data": { "card_id": "uuid", "santri_name": "Ahmad Fauzi", "status": "ACTIVE" },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:14:00Z" } }
```
Response 422 (sesi kedaluwarsa):
```json
{ "success": false, "error": { "code": "REGISTRATION_SESSION_EXPIRED",
  "message": "Sesi pendaftaran sudah berakhir, ulangi dari awal.", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:14:00Z" } }
```

`pin_hash_local` dihitung dengan formula yang sama seperti §6: `SHA-256(card_uid + salt_tenant + pin)`.

### 7.4d `POST /v1/terminal/pin-reset` (khusus Terminal Admin, kartu lama masih ada — §4.6)

Request:
```json
{ "device_id": "AA:BB:CC:DD:EE:FF", "card_uid": "04A3B2C1", "new_pin_hash_local": "sha256-hex-string" }
```
Response 200:
```json
{ "success": true, "data": { "card_id": "uuid", "santri_name": "Ahmad Fauzi" },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:20:00Z" } }
```
Response 422 (kartu tidak aktif/tidak ditemukan):
```json
{ "success": false, "error": { "code": "CARD_NOT_ACTIVE",
  "message": "Kartu tidak ditemukan atau sedang tidak aktif.", "details": {} },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:20:00Z" } }
```

Tidak ada langkah tambahan setelah ini — beda dengan §7.4b/7.4c, endpoint ini satu langkah
langsung selesai (tidak ada sesi/handshake ke web) karena identitas santri sudah pasti dari
`card_uid` yang di-tap.

### 7.5 `POST /v1/terminal/withdrawal`

Request:
```json
{
  "device_id": "AA:BB:CC:DD:EE:FF",
  "card_uid": "04A3B2C1",
  "encrypted_pin": "sha256-hex-string",
  "amount": 20000,
  "reason": "EXCESS_TOPUP_REFUND",
  "idempotency_key": "term-AABBCC-1721370200-03"
}
```
`reason` harus salah satu dari: `CARD_CLOSURE`, `EXCESS_TOPUP_REFUND`, `OTHER`.

Response 200:
```json
{
  "success": true,
  "data": { "transaction_id": "uuid", "journal_id": "uuid",
    "santri_name": "Ahmad Fauzi", "amount": 20000, "new_balance": 115000 },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:10:00Z" }
}
```
Response 422 (contoh limit terlampaui):
```json
{
  "success": false,
  "error": { "code": "WITHDRAWAL_LIMIT_EXCEEDED", "message": "Nominal penarikan melebihi batas per transaksi.",
    "details": { "limit": 200000, "requested_amount": 300000 } },
  "meta": { "requestId": "uuid", "timestamp": "2026-07-19T10:10:00Z" }
}
```

### 7.6 `GET /v1/terminals/:id/heartbeat`

Kirim tiap **30 detik** via WebSocket (bukan polling HTTP berulang) ke Backend. Payload minimal:
```json
{ "device_id": "AA:BB:CC:DD:EE:FF", "firmware_version": "1.2.0", "status": "ONLINE", "timestamp": "ISO8601" }
```
Firmware TIDAK perlu logika threshold offline — itu tanggung jawab Backend (3 heartbeat hilang
berturut-turut → Backend yang menandai status `OFFLINE`). Firmware cukup kirim heartbeat
konsisten dan reconnect otomatis dengan exponential backoff jika koneksi WebSocket putus.

### 7.7 `POST /v1/terminals/:id/ota` (dipicu dari dashboard, diterima firmware)

Backend mengirim trigger update berisi URL binary + hash SHA-256 + tanda tangan RSA. Firmware
melakukan **pull** binary dari URL tersebut (bukan Backend push binary langsung ke device) —
lihat alur lengkap di §8.

---

## 8. OTA (OVER-THE-AIR UPDATE)

1. Firmware pakai **dual partition bootloader** (Factory + OTA).
2. Saat menerima trigger update, firmware men-download binary dari URL yang diberikan Backend.
3. **Verifikasi tanda tangan digital** (SHA-256 hash binary dicocokkan, lalu diverifikasi
   dengan RSA public key yang sudah tertanam di firmware) SEBELUM binary ditulis ke partisi
   cadangan.
4. Jika verifikasi gagal: hentikan proses, JANGAN tulis ke partisi, laporkan kegagalan ke
   Backend, tetap berjalan di firmware lama.
5. Jika verifikasi berhasil: tulis ke partisi OTA (bukan partisi aktif), baru kemudian switch
   boot partition setelah penulisan selesai penuh dan diverifikasi ulang.
6. Ini mencegah bricking total: kalau proses gagal di tengah jalan (misal listrik padam),
   device tetap boot ke partisi Factory/firmware lama yang belum tersentuh.

---

## 9. KEBUTUHAN NON-FUNGSIONAL

| Dimensi | Ketentuan |
|---|---|
| Keamanan Transport | HTTPS TLS 1.3 wajib, tanpa bypass sertifikat dalam kondisi apapun |
| Heartbeat | Kirim tiap 30 detik, reconnect otomatis dengan backoff jika putus |
| Retry | Maksimal 3x berturut dengan `idempotency_key` sama, lalu berhenti & tampilkan error |
| OTA Safety | Update gagal di tengah proses TIDAK BOLEH mem-brick device (wajib diuji fisik) |
| Waktu Respon UI | Feedback visual ke operator maksimal 1 detik setelah tap kartu (loading state) |

---

## 10. STRATEGI TESTING

| Level | Fokus |
|---|---|
| Unit | Fungsi hashing PIN lokal, parsing response JSON, state machine menu operator |
| Integration | Simulasi request ke Backend (mock server) untuk charge/topup/withdrawal, termasuk skenario error tiap `error.code` |
| Hardware-in-the-loop | Simulasi kegagalan jaringan saat transaksi berlangsung (harus retry dengan idempotency_key sama, bukan generate baru) |
| Hardware-in-the-loop (WAJIB) | Simulasi kegagalan OTA — matikan power fisik saat proses penulisan partisi berlangsung, verifikasi device tetap boot normal ke firmware lama saat power kembali |

---

## 11. ROADMAP & DEFINITION OF DONE

**Fase 1 (Bulan 1–2) — Prototype:** Baca UID kartu MIFARE dengan MFRC522/PN532, tampilkan di
serial monitor/LCD. DoD: pembacaan kartu stabil dan konsisten di berbagai kondisi jarak/sudut
tap yang wajar.

**Fase 2 (Bulan 3–4) — Integrasi Transaksi:** Menu operator berfungsi penuh di layar terminal
untuk KEDUA tipe (Merchant: Jual/Top-Up/Tarik Saldo; Admin: Daftar/Ganti Kartu/Top-Up/Reset PIN).
DoD: alur Charge, Top-Up, dan Withdrawal terintegrasi penuh dengan §7.3–7.5 di Terminal
Merchant; idempotency & retry (§5) teruji; struk tercetak (atau konfirmasi visual jelas kalau
tanpa printer) untuk tiap jenis transaksi; alur Daftar/Ganti Kartu (§4.5, §7.4b–7.4c) berhasil
end-to-end di Terminal Admin termasuk skenario sesi kedaluwarsa, kartu yang sudah terdaftar,
dan skenario penggantian kartu (santri yang dipilih sudah punya kartu lama); alur Reset PIN
(§4.6, §7.4d) berhasil satu langkah tanpa handshake web; firmware terbukti menampilkan menu
yang benar sesuai `terminal_type` yang didapat dari Backend.

**Fase 3 (Bulan 5) — Stabilisasi OTA:** DoD: simulasi kegagalan OTA di tengah proses (matikan
power saat menulis partisi) tidak mem-brick device — device tetap boot ke firmware lama saat
power kembali. WAJIB diuji dengan hardware fisik, bukan hanya simulasi kode.

---

## INSTRUKSI EKSEKUSI

Mulai dari Fase 1. Jangan lompat fase — setiap fase harus memenuhi Definition of Done sebelum
lanjut ke fase berikutnya. Di akhir tiap fase, laporkan: (1) apa yang selesai, (2) hasil test
yang relevan dengan DoD fase itu, (3) daftar `// TODO: OPEN QUESTION` yang muncul selama
pengerjaan. Kalau ada bagian dokumen ini yang ambigu atau bentrok — terutama menyangkut
keamanan PIN, idempotency, atau OTA — hentikan dan tanyakan sebelum melanjutkan, jangan menebak.
