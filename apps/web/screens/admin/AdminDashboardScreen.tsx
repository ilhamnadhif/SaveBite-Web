"use client";

import { COMPLAINT_CATEGORY_LABELS, formatRupiah } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { TextButton } from "../../ui/buttons";
import { AppCard, EmptyState, StatTile } from "../../ui/common";
import { C, display, ui } from "../../ui/theme";
import { useShellScope } from "../ShellFrame";
import { AdminPage, CellText, ComplaintBadge, VerificationBadge, formatAdminDate } from "./adminUi";

const GRID_2 = "repeat(auto-fit, minmax(320px, 1fr))";
const GRID_4 = "repeat(auto-fit, minmax(200px, 1fr))";

function Tile({ value, label, attention = false }: { value: string; label: string; attention?: boolean }) {
  return (
    <StatTile
      value={value}
      label={label}
      background={attention ? C.terracottaSoftBg : C.white}
      valueColor={attention ? C.brown : C.ink}
      labelColor={C.body}
      border={`1px solid ${attention ? C.terracottaSoftBorder : C.border}`}
      style={{ padding: "16px 18px" }}
    />
  );
}

function Panel({ title, onOpen, children }: { title: string; onOpen: () => void; children: React.ReactNode }) {
  return (
    <AppCard padding="18px 20px">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <h2 style={{ ...display(16, { weight: 700 }), flex: 1 }}>{title}</h2>
        <TextButton label="Lihat semua" onTap={onOpen} fontSize={13} fontWeight={700} />
      </div>
      {children}
    </AppCard>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.divider}` }}>
      {children}
    </div>
  );
}

export function AdminDashboardScreen() {
  const state = useAppState();
  const shell = useShellScope();
  const stats = state.adminStats;
  const pending = state.adminMerchants.filter((merchant) => merchant.verificationStatus === "pending").slice(0, 4);
  const complaints = state.adminComplaints.filter((item) => item.status === "open" || item.status === "in_review").slice(0, 4);
  return (
    <AdminPage
      title="Dashboard"
      subtitle="Ringkasan platform dan hal yang perlu ditindaklanjuti."
      error={state.adminError}
      loading={state.isLoadingAdmin && state.adminMerchants.length === 0}
    >
      <div style={{ display: "grid", gridTemplateColumns: GRID_4, gap: 12 }}>
        <Tile value={`${stats.pendingMerchants}`} label="Penjual menunggu verifikasi" attention={stats.pendingMerchants > 0} />
        <Tile value={`${stats.openComplaints}`} label="Pengaduan belum selesai" attention={stats.openComplaints > 0} />
        <Tile value={`${stats.verifiedMerchants}`} label="Penjual terverifikasi" />
        <Tile value={`${stats.totalUsers}`} label={`Pengguna (${stats.suspendedUsers} ditangguhkan)`} />
        <Tile value={`${stats.ordersToday}`} label="Transaksi hari ini" />
        <Tile value={formatRupiah(stats.grossToday)} label="Nilai transaksi hari ini" />
        <Tile value={formatRupiah(stats.gross30d)} label="Nilai transaksi 30 hari" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: GRID_2, gap: 14, marginTop: 18 }}>
        <Panel title="Penjual menunggu" onOpen={() => shell?.selectTab(1)}>
          {pending.length === 0 ? (
            <EmptyState icon="storefront_outlined" title="Tidak ada antrean" message="Semua penjual sudah ditinjau." />
          ) : (
            pending.map((merchant) => (
              <Row key={merchant.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CellText primary={merchant.storeName} secondary={`${merchant.ownerName} · ${formatAdminDate(merchant.createdAt)}`} />
                </div>
                <VerificationBadge status={merchant.verificationStatus} />
              </Row>
            ))
          )}
        </Panel>
        <Panel title="Pengaduan terbaru" onOpen={() => shell?.selectTab(3)}>
          {complaints.length === 0 ? (
            <EmptyState icon="support_agent_outlined" title="Tidak ada pengaduan" message="Belum ada pengaduan yang menunggu." />
          ) : (
            complaints.map((complaint) => (
              <Row key={complaint.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CellText
                    primary={`${complaint.orderReference} · ${COMPLAINT_CATEGORY_LABELS[complaint.category]}`}
                    secondary={`${complaint.consumerName} · ${complaint.storeName}`}
                  />
                </div>
                <ComplaintBadge status={complaint.status} />
              </Row>
            ))
          )}
        </Panel>
      </div>
      <p style={{ ...ui(12, { color: C.muted }), marginTop: 16 }}>Nilai transaksi hanya menghitung pembayaran terverifikasi yang tidak dibatalkan atau dikembalikan.</p>
    </AdminPage>
  );
}
