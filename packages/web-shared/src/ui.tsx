"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, LogOut, Search, Store, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AuthGate, useAuth } from "./auth";
import { authCallbackUrl, safeNextPath } from "./redirect";

export type NavItem = { href: string; label: string; icon: LucideIcon };
export function AppFrame({ kicker, logo = "S", nav, children, merchant = false }: {
  kicker: string; logo?: string; nav: NavItem[]; children: ReactNode; merchant?: boolean;
}) {
  const path = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const isLogin = path === "/login" || path === "/auth/callback";
  if (isLogin) return <>{children}</>;
  return <AuthGate merchant={merchant}>
    <div className={`app-frame ${merchant ? "merchant-frame" : "consumer-frame"}`}>
      <aside className="sidebar">
        <Link className="brand-lockup" href="/">
          <span className="brand-mark">{logo}</span><span><strong>savebite</strong><small>{kicker}</small></span>
        </Link>
        <div className="sidebar-section-label">MENU</div>
        <nav className="side-nav">
          {nav.map((item) => {
            const Icon = item.icon;
            const active = path === item.href || (item.href !== "/" && path.startsWith(item.href + "/"));
            return <Link className={`nav-link ${active ? "active" : ""}`} href={item.href} key={item.href}>
              <Icon size={19} strokeWidth={1.8} /><span>{item.label}</span>
            </Link>;
          })}
        </nav>
        {!merchant && <div className="sidebar-tip"><div className="tip-icon">✳</div><strong>Selamatkan makanan,<br/>satu bag setiap kali.</strong><span>Good food deserves a second chance.</span></div>}
        <button className="account-button" onClick={() => void signOut().then(() => router.push("/login"))}>
          <span className="avatar">{(user?.user_metadata?.full_name ?? user?.email ?? "S").toString().slice(0,1).toUpperCase()}</span>
          <span className="account-copy"><strong>{user?.user_metadata?.full_name ?? "Akun SaveBite"}</strong><small>{user?.email}</small></span><LogOut size={16}/>
        </button>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="topbar-context"><span className="topbar-dot"/>{merchant ? "Merchant workspace" : "Save good food today"}</div>
          {!merchant && <form className="top-search" action="/search"><Search size={17}/><input name="q" placeholder="Cari makanan atau toko…" aria-label="Cari makanan atau toko"/><kbd>↵</kbd></form>}
          <div className="top-actions">
            {!merchant && <Link href="/notifications" className="icon-button" aria-label="Notifikasi"><Bell size={19}/></Link>}
            {user ? <><Link href={merchant ? "/" : "/merchant"} className="workspace-switch"><Store size={15}/><span>{merchant ? "Mode konsumen" : "Mode merchant"}</span></Link><div className="top-avatar">{(user.user_metadata?.full_name ?? user.email ?? "S").toString().slice(0,1).toUpperCase()}</div></> : <Link href="/login" className="button button-secondary top-login">Masuk</Link>}
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  </AuthGate>;
}

export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>;
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}>{(title || action) && <div className="panel-header">{title && <h2>{title}</h2>}{action}</div>}{children}</section>;
}

