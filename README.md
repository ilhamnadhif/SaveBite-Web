# SaveBite Web

SaveBite untuk browser: aplikasi Flutter SaveBite (`../SaveBite`) yang di-port satu-banding-satu ke Next.js. Alur, layar, copy Bahasa Indonesia, warna, tipografi, dan aturan bisnisnya sama dengan aplikasi mobile — pengguna cukup membuka web, tidak perlu memasang aplikasi.

Satu aplikasi melayani tiga peran: **konsumen** menemukan dan memesan Surprise Bag di sekitar mereka, **merchant** mengelola toko, bag, pesanan, pickup, dan saldo, dan **admin** memverifikasi penjual, mengelola pengguna, menangani pengaduan, dan melihat laporan transaksi. Backend-nya Supabase yang sama dengan aplikasi mobile (Auth, Postgres + RLS, Realtime, Storage, Edge Functions Midtrans).

## Alur (sama dengan mobile)

- **Startup**: tanpa splash — jika ada sesi, muat profil/toko lalu buka ruang kerja terakhir (`last_mode`); jika tidak, onboarding (sekali per perangkat) → pilih peran → login Google.
- **Konsumen**: izin lokasi → Beranda (bag terdekat, kategori, filter, pilih lokasi), Peta (OpenStreetMap), Pesanan, Favorit, Profil; detail bag, profil toko, pencarian, checkout QRIS (Midtrans Snap), status pembayaran tersinkron server, voucher pickup dengan QR berotasi 60 detik, ulasan, notifikasi realtime, edit profil, bantuan, dokumen legal, ganti peran, hapus akun.
- **Merchant**: setup toko (titik peta dipilih manual di web, seperti build web Flutter), Dashboard, kelola bag (buat/edit/duplikat/aktif-nonaktif, jadwal, stok, foto), pesanan masuk realtime, tandai siap, batalkan, detail pesanan, **scan QR pickup dengan kamera**, ulasan, saldo/transaksi, rekening bank, penarikan dana.

- **Admin** (`/admin`, tidak ditampilkan di halaman pilih peran): Dashboard, Verifikasi Penjual, Kelola Pengguna, Pengaduan, Laporan Transaksi. Peran disimpan di tabel `admin_users` dan ditambahkan operator lewat SQL; setiap RPC admin memeriksa peran di server. Toko baru berstatus `pending` dan baru tampil ke konsumen setelah disetujui.

Navigasi meniru `Navigator` Flutter: layar di-*push* ke tumpukan, layar di bawahnya tetap hidup (posisi scroll dan isian form tidak hilang), tombol kembali browser = tombol kembali Android, dan navigasi "root" (mis. logout, checkout selesai) membersihkan riwayat agar tidak bisa kembali ke alur yang sudah ditutup. Setiap layar tetap punya URL sehingga refresh atau tautan yang dibagikan membuka layar yang sama.

## Struktur

```
apps/web
├── app/                      Next.js: root layout, catch-all page (tanpa UI), API, /auth/callback
├── middleware.ts             sesi Supabase, gerbang login, security headers
├── lib/                      port lapisan non-UI Flutter
│   ├── models.ts             lib/data/models.dart
│   ├── mappers.ts            lib/data/mappers.dart
│   ├── backend/              lib/data/backend/* (kontrak, Supabase, demo)
│   ├── appState.ts           lib/app_state.dart (state + use case)
│   ├── appNav.tsx            lib/app_nav.dart (satu pintu navigasi)
│   ├── navigator.ts          Navigator ala Flutter + sinkronisasi riwayat browser
│   ├── routes.ts             tabel URL ↔ layar
│   └── auth.ts, location.ts, notificationRoute.ts, env.ts, imagePicker.ts
├── ui/                       port lib/widgets + lib/theme (token, ikon Material, komponen)
└── screens/                  port lib/screens/{onboarding,consumer,merchant,shared}
packages/web-shared           env tervalidasi, logger, sanitasi redirect, klien Supabase browser/server
```

Ikon memakai set Material Icons yang sama dengan Flutter (`Icons.*`), dirender sebagai SVG. Daftar ikon ada di `scripts/icon-names.txt`; jalankan `pnpm icons` setelah menambah nama.

## Menjalankan lokal

1. Salin `.env.example` menjadi `apps/web/.env.local` dan isi nilai publik Supabase + Midtrans (sama dengan `assets/config/client.env` di aplikasi Flutter).
2. Di Supabase Auth → URL Configuration, tambahkan `http://localhost:3000/auth/callback` ke redirect allowlist.
3. `pnpm install`, lalu `pnpm dev` → `http://localhost:3000`.

Mode demo (data contoh di memori, login lokal, tanpa Supabase/pembayaran) — setara `--dart-define=SAVEBITE_DEMO=true`:

```sh
NEXT_PUBLIC_SAVEBITE_DEMO=true pnpm dev
```

`NEXT_PUBLIC_SAVEBITE_E2E=true` (hanya bersama profil Midtrans `sandbox`) menampilkan alat uji internal: login akun pengujian dan input hasil scan staging.

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm dev` | Server pengembangan pada port 3000 |
| `pnpm build` | Build produksi |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint 9 |
| `pnpm test` | Vitest (`packages/web-shared` dan `apps/web`) |
| `pnpm check:migrations` | Audit SQL migrasi di repo ini |
| `pnpm icons` | Generate ulang ikon Material dari `scripts/icon-names.txt` |
| `pnpm verify` | Semua cek di atas + build. Titik masuk tunggal untuk CI. |

## Deploy VPS

Siapkan `.env` dari `.env.example`, lalu:

```sh
docker compose up --build -d
docker compose ps          # tunggu status `healthy`
curl -fsS http://localhost:3002/api/ready
```

**Wajib HTTPS untuk paritas penuh dengan mobile.** Browser hanya mengizinkan lokasi (GPS), kamera (scan QR pickup merchant), dan clipboard pada *secure context*. Di `http://<ip-vps>:3002` fitur tersebut ditolak browser dan aplikasi menampilkan panduan izinnya. Aktifkan profil Caddy dengan domain: `docker compose --profile custom-domain up --build -d` (set `ROOT_DOMAIN`, `ACME_EMAIL`, arahkan DNS, buka port 80/443), lalu ubah `NEXT_PUBLIC_AUTH_CALLBACK_URL` ke `https://<domain>/auth/callback`.

