"use client";

import { AppNav } from "../../lib/appNav";
import { AppLogoWordmark } from "../../ui/brand";
import { safeTop } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { C, display, ui } from "../../ui/theme";

/** A3 Role fork: buyer or seller, then login. */
export function ForkScreen() {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
        background: C.cream,
        paddingTop: safeTop(16),
        paddingRight: 24,
        paddingBottom: "calc(32px + var(--safe-bottom))",
        paddingLeft: 24,
      }}
    >
      <AppLogoWordmark logoSize={30} textSize={19} />
      <h1 style={{ ...display(27, { color: C.ink }), marginTop: 36 }}>Mau mulai dari mana?</h1>
      <p style={{ ...ui(14, { color: C.body, height: 1.5 }), marginTop: 6 }}>
        Pilih peranmu. Tenang, bisa diganti kapan saja lewat Profil.
      </p>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, marginTop: 26 }}>
        <RoleCard
          background={C.greenSoftBg}
          borderColor={C.greenSoftBorder}
          iconBoxColor={C.greenBright}
          icon="shopping_bag_outlined"
          title="Saya mau beli"
          titleColor={C.green}
          desc="Temukan Surprise Bag murah dari toko di sekitarmu."
          descColor={C.body2}
          arrowColor={C.greenBright}
          onTap={() => AppNav.toLogin({ merchant: false })}
        />
        <RoleCard
          background={C.terracottaSoftBg}
          borderColor={C.terracottaSoftBorder}
          iconBoxColor={C.terracotta}
          icon="storefront_outlined"
          title="Saya mau jual"
          titleColor={C.brown}
          desc="Ubah stok berlebih jadi cuan, kurangi makanan terbuang."
          descColor={C.terracottaText}
          arrowColor={C.terracotta}
          onTap={() => AppNav.toLogin({ merchant: true })}
        />
      </div>
      <p style={{ ...ui(13, { color: C.captionWarm }), marginTop: 22, textAlign: "center" }}>
        Satu akun bisa jadi pembeli sekaligus penjual.
      </p>
    </div>
  );
}

function RoleCard({
  background,
  borderColor,
  iconBoxColor,
  icon,
  title,
  titleColor,
  desc,
  descColor,
  arrowColor,
  onTap,
}: {
  background: string;
  borderColor: string;
  iconBoxColor: string;
  icon: IconName;
  title: string;
  titleColor: string;
  desc: string;
  descColor: string;
  arrowColor: string;
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      className="sb-tap"
      onClick={onTap}
      style={{
        position: "relative",
        width: "100%",
        textAlign: "left",
        padding: 22,
        background,
        borderRadius: 22,
        border: `1.5px solid ${borderColor}`,
      }}
    >
      <span
        style={{
          width: 44,
          height: 44,
          borderRadius: 14,
          background: iconBoxColor,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name={icon} size={22} color={C.white} />
      </span>
      <span style={{ display: "block", ...display(20, { color: titleColor }), marginTop: 14 }}>{title}</span>
      <span style={{ display: "block", ...ui(13.5, { color: descColor, height: 1.5 }), marginTop: 5 }}>{desc}</span>
      <span style={{ position: "absolute", top: 24, right: 22 }}>
        <Icon name="arrow_forward" size={20} color={arrowColor} />
      </span>
    </button>
  );
}
