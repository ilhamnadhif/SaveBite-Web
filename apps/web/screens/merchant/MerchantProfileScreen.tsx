"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { formatRupiah } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { OutlinedButton, TextButton } from "../../ui/buttons";
import { AppCard, ColoredHeader, Gap, MenuRow, RefreshScroll, Screen, Spinner, StatTile } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { confirmDialog, snack } from "../../ui/overlays";
import { C, display, ellipsis, ui, withAlpha } from "../../ui/theme";
import { useShellScope } from "../ShellFrame";

/** The merchant profile: store operations, account, and switching roles. */
export function MerchantProfileScreen() {
  const state = useAppState();
  const shell = useShellScope();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = () => Promise.all([appState.loadStore(), appState.loadMerchantData()]);

  const logout = async () => {
    const ok = await confirmDialog({
      title: "Keluar?",
      message: "Kamu perlu masuk lagi untuk melanjutkan.",
      confirmLabel: "Keluar",
      destructive: true,
    });
    if (ok && alive.current) await AppNav.logout();
  };

  const deleteAccount = async () => {
    const ok = await confirmDialog({
      title: "Hapus akun permanen?",
      message:
        "Profil, toko, dan akses akun akan dihapus. Riwayat transaksi yang wajib disimpan akan dianonimkan. Tindakan ini tidak dapat dibatalkan.",
      confirmLabel: "Hapus permanen",
      destructive: true,
    });
    if (!ok || !alive.current) return;
    setDeletingAccount(true);
    try {
      await AppNav.deleteAccount();
    } catch (error) {
      if (!alive.current) return;
      const message = error instanceof BackendException ? error.message : "Akun belum dapat dihapus. Coba lagi.";
      snack(message, "error_outline_rounded");
      setDeletingAccount(false);
    }
  };

  const loadError = state.storeError ?? state.merchantError;

  return (
    <Screen>
      <ColoredHeader background={C.brown} bottomPadding={22}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <StoreLogo logoUrl={state.storeLogoUrl} storeName={state.storeName} />
          <Gap w={14} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ ...display(19, { weight: 700, color: C.cream }), ...ellipsis }}>
              {state.storeName === "" ? "Toko Anda" : state.storeName}
            </h1>
            <Gap h={2} />
            <p style={ui(13, { color: C.merchantMuted })}>{`Merchant · ${state.storeCategory}`}</p>
            <Gap h={3} />
            <p style={ui(11.5, { color: C.merchantMuted })}>{`${state.openTime}–${state.closeTime}`}</p>
          </div>
          {state.isLoadingMerchant ? <Spinner size={18} strokeWidth={2} color={C.amber} label="Memuat" /> : null}
        </div>
        <Gap h={18} />
        <div style={{ display: "flex" }}>
          <StatTile
            value={`${state.bagsSoldToday}`}
            label="Bag hari ini"
            background={C.brownCard}
            valueColor={C.white}
            labelColor={C.merchantMuted}
            style={{ flex: 1 }}
          />
          <Gap w={10} />
          <StatTile
            value={formatRupiah(state.incomeThisMonth)}
            label="Bulan ini"
            background={C.brownCard}
            valueColor={C.white}
            labelColor={C.merchantMuted}
            style={{ flex: 1 }}
          />
        </div>
      </ColoredHeader>
      <RefreshScroll onRefresh={reload} color={C.terracotta} style={{ padding: "18px 20px 24px" }}>
        {loadError !== null ? (
          <>
            <ErrorCard message={loadError} onRetry={() => void reload()} />
            <Gap h={14} />
          </>
        ) : null}
        <RoleSwitch onTap={() => AppNav.switchToConsumer()} />
        <Gap h={16} />
        <div style={{ background: C.white, borderRadius: 18, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <MenuRow icon="storefront_outlined" label="Profil & jam toko" onTap={() => AppNav.toEditStore()} />
          <MenuRow icon="account_balance_outlined" label="Rekening & penarikan" onTap={() => shell?.selectTab(3)} />
          <MenuRow icon="notifications_none_rounded" label="Notifikasi" onTap={() => AppNav.toNotifications()} />
          <MenuRow icon="reviews_outlined" label="Ulasan pelanggan" onTap={() => AppNav.toMerchantReviews()} />
          <MenuRow icon="help_outline_rounded" label="Bantuan" last onTap={() => AppNav.toHelp()} />
        </div>
        <Gap h={8} />
        <AccountSummary userName={state.userName} userEmail={state.userEmail} />
        <Gap h={10} />
        <OutlinedButton
          label="Keluar"
          icon="logout_rounded"
          iconSize={19}
          color={C.danger}
          fontWeight={500}
          onTap={() => void logout()}
          style={{ width: "100%", minHeight: 50, borderRadius: 25, border: `1px solid ${C.danger}` }}
        />
        <Gap h={10} />
        <TextButton
          label={
            <span style={ui(13, { weight: 700, color: C.danger })}>{deletingAccount ? "Menghapus akun…" : "Hapus akun"}</span>
          }
          onTap={deletingAccount ? null : () => void deleteAccount()}
          style={{ width: "100%" }}
        />
      </RefreshScroll>
    </Screen>
  );
}

