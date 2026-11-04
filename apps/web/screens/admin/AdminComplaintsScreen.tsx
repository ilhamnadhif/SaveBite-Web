"use client";

import { useState } from "react";
import { appState } from "../../lib/appState";
import {
  COMPLAINT_CATEGORY_LABELS,
  COMPLAINT_STATUS_LABELS,
  formatRupiah,
  type AdminComplaint,
  type ComplaintStatus,
} from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FilledButton, TextButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { AppCard, EmptyState, Wrap } from "../../ui/common";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";
import { AdminPage, ComplaintBadge, formatAdminDate, promptNote, reportAdminError } from "./adminUi";

type Filter = ComplaintStatus | "all";

const FILTERS: readonly Filter[] = ["all", "open", "in_review", "resolved", "rejected"];
const filterLabel = (filter: Filter) => (filter === "all" ? "Semua" : COMPLAINT_STATUS_LABELS[filter]);

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={ui(11.5, { weight: 700, color: C.muted })}>{label}</div>
      <div style={{ ...ui(13.5, { color: C.ink }), marginTop: 2 }}>{value}</div>
    </div>
  );
}

function ComplaintCard({ complaint }: { complaint: AdminComplaint }) {
  const [busy, setBusy] = useState(false);
  const closed = complaint.status === "resolved" || complaint.status === "rejected";

  const update = async (status: Exclude<ComplaintStatus, "open">, note?: string) => {
    setBusy(true);
    try {
      await appState.updateComplaint(complaint.id, status, note);
      snack(`Pengaduan ${complaint.orderReference} diperbarui`);
    } catch (error) {
      reportAdminError(error, (value) => appState.messageFor(value));
    } finally {
      setBusy(false);
    }
  };

  const close = async (status: "resolved" | "rejected") => {
    const note = await promptNote({
      title: status === "resolved" ? "Selesaikan pengaduan" : "Tolak pengaduan",
      message: "Tindak lanjut ini dikirim ke Pembeli sebagai notifikasi.",
      placeholder: status === "resolved" ? "Contoh: Penjual mengganti 1 roti" : "Contoh: bukti tidak sesuai pesanan",
      confirmLabel: status === "resolved" ? "Selesaikan" : "Tolak",
      destructive: status === "rejected",
    });
    if (note) await update(status, note);
  };

  return (
    <AppCard padding="18px 20px" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <h2 style={{ ...display(16, { weight: 700 }), flex: 1, minWidth: 0 }}>
          {`${complaint.orderReference} · ${COMPLAINT_CATEGORY_LABELS[complaint.category]}`}
        </h2>
        <ComplaintBadge status={complaint.status} />
      </div>
      <p style={ui(14, { color: C.ink, height: 1.5 })}>{complaint.description}</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 14 }}>
        <Detail label="Pembeli" value={complaint.consumerName} />
        <Detail label="Toko" value={complaint.storeName} />
        <Detail label="Pesanan" value={`${complaint.bagTitle} · ${formatRupiah(complaint.totalAmount)}`} />
        <Detail label="Diajukan" value={formatAdminDate(complaint.createdAt)} />
      </div>
      {complaint.adminNote ? (
        <div style={{ marginTop: 14, padding: "10px 14px", borderRadius: 12, background: C.greenSoftBg }}>
          <div style={ui(11.5, { weight: 700, color: C.greenAccent })}>Tindak lanjut Admin</div>
          <div style={{ ...ui(13.5, { color: C.ink }), marginTop: 2 }}>{complaint.adminNote}</div>
        </div>
      ) : null}
      {closed ? null : (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, marginTop: 12 }}>
          <FilledButton label="Selesaikan" fontSize={13} fontWeight={700} onTap={busy ? null : () => void close("resolved")} />
          {complaint.status === "open" ? (
            <TextButton label="Tandai ditinjau" fontSize={13} fontWeight={700} onTap={busy ? null : () => void update("in_review")} />
          ) : null}
          <TextButton label="Tolak" color={C.danger} fontSize={13} fontWeight={700} onTap={busy ? null : () => void close("rejected")} />
        </div>
      )}
    </AppCard>
  );
}

export function AdminComplaintsScreen() {
  const state = useAppState();
  const [filter, setFilter] = useState<Filter>("all");
  const rows = state.adminComplaints.filter((complaint) => filter === "all" || complaint.status === filter);
  return (
    <AdminPage
      title="Pengaduan"
      subtitle="Tindak lanjuti pengaduan Pembeli terkait produk atau transaksi."
      error={state.adminError}
      loading={state.isLoadingAdmin && state.adminComplaints.length === 0 && state.adminMerchants.length === 0}
    >
      <Wrap spacing={8} runSpacing={8} style={{ marginBottom: 14 }}>
        {FILTERS.map((item) => (
          <SelectChip key={item} label={filterLabel(item)} selected={filter === item} onTap={() => setFilter(item)} />
        ))}
      </Wrap>
      {rows.length === 0 ? (
        <EmptyState icon="support_agent_outlined" title="Tidak ada pengaduan" message="Belum ada pengaduan pada status ini." />
      ) : (
        rows.map((complaint) => <ComplaintCard key={complaint.id} complaint={complaint} />)
      )}
    </AdminPage>
  );
}
