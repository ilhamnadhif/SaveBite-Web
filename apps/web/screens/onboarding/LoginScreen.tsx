"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { AuthService, isApplePlatform } from "../../lib/auth";
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
 * OAuth login. The role is persisted before the provider page opens so the
 * redirect back never loses where the user was going.
 */
export function LoginScreen({ merchant, next }: { merchant: boolean; next?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showApple] = useState(() => isApplePlatform());
  const target = next || (merchant ? "/merchant" : "/");

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
      await AppNav.completeLogin({ merchant });
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
          {merchant
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
      {showApple ? (
        <div style={{ marginTop: 10 }}>
          <ProviderButton
            label="Lanjutkan dengan Apple"
            icon={<Icon name="apple" size={25} color={C.ink} />}
            busy={busy}
            onPressed={() => void login(() => AuthService.signInWithApple(target))}
          />
        </div>
      ) : null}
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

/** The four-colour Google "G" ring used by the mobile login button. */
function GoogleMark() {
  return (
    <span
      aria-hidden
      style={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        background: "conic-gradient(from 90deg, #EA4335, #FBBC05, #34A853, #4285F4, #EA4335)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: C.white }} />
    </span>
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
