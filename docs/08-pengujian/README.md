# 8. File Pengujian Perangkat Lunak

SaveBite diuji dengan dua metode:

- **Blackbox testing** menguji fungsi dari sisi pengguna berdasarkan kebutuhan di [SRS](../01-srs), tanpa melihat kode. Hasilnya **61 uji: 58 Valid, 3 Tidak Valid**.
- **Whitebox testing** menguji struktur logika tiga fungsi di `apps/web/lib/models.ts`. Hasilnya **21 test lulus** dengan cakupan cabang 100%.

| Isi | Lokasi |
|---|---|
| Bukti screenshot setiap uji blackbox (no. 1–61) | [`blackbox/`](blackbox) |
| File test whitebox (Vitest), ikut dijalankan oleh `pnpm test` dan CI | [`apps/web/test/whitebox-tugas12.test.ts`](../../apps/web/test/whitebox-tugas12.test.ts) |
| Output Vitest dan laporan coverage | [`whitebox/Hasil Vitest dan coverage.txt`](whitebox/Hasil%20Vitest%20dan%20coverage.txt) |
| Seluruh test otomatis lain di repository | [`apps/web/test`](../../apps/web/test), [`packages/web-shared/test`](../../packages/web-shared/test) |

## Lingkungan pengujian

| Item | Keterangan |
|---|---|
| Tanggal | 14 November 2026 |
| Aplikasi | https://savebite.web.id (versi produksi) |
| Peramban | Zen Browser (berbasis Firefox) di macOS; Google Chrome untuk uji scan QR dua akun sekaligus |
| Pembayaran | Midtrans mode sandbox (simulator QRIS dan kartu uji), bukan uang sungguhan |
| Akun uji | Satu akun Admin (juga dipakai sebagai Pembeli), satu akun Penjual uji, satu akun Pembeli untuk uji penangguhan |
| Data uji | Toko "[UJI] Toko Uji Kelompok 2" dan bag "[UJI] Surprise Bag Roti Uji"; setelah pengujian bag dinonaktifkan dan toko ditolak agar tidak tampil ke Pembeli |
| Catatan uji QR | Scan QR pengambilan memakai kamera yang disimulasikan dengan gambar QR dari layar voucher Pembeli, karena pengujian berjalan di satu komputer |

## Blackbox testing

Test case disusun per use case dengan teknik *equivalence partitioning* (input valid dan tidak valid), *boundary value analysis* (batas stok, harga minimal, panjang teks), dan *use case testing* (alur pengguna dari awal sampai akhir). Kolom Hasil yang Diharapkan merujuk ke kebutuhan pada SRS (FR dan BR). **Valid** berarti hasil sesuai harapan, **Tidak Valid** berarti tidak sesuai.

### Login, akses, dan dashboard (UC-01 s.d. UC-03)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 1 | Membuka alamat /admin tanpa sesi, lalu masuk dengan akun Google Admin | Alamat: savebite.web.id/admin; akun Google: Admin | Sistem meminta login Google, membuat sesi, lalu menampilkan Dashboard Admin (FR-03, FR-05) | Muncul halaman login Admin; setelah memilih akun Google, kembali ke savebite.web.id dan Dashboard Admin tampil | Valid | [ADMIN-LOGIN](blackbox/01%20ADMIN-LOGIN.jpg) |
| 2 | Pembeli menekan Keluar di Profil, lalu mengonfirmasi | Tombol: Keluar > Keluar | Sesi berakhir dan pengguna keluar dari aplikasi (FR-03) | Dialog "Keluar?" muncul; setelah dikonfirmasi pengguna diarahkan ke halaman pilih peran | Valid | [LOGOUT](blackbox/02%20LOGOUT.jpg) |
| 3 | Akun Pembeli biasa membuka halaman khusus Admin | Akun: ilhamclaude0 (bukan Admin); alamat: /admin | Akses ditolak karena hak akses tidak sesuai peran (FR-03, BR-08) | Dialihkan ke Beranda dengan pesan "Halaman ini khusus Admin." | Valid | [ADM-NONADMIN](blackbox/03%20ADM-NONADMIN.jpg) |
| 4 | Akun yang ditangguhkan Admin mencoba masuk | Akun: solikinclaude (status Ditangguhkan) | Akun tidak dapat dipakai dan alasan penangguhan ditampilkan (FR-23) | Halaman "Akun ditangguhkan" menampilkan alasan dari Admin dan tombol "Keluar dari akun" | Valid | [SUSPENDED-LOGIN](blackbox/04%20SUSPENDED-LOGIN.jpg) |
| 5 | Membuka alamat yang tidak ada | Alamat: /halaman-yang-tidak-ada | Sistem menampilkan pesan halaman tidak ditemukan | Tampil "Halaman tidak ditemukan" dengan tombol "Buka SaveBite" | Valid | [NOTFOUND](blackbox/05%20NOTFOUND.jpg) |
| 6 | Admin membuka Dashboard | Menu: Dashboard | Dashboard menampilkan ringkasan pengguna, transaksi, dan pengaduan (FR-05) | Tampil 1 penjual menunggu verifikasi, 0 pengaduan, 6 penjual terverifikasi, 12 pengguna, dan nilai transaksi | Valid | [ADMIN-DASH](blackbox/06%20ADMIN-DASH.jpg) |

