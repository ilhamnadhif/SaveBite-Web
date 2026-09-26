# SaveBite Web

Aplikasi web SaveBite dalam satu Next.js App Router. Setelah login dengan satu akun Google, pengguna memilih peran **Konsumen** atau **Merchant**. Ruang merchant berada di `/merchant`; katalog konsumen tetap di halaman utama.

## Fitur

- Konsumen: katalog, pencarian/filter, peta OpenStreetMap, detail toko dan bag, favorit, checkout QRIS Snap, status pesanan realtime, QR pickup Flutter, kode pickup 8 digit, ulasan, profil, dan notifikasi.
- Merchant: setup/profil toko, dashboard, kelola bag, pesanan realtime, status pesanan, redeem pickup, saldo/transaksi, rekening, penarikan, dan ulasan.
- `packages/web-shared`: autentikasi Supabase, komponen, tema, konfigurasi tervalidasi, dan formatter bersama.

## Arsitektur

```
Browser ──► Next.js middleware  (refresh sesi Supabase + security headers)
       │
       ├─► Halaman (prerender statis, data diambil langsung dari PostgREST)
       │
       └─► Supabase
             ├─ PostgREST   : views (available_bags, consumer_orders, …)
             │                + tabel yang di-RLS (profiles, notifications, …)
             ├─ Edge Fn     : midtrans-create | midtrans-status | midtrans-cancel
             ├─ Realtime    : postgres_changes pada orders / notifications / surprise_bags
             └─ Storage     : bag-images, store-logos (publik)
```

Kode `NEXT_PUBLIC_*` hanya berisi nilai publik (anon key Supabase dan *client* key Midtrans). Seluruh otorisasi ditegakkan oleh **RLS Postgres**, bukan oleh menyembunyikan tombol di UI. Halaman `/` sampai `/merchant/*` sengaja tidak dirender di server: seluruh data diambil browser lewat PostgREST di bawah RLS, sehingga tidak ada kebocoran data melalui HTML.

## Jalankan lokal

1. Salin `.env.example` menjadi `.env.local` di `apps/web/`; isi URL dan publishable/anon key Supabase, callback OAuth, serta Midtrans client key publik.
2. Pada Supabase Auth → URL Configuration, tambahkan `http://localhost:3000/auth/callback` ke redirect allowlist. Provider Google tetap memakai callback Supabase `https://<project-ref>.supabase.co/auth/v1/callback`.
3. Jalankan `pnpm install`, lalu `pnpm dev`. Aplikasi tersedia di `http://localhost:3000`.

## Perintah

| Perintah | Fungsi |
|---|---|
| `pnpm dev` | Server pengembangan pada port 3000 |
| `pnpm build` | Build produksi (menjalankan lint sebagai bagian dari `next build`) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm lint` / `pnpm lint:fix` | ESLint 9 (flat config, type-aware) |
| `pnpm test` | Vitest: 157 test di `packages/web-shared` dan `apps/web` |
| `pnpm test:coverage` | Test + laporan cakupan v8 |
| `pnpm check:migrations` | Audit SQL: `search_path` pada `security definer`, hak akses tabel rahasia, kebocoran kredensial |
| `pnpm verify` | Semua Checks di atas + build. **Titik masuk tunggal untuk CI.** |

## Deploy VPS

Siapkan `.env` dari `.env.example`, gunakan callback `http://<ip-vps>:3002/auth/callback`, kosongkan `NEXT_PUBLIC_COOKIE_DOMAIN`, dan buka port TCP 3002 di firewall. Jalankan:

```sh
docker compose up --build -d
docker compose ps          # tunggu status `healthy`
curl -fsS http://localhost:3002/api/ready
```

Aplikasi konsumen tersedia pada `http://<ip-vps>:3002/`, dan portal merchant pada `http://<ip-vps>:3002/merchant`.

Jika domain tersedia, profil Caddy dapat diaktifkan dengan `docker compose --profile custom-domain up --build -d`. Arahkan DNS domain utama dan subdomain merchant ke VPS, set `ROOT_DOMAIN`, `ACME_EMAIL`, dan `NEXT_PUBLIC_COOKIE_DOMAIN`, serta buka port 80/443.

### Operasi

