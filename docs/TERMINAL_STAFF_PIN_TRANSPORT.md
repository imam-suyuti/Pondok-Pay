# Kontrak Transport PIN Staf Terminal

Untuk PIN tindakan `ADMIN_PESANTREN` dan `OPERATOR_MERCHANT`, terminal mengirim nilai berikut, bukan PIN plaintext:

```text
SHA-256(staff_user_id + salt_tenant + PIN_6_digit)
```

- `staff_user_id` adalah UUID Admin atau Operator yang dipilih di terminal.
- `salt_tenant` adalah salt tenant yang diprovision ke terminal melalui kanal aman.
- Backend membandingkan nilai transport ini terhadap `action_pin_hash` memakai Argon2id.
- Nilai transport tidak boleh dicatat dalam log firmware atau API.
- Device token tetap wajib menyertai request dan PIN tidak dapat digunakan lintas tenant atau lintas staf.
