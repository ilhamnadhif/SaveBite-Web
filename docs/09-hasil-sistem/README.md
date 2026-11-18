# 9. Hasil Sistem

**Aplikasi berjalan di: <https://savebite.web.id>**

SaveBite adalah marketplace makanan surplus berbasis web. Satu aplikasi melayani tiga peran: **Pembeli** mencari dan memesan Surprise Bag di sekitarnya, **Penjual** mengelola toko, bag, pesanan, pengambilan dengan QR, dan saldo, dan **Admin** (`/admin`) memverifikasi penjual, mengelola pengguna, menangani pengaduan, dan melihat laporan transaksi.

Pembayaran memakai Midtrans **mode sandbox** (simulator QRIS dan kartu uji), jadi tidak ada uang sungguhan yang berpindah.

## Kode sumber

Kode program adalah isi repository ini.

| Lokasi | Isi |
|---|---|
| [`apps/web`](../../apps/web) | Aplikasi Next.js: layar (`screens/`), komponen UI (`ui/`), logika dan akses data (`lib/`), API dan callback auth (`app/`) |
| [`apps/web/test`](../../apps/web/test) | Unit dan integration test (Vitest) |
| [`packages/web-shared`](../../packages/web-shared) | Validasi env, logger, sanitasi redirect, klien Supabase |
| [`supabase/migrations`](../../supabase/migrations) | Skema database Postgres, RLS, dan RPC |
| [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml) | CI/CD: lint, typecheck, test, build, Docker, deploy ke VPS |
| [`docker-compose.yml`](../../docker-compose.yml), [`Caddyfile`](../../Caddyfile) | Deploy produksi (Docker + HTTPS) |

Teknologi: Next.js + React + TypeScript, Supabase (Auth Google, Postgres + RLS, Realtime, Storage, Edge Functions), Midtrans Snap, OpenStreetMap, Docker, Caddy, dan GitHub Actions.