_Tabel 12.2 Blackbox testing: Login, akses, dan dashboard (UC-01 s.d. UC-03)_

### Pencarian dan pembelian makanan (UC-04, UC-05)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 7 | Lokasi browser tidak tersedia, Pembeli memilih area secara manual | Pilih area manual > Margonda, Depok | Pembeli tetap dapat mencari makanan berdasarkan lokasi yang dipilih (FR-06) | Area tersimpan dan Beranda menampilkan lokasi "Margonda, Depok" | Valid | [AREA-MANUAL](blackbox/07%20AREA-MANUAL.jpg) |
| 8 | Pembeli membuka Beranda setelah toko uji disetujui | Area: Margonda, Depok | Beranda menampilkan makanan terdekat beserta harga normal, harga diskon, dan sisa stok (FR-05, FR-07) | Bag [UJI] tampil di "Segera tutup": Rp12.000 (coret Rp30.000), sisa 3, jarak 0,6 km | Valid | [APPROVED-VISIBLE](blackbox/08%20APPROVED-VISIBLE.jpg) |
| 9 | Mencari makanan dengan kata kunci yang ada | Kata kunci: UJI | Sistem menampilkan makanan yang cocok dengan kata kunci (FR-06) | Tampil "1 hasil untuk UJI": [UJI] Surprise Bag Roti Uji (diuji dari akun pemilik toko dalam mode Pembeli) | Valid | [SEARCH-UJI](blackbox/09%20SEARCH-UJI.jpg) |
| 10 | Mencari makanan dengan kata kunci yang tidak ada | Kata kunci: pizzaxyz | Sistem memberi tahu bahwa hasil tidak ditemukan (FR-06) | Tampil "Tak ada hasil - Tak ada toko atau bag yang cocok dengan pizzaxyz" | Valid | [SEARCH-NONE](blackbox/10%20SEARCH-NONE.jpg) |
| 11 | Memfilter Beranda dengan kategori yang tidak punya bag | Kategori: Kafe | Sistem hanya menampilkan bag yang sesuai filter dan menyediakan cara mengatur ulang filter | Tampil "Tak ada bag yang cocok" dan tombol "Atur ulang filter"; setelah direset bag Bakery tampil lagi | Valid | [FILTER-CAT](blackbox/11%20FILTER-CAT.jpg) |
| 12 | Membuka tab Peta lalu mengetuk penanda harga | Penanda: Rp12rb | Peta menampilkan lokasi makanan dan detail singkat bag (FR-06) | Peta OpenStreetMap dengan penanda harga tampil; kartu bag [UJI] muncul di bawah peta | Valid | [MAP](blackbox/12%20MAP.jpg) |

_Tabel 12.3 Blackbox testing: Pencarian dan pembelian makanan (UC-04, UC-05)_