export function Metric({ label, value, hint, accent = "green", icon }: { label: string; value: string; hint?: string; accent?: string; icon?: ReactNode }) {
  return <div className={`metric-card metric-${accent}`}><div className="metric-top"><span>{label}</span>{icon && <span className="metric-icon">{icon}</span>}</div><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

export function EmptyState({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><span className="empty-mark">✳</span><h3>{title}</h3><p>{detail}</p>{action}</div>;
}

export function StatusPill({ status }: { status: string }) {
  const labels: Record<string, string> = { pending: "Menunggu bayar", paid: "Dibayar", preparing: "Disiapkan", ready: "Siap diambil", redeemed: "Selesai", expired: "Kedaluwarsa", cancelled: "Dibatalkan", refunded: "Refund", requested: "Diajukan", processing: "Diproses", verified: "Terverifikasi" };
  return <span className={`status-pill status-${status}`}>{labels[status] ?? status}</span>;
}

/**
 * Image for merchant-uploaded content.
 *
 * These URLs are only known at runtime (public Supabase Storage buckets), so
 * `next/image` would need a remote pattern and would proxy every photo through
 * this 1-CPU VPS. Using a plain `<img>` with explicit loading hints avoids a
 * pointless optimisation proxy while still deferring off-screen work.
 *
 * `alt` is a required prop so decorative use is always a deliberate decision.
 */
export function SmartImage({
  src,
  alt,
  className,
  priority = false,
  width,
  height,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
  width?: number;
  height?: number;
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : "auto"}
      decoding="async"
      referrerPolicy="no-referrer"
    />
  );
}

export function LoginCard({ initialMerchant = false, error, next }: { initialMerchant?: boolean; error?: string | null; next?: string }) {
  const [merchant, setMerchant] = useState(initialMerchant);
  const { user, loading } = useAuth();
  const router = useRouter();
  // `next` is attacker-controllable, so it is sanitised and constrained to the
  // workspace the user actually chose. Falling back to the workspace root keeps
  // the previous behaviour when no (or an invalid) target is present.
  const target = next
    ? safeNextPath(next, { fallback: "", requirePrefix: merchant ? "/merchant" : "/" })
    : merchant ? "/merchant" : "/";
  const resolvedTarget = target || (merchant ? "/merchant" : "/");
  const label = merchant ? "Selamat datang, Merchant" : "Selamat datang di SaveBite";
  return <main className="login-screen"><div className="login-card"><Link className="brand-lockup login-brand" href="/"><span className="brand-mark">S</span><span><strong>savebite</strong><small>GOOD FOOD, LESS WASTE</small></span></Link><div className="eyebrow">PILIH CARA MENGGUNAKAN SAVEBITE</div><h1>{label}</h1><p>{merchant ? "Kelola toko, surprise bag, pesanan, dan pickup pelanggan." : "Temukan dan pesan Surprise Bag dari toko di sekitarmu."}</p><div className="login-role-picker" role="group" aria-label="Pilih peran"><button type="button" className={!merchant ? "selected" : ""} aria-pressed={!merchant} onClick={() => setMerchant(false)}><span className="role-picker-mark consumer-mark">S</span><span><strong>Konsumen</strong><small>Cari makanan enak dengan harga hemat</small></span></button><button type="button" className={merchant ? "selected" : ""} aria-pressed={merchant} onClick={() => setMerchant(true)}><span className="role-picker-mark merchant-mark"><Store size={18}/></span><span><strong>Merchant</strong><small>Selamatkan stok dan kelola toko</small></span></button></div>{error && <div className="alert alert-error" role="alert">{error}</div>}{user ? <button className="google-button" disabled={loading} onClick={() => router.push(resolvedTarget)}>{merchant ? "Lanjutkan sebagai Merchant" : "Lanjutkan sebagai Konsumen"}</button> : <GoogleLoginButton merchant={merchant}/>}<small className="login-foot">Satu akun SaveBite bisa digunakan untuk kedua peran.</small></div></main>;
}

export function GoogleLoginButton({ merchant = false }: { merchant?: boolean }) {
  const router = useRouter();
  return <button className="google-button" onClick={async () => {
    // Imported lazily so the browser client is only constructed on click.
    const { supabaseBrowser } = await import("./client");
    const params = new URLSearchParams(window.location.search);
    const requested = safeNextPath(params.get("next"), {
      fallback: "",
      requirePrefix: merchant ? "/merchant" : "/",
    });
    const next = requested || (merchant ? "/merchant" : "/");
    const { error } = await supabaseBrowser().auth.signInWithOAuth({ provider: "google", options: { redirectTo: authCallbackUrl(window.location.origin, next), queryParams: { access_type: "offline", prompt: "select_account" } } });
    if (error) router.push("/login?error=" + encodeURIComponent(error.message));
  }}><span className="google-g">G</span>Lanjutkan dengan Google</button>;
}
