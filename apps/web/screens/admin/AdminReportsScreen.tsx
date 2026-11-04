"use client";

import { useEffect, useState } from "react";
import { appState } from "../../lib/appState";
import { midtransSandbox } from "../../lib/env";
import { formatRupiah, type ReportDay, type ReportMerchant } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { SelectChip } from "../../ui/chips";
import { AppCard, AppTextField, EmptyState, FieldLabel, StatTile, Wrap } from "../../ui/common";
import { C, display, ui } from "../../ui/theme";
import { AdminPage, AdminTable, CellText, type AdminColumn } from "./adminUi";

const DAY_MS = 86_400_000;
const PRESETS = [7, 30, 90] as const;

/** `YYYY-MM-DD` in Asia/Jakarta, the day boundary the report RPC uses. */
function jakartaDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(date);
}

const presetRange = (days: number) => ({
  from: jakartaDate(new Date(Date.now() - (days - 1) * DAY_MS)),
  to: jakartaDate(new Date()),
});

function shortDay(day: string): string {
  const [, month, date] = day.split("-");
  return `${date}/${month}`;
}

/** Single series: bars from the baseline, one hover tooltip, no legend. */
function DailyChart({ days }: { days: readonly ReportDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((day) => day.grossAmount));
  const active = hovered === null ? null : days[hovered];
  return (
    <AppCard padding="18px 20px">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 14 }}>
        <h2 style={{ ...display(16, { weight: 700 }), flex: 1 }}>Nilai transaksi harian</h2>
        <span style={ui(12.5, { color: C.body })}>
          {active ? `${shortDay(active.day)} · ${formatRupiah(active.grossAmount)} · ${active.orders} pesanan` : `Tertinggi ${formatRupiah(max)}`}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Nilai transaksi harian selama ${days.length} hari, tertinggi ${formatRupiah(max)}`}
        onMouseLeave={() => setHovered(null)}
        style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 170, borderBottom: `1px solid ${C.rule}` }}
      >
        {days.map((day, index) => (
          <div
            key={day.day}
            onMouseEnter={() => setHovered(index)}
            style={{ flex: "1 1 0", minWidth: 0, height: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          >
            <div
              className="sb-admin-chart-bar"
              style={{ height: `${(day.grossAmount / max) * 100}%`, background: hovered === index ? C.green : undefined }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, ...ui(11.5, { color: C.muted }) }}>
        <span>{days.length ? shortDay(days[0].day) : ""}</span>
        <span>{days.length ? shortDay(days[days.length - 1].day) : ""}</span>
      </div>
    </AppCard>
  );
}

const MERCHANT_COLUMNS: readonly AdminColumn<ReportMerchant>[] = [
  { header: "Toko", render: (row) => <CellText primary={row.storeName} /> },
  { header: "Pesanan", render: (row) => `${row.orders}` },
  { header: "Nilai transaksi", render: (row) => formatRupiah(row.grossAmount) },
];

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <StatTile
      value={value}
      label={label}
      background={C.white}
      valueColor={C.ink}
      labelColor={C.body}
      border={`1px solid ${C.border}`}
      style={{ padding: "16px 18px" }}
    />
  );
}

export function AdminReportsScreen() {
  const state = useAppState();
  const [range, setRange] = useState(() => presetRange(30));
  const [preset, setPreset] = useState<number | null>(30);

  useEffect(() => {
    if (range.from && range.to) void appState.loadReport(range.from, range.to);
  }, [range]);

  const report = state.report;
  return (
    <AdminPage
      title="Laporan Transaksi"
      subtitle="Statistik pembayaran terverifikasi berdasarkan periode."
      error={state.transactionReportError}
      loading={state.isLoadingReport && report === null}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 14, marginBottom: 16 }}>
        <Wrap spacing={8} runSpacing={8}>
          {PRESETS.map((days) => (
            <SelectChip
              key={days}
              label={`${days} hari`}
              selected={preset === days}
              onTap={() => {
                setPreset(days);
                setRange(presetRange(days));
              }}
            />
          ))}
        </Wrap>
        {(["from", "to"] as const).map((field) => (
          <div key={field} style={{ width: 170 }}>
            <FieldLabel htmlFor={`report-${field}`}>{field === "from" ? "Dari" : "Sampai"}</FieldLabel>
            <AppTextField
              id={`report-${field}`}
              type="date"
              value={range[field]}
              onChange={(event) => {
                setPreset(null);
                setRange({ ...range, [field]: event.target.value });
              }}
            />
          </div>
        ))}
      </div>
      {report === null ? null : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 14 }}>
            <Tile value={`${report.settledOrders}`} label="Transaksi berhasil" />
            <Tile value={formatRupiah(report.grossAmount)} label="Nilai transaksi" />
            <Tile value={formatRupiah(report.merchantNetAmount)} label="Bagian penjual" />
            <Tile value={formatRupiah(report.platformRevenue)} label="Pendapatan platform" />
          </div>
          <DailyChart days={report.daily} />
          <h2 style={{ ...display(16, { weight: 700 }), margin: "20px 0 10px" }}>Penjual teratas</h2>
          {report.topMerchants.length === 0 ? (
            <EmptyState icon="storefront_outlined" title="Belum ada transaksi" message="Tidak ada transaksi pada periode ini." />
          ) : (
            <AdminTable
              columns={MERCHANT_COLUMNS}
              rows={report.topMerchants}
              rowKey={(row) => row.id}
              emptyIcon="storefront_outlined"
              emptyTitle="Belum ada transaksi"
              emptyMessage="Tidak ada transaksi pada periode ini."
            />
          )}
          <p style={{ ...ui(12, { color: C.muted, height: 1.5 }), marginTop: 14 }}>
            {`${report.completedOrders} pesanan sudah diambil. ${report.unsettledOrders} pesanan dibatalkan atau dikembalikan dan tidak dihitung.`}
            {midtransSandbox() ? " Data ini memakai pembayaran mode sandbox Midtrans, bukan uang sungguhan." : ""}
          </p>
        </>
      )}
    </AdminPage>
  );
}
