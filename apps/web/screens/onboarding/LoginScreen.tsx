"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { AuthService } from "../../lib/auth";
import { e2eMode } from "../../lib/env";
import { navigator } from "../../lib/navigator";
import type { LegalDocument } from "../../lib/routes";
import { AppLogo } from "../../ui/brand";
import { FilledButton, IconButton } from "../../ui/buttons";
import { AppTextField, ErrorBox, FieldError, Spinner, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { showSheet } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

type Credentials = { email: string; password: string };

/**
 * Messages for the error codes `/auth/callback` adds to the URL. Only these
 * fixed texts can be shown, so a crafted link cannot put its own copy here.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  exchange_failed: "Sesi tidak dapat dibuat. Silakan coba masuk kembali.",
  unavailable: "Layanan sedang tidak tersedia. Silakan coba lagi.",
};

/**
 * OAuth login with Google. The role is persisted before the provider page
 * opens so the redirect back never loses where the user was going.
 */
export function LoginScreen({
  merchant,
  next,
  errorCode,
}: {
  merchant: boolean;
  next?: string;
  /** Error code from a failed `/auth/callback`. */
  errorCode?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => (errorCode ? (CALLBACK_ERRORS[errorCode] ?? null) : null));
  const target = next || (merchant ? "/merchant" : "/");
  const admin = target === "/admin" || target.startsWith("/admin/");

  const login = async (provider: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await appState.setPendingMerchantIntent(merchant);
      if (AuthService.isConfigured) {
        const opened = await provider();
        if (!opened) {
          setError("Halaman login tidak dapat dibuka. Coba lagi.");
          setBusy(false);
        }
        // On success the browser is leaving for the provider: stay busy.
        return;
      }
      await AppNav.completeLogin({ merchant, next });
      setBusy(false);
    } catch {
      setError("Login gagal dimulai. Periksa koneksi lalu coba lagi.");
      setBusy(false);
    }
  };

  const showTestAccountLogin = async () => {
    if (!e2eMode() || busy) return;
    const credentials = await showSheet<Credentials>((close) => <TestAccountLoginSheet close={close} />, {
      label: "Masuk dengan akun pengujian",
    });
    if (!credentials) return;
    await login(() => AuthService.signInWithPassword(credentials.email, credentials.password));
  };

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
        paddingBottom: "calc(24px + var(--safe-bottom))",
        paddingLeft: 24,
      }}
    >
      <div style={{ marginLeft: -12 }}>
        <IconButton tooltip="Kembali" icon="arrow_back" onTap={busy ? null : () => void navigator.maybePop()} />
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
        <AppLogo size={72} />
        <h1 style={{ ...display(26, { weight: 800, color: C.ink }), marginTop: 26 }}>Tinggal selangkah lagi</h1>
        <p style={{ ...ui(15, { color: C.body, height: 1.5 }), marginTop: 8, maxWidth: 300 }}>
          {admin
            ? "Masuk dengan akun Admin untuk mengelola penjual, pengguna, dan pengaduan."
            : merchant
            ? "Masuk untuk menyiapkan toko dan menyelamatkan stok makananmu."
            : "Masuk untuk menemukan dan memesan Surprise Bag di sekitarmu."}
        </p>
      </div>
      {error ? (
        <ErrorBox style={{ textAlign: "center", marginBottom: 12 }}>{error}</ErrorBox>
      ) : null}
      <ProviderButton
        label="Lanjutkan dengan Google"
        icon={<GoogleMark />}
        busy={busy}
        onPressed={() => void login(() => AuthService.signInWithGoogle(target))}
      />
      {e2eMode() ? (
        <div style={{ marginTop: 10 }}>
          <ProviderButton
            label="Masuk dengan akun pengujian"
            icon={<Icon name="science_outlined" size={24} color={C.greenBright} />}
            busy={busy}
            onPressed={() => void showTestAccountLogin()}
          />
        </div>
      ) : null}
      <p style={{ ...ui(11.5, { color: C.captionWarm, height: 1.6 }), marginTop: 14, textAlign: "center" }}>
        Dengan masuk, kamu menyetujui <LegalLink label="Ketentuan Layanan" document="terms" /> dan{" "}
        <LegalLink label="Kebijakan Privasi" document="privacy" />.
      </p>
    </div>
  );
}

