"use client";

import { useState } from "react";
import { appState } from "../../lib/appState";
import { VERIFICATION_LABELS, type AdminMerchant, type VerificationStatus } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FilledButton, TextButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { Wrap } from "../../ui/common";
import { snack } from "../../ui/overlays";
import { C, ui } from "../../ui/theme";
import { AdminPage, AdminTable, CellText, VerificationBadge, formatAdminDate, promptNote, reportAdminError, type AdminColumn } from "./adminUi";

type Filter = VerificationStatus | "all";

const FILTERS: readonly Filter[] = ["all", "pending", "verified", "rejected"];
const filterLabel = (filter: Filter) => (filter === "all" ? "Semua" : VERIFICATION_LABELS[filter]);

export function AdminSellersScreen() {
  const state = useAppState();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const decide = async (merchant: AdminMerchant, status: "verified" | "rejected", note?: string) => {
    setBusyId(merchant.id);
    try {
      await appState.setMerchantVerification(merchant.id, status, note);
      snack(status === "verified" ? `${merchant.storeName} disetujui` : `${merchant.storeName} ditolak`);
    } catch (error) {
      reportAdminError(error, (value) => appState.messageFor(value));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (merchant: AdminMerchant) => {
    const note = await promptNote({
      title: `Tolak ${merchant.storeName}`,
      message: "Alasan ditampilkan kepada penjual supaya datanya bisa diperbaiki.",
      placeholder: "Contoh: alamat toko belum lengkap",
      confirmLabel: "Tolak",
      destructive: true,
    });
    if (note) await decide(merchant, "rejected", note);
  };

  const columns: readonly AdminColumn<AdminMerchant>[] = [
    { header: "Toko", render: (row) => <CellText primary={row.storeName} secondary={row.category} /> },
    { header: "Pemilik", render: (row) => <CellText primary={row.ownerName} secondary={row.ownerEmail} /> },
    { header: "Alamat", render: (row) => <span style={ui(13, { color: C.body })}>{row.address || "–"}</span> },
    { header: "Bag", render: (row) => `${row.bagCount}` },
    { header: "Daftar", render: (row) => formatAdminDate(row.createdAt) },
    {
      header: "Status",
      render: (row) => (
        <>
          <VerificationBadge status={row.verificationStatus} />
          {row.verificationNote ? <div style={{ ...ui(12, { color: C.body }), marginTop: 5, maxWidth: 200 }}>{row.verificationNote}</div> : null}
        </>
      ),
    },
    {
      header: "Tindakan",
      render: (row) => {
        const busy = busyId === row.id;
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            {row.verificationStatus !== "verified" ? (
              <FilledButton label="Setujui" fontSize={13} fontWeight={700} onTap={busy ? null : () => void decide(row, "verified")} />
            ) : null}
            {row.verificationStatus !== "rejected" ? (
              <TextButton label="Tolak" color={C.danger} fontSize={13} fontWeight={700} onTap={busy ? null : () => void reject(row)} />
            ) : null}
          </div>
        );
      },
    },
  ];

  const rows = state.adminMerchants.filter((merchant) => filter === "all" || merchant.verificationStatus === filter);
  return (
    <AdminPage
      title="Verifikasi Penjual"
      subtitle="Toko baru tampil ke Pembeli setelah disetujui Admin."
      error={state.adminError}
      loading={state.isLoadingAdmin && state.adminMerchants.length === 0}
    >
      <Wrap spacing={8} runSpacing={8} style={{ marginBottom: 14 }}>
        {FILTERS.map((item) => (
          <SelectChip key={item} label={filterLabel(item)} selected={filter === item} onTap={() => setFilter(item)} />
        ))}
      </Wrap>
      <AdminTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyIcon="storefront_outlined"
        emptyTitle="Tidak ada penjual"
        emptyMessage="Belum ada penjual pada status ini."
      />
    </AdminPage>
  );
}