- **Health vs readiness.** `/api/health` hanya memastikan proses bisa melayani HTTP (dipakai `HEALTHCHECK`, tidak pernah memicu restart loop). `/api/ready` juga memeriksa konfigurasi *dan* menjawab Supabase, mengembalikan `503` selama outage sehingga load balancer menahan trafik. Probe database dibatasi (2 percobaan, timeout 2 detik, backoff 200 ms) dan memakai `head: true` sehingga tidak menarik baris.
- **Shutdown.** Container berjalan sebagai user `node` (bukan root) dengan `no-new-privileges`, `init: true` (tini sebagai PID 1) dan `stop_grace_period: 30s`. Next.js menangani SIGTERM dan menyelesaikan request yang sedang berjalan sebelum keluar.
- **Log.** Structured JSON satu baris ke stdout/stderr dengan field `level`, `scope`, `time`, dan konteks. Redaksi otomatis untuk password, token, secret, dan kunci. `LOG_LEVEL` mengatur verbosity (default `info`).
- **Restart.** `restart: unless-stopped`. Kegagalan konfigurasi membuat `/api/ready` melaporkan 503 dan detail variabel yang bermasalah **tanpa membocorkan nilainya**.

### CI/CD

`.github/workflows/deploy.yml` menjalankan tiga job:

1. **validate** — `check:migrations` → `lint` → `typecheck` → `test` → `build` → `pnpm audit --audit-level=high` → `docker compose config`.
2. **docker** — build image sungguhan dan smoke test `/api/health` pada container hasil build.
3. **deploy** (hanya pada `main` dan bila repository variable `SAVEBITE_DEPLOY_ENABLED` = `true`) — rsync ke VPS, membangun/menjalankan Compose, menunggu healthcheck Docker berstatus `healthy`, lalu memverifikasi `/api/ready`, security header, dan log error terbaru.

Siapkan repository secrets `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, dan `VPS_KNOWN_HOSTS`. File `.env` tetap tersimpan di VPS dan tidak pernah di-sync.

## Kode pickup merchant desktop

Setelah order siap, konsumen dapat meminta kode 8 digit. Kode mentah hanya dikirim sekali oleh RPC; Supabase menyimpan hash SHA-256 dan expiry. Kode berlaku maksimal 5 menit atau sampai order/jendela pickup berakhir. Penerbitan baru menggantikan kode sebelumnya. Redeem memeriksa pemilik toko, status ready, bukti pembayaran, waktu order dan jendela pickup, lalu menghapus kode dalam transaksi yang sama. Lima kegagalan dalam 15 menit membatasi percobaan berikutnya.

Tabel `private.pickup_manual_codes` dan `private.pickup_manual_code_attempts` tidak dapat dibaca maupun ditulis peran `anon`/`authenticated`; satu-satunya jalan masuk adalah fungsi `security definer` yang akses default-nya dicabut lalu diberi `grant execute` hanya ke `authenticated`. Invarian ini dijaga oleh `pnpm check:migrations`.

Pada project Supabase SaveBite yang sudah menerapkan migrasi 0001–0021, jalankan `0022_manual_pickup_codes.sql` lalu `0023_web_storage_realtime.sql`. Migrasi pertama mempertahankan `redeem_order(text)` sehingga token QR Flutter SB2 sepanjang 52 karakter tetap berfungsi. Migrasi kedua membatasi upload `bag-images` dan `store-logos` ke JPEG/WebP serta mengaktifkan Realtime untuk `surprise_bags`.

## Keamanan

- **Open redirect.** Parameter `next` pada `/login` dan `/auth/callback` tidak pernah dipercaya. `safeNextPath()` (dari `packages/web-shared/src/redirect.ts`) hanya menerima path same-origin: menolak `//host`, `/\host`, URL absolut, `javascript:`, dan karakter kontrol, lalu memvalidasi ulang hasil parse dengan `URL`. Target juga dibatasi ke workspace peran yang dipilih sehingga sesi konsumen tidak bisa diarahkan ke `/merchant`. Backup: 15 test regresi.
- **Security headers.** CSP dengan `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, `form-action 'self'`, serta allowlist `connect-src` dan `frame-src` hanya untuk Supabase dan Midtrans. Ditambah `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (geolokasi tetap diizinkan), dan HSTS hanya saat request benar-benar HTTPS.
  Catatan jujur: `script-src` memuat `'unsafe-inline'`. Semua route kecuali callback dan API handler di-*prerender* saat build, sehingga nonce per-request tidak bisa disisipkan ke HTML; memaksakan nonce berarti merender setiap halaman di server pada setiap request, yang merupakan regresi besar pada target vCPU tunggal. Aplikasi tidak pernah merender HTML pengguna (`dangerouslySetInnerHTML`, `eval`, dan `new Function` tidak ada di mana pun) sehingga permukaan yang dapat dieksploitasi adalah *sumber* script, dan itu dipin ke origin sendiri plus Midtrans.
