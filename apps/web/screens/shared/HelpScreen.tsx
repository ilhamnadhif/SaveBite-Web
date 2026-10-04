"use client";

import { Fragment, useId, useState } from "react";
import { AppCard, Divider, MenuRow, Screen, Scroll, SimpleHeader } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, R, ui } from "../../ui/theme";

type Faq = { readonly question: string; readonly answer: string };

const FAQS: readonly Faq[] = [
  {
    question: "Apa itu Surprise Bag?",
    answer: "Paket kejutan berisi makanan layak yang belum terjual hari itu, dijual diskon 50–70%.",
  },
  {
    question: "Bagaimana cara ambil pesanan?",
    answer: "Datang ke toko pada jam pickup, tunjukkan QR di menu Pesanan, lalu kasir scan.",
  },
  {
    question: "Metode pembayaran apa saja?",
    answer:
      "Semua metode yang aktif di Midtrans: QRIS, transfer bank (virtual account), " +
      "e-wallet, dan lainnya. Setelah checkout, kamu diarahkan ke halaman pembayaran " +
      "Midtrans untuk memilih metode.",
  },
  {
    question: "Bagaimana kalau saya tidak jadi ambil?",
    answer:
      "Buka Kebijakan Pembatalan & Pengembalian Dana di Profil. Pembayaran yang " +
      "belum selesai akan kedaluwarsa otomatis; pesanan yang sudah dibayar " +
      "mengikuti proses pembatalan dan refund yang tercantum di sana.",
  },
  {
    question: "Bisakah satu akun jadi penjual?",
    answer:
      "Bisa. Pilih “Beralih ke mode penjual” dari Profil. Jika belum memiliki " +
      "toko, kamu akan diminta melengkapi data toko terlebih dahulu.",
  },
];

/** Help / FAQ. Full screen with its own header. */
export function HelpScreen() {
  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Bantuan" />
      <Scroll style={{ padding: "12px 16px 24px" }}>
        <h2 style={{ ...ui(12.5, { weight: 700, color: C.body }), padding: "0 0 10px 4px" }}>Pertanyaan umum</h2>
        <div
          style={{
            background: C.white,
            borderRadius: R.cardSm,
            border: `1px solid ${C.border}`,
            overflow: "hidden",
          }}
        >
          {FAQS.map((faq, index) => (
            <Fragment key={faq.question}>
              {index > 0 ? <Divider color={C.divider} /> : null}
              <FaqTile faq={faq} />
            </Fragment>
          ))}
        </div>
        <h2 style={{ ...ui(12.5, { weight: 700, color: C.body }), padding: "0 0 10px 4px", marginTop: 22 }}>Hubungi kami</h2>
        <AppCard padding={0}>
          <MenuRow icon="mail_outline" label="Kirim email ke dukungan" last onTap={openEmail} />
        </AppCard>
      </Scroll>
    </Screen>
  );
}

/**
 * `launchUrl(mailto:…)`. On the web, url_launcher opens the link with
 * `noopener` (Safari on the current window) and always reports success, so
 * only a thrown error can be reported here.
 */
function openEmail() {
  const subject = encodeURIComponent("Bantuan aplikasi SaveBite");
  const body = encodeURIComponent("Halo tim SaveBite,\n\nNomor pesanan (jika ada):\nKendala:\n");
  const url = `mailto:halo@savebite.id?subject=${subject}&body=${body}`;
  try {
    const agent = window.navigator.userAgent;
    const safari = agent.includes("Safari") && !agent.includes("Chrome");
    window.open(url, safari ? "_top" : "_blank", "noopener,noreferrer");
  } catch {
    snack("Tidak dapat membuka email. Kirim ke halo@savebite.id.", "error_outline");
  }
}

/**
 * `ExpansionTile` with the help screen's theme: no splash/highlight, no
 * dividers, green expand icon, 16 px tile padding and 16/0/16/14 children
 * padding. Expands over 200 ms ease-in like Flutter.
 */
function FaqTile({ faq }: { faq: Faq }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const buttonId = `${id}-question`;
  const panelId = `${id}-answer`;
  return (
    <div>
      <button
        type="button"
        id={buttonId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        style={{
          width: "100%",
          minHeight: 56,
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "8px 16px",
          textAlign: "left",
        }}
      >
        <span style={{ ...ui(14.5, { weight: 700, color: C.ink, height: 1.5 }), flex: 1, minWidth: 0 }}>{faq.question}</span>
        <Icon
          name="expand_more_rounded"
          size={24}
          color={C.greenBright}
          style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 200ms ease-in" }}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        aria-hidden={!expanded}
        style={{
          display: "grid",
          gridTemplateRows: expanded ? "1fr" : "0fr",
          visibility: expanded ? "visible" : "hidden",
          transition: "grid-template-rows 200ms ease-in, visibility 200ms",
        }}
      >
        <div style={{ minHeight: 0, overflow: "hidden" }}>
          <p style={{ ...ui(13.5, { color: C.body, height: 1.55 }), padding: "0 16px 14px" }}>{faq.answer}</p>
        </div>
      </div>
    </div>
  );
}