### Pemesanan dan pembayaran (UC-06 s.d. UC-09)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 13 | Menambah jumlah bag melebihi stok di Checkout | Stok 3; tombol + ditekan 3 kali | Pesanan hanya dapat dibuat selama stok tersedia; total dihitung otomatis (FR-08, FR-09, BR-04) | Jumlah berhenti di 3 dan tombol + nonaktif; total Rp36.000 + biaya layanan Rp1.000 = Rp37.000 | Valid | [CHECKOUT-QTY](blackbox/13%20CHECKOUT-QTY.jpg) |
| 14 | Membuat pesanan 1 bag lalu menekan Lanjutkan | Jumlah: 1; total Rp13.000 | Pesanan tersimpan dan metode pembayaran Midtrans ditampilkan (FR-09, FR-10) | Diarahkan ke halaman Midtrans (sandbox) Rp13.000 dengan pilihan GoPay QRIS, Virtual Account, kartu, ShopeePay QRIS | Valid | [CHECKOUT-REDIRECT](blackbox/14%20CHECKOUT-REDIRECT.jpg) |
| 15 | Memilih QRIS lalu mengunduhnya | Metode: GoPay QRIS; tombol Download QRIS | Kode QRIS pesanan tampil dan dapat diunduh (FR-11) | Kode QRIS tampil di halaman Midtrans dan file SB-...-qris.png berhasil terunduh | Valid | [QRIS-DOWNLOAD](blackbox/15%20QRIS-DOWNLOAD.jpg) |
| 16 | Menutup halaman pembayaran sebelum membayar | Tombol tutup (x) di halaman Midtrans | Status pembayaran tetap terlihat sebagai menunggu dan pembayaran bisa dilanjutkan (FR-12) | Kembali ke Pesanan; status "Menunggu bayar" dengan tombol "Lanjutkan pembayaran" | Valid | [PAY-RESUME](blackbox/16%20PAY-RESUME.jpg) |
| 17 | Membayar QRIS lewat simulator Midtrans sandbox | Simulator QRIS: Pay (status PAID) | Status pembayaran berubah berhasil dan pesanan diproses (FR-12, FR-17) | Status pesanan "Diproses": "Pembayaran sudah diterima. QR tersedia setelah pesanan siap." | Valid | [PAY-SUCCESS](blackbox/17%20PAY-SUCCESS.jpg) |
| 18 | Membayar dengan kartu yang ditolak bank, lalu menutup halaman pembayaran | Kartu uji sandbox 4911 1111 1111 1113 | Sistem menampilkan status pembayaran gagal dan Pembeli kembali ke SaveBite (FR-12, NFR pesan kesalahan jelas) | Midtrans menampilkan "Payment declined by bank", tetapi setelah ditutup browser diarahkan ke example.com, bukan ke SaveBite | **Tidak Valid** | [PAY-DENY](blackbox/18%20PAY-DENY.jpg) |
| 19 | Membiarkan pesanan tidak dibayar sampai batas waktu | Pesanan SB-5114467674884DDD, batas 15 menit | Pesanan otomatis Kedaluwarsa dan stok dikembalikan (BR-05) | Pukul 14.40 status menjadi "Kedaluwarsa", reservasi dilepas, dan stok kembali dari 1 menjadi 2 | Valid | [PAY-EXPIRED](blackbox/19%20PAY-EXPIRED.jpg) |
| 20 | Pemilik toko memesan bag dari tokonya sendiri | Akun ilhamclaude0 (pemilik toko [UJI]) dalam mode Pembeli | Pesanan ditolak dengan pesan kesalahan yang jelas (BR-08, NFR pesan kesalahan jelas) | Pesanan memang tidak dibuat, tetapi pesannya umum: "Pembayaran belum dapat diproses. Coba lagi." tanpa menyebut alasan | **Tidak Valid** | [BUY-OWN](blackbox/20%20BUY-OWN.jpg) |

_Tabel 12.4 Blackbox testing: Pemesanan dan pembayaran (UC-06 s.d. UC-09)_