- **Unggahan berkas.** Ukuran, MIME, dan **magic bytes** divalidasi sebelum diunggah; nama berkas disanitasi sehingga tidak dapat keluar dari prefix pemiliknya, dan objek diberi `cacheControl` satu tahun. Migrasi 0023 juga membatasi bucket dan kebijakan RLS `bag-images` serta `store-logos` ke JPEG/WebP. Avatar tetap mendukung format yang sudah dikonfigurasi.
- **Kebocoran detail database.** `describeError()` memetakan kode PostgREST/SQLSTATE ke kalimat Indonesia yang aman dan mencatat detail aslinya ke log. Kata `NaN` dari `Intl` pada `rupiah()` dan string berisi nama tabel/constraint tidak pernah sampai ke UI.
- **Cookie.** `SameSite=Lax` (wajib; `Strict` akan membuang sesi tepat setelah callback Google), `Secure` dipaksa aktif di produksi, `HttpOnly` mengikuti default `@supabase/ssr`, dan `domain` hanya diisi bila `NEXT_PUBLIC_COOKIE_DOMAIN` disetel.
- **Operasi idempoten.** Checkout, penarikan, dan pencatatan transaksi memakai idempotency key; kode pickup memakai `FOR UPDATE` plus advisory lock sehingga tidak dapat ditebus dua kali.

## API internal

Tidak ada REST API milik aplikasi ini; browser berbicara langsung ke Supabase di bawah RLS. Dua route handler Next.js tersedia untuk operasi:

| Route | Auth | Perilaku |
|---|---|---|
| `GET /api/health` | publik | Liveness. `200` selama proses melayani HTTP. Tidak menyentuh database. |
| `GET /api/ready` | publik | Readiness. `200` hanya bila konfigurasi valid **dan** Supabase menjawab; selain itu `503` dengan nama variabel/komponen yang bermasalah. |
| `GET /auth/callback` | publik | Tukar kode PKCE, lalu redirect ke `next` yang sudah divalidasi. `303` supaya kode sekali pakai tidak dapat diulang. |

## Environment

Wajib: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_AUTH_CALLBACK_URL`.
Opsional: `NEXT_PUBLIC_COOKIE_DOMAIN`, `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`, `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT` (default `sandbox`), `LOG_LEVEL`, `ROOT_DOMAIN`, `ACME_EMAIL`.

Konfigurasi dibaca melalui `packages/web-shared/src/env.ts`, yang memvalidasi format URL, menolak `NEXT_PUBLIC_MIDTRANS_ENVIRONMENT` yang tidak dikenal, dan melempar `ConfigError` yang menyebut nama variabel bila ada yang hilang — bukan diam-diam menghasilkan `RpNaN` atau permintaan ke host yang salah. `/api/ready` memakai jalur non-throwing dari modul yang sama.

Supabase publishable/anon key dan Midtrans client key memang dipakai di browser. Jangan masukkan service-role key, Midtrans server key, atau kredensial rahasia lain ke environment web. Midtrans create/status/cancel tetap berjalan melalui Edge Functions Supabase.

## Batasan yang diketahui

- Migrasi 0001–0021, Edge Functions, dan aplikasi Flutter berada di repositori lain. Repo ini memuat migrasi 0022–0023; `pnpm check:migrations` hanya mengaudit SQL yang ada di repo ini.
- Integrasi Midtrans, Supabase, dan realtime tidak diuji end-to-end di CI karena memerlukan kredensial dan project nyata; CI memverifikasi bentuk kontrak (payload, penanganan error, UI yang gagal dengan rapi), bukan transaksi sungguhan.
- CI belum menjalankan test E2E browser. Rilis ini diperiksa manual di browser Codex untuk katalog konsumen dan pemilihan peran/login merchant; alur Google OAuth, transaksi Midtrans, dan redeem sungguhan belum diuji end-to-end.
- CI menjalankan `pnpm audit --audit-level=high` untuk memastikan dependency produksi tidak memiliki kerentanan berkeparahan tinggi yang diketahui.
