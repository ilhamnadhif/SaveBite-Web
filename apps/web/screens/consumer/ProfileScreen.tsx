"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import { formatRupiah, savings } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { TextButton } from "../../ui/buttons";
import { AppCard, ColoredHeader, Gap, MenuRow, Screen, Scroll, StatTile } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { DialogSurface, confirmDialog, showDialog, snack } from "../../ui/overlays";
import { C, display, ellipsis, ui } from "../../ui/theme";

/**
 * M3 `ColorScheme.fromSeed(AppColors.green)` roles used by the plain
 * `TextField` in the delete-account dialog (Flutter 3.41, tonal spot).
 */
const M3_ON_SURFACE_VARIANT = "#404944";
const M3_ON_SURFACE = "#171D1A";

/** Consumer profile, account settings, role switching, and privacy controls. Tab 4 of the shell. */
export function ProfileScreen() {
  const state = useAppState();
  const [switchingRole, setSwitchingRole] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const doneOrders = state.orderHistory.filter((order) => order.status === "done");
  const savedBags = doneOrders.reduce((total, order) => total + order.quantity, 0);
  const totalSavings = doneOrders.reduce((total, order) => total + savings(order.bag) * order.quantity, 0);

  const switchToMerchant = async () => {
    if (switchingRole || deletingAccount) return;
    setSwitchingRole(true);
    try {
      await AppNav.switchToMerchant();
    } catch {
      if (!alive.current) return;
      appState.switchToConsumer();
      snack("Mode penjual gagal dibuka. Coba lagi.", "error_outline");
    } finally {
      if (alive.current) setSwitchingRole(false);
    }
  };

  const confirmDelete = async (): Promise<boolean> => {
    const result = await showDialog<boolean>((close) => <DeleteAccountDialog close={close} />, {
      dismissible: false,
      label: "Hapus akun permanen?",
    });
    return result ?? false;
  };

  const deleteAccount = async () => {
    if (deletingAccount || switchingRole) return;
    if (!(await confirmDelete()) || !alive.current) return;
    setDeletingAccount(true);
    try {
      await AppNav.deleteAccount();
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof BackendException) snack(error.message, "error_outline");
      else snack("Akun gagal dihapus. Periksa koneksi lalu coba lagi.", "error_outline");
    } finally {
      if (alive.current) setDeletingAccount(false);
    }
  };

  const logout = async () => {
    if (deletingAccount) return;
    const confirmed = await confirmDialog({
      title: "Keluar?",
      message: "Kamu perlu masuk lagi untuk melanjutkan.",
      confirmLabel: "Keluar",
      destructive: true,
    });
    if (confirmed && alive.current) await AppNav.logout();
  };

  return (
    <Screen background={C.cream}>
      <ColoredHeader background={C.green} bottomPadding={22}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <ProfileAvatar url={state.userAvatarUrl} initials={state.userInitials} />
          <div style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
            <div style={{ ...display(19, { weight: 700, color: C.cream }), ...ellipsis }}>{state.userName}</div>
            <div style={{ ...ui(13, { color: C.greenMuted }), ...ellipsis }}>{state.userEmail}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <StatTile
            value={`${savedBags}`}
            label="Bag diselamatkan"
            background={C.greenDark}
            valueColor={C.amber}
            labelColor={C.greenMuted}
            style={{ flex: 1 }}
          />
          <StatTile
            value={formatRupiah(totalSavings)}
            label="Total hemat"
            background={C.greenDark}
            valueColor={C.amber}
            labelColor={C.greenMuted}
            style={{ flex: 1 }}
          />
        </div>
      </ColoredHeader>
      <Scroll style={{ padding: "18px 20px 24px", background: C.cream }}>
        {state.profileError !== null ? (
          <>
            <ProfileErrorCard message={state.profileError} />
            <Gap h={14} />
          </>
        ) : null}
        <SectionLabel text="Akun" />
        <AppCard padding={0}>
          <MenuRow icon="edit_outlined" label="Edit profil" onTap={() => void AppNav.toEditProfile()} />
          <MenuRow icon="notifications_none" label="Notifikasi" last onTap={() => AppNav.toNotifications()} />
        </AppCard>
        <Gap h={18} />
        <SectionLabel text="Mode aplikasi" />
        <AppCard padding={0}>
          <MenuRow
            icon="storefront_outlined"
            label={switchingRole ? "Membuka mode penjual…" : "Beralih ke mode penjual"}
            last
            onTap={switchingRole ? undefined : () => void switchToMerchant()}
          />
        </AppCard>
        <Gap h={18} />
        <SectionLabel text="Informasi & legal" />
        <AppCard padding={0}>
          <MenuRow icon="help_outline" label="Bantuan" onTap={() => AppNav.toHelp()} />
          <MenuRow icon="description_outlined" label="Syarat & Ketentuan" onTap={() => AppNav.toLegal("terms")} />
          <MenuRow icon="privacy_tip_outlined" label="Kebijakan Privasi" onTap={() => AppNav.toLegal("privacy")} />
          <MenuRow
            icon="currency_exchange_outlined"
            label="Pembatalan & pengembalian dana"
            last
            onTap={() => AppNav.toLegal("refundPolicy")}
          />
        </AppCard>
        <Gap h={18} />
        <SectionLabel text="Privasi akun" />
        <AppCard padding={0}>
          <MenuRow
            icon="delete_outline"
            label={deletingAccount ? "Menghapus akun…" : "Hapus akun permanen"}
            last
            onTap={deletingAccount ? undefined : () => void deleteAccount()}
          />
        </AppCard>
        <Gap h={6} />
        <button
          type="button"
          className="sb-tap"
          onClick={() => void logout()}
          style={{ width: "100%", display: "flex", justifyContent: "center", padding: "20px 0" }}
        >
          <span style={ui(14, { weight: 700, color: C.danger })}>Keluar</span>
        </button>
      </Scroll>
    </Screen>
  );
}

function ProfileErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{ display: "flex", alignItems: "center", padding: "8px 8px 8px 14px", background: C.dangerBg, borderRadius: 13 }}
    >
      <Icon name="error_outline" size={18} color={C.danger} />
      <span style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0, marginLeft: 9 }}>{message}</span>
      <TextButton label="Coba lagi" onTap={() => void appState.loadProfile()} />
    </div>
  );
}

/** `ClipOval(Image.network)` falling back to the initials when it fails. */
function ProfileAvatar({ url, initials }: { url: string | null; initials: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (url && url !== failedUrl) {
    return (
      <img
        src={url}
        alt=""
        width={58}
        height={58}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedUrl(url)}
        style={{ width: 58, height: 58, borderRadius: "50%", objectFit: "cover", flex: "none" }}
      />
    );
  }
  return (
    <div
      aria-hidden
      style={{
        width: 58,
        height: 58,
        borderRadius: "50%",
        background: C.amber,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        ...display(22, { color: C.green }),
      }}
    >
      {initials}
    </div>
  );
}

function SectionLabel({ text }: { text: string }) {
  return <h2 style={{ ...ui(12, { weight: 700, color: C.muted }), padding: "0 0 8px 4px" }}>{text}</h2>;
}

/**
 * The permanent-deletion confirmation: an `AlertDialog` (M3 paddings) whose
 * confirm action unlocks only after typing HAPUS.
 */
function DeleteAccountDialog({ close }: { close: (value?: boolean) => void }) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const inputId = useId();
  const matches = value.trim().toUpperCase() === "HAPUS";

  // `autofocus: true`, after the overlay has focused its panel.
  useEffect(() => {
    const timer = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, []);

  const textStyle = ui(16, { weight: 400, color: C.ink, height: 1.5, letterSpacing: 0.5 });
  const underline = focused
    ? `inset 0 -2px 0 ${C.green}`
    : `inset 0 -1px 0 ${hovered ? M3_ON_SURFACE : M3_ON_SURFACE_VARIANT}`;

  return (
    <DialogSurface title="Hapus akun permanen?" style={{ padding: 24 }}>
      <p style={ui(13.5, { color: C.body, height: 1.5 })}>
        Profil, favorit, dan akses akun akan dihapus. Riwayat transaksi yang wajib disimpan menurut hukum dapat
        dianonimkan. Tindakan ini tidak dapat dibatalkan.
      </p>
      <label htmlFor={inputId} style={{ display: "block", ...ui(12.5, { weight: 700, color: C.body }), marginTop: 16 }}>
        Ketik HAPUS untuk melanjutkan
      </label>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ position: "relative", marginTop: 7, boxShadow: underline }}
      >
        <input
          ref={input}
          id={inputId}
          value={value}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            display: "block",
            width: "100%",
            border: 0,
            outline: "none",
            background: "transparent",
            padding: "4px 0",
            caretColor: C.greenBright,
            ...textStyle,
          }}
        />
        {value === "" ? (
          <span aria-hidden style={{ position: "absolute", left: 0, top: 4, pointerEvents: "none", ...textStyle, color: M3_ON_SURFACE_VARIANT }}>
            HAPUS
          </span>
        ) : null}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 24 }}>
        <TextButton label={<span style={ui(14, { weight: 700, color: C.body })}>Batal</span>} onTap={() => close(false)} />
        <TextButton
          label={<span style={ui(14, { weight: 800, color: C.danger })}>Hapus permanen</span>}
          onTap={matches ? () => close(true) : null}
        />
      </div>
    </DialogSurface>
  );
}