function StoreLogo({ logoUrl, storeName }: { logoUrl: string | null; storeName: string }) {
  if (logoUrl) {
    return (
      <div style={{ width: 58, height: 58, borderRadius: "50%", overflow: "hidden", flex: "none" }}>
        <FoodImage path={logoUrl} width={58} height={58} />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 58,
        height: 58,
        flex: "none",
        borderRadius: "50%",
        background: C.amber,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...display(20, { color: C.brown }),
      }}
    >
      {storeInitials(storeName)}
    </div>
  );
}

function storeInitials(storeName: string): string {
  const parts = storeName
    .trim()
    .split(/\s+/)
    .filter((part) => part !== "");
  if (parts.length === 0) return "T";
  if (parts.length === 1) return parts[0].substring(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function RoleSwitch({ onTap }: { onTap: () => void }) {
  return (
    <button
      type="button"
      className="sb-ink"
      onClick={onTap}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        padding: 15,
        background: C.greenSoftBg,
        borderRadius: 16,
        border: `1px solid ${withAlpha(C.greenBright, 55 / 255)}`,
        textAlign: "left",
      }}
    >
      <span
        style={{
          width: 42,
          height: 42,
          flex: "none",
          borderRadius: "50%",
          background: C.greenBright,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon name="shopping_bag_outlined" color={C.white} />
      </span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", marginLeft: 12 }}>
        <span style={ui(13.5, { weight: 800, color: C.greenAccent })}>Beralih ke mode pembeli</span>
        <span style={{ ...ui(11.5, { color: C.body }), marginTop: 2 }}>Cari dan pesan Surprise Bag di sekitar Anda.</span>
      </span>
      <Icon name="chevron_right_rounded" color={C.greenAccent} />
    </button>
  );
}

function AccountSummary({ userName, userEmail }: { userName: string; userEmail: string }) {
  return (
    <AppCard radius={16}>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Icon name="person_outline_rounded" color={C.muted} />
        <Gap w={10} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={ui(13, { weight: 700, color: C.ink })}>{userName}</p>
          {userEmail !== "" ? <p style={{ ...ui(11.5, { color: C.muted }), ...ellipsis }}>{userEmail}</p> : null}
        </div>
      </div>
    </AppCard>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      style={{ display: "flex", alignItems: "center", padding: 13, background: C.dangerTintBg, borderRadius: 14 }}
    >
      <Icon name="error_outline_rounded" color={C.danger} />
      <Gap w={9} />
      <p style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0 }}>{message}</p>
      <TextButton label="Coba lagi" onTap={onRetry} fontWeight={500} />
    </div>
  );
}