### Persiapan toko dan pengelolaan menu (UC-11 s.d. UC-13)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 21 | Mengirim form Siapkan Toko tanpa isi | Nama toko: (kosong); Alamat: (kosong) | Sistem memvalidasi data toko dan menolak data kosong (FR-14) | Pesan "Nama toko wajib diisi", "Alamat wajib diisi", dan "Periksa kembali data toko." | Valid | [STORE-EMPTY](blackbox/21%20STORE-EMPTY.jpg) |
| 22 | Mengisi nama dan alamat toko terlalu pendek | Nama toko: AB; Alamat: Condet | Sistem menolak data yang tidak lengkap (FR-14) | Pesan "Minimal 3 karakter" dan "Masukkan alamat lebih lengkap" | Valid | [STORE-SHORT](blackbox/22%20STORE-SHORT.jpg) |
| 23 | Menyimpan toko tanpa memilih titik di peta | Nama dan alamat valid; pin peta belum dipilih | Sistem meminta lokasi toko dilengkapi (FR-14) | Pesan "Sinkronkan alamat dengan pin peta sebelum melanjutkan." | Valid | [STORE-NOPIN](blackbox/23%20STORE-NOPIN.jpg) |
| 24 | Menyimpan data toko yang lengkap | Nama: [UJI] Toko Uji Kelompok 2; alamat lengkap; pin peta; jam 08.00-21.00 | Data toko tersimpan dan toko menunggu verifikasi Admin (FR-14, BR-01) | Toko tersimpan; Dashboard Penjual menampilkan "Menunggu verifikasi Admin" | Valid | [STORE-OK](blackbox/24%20STORE-OK.jpg) |
| 25 | Mengirim form Buat Surprise Bag tanpa isi | Semua kolom kosong | Sistem memvalidasi data menu (FR-15) | Pesan "Judul bag wajib diisi", "Deskripsi wajib diisi", harga "Wajib diisi", dan "Periksa kembali data bag." | Valid | [BAG-EMPTY](blackbox/25%20BAG-EMPTY.jpg) |
| 26 | Mengisi judul/deskripsi terlalu pendek dan harga jual di atas harga asli | Judul: Ro; Deskripsi: Roti; Harga asli Rp20.000; Harga jual Rp25.000 | Harga diskon harus lebih rendah dari harga normal dan data harus lengkap (FR-16, BR-03) | Pesan "Minimal 3 karakter", "Minimal 10 karakter", "Harus di atas harga jual", dan "Harus lebih rendah" | Valid | [BAG-INVALID](blackbox/26%20BAG-INVALID.jpg) |
| 27 | Mengisi harga jual di bawah batas minimal | Harga asli Rp20.000; Harga jual Rp500 | Harga ditolak bila tidak sesuai ketentuan platform (BR-03) | Pesan "Minimal Rp1.000" pada harga jual | Valid | [BAG-MINPRICE](blackbox/27%20BAG-MINPRICE.jpg) |
| 28 | Mengisi jam selesai pengambilan sebelum jam mulai | Mulai 14.00; selesai 13.00 | Periode ketersediaan harus valid (FR-16) | Pesan "Harus setelah mulai" pada jam selesai | Valid | [BAG-WINDOW](blackbox/28%20BAG-WINDOW.jpg) |
| 29 | Mempublikasikan bag tanpa foto | Semua data valid; foto kosong | Sistem menolak menu yang belum lengkap (FR-15) | Pesan "Tambahkan foto bag sebelum dipublikasikan." | Valid | [BAG-NOPHOTO](blackbox/29%20BAG-NOPHOTO.jpg) |
| 30 | Mempublikasikan bag dengan data lengkap | Foto, judul [UJI] Surprise Bag Roti Uji, harga Rp30.000 > Rp12.000, 3 bag, hari ini 14.00-21.00 | Menu tersimpan dan aktif (FR-15, FR-16) | Pesan "Bag dipublikasikan"; bag tampil di Bag aktif dengan "3 tersisa" | Valid | [BAG-OK](blackbox/30%20BAG-OK.jpg) |
| 31 | Menonaktifkan bag dari Kelola Bag | Sakelar bag [UJI] > Nonaktifkan | Penjual dapat menonaktifkan menu (FR-15) | Dialog "Nonaktifkan bag? Bag tidak akan tampil ke pembeli."; setelah dikonfirmasi muncul "Bag dinonaktifkan" | Valid | [BAG-DEACTIVATE](blackbox/31%20BAG-DEACTIVATE.jpg) |

_Tabel 12.5 Blackbox testing: Persiapan toko dan pengelolaan menu (UC-11 s.d. UC-13)_

### Status pesanan dan pengambilan (UC-14)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 32 | Penjual membuka Dashboard setelah Pembeli membayar | Akun Penjual [UJI] | Pesanan baru tampil di halaman Penjual (FR-05, FR-17) | Pesanan aktif "Ilham Nadhif - 1 bag" berstatus "Baru"; banner verifikasi sudah hilang | Valid | [MERCHANT-INCOMING](blackbox/32%20MERCHANT-INCOMING.jpg) |
| 33 | Penjual membuka detail pesanan | Pesanan SB-638A7754E7634240 | Rincian pesanan dan pembayaran ditampilkan (FR-17) | Tampil item, jadwal 14.00-21.00, subtotal Rp12.000, biaya layanan Rp1.000, komisi -Rp1.200, masuk saldo Rp10.800 | Valid | [ORDER-DETAIL](blackbox/33%20ORDER-DETAIL.jpg) |
| 34 | Penjual menandai pesanan siap diambil | Tombol: Tandai siap diambil | Status pesanan berubah menjadi Siap Diambil (FR-17) | Pesan "Pesanan ditandai siap diambil."; status "Siap" dan tombol "Scan QR untuk redeem" | Valid | [ORDER-READY](blackbox/34%20ORDER-READY.jpg) |
| 35 | Pembeli membuka voucher pesanan yang siap | Pesanan SB-638A7754E7634240 | Kode QR pengambilan yang valid ditampilkan (BR-06) | "Pesanan siap diambil!" dengan QR yang diperbarui otomatis tiap 60 detik dan batas "Hari ini pukul 21.00" | Valid | [VOUCHER-QR](blackbox/35%20VOUCHER-QR.jpg) |
| 36 | Penjual memindai QR voucher Pembeli | Scan QR (kamera disimulasikan dengan gambar QR dari layar Pembeli) | Pesanan selesai dengan QR yang valid pada waktu pengambilan (BR-06) | "Pickup berhasil dikonfirmasi" dan "Pesanan berhasil di-redeem" | Valid | [REDEEM-OK](blackbox/36%20REDEEM-OK.jpg) |
| 37 | Penjual memindai ulang QR yang sudah dipakai | QR yang sama setelah redeem | QR yang sudah dipakai ditolak (BR-06) | Pesan "Voucher tidak ditemukan, sudah dipakai, atau bukan milik toko ini." | Valid | [REDEEM-REUSE](blackbox/37%20REDEEM-REUSE.jpg) |
| 38 | Pembeli membuka Riwayat pesanan | Tab: Pesanan > Riwayat | Riwayat transaksi tampil sesuai status (FR-17, FR-18) | Pesanan [UJI] "Selesai" dengan "Beri rating" dan "Ajukan pengaduan"; pesanan lama "Kedaluwarsa" | Valid | [HISTORY](blackbox/38%20HISTORY.jpg) |