Cara menjalankan di komputer sendiri ada di [README utama](../../README.md#menjalankan-lokal). Versi tanpa backend bisa dicoba dengan `NEXT_PUBLIC_SAVEBITE_DEMO=true pnpm dev`.

## Tampilan aplikasi

<table>
<tr><td align="center" valign="top"><a href="screenshot/01%20Umum%20-%20Onboarding.jpg"><img src="screenshot/01%20Umum%20-%20Onboarding.jpg" width="260" alt="Umum - Onboarding"></a><br><sub>Umum - Onboarding</sub></td><td align="center" valign="top"><a href="screenshot/02%20Umum%20-%20Login.jpg"><img src="screenshot/02%20Umum%20-%20Login.jpg" width="260" alt="Umum - Login"></a><br><sub>Umum - Login</sub></td><td align="center" valign="top"><a href="screenshot/03%20Pembeli%20-%20Beranda.jpg"><img src="screenshot/03%20Pembeli%20-%20Beranda.jpg" width="260" alt="Pembeli - Beranda"></a><br><sub>Pembeli - Beranda</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/04%20Pembeli%20-%20Peta.jpg"><img src="screenshot/04%20Pembeli%20-%20Peta.jpg" width="260" alt="Pembeli - Peta"></a><br><sub>Pembeli - Peta</sub></td><td align="center" valign="top"><a href="screenshot/05%20Pembeli%20-%20Detail%20Surprise%20Bag.jpg"><img src="screenshot/05%20Pembeli%20-%20Detail%20Surprise%20Bag.jpg" width="260" alt="Pembeli - Detail Surprise Bag"></a><br><sub>Pembeli - Detail Surprise Bag</sub></td><td align="center" valign="top"><a href="screenshot/06%20Pembeli%20-%20Checkout.jpg"><img src="screenshot/06%20Pembeli%20-%20Checkout.jpg" width="260" alt="Pembeli - Checkout"></a><br><sub>Pembeli - Checkout</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/07%20Pembeli%20-%20Voucher%20QR.jpg"><img src="screenshot/07%20Pembeli%20-%20Voucher%20QR.jpg" width="260" alt="Pembeli - Voucher QR"></a><br><sub>Pembeli - Voucher QR</sub></td><td align="center" valign="top"><a href="screenshot/08%20Pembeli%20-%20Riwayat%20Pesanan.jpg"><img src="screenshot/08%20Pembeli%20-%20Riwayat%20Pesanan.jpg" width="260" alt="Pembeli - Riwayat Pesanan"></a><br><sub>Pembeli - Riwayat Pesanan</sub></td><td align="center" valign="top"><a href="screenshot/09%20Pembeli%20-%20Notifikasi.jpg"><img src="screenshot/09%20Pembeli%20-%20Notifikasi.jpg" width="260" alt="Pembeli - Notifikasi"></a><br><sub>Pembeli - Notifikasi</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/10%20Pembeli%20-%20Profil.jpg"><img src="screenshot/10%20Pembeli%20-%20Profil.jpg" width="260" alt="Pembeli - Profil"></a><br><sub>Pembeli - Profil</sub></td><td align="center" valign="top"><a href="screenshot/11%20Penjual%20-%20Dashboard.jpg"><img src="screenshot/11%20Penjual%20-%20Dashboard.jpg" width="260" alt="Penjual - Dashboard"></a><br><sub>Penjual - Dashboard</sub></td><td align="center" valign="top"><a href="screenshot/12%20Penjual%20-%20Kelola%20Bag.jpg"><img src="screenshot/12%20Penjual%20-%20Kelola%20Bag.jpg" width="260" alt="Penjual - Kelola Bag"></a><br><sub>Penjual - Kelola Bag</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/13%20Penjual%20-%20Buat%20Surprise%20Bag.jpg"><img src="screenshot/13%20Penjual%20-%20Buat%20Surprise%20Bag.jpg" width="260" alt="Penjual - Buat Surprise Bag"></a><br><sub>Penjual - Buat Surprise Bag</sub></td><td align="center" valign="top"><a href="screenshot/14%20Penjual%20-%20Pesanan%20Masuk.jpg"><img src="screenshot/14%20Penjual%20-%20Pesanan%20Masuk.jpg" width="260" alt="Penjual - Pesanan Masuk"></a><br><sub>Penjual - Pesanan Masuk</sub></td><td align="center" valign="top"><a href="screenshot/15%20Penjual%20-%20Scan%20QR%20Berhasil.jpg"><img src="screenshot/15%20Penjual%20-%20Scan%20QR%20Berhasil.jpg" width="260" alt="Penjual - Scan QR Berhasil"></a><br><sub>Penjual - Scan QR Berhasil</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/16%20Penjual%20-%20Saldo.jpg"><img src="screenshot/16%20Penjual%20-%20Saldo.jpg" width="260" alt="Penjual - Saldo"></a><br><sub>Penjual - Saldo</sub></td><td align="center" valign="top"><a href="screenshot/17%20Penjual%20-%20Profil%20Toko.jpg"><img src="screenshot/17%20Penjual%20-%20Profil%20Toko.jpg" width="260" alt="Penjual - Profil Toko"></a><br><sub>Penjual - Profil Toko</sub></td><td align="center" valign="top"><a href="screenshot/18%20Admin%20-%20Dashboard.jpg"><img src="screenshot/18%20Admin%20-%20Dashboard.jpg" width="260" alt="Admin - Dashboard"></a><br><sub>Admin - Dashboard</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/19%20Admin%20-%20Verifikasi%20Penjual.jpg"><img src="screenshot/19%20Admin%20-%20Verifikasi%20Penjual.jpg" width="260" alt="Admin - Verifikasi Penjual"></a><br><sub>Admin - Verifikasi Penjual</sub></td><td align="center" valign="top"><a href="screenshot/20%20Admin%20-%20Kelola%20Pengguna.jpg"><img src="screenshot/20%20Admin%20-%20Kelola%20Pengguna.jpg" width="260" alt="Admin - Kelola Pengguna"></a><br><sub>Admin - Kelola Pengguna</sub></td><td align="center" valign="top"><a href="screenshot/21%20Admin%20-%20Pengaduan.jpg"><img src="screenshot/21%20Admin%20-%20Pengaduan.jpg" width="260" alt="Admin - Pengaduan"></a><br><sub>Admin - Pengaduan</sub></td></tr>
<tr><td align="center" valign="top"><a href="screenshot/22%20Admin%20-%20Laporan%20Transaksi.jpg"><img src="screenshot/22%20Admin%20-%20Laporan%20Transaksi.jpg" width="260" alt="Admin - Laporan Transaksi"></a><br><sub>Admin - Laporan Transaksi</sub></td></tr>
</table>