### Operasi

- **Health vs readiness.** `/api/health` hanya memastikan proses melayani HTTP. `/api/ready` juga memeriksa konfigurasi dan Supabase; `503` selama outage.
- **Shutdown.** Container berjalan sebagai user `node`, `no-new-privileges`, `init: true`, `stop_grace_period: 30s`.
- **Log.** JSON satu baris dengan redaksi otomatis untuk password, token, secret, dan kunci. `LOG_LEVEL` mengatur verbosity.

### CI/CD

`.github/workflows/deploy.yml`: **validate** (migrasi → lint → typecheck → test → build → audit → compose config), **docker** (build image + smoke test `/api/health`), **deploy** (hanya `main` dan `SAVEBITE_DEPLOY_ENABLED=true`).

## Keamanan

- **Otorisasi di database.** Semua data diambil browser langsung dari Supabase di bawah RLS, memakai view/RPC/Edge Function yang sama dengan mobile. HTML yang dikirim server tidak memuat data pengguna.
- **Pembayaran.** Checkout membuat pesanan lalu langsung membuka halaman Snap Midtrans (metode `MIDTRANS`: semua metode yang aktif di akun merchant). URL halaman hanya diikuti bila lolos validasi host/path Snap resmi. Midtrans kembali lewat Edge Function `midtrans-return?target=web` ke `MIDTRANS_WEB_RETURN_URL` (`?savebite_payment_return=1` → tab Pesanan); status lunas selalu dari `midtrans-status` (Get Status di server) atau webhook. Kunci idempotensi checkout/penarikan disimpan sebelum request sehingga refresh atau retry tidak membuat pesanan ganda.
- **QR pickup.** Token acak berumur pendek dari `issue_pickup_token`, dirotasi tiap 60 detik; merchant hanya dapat menebus token yang benar-benar dibaca kamera.
- **Unggahan gambar.** Foto di-*encode* ulang di browser menjadi JPEG maks. 1280 px (sama dengan `imageQuality: 80, maxWidth: 1280` di Flutter), sehingga metadata EXIF/GPS terbuang dan file non-gambar tidak bisa lolos; batas 2 MB dan path `<uid>/…` tetap ditegakkan, lalu kebijakan bucket di Supabase.
- **Open redirect.** `next` pada `/login` dan `/auth/callback` divalidasi `safeNextPath()` (hanya path same-origin).
- **Security headers.** CSP ketat (`default-src 'self'`, `frame-ancestors 'none'`, allowlist Supabase + Midtrans), `Permissions-Policy` hanya mengizinkan geolokasi dan kamera untuk origin sendiri, HSTS saat HTTPS. `'unsafe-eval'` hanya muncul di `next dev`.
- **Cookie.** `SameSite=Lax`, `Secure` di produksi, `domain` hanya bila `NEXT_PUBLIC_COOKIE_DOMAIN` disetel.

## Route server

| Route | Perilaku |
|---|---|
| `GET /api/health` | Liveness, tidak menyentuh database. |
| `GET /api/ready` | Readiness: konfigurasi valid **dan** Supabase menjawab. |
| `GET /auth/callback` | Tukar kode PKCE, lalu redirect `303` ke `next` yang sudah divalidasi. |

Semua path aplikasi lain dilayani satu halaman kosong; aplikasi klien membangun layarnya dari URL. Path yang tidak dikenal menghasilkan `404`.

## Environment

Wajib: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_CALLBACK_URL`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`.
Opsional: `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT` (default `sandbox`), `NEXT_PUBLIC_COOKIE_DOMAIN`, `NEXT_PUBLIC_SAVEBITE_E2E`, `NEXT_PUBLIC_SAVEBITE_DEMO` (pengembangan saja), `LOG_LEVEL`, `ROOT_DOMAIN`, `ACME_EMAIL`.

Hanya nilai publik yang boleh ada di sini. Jangan masukkan service-role key, Midtrans server key, atau secret lain.

## Database

Rantai migrasi lengkap 0001–0025 dan Edge Functions berada di repo Flutter (`../SaveBite/supabase`), yang ter-link ke project Supabase; terapkan dengan `supabase db push` dari sana. Repo ini memuat 0022 (kode pickup manual, fitur web lama yang kini tidak dipakai UI — dipertahankan karena migrasi tidak boleh dihapus) 0023 (pembatasan MIME bucket gambar + Realtime `surprise_bags`), dan 0025 (Admin dan pengaduan); salinan identiknya ada di repo Flutter, dan `pnpm check:migrations` mengauditnya di sini. 0024 menambahkan checkout Snap ter-hosting dengan semua metode (`MIDTRANS`).

## Batasan yang diketahui

- Push notification saat aplikasi tertutup tidak ada (sama dengan mobile: hanya notifikasi realtime dalam aplikasi).
- Integrasi Midtrans, Supabase, dan Google OAuth tidak diuji end-to-end di CI karena memerlukan kredensial nyata.
