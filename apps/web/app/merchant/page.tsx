"use client";

import Link from "next/link";
import { CircleDollarSign, PackageCheck, ShoppingBag, Sprout } from "lucide-react";
import { Metric, PageHeading, Panel, StatusPill, useAsyncData, useRealtime } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { rupiah, shortDate } from "@savebite/web-shared";
import type { MerchantOrder } from "../../components/MerchantData";

const RECENT_ORDERS = 8;

type DashboardData = { orders: MerchantOrder[]; balance: number; bagCount: number };

export default function DashboardPage() {
  const { data, loading, error, reload } = useAsyncData<DashboardData>(
    async () => {
      const db = supabaseBrowser();
      const [merchant, orders, bags] = await Promise.all([
        db.rpc("get_my_merchant"),
        db.from("merchant_orders").select("*").order("created_at", { ascending: false }).limit(RECENT_ORDERS),
        db.from("surprise_bags").select("id").eq("status", "active"),
      ]);
      // The RPC and both selects must all succeed; a partial load previously
      // rendered zero-valued metrics with no indication anything had failed.
      if (merchant.error) throw merchant.error;
      if (orders.error) throw orders.error;
      if (bags.error) throw bags.error;

      const id = String((merchant.data as Record<string, unknown> | null)?.id ?? "");
      let balance = 0;
      if (id) {
        const { data: row, error: balanceError } = await db
          .from("merchant_balance")
          .select("available")
          .eq("merchant_id", id)
          .maybeSingle();
        if (balanceError) throw balanceError;
        balance = Number(row?.available ?? 0);
      }

      return {
        orders: (orders.data ?? []) as MerchantOrder[],
        balance,
        bagCount: bags.data?.length ?? 0,
      };
    },
    { scope: "merchantDashboard.load", initialData: { orders: [], balance: 0, bagCount: 0 } },
  );

  useRealtime("merchant-dashboard", { table: "orders", debounceMs: 600 }, reload);

  const { orders, balance, bagCount } = data;
  const needsAction = orders.filter((order) => ["paid", "preparing", "ready"].includes(order.status)).length;
  const today = new Date().toDateString();
  const rescuedToday = orders.filter(
    (order) => order.status === "redeemed" && new Date(order.redeemed_at ?? order.created_at).toDateString() === today,
  ).length;

  return <>
    <PageHeading
      eyebrow="SELAMAT DATANG KEMBALI"
      title="Ringkasan toko"
      description="Lihat aktivitas dan operasional SaveBite hari ini."
      action={<Link className="button button-primary" href="/merchant/bags/new"><ShoppingBag size={15}/>Tambah surprise bag</Link>}
    />
    <div className="metric-grid">
      <Metric label="Bag aktif" value={String(bagCount)} hint="Tersedia di katalog" icon={<ShoppingBag size={16}/>}/>
      <Metric label="Pesanan perlu aksi" value={String(needsAction)} hint="Sudah dibayar pelanggan" accent="gold" icon={<PackageCheck size={16}/>}/>
      <Metric label="Saldo tersedia" value={rupiah(balance)} hint="Dari pendapatan terverifikasi" accent="terracotta" icon={<CircleDollarSign size={16}/>}/>
      <Metric label="Terselamatkan hari ini" value={String(rescuedToday)} hint="Bag berhasil dipickup" icon={<Sprout size={16}/>}/>
    </div>

    <Panel
      title="Pesanan terbaru"
      action={<Link className="text-link" href="/merchant/orders">Semua pesanan →</Link>}
    >
      {error ? (
        <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>
      ) : loading && !orders.length ? (
        <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat aktivitas…</div>
      ) : orders.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th>PELANGGAN</th><th>ITEM</th><th>WAKTU</th><th>STATUS</th><th></th></tr></thead>
            <tbody>
              {orders.slice(0, 6).map((order) => (
                <tr key={order.id}>
                  <td>
                    <div className="strong-cell">{order.consumer_anonymized ? "Pelanggan" : order.consumer_name || "Pelanggan"}</div>
                    <div className="sub-cell">#{order.order_reference}</div>
                  </td>
                  <td>{order.bag_title} · {order.quantity}</td>
                  <td>{shortDate(order.created_at)}</td>
                  <td><StatusPill status={order.status}/></td>
                  <td><Link className="text-link" href="/merchant/orders">Buka</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="dashboard-empty">
          <p>Belum ada pesanan yang masuk.</p>
          <Link className="text-link" href="/merchant/bags/new">Terbitkan surprise bag pertama →</Link>
        </div>
      )}
    </Panel>
  </>;
}