_Tabel 12.6 Blackbox testing: Status pesanan dan pengambilan (UC-14)_

### Saldo Penjual (UC-15)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 39 | Penjual membuka Saldo sebelum pesanan diambil | Menu: Saldo | Saldo hasil penjualan ditampilkan (FR-19) | Saldo Rp0 karena belum ada pesanan selesai; tombol bertuliskan "Payout belum diaktifkan" (penarikan dana tidak termasuk FR) | Valid | [PAYOUT-OFF](blackbox/39%20PAYOUT-OFF.jpg) |
| 40 | Penjual membuka Saldo setelah pesanan di-redeem | Menu: Saldo | Pendapatan dicatat sebagai saldo setelah dipotong komisi (FR-19, BR-07) | Saldo Rp10.800 (Rp12.000 - komisi Rp1.200) dan riwayat "+Rp10.800" | Valid | [SALDO-AFTER](blackbox/40%20SALDO-AFTER.jpg) |

_Tabel 12.7 Blackbox testing: Saldo Penjual (UC-15)_

### Pengaduan, ulasan, dan notifikasi Pembeli (UC-10)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 41 | Membuka form pengaduan tanpa memilih kategori | Kategori: (belum dipilih) | Sistem memvalidasi kelengkapan data pengaduan (FR-20) | Tombol "Kirim pengaduan" nonaktif sampai kategori dipilih | Valid | [COMPLAINT-NOCAT](blackbox/41%20COMPLAINT-NOCAT.jpg) |
| 42 | Mengirim pengaduan dengan deskripsi terlalu pendek | Kategori: Jumlah tidak sesuai; Deskripsi: kurang | Sistem menolak data pengaduan yang tidak lengkap (FR-20) | Pesan "Tulis minimal 10 karakter." | Valid | [COMPLAINT-SHORT](blackbox/42%20COMPLAINT-SHORT.jpg) |
| 43 | Mengirim pengaduan yang lengkap | Kategori: Jumlah tidak sesuai; Deskripsi: [UJI] Isi bag kurang satu roti... | Pengaduan terkirim ke Admin (FR-20) | Pesan "Pengaduan terkirim. Admin akan menindaklanjuti."; kartu pesanan "Pengaduan: Menunggu" dan tautan pengaduan hilang | Valid | [COMPLAINT-OK](blackbox/43%20COMPLAINT-OK.jpg) |
| 44 | Membuka Beri ulasan tanpa memilih bintang | Rating: (kosong) | Ulasan tidak dapat dikirim tanpa rating | Tombol "Kirim ulasan" nonaktif | Valid | [RATING-NONE](blackbox/44%20RATING-NONE.jpg) |
| 45 | Mengirim ulasan | Rating 4 bintang; label: Masih fresh | Ulasan tersimpan | Pesan "Terima kasih, ulasanmu terkirim"; riwayat menampilkan "Sudah diulas" | Valid | [RATING-OK](blackbox/45%20RATING-OK.jpg) |
| 46 | Pembeli melihat status pengaduan setelah ditangani Admin | Tab: Pesanan > Riwayat | Pembeli dapat melihat hasil tindak lanjut pengaduan (FR-21) | Kartu pesanan menampilkan "Pengaduan: Selesai - [UJI] Penjual mengganti 1 roti yang kurang." | Valid | [COMPLAINT-BUYER-STATUS](blackbox/46%20COMPLAINT-BUYER-STATUS.jpg) |
| 47 | Pembeli membuka Notifikasi | Menu: Notifikasi | Notifikasi status pesanan dan pengaduan tampil dan dikelompokkan sesuai tanggal | Notifikasi pembayaran, pesanan siap, pesanan selesai, dan pengaduan tampil, tetapi notifikasi lama (7 Nov, 4 Nov, 6 Okt) ikut dikelompokkan di "HARI INI" | **Tidak Valid** | [NOTIF](blackbox/47%20NOTIF.jpg) |