function ProviderButton({
  label,
  icon,
  busy,
  onPressed,
}: {
  label: string;
  icon: ReactNode;
  busy: boolean;
  onPressed: () => void;
}) {
  return (
    <button
      type="button"
      className="sb-ink"
      disabled={busy}
      onClick={onPressed}
      style={{
        width: "100%",
        height: 56,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        background: C.white,
        borderRadius: 16,
        border: `1.5px solid ${C.inputBorder}`,
        opacity: busy ? 0.6 : 1,
        flex: "none",
      }}
    >
      {busy ? <Spinner size={20} strokeWidth={2} /> : icon}
      <span style={ui(15.5, { weight: 700, color: C.ink })}>{label}</span>
    </button>
  );
}

function LegalLink({ label, document }: { label: string; document: LegalDocument }) {
  return (
    <button
      type="button"
      className="sb-tap"
      onClick={() => AppNav.toLegal(document)}
      style={{ ...ui(11.5, { weight: 700, color: C.greenBright }), padding: "6px 0", display: "inline" }}
    >
      {label}
    </button>
  );
}

/** The official multicolour Google "G" mark. */
function GoogleMark() {
  return (
    <svg width={24} height={24} viewBox="0 0 48 48" aria-hidden focusable="false" style={{ flex: "none", display: "block" }}>
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/** E2E-only email/password sheet. Credentials are never stored. */
function TestAccountLoginSheet({ close }: { close: (value?: Credentials) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: { email?: string; password?: string } = {};
    if (!email.trim() || !email.includes("@")) next.email = "Masukkan email akun uji yang valid.";
    if (!password) next.password = "Masukkan kata sandi akun uji.";
    setErrors(next);
    if (next.email || next.password) return;
    const credentials = { email: email.trim(), password };
    setEmail("");
    setPassword("");
    close(credentials);
  };

  return (
    <form
      onSubmit={submit}
      style={{
        background: C.cream,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        padding: "20px 24px",
        paddingBottom: "calc(24px + var(--safe-bottom))",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Icon name="science_outlined" color={C.greenBright} />
        <h2 style={{ ...ui(18, { weight: 800, color: C.ink }), flex: 1 }}>Masuk dengan akun pengujian</h2>
        <IconButton tooltip="Tutup" icon="close" onTap={() => close()} />
      </div>
      <p style={{ ...ui(13, { color: C.body, height: 1.45 }), marginTop: 8 }}>
        Khusus pengujian E2E. Credential diisi saat pengujian dan tidak ditanam di source atau konfigurasi SaveBite.
      </p>
      <label style={{ ...ui(12.5, { weight: 700, color: C.body }), marginTop: 20, marginBottom: 7 }} htmlFor="e2e-email">
        Email akun uji
      </label>
      <AppTextField
        id="e2e-email"
        type="email"
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="contoh@pengujian.local"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        invalid={Boolean(errors.email)}
        leading={<Icon name="alternate_email" size={20} color={C.body} />}
        autoFocus
      />
      <FieldError>{errors.email}</FieldError>
      <label style={{ ...ui(12.5, { weight: 700, color: C.body }), marginTop: 14, marginBottom: 7 }} htmlFor="e2e-password">
        Kata sandi akun uji
      </label>
      <AppTextField
        id="e2e-password"
        type="password"
        autoComplete="off"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        invalid={Boolean(errors.password)}
        leading={<Icon name="lock_outline" size={20} color={C.body} />}
      />
      <FieldError>{errors.password}</FieldError>
      <div style={{ marginTop: 20, display: "flex" }}>
        <FilledButton label="Masuk untuk pengujian" icon="login" type="submit" style={{ width: "100%", minHeight: 48 }} />
      </div>
    </form>
  );
}
