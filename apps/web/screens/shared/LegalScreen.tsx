"use client";

import type { LegalDocument } from "../../lib/routes";
import { Screen, Scroll, SimpleHeader, safeBottom } from "../../ui/common";
import { C, display, ui } from "../../ui/theme";

type LegalSection = { readonly title: string; readonly body: string };

type LegalContent = {
  readonly title: string;
  readonly introduction: string;
  readonly sections: readonly LegalSection[];
};

/** Legal documents opened from the profile and the help centre. */
export function LegalScreen({ document }: { document: LegalDocument }) {
  const content = contentFor(document);
  return (
    <Screen background={C.cream}>
      <SimpleHeader title={content.title} />
      <Scroll style={{ padding: "18px 20px", paddingBottom: safeBottom(28) }}>
        <p style={ui(12.5, { color: C.muted })}>Terakhir diperbarui: 7 Agustus 2026</p>
        <p style={{ ...ui(14, { color: C.body, height: 1.65 }), marginTop: 12, marginBottom: 20 }}>{content.introduction}</p>
        {content.sections.map((section) => (
          <section key={section.title} style={{ marginBottom: 20 }}>
            {/* AppText.display(17, weight: 750): the variable font renders 750. */}
            <h2 style={{ ...display(17, { weight: 700, color: C.ink }), fontWeight: 750 }}>{section.title}</h2>
            <p style={{ ...ui(13.5, { color: C.body, height: 1.65 }), marginTop: 7 }}>{section.body}</p>
          </section>
        ))}
      </Scroll>
    </Screen>
  );
}

function contentFor(document: LegalDocument): LegalContent {
  switch (document) {
    case "terms":
      return {
        title: "Syarat & Ketentuan",
        introduction:
          "Ketentuan ini menjelaskan aturan dasar penggunaan SaveBite sebagai " +
          "platform yang mempertemukan konsumen dan merchant makanan surplus.",
        sections: [
          {
            title: "1. Akun dan kelayakan",
            body:
              "Pengguna bertanggung jawab atas keakuratan data akun, keamanan " +
              "akses, dan seluruh aktivitas yang dilakukan melalui akunnya. Akun " +
              "tidak boleh digunakan untuk penipuan, penyalahgunaan promo, atau " +
              "aktivitas yang melanggar hukum.",
          },
          {
            title: "2. Surprise Bag",
            body:
              "Isi Surprise Bag dapat bervariasi karena bergantung pada makanan " +
              "surplus yang tersedia. Merchant tetap bertanggung jawab atas " +
              "kualitas, keamanan pangan, informasi alergen, serta kesesuaian " +
              "produk pada saat penyerahan.",
          },
          {
            title: "3. Pesanan dan pengambilan",
            body:
              "Konsumen wajib datang pada jendela pengambilan yang tercantum dan " +
              "menunjukkan token QR aktif. Token bersifat pribadi dan tidak boleh " +
              "dibagikan. Pesanan dianggap selesai setelah merchant memindai dan " +
              "mengonfirmasi pengambilan.",
          },
          {
            title: "4. Pembayaran",
            body:
              "Pembayaran diproses melalui Midtrans. SaveBite tidak menyimpan " +
              "credential pembayaran pengguna dan hanya menganggap transaksi " +
              "berhasil setelah statusnya diverifikasi oleh server penyedia. " +
              "Ketersediaan metode dan waktu penyelesaian dapat berbeda menurut " +
              "channel pembayaran yang dipilih.",
          },
          {
            title: "5. Pembatasan dan penghentian",
            body:
              "SaveBite dapat membatasi akses yang terindikasi melanggar aturan " +
              "atau membahayakan pengguna lain, dengan tetap mengikuti hukum yang " +
              "berlaku dan mekanisme keberatan yang tersedia.",
          },
        ],
      };
    case "privacy":
      return {
        title: "Kebijakan Privasi",
        introduction:
          "Kebijakan ini merangkum cara SaveBite memproses data untuk menjalankan " +
          "akun, pesanan, lokasi, notifikasi, dan dukungan pengguna.",
        sections: [
          {
            title: "1. Data yang diproses",
            body:
              "SaveBite dapat memproses identitas akun, email, nomor telepon, foto " +
              "profil, lokasi perangkat saat diizinkan, detail pesanan, ulasan, " +
              "data toko merchant, serta catatan keamanan dan operasional.",
          },
          {
            title: "2. Tujuan pemrosesan",
            body:
              "Data digunakan untuk autentikasi, menampilkan bag terdekat, " +
              "memproses dan memvalidasi pesanan, mencegah penyalahgunaan, " +
              "mengirim notifikasi layanan, menangani dukungan, dan meningkatkan " +
              "keandalan aplikasi.",
          },
          {
            title: "3. Berbagi dan penyimpanan",
            body:
              "Data hanya boleh dibagikan kepada penyedia infrastruktur dan mitra " +
              "yang diperlukan untuk layanan, berdasarkan perjanjian perlindungan " +
              "data. Data disimpan selama diperlukan untuk menyediakan layanan, " +
              "memenuhi kewajiban hukum, dan menyelesaikan sengketa.",
          },
          {
            title: "4. Pilihan pengguna",
            body:
              "Pengguna dapat menolak izin lokasi dan memasukkan area secara " +
              "manual. Pengguna juga dapat memperbarui profil, mengatur notifikasi " +
              "di perangkat, serta meminta penghapusan akun dari menu Profil.",
          },
          {
            title: "5. Keamanan data",
            body:
              "SaveBite menerapkan pembatasan akses dan kontrol keamanan yang " +
              "wajar untuk melindungi data pengguna.",
          },
        ],
      };
    case "refundPolicy":
      return {
        title: "Pembatalan & Pengembalian Dana",
        introduction:
          "Kebijakan ini menjelaskan skenario pembatalan dan pengembalian dana untuk " +
          "pembayaran yang diproses melalui Midtrans.",
        sections: [
          {
            title: "1. Pembatalan oleh merchant",
            body:
              "Jika merchant tidak dapat menyediakan pesanan, status pesanan harus " +
              "diubah melalui proses pembatalan server. Pembayaran yang sudah " +
              "berhasil tidak boleh dibatalkan hanya dari perangkat merchant; " +
              "pengembalian diproses ke metode asal sesuai status dan SLA Midtrans.",
          },
          {
            title: "2. Stok atau transaksi gagal",
            body:
              "Pesanan yang gagal dibuat karena stok berubah tidak boleh dikenai " +
              "biaya. Reservation pembayaran yang gagal atau kedaluwarsa " +
              "dikembalikan tepat satu kali. Kunci idempotensi mencegah pesanan " +
              "ganda ketika pengguna mencoba kembali.",
          },
          {
            title: "3. Tidak datang saat pickup",
            body:
              "Pesanan yang tidak diambil pada jendela pengambilan mengikuti ketentuan " +
              "yang tercantum pada detail pesanan.",
          },
          {
            title: "4. Pengajuan masalah",
            body:
              "Pengguna harus dapat mengirim nomor pesanan, uraian masalah, dan " +
              "bukti pendukung melalui kanal bantuan SaveBite.",
          },
        ],
      };
  }
}