_Tabel 12.8 Blackbox testing: Pengaduan, ulasan, dan notifikasi Pembeli (UC-10)_

### Administrasi platform (UC-16 s.d. UC-19)

| No | Skenario Pengujian | Test Case | Hasil yang Diharapkan | Hasil Pengujian | Kesimpulan | Bukti |
|---:|---|---|---|---|---|---|
| 48 | Pembeli lain mencari bag dari toko yang belum diverifikasi | Akun Pembeli lain; kata kunci: UJI | Toko yang belum diverifikasi belum boleh menawarkan menu ke Pembeli (BR-01) | Tampil "Tak ada hasil"; bag toko pending tidak muncul | Valid | [PENDING-HIDDEN](blackbox/48%20PENDING-HIDDEN.jpg) |
| 49 | Admin menolak toko dengan alasan terlalu pendek | Alasan: ok | Admin harus mengisi alasan penolakan yang jelas (FR-22) | Dialog tetap terbuka dengan pesan "Tuliskan minimal 5 karakter." | Valid | [REJECT-SHORT](blackbox/49%20REJECT-SHORT.jpg) |
| 50 | Admin menolak toko dengan alasan lengkap | Alasan: Uji penolakan: alamat toko perlu dilengkapi | Status verifikasi menjadi ditolak (FR-22) | Pesan "[UJI] Toko Uji Kelompok 2 ditolak"; status "Ditolak" beserta alasannya | Valid | [REJECT-OK](blackbox/50%20REJECT-OK.jpg) |
| 51 | Admin menyetujui toko | Tombol: Setujui | Status verifikasi menjadi terverifikasi (FR-22) | Pesan "[UJI] Toko Uji Kelompok 2 disetujui"; status "Terverifikasi" | Valid | [APPROVE](blackbox/51%20APPROVE.jpg) |
| 52 | Admin mencari pengguna | Kata kunci: solikin | Admin dapat melihat daftar pengguna (FR-23) | Daftar hanya menampilkan "solikin claude" | Valid | [USER-SEARCH](blackbox/52%20USER-SEARCH.jpg) |
| 53 | Admin menangguhkan akun pengguna | Akun: solikin claude; alasan: Uji penangguhan akun untuk Tugas 12 | Status akun berubah ditangguhkan (FR-23) | Status "Ditangguhkan" beserta alasan dan tombol "Aktifkan". Catatan: daftar dimuat ulang tanpa filter walau kotak cari masih berisi "solikin" | Valid | [USER-SUSPEND](blackbox/53%20USER-SUSPEND.jpg) |
| 54 | Admin melihat akunnya sendiri di Kelola Pengguna | Akun: m.ilhamnadhif121 (Admin) | Admin tidak dapat menangguhkan akun Admin (BR-08) | Peran tertulis "Admin" dan kolom Tindakan "-" (tidak ada tombol Tangguhkan) | Valid | [ADMIN-SELF](blackbox/54%20ADMIN-SELF.jpg) |
| 55 | Admin mengaktifkan kembali akun | Akun: solikin claude; tombol Aktifkan | Status akun kembali aktif (FR-23) | Dialog "Pengguna dapat masuk dan bertransaksi lagi."; status kembali "Aktif" | Valid | [USER-ACTIVATE](blackbox/55%20USER-ACTIVATE.jpg) |
| 56 | Admin membuka daftar pengaduan | Menu: Pengaduan | Admin dapat melihat daftar pengaduan (FR-21) | Pengaduan [UJI] tampil lengkap: nomor pesanan, kategori, isi, pembeli, toko, tanggal, status "Menunggu" | Valid | [ADMIN-COMPLAINT-LIST](blackbox/56%20ADMIN-COMPLAINT-LIST.jpg) |
| 57 | Admin menandai pengaduan sedang ditinjau | Tombol: Tandai ditinjau | Status pengaduan diperbarui (FR-21) | Pesan "Pengaduan ... diperbarui"; status "Ditinjau"; Pembeli menerima notifikasi | Valid | [ADMIN-COMPLAINT-REVIEW](blackbox/57%20ADMIN-COMPLAINT-REVIEW.jpg) |
| 58 | Admin menyelesaikan pengaduan dengan tindak lanjut | Catatan: [UJI] Penjual mengganti 1 roti yang kurang. | Admin mengisi tindak lanjut dan menutup pengaduan (FR-21) | Status "Selesai" dan catatan tampil sebagai "Tindak lanjut Admin" | Valid | [ADMIN-COMPLAINT-RESOLVE](blackbox/58%20ADMIN-COMPLAINT-RESOLVE.jpg) |
| 59 | Admin membuka laporan 30 hari | Periode: 16/10/2026 - 14/11/2026 | Laporan dan statistik transaksi sesuai periode (FR-24) | 5 transaksi, Rp210.000, bagian penjual Rp184.500, pendapatan platform Rp25.500; sama persis dengan hasil query database | Valid | [REPORT-30](blackbox/59%20REPORT-30.jpg) |
| 60 | Admin memilih periode 7 hari | Periode: 08/11/2026 - 14/11/2026 | Laporan berubah sesuai periode (FR-24) | Semua angka Rp0 dan "Belum ada transaksi pada periode ini" | Valid | [REPORT-7](blackbox/60%20REPORT-7.jpg) |
| 61 | Admin membuka laporan setelah pesanan uji dibayar | Periode: 30 hari | Transaksi baru ikut terhitung (FR-24) | Transaksi bertambah menjadi 6 (Rp223.000) dan [UJI] Toko Uji Kelompok 2 masuk Penjual teratas | Valid | [REPORT-UPDATE](blackbox/61%20REPORT-UPDATE.jpg) |

