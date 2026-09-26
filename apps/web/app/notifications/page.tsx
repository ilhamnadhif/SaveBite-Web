"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, CheckCheck, CreditCard, PackageCheck, Star } from "lucide-react";
import { EmptyState, PageHeading, Panel, describeError, useAsyncData, useAuth, useRealtime } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { shortDate } from "@savebite/web-shared";

type Notice = { id: string; title: string; body: string; type: string; read: boolean; created_at: string; data?: Record<string, unknown> };

const MAX_NOTICES = 100;

const iconFor = (type: string) =>
  type === "payment" ? CreditCard : type === "order" ? PackageCheck : type === "review" ? Star : Bell;

export default function NotificationsPage() {
  const { user } = useAuth();
  const [actionError, setActionError] = useState("");

  const load = async (): Promise<Notice[]> => {
    if (!user) return [];
    const { data, error } = await supabaseBrowser()
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_NOTICES);
    if (error) throw error;
    return (data ?? []) as Notice[];
  };

  const { data: rows, loading, error, reload } = useAsyncData<Notice[]>(load, {
    enabled: Boolean(user),
    deps: [user?.id],
    scope: "notifications.load",
    initialData: [],
  });

  useRealtime(
    "consumer-notifications",
    { table: "notifications", filter: user ? `user_id=eq.${user.id}` : undefined },
    reload,
  );

  async function markAll() {
    if (!user) return;
    setActionError("");
    const { error: updateError } = await supabaseBrowser()
      .from("notifications")
      .update({ read: true })
      .eq("user_id", user.id);
    // Previously this fired and forgot: a failure left every row unread with no
    // indication that anything had gone wrong.
    if (updateError) {
      setActionError(describeError(updateError, "notifications.markAll", { userId: user.id }));
      return;
    }
    reload();
  }

  if (!user) {
    return (
      <EmptyState
        title="Masuk untuk melihat notifikasi"
        detail="Pembayaran, pickup, dan aktivitas akun kamu akan muncul di sini."
        action={<Link href="/login" className="button button-primary">Masuk ke SaveBite</Link>}
      />
    );
  }

  return <>
    <PageHeading
      eyebrow="UPDATE TERBARU"
      title="Notifikasi"
      description="Informasi pembayaran, pickup, dan aktivitas akun."
      action={
        <button className="button button-secondary" onClick={() => void markAll()} disabled={!rows.some((row) => !row.read)}>
          <CheckCheck size={14}/>Tandai semua dibaca
        </button>
      }
    />
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {actionError && <div className="alert alert-error" role="alert">{actionError}</div>}
    {loading && !rows.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat notifikasi…</div>
    ) : rows.length ? (
      <Panel className="notifications-panel">
        <div className="notice-list">
          {rows.map((row) => {
            const Icon = iconFor(row.type);
            const orderId = row.data?.order_id;
            return (
              <Link
                href={typeof orderId === "string" ? `/orders?order=${encodeURIComponent(orderId)}` : "/orders"}
                key={row.id}
                className={"notice-row " + (row.read ? "read" : "")}
              >
                <span className="notice-icon"><Icon size={17}/></span>
                <span className="notice-copy"><strong>{row.title}</strong><small>{row.body}</small><time>{shortDate(row.created_at)}</time></span>
                {!row.read && <span className="notice-dot" aria-label="Belum dibaca"/>}
              </Link>
            );
          })}
        </div>
      </Panel>
    ) : (
      <EmptyState title="Belum ada notifikasi" detail="Kami akan menyimpan update penting pesanan di sini."/>
    )}
  </>;
}
