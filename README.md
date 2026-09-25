# SaveBite Web

Aplikasi web SaveBite dalam satu Next.js App Router. Setelah login dengan satu akun Google, pengguna memilih peran **Konsumen** atau **Merchant**. Ruang merchant berada di `/merchant`; katalog konsumen tetap di halaman utama.

## Fitur

- Konsumen: katalog, pencarian/filter, peta OpenStreetMap, detail toko dan bag, favorit, checkout QRIS Snap, status pesanan realtime, QR pickup Flutter, kode pickup 8 digit, ulasan, profil, dan notifikasi.
- Merchant: setup/profil toko, dashboard, kelola bag, pesanan realtime, status pesanan, redeem pickup, saldo/transaksi, rekening, penarikan, dan ulasan.
- `packages/web-shared`: autentikasi Supabase, komponen, tema, dan formatter bersama.

## Jalankan lokal

1. Salin `.env.example` menjadi `.env`; isi URL dan publishable/anon key Supabase, callback OAuth, serta Midtrans client key publik.
2. Pada Supabase Auth → URL Configuration, tambahkan `http://localhost:3000/auth/callback` ke redirect allowlist. Provider Google tetap memakai callback Supabase `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Jalankan `pnpm install`, lalu `pnpm dev`. Aplikasi tersedia di `http://localhost:3000`.

## Deploy VPS

Siapkan `.env` dari `.env.example`, gunakan callback `http://<ip-vps>:3000/auth/callback`, kosongkan `NEXT_PUBLIC_COOKIE_DOMAIN`, dan buka port TCP 3000 di firewall. Jalankan:

```sh
docker compose up --build -d
```

Aplikasi konsumen tersedia pada `http://<ip-vps>:3000/`, dan portal merchant pada `http://<ip-vps>:3000/merchant`.

GitHub Actions menjalankan typecheck dan build pada push ke `main`, lalu mengirim source ke `/home/ubuntu/savebite-web` dan membangun/menjalankan Docker di VPS. Siapkan repository secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, dan `VPS_KNOWN_HOSTS`. File `.env` tetap tersimpan di VPS.

Jika domain tersedia, profil Caddy dapat diaktifkan dengan `docker compose --profile custom-domain up --build -d`. Arahkan DNS domain utama dan subdomain merchant ke VPS, set `ROOT_DOMAIN`, `ACME_EMAIL`, dan `NEXT_PUBLIC_COOKIE_DOMAIN`, serta buka port 80/443.

## Kode pickup merchant desktop

Setelah order siap, konsumen dapat meminta kode 8 digit. Kode mentah hanya dikirim sekali oleh RPC; Supabase menyimpan hash SHA-256 dan expiry. Kode berlaku maksimal 5 menit atau sampai order/jendela pickup berakhir. Penerbitan baru mengganti kode sebelumnya. Redeem memeriksa pemilik toko, status ready, bukti pembayaran, waktu order dan jendela pickup, lalu menghapus kode dalam transaksi yang sama. Lima kegagalan dalam 15 menit membatasi percobaan berikutnya.

Jalankan migrasi `supabase/migrations/0022_manual_pickup_codes.sql` pada project Supabase SaveBite yang telah menerapkan migrasi sampai 0021. Migrasi ini mempertahankan `redeem_order(text)` sehingga token QR Flutter SB2 sepanjang 52 karakter tetap berfungsi.

## Environment

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_CALLBACK_URL`, `NEXT_PUBLIC_COOKIE_DOMAIN`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT`, `ROOT_DOMAIN`, dan `ACME_EMAIL`.

Supabase publishable/anon key dan Midtrans client key memang dipakai di browser. Jangan masukkan service-role key, Midtrans server key, atau kredensial rahasia lain ke environment web. Midtrans create/status/cancel tetap berjalan melalui Edge Functions Supabase.