_Tabel 12.9 Blackbox testing: Administrasi platform (UC-16 s.d. UC-19)_

### Rekapitulasi

| Kelompok | Jumlah uji | Valid | Tidak Valid |
|---|---:|---:|---:|
| Login, akses, dan dashboard (UC-01 s.d. UC-03) | 6 | 6 | 0 |
| Pencarian dan pembelian makanan (UC-04, UC-05) | 6 | 6 | 0 |
| Pemesanan dan pembayaran (UC-06 s.d. UC-09) | 8 | 6 | 2 |
| Persiapan toko dan pengelolaan menu (UC-11 s.d. UC-13) | 11 | 11 | 0 |
| Status pesanan dan pengambilan (UC-14) | 7 | 7 | 0 |
| Saldo Penjual (UC-15) | 2 | 2 | 0 |
| Pengaduan, ulasan, dan notifikasi Pembeli (UC-10) | 7 | 6 | 1 |
| Administrasi platform (UC-16 s.d. UC-19) | 14 | 14 | 0 |
| **Total** | **61** | **58** | **3** |

### Temuan

Tiga uji berkesimpulan Tidak Valid:

- **Uji no. 18 – pembayaran ditolak.** Setelah kartu ditolak dan halaman Midtrans ditutup, Pembeli diarahkan ke example.com, bukan kembali ke SaveBite. Penyebabnya, saat membuat transaksi aplikasi hanya mengirim alamat kembali untuk pembayaran selesai (`callbacks.finish`), sedangkan alamat untuk pembayaran gagal atau belum selesai masih memakai pengaturan bawaan di dashboard Midtrans. Perbaikan: isi Error dan Unfinish Redirect URL di dashboard Midtrans dengan alamat SaveBite.
- **Uji no. 20 – membeli bag dari toko sendiri.** Pesanan memang ditolak sesuai aturan, tetapi pesan yang muncul hanya "Pembayaran belum dapat diproses. Coba lagi." sehingga pengguna tidak tahu alasannya. Perbaikan: tampilkan pesan yang menjelaskan bahwa penjual tidak dapat membeli bag dari tokonya sendiri, atau sembunyikan tombol Pesan untuk bag milik sendiri.
- **Uji no. 47 – pengelompokan notifikasi.** Semua notifikasi, termasuk dari 7 November dan 6 Oktober, ditampilkan di bawah judul "HARI INI". Penyebabnya, judul kelompok diambil dari kolom `group_label` yang selalu berisi "Hari ini" saat notifikasi dibuat. Perbaikan: hitung judul kelompok dari tanggal notifikasi.

Catatan lain yang tidak mengubah kesimpulan Valid:

- Uji no. 53: setelah Admin menangguhkan pengguna, daftar dimuat ulang tanpa filter walaupun kotak pencarian masih berisi kata kunci.
- Uji no. 9: pemilik toko yang belum diverifikasi masih dapat melihat bag tokonya sendiri di pencarian mode Pembeli. Pembeli lain tidak dapat melihatnya (uji no. 48).

## Whitebox testing

Tiga fungsi nyata dari `apps/web/lib/models.ts` dipilih karena memiliki percabangan dan perulangan serta berkaitan dengan fitur yang diuji blackbox. Untuk setiap fungsi dibuat flow graph, lalu dihitung kompleksitas siklomatik V(G) = E − N + 2. Test case disusun agar setiap cabang (true dan false) dieksekusi minimal sekali, termasuk *loop testing* (0, 1, dan banyak iterasi) serta nilai batas. Flow graph dan jalur independen lengkap ada di BAB Tugas 12 [Laporan Akhir](../lampiran).

### WB-1 `formatRupiah(value)`, V(G) = 5

| ID | Input | Hasil yang diharapkan | Hasil (Vitest) | Status |
|---|---|---|---|---|
| WB-1.1 | `NaN` | `"Rp0"` | `"Rp0"` | Lulus |
| WB-1.2 | `5` | `"Rp5"` | `"Rp5"` | Lulus |
| WB-1.3 | `500` | `"Rp500"` | `"Rp500"` | Lulus |
| WB-1.4 | `1000` | `"Rp1.000"` | `"Rp1.000"` | Lulus |
| WB-1.5 | `1250000` | `"Rp1.250.000"` | `"Rp1.250.000"` | Lulus |
| WB-1.6 | `-15000` | `"-Rp15.000"` | `"-Rp15.000"` | Lulus |
| WB-1.7 | `15999.9` | `"Rp15.999"` | `"Rp15.999"` | Lulus |

### WB-2 `bagContentsValidationError(values)` (memanggil `normalizeBagContents`), V(G) = 5

| ID | Input | Hasil yang diharapkan | Hasil (Vitest) | Status |
|---|---|---|---|---|
| WB-2.1 | `[]` (kosong, loop 0 kali) | `null` | `null` | Lulus |
| WB-2.2 | `["Roti tawar"]` (loop 1 kali) | `null` | `null` | Lulus |
| WB-2.3 | `["", "   ", "Donat"]` | `null` | `null` | Lulus |
| WB-2.4 | 20 item + `"ITEM 1"` (duplikat) | `null` | `null` | Lulus |
| WB-2.5 | 20 item (batas atas) | `null` | `null` | Lulus |
| WB-2.6 | 21 item | `"Maksimal 20 item"` | `"Maksimal 20 item"` | Lulus |
| WB-2.7 | 1 item 80 karakter (batas atas) | `null` | `null` | Lulus |
| WB-2.8 | `"Roti"` + item 81 karakter | `"Setiap item maksimal 80 karakter"` | `"Setiap item maksimal 80 karakter"` | Lulus |

### WB-3 `canComplain(order, complaint)`, V(G) = 3

| ID | Input | Hasil yang diharapkan | Hasil (Vitest) | Status |
|---|---|---|---|---|
| WB-3.1 | id pesanan `""` | `false` | `false` | Lulus |
| WB-3.2 | pesanan yang sudah punya pengaduan | `false` | `false` | Lulus |
| WB-3.3 | `paymentState` `paid` | `true` | `true` | Lulus |
| WB-3.4 | `paymentState` `refunded` | `true` | `true` | Lulus |
| WB-3.5 | `paymentState` `disputed` | `true` | `true` | Lulus |
| WB-3.6 | `paymentState` `pending` | `false` | `false` | Lulus |

### Hasil

| Fungsi | V(G) | Test case | Cabang tercakup | Statement tercakup |
|---|---:|---|---|---|
| `formatRupiah` | 5 | 7 lulus | 8/8 (100%) | 10/10 (100%) |
| `normalizeBagContents` + `bagContentsValidationError` | 5 | 8 lulus | 4/4 + 4/4 (100%) | 9/9 + 7/7 (100%) |
| `canComplain` | 3 | 6 lulus | 7/7 (100%) | 3/3 (100%) |

Menjalankan ulang dari root repository:

```sh
pnpm install
pnpm --filter @savebite/web exec vitest run test/whitebox-tugas12.test.ts
```

Angka coverage di atas diukur dengan provider V8. Paket itu tidak termasuk dependency repository, jadi pasang dulu sementara (`pnpm --filter @savebite/web add -D @vitest/coverage-v8@4.1.11`), lalu tambahkan `--coverage --coverage.include=lib/models.ts` ke perintah di atas.

## Kesimpulan

Blackbox testing menjalankan 61 uji pada seluruh kelompok use case, dengan hasil 58 Valid dan 3 Tidak Valid. Fungsi utama SaveBite berjalan sesuai SRS, mulai dari login sesuai peran, pencarian, pemesanan, pembayaran Midtrans, pengambilan dengan QR, saldo penjual, dan pengaduan, sampai administrasi platform. Ketiga temuan berkaitan dengan pesan dan pengalihan saat terjadi kegagalan, serta tampilan pengelompokan notifikasi.

Whitebox testing pada tiga fungsi menghasilkan 21 test yang semuanya lulus dengan cakupan cabang 100%. Blackbox menemukan masalah dari sisi pengguna, sedangkan whitebox memastikan seluruh jalur logika fungsi yang diuji sudah dieksekusi.
