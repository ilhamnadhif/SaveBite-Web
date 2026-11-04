"use client";

import { useState, type FormEvent } from "react";
import { appState } from "../../lib/appState";
import type { AdminUser } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FilledButton, TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { AppTextField } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { confirmDialog, snack } from "../../ui/overlays";
import { C, ui } from "../../ui/theme";
import { AdminPage, AdminTable, CellText, VerifiedBadge, formatAdminDate, promptNote, reportAdminError, type AdminColumn } from "./adminUi";

function roleLabel(user: AdminUser): string {
  if (user.isAdmin) return "Admin";
  return user.storeName ? "Penjual" : "Pembeli";
}

export function AdminUsersScreen() {
  const state = useAppState();
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const search = (event: FormEvent) => {
    event.preventDefault();
    void appState.loadAdminUsers(query);
  };

  const apply = async (user: AdminUser, suspended: boolean, reason?: string) => {
    setBusyId(user.id);
    try {
      await appState.setUserSuspended(user.id, suspended, reason);
      snack(suspended ? `${user.name} ditangguhkan` : `${user.name} diaktifkan kembali`);
    } catch (error) {
      reportAdminError(error, (value) => appState.messageFor(value));
    } finally {
      setBusyId(null);
    }
  };

  const suspend = async (user: AdminUser) => {
    const reason = await promptNote({
      title: `Tangguhkan ${user.name}`,
      message: user.storeName
        ? "Akun tidak bisa dipakai dan tokonya hilang dari Pembeli sampai diaktifkan kembali."
        : "Akun tidak bisa dipakai sampai diaktifkan kembali. Alasan ditampilkan kepada pengguna.",
      placeholder: "Contoh: melanggar ketentuan layanan",
      confirmLabel: "Tangguhkan",
      destructive: true,
    });
    if (reason) await apply(user, true, reason);
  };

  const activate = async (user: AdminUser) => {
    const confirmed = await confirmDialog({
      title: `Aktifkan ${user.name}?`,
      message: "Pengguna dapat masuk dan bertransaksi lagi.",
      confirmLabel: "Aktifkan",
    });
    if (confirmed) await apply(user, false);
  };

  const columns: readonly AdminColumn<AdminUser>[] = [
    { header: "Nama", render: (row) => <CellText primary={row.name} secondary={row.email} /> },
    { header: "Peran", render: (row) => <CellText primary={roleLabel(row)} secondary={row.storeName} /> },
    { header: "Pesanan", render: (row) => `${row.orderCount}` },
    { header: "Bergabung", render: (row) => formatAdminDate(row.createdAt) },
    {
      header: "Status",
      render: (row) =>
        row.suspendedAt ? (
          <>
            <StatusBadge.expired text="Ditangguhkan" />
            {row.suspendedReason ? <div style={{ ...ui(12, { color: C.body }), marginTop: 5, maxWidth: 220 }}>{row.suspendedReason}</div> : null}
          </>
        ) : (
          <VerifiedBadge text="Aktif" />
        ),
    },
    {
      header: "Tindakan",
      render: (row) => {
        if (row.isAdmin) return <span style={ui(12.5, { color: C.muted })}>–</span>;
        const busy = busyId === row.id;
        return row.suspendedAt ? (
          <FilledButton label="Aktifkan" fontSize={13} fontWeight={700} onTap={busy ? null : () => void activate(row)} />
        ) : (
          <TextButton label="Tangguhkan" color={C.danger} fontSize={13} fontWeight={700} onTap={busy ? null : () => void suspend(row)} />
        );
      },
    },
  ];

  return (
    <AdminPage
      title="Kelola Pengguna"
      subtitle="Lihat akun Pembeli dan Penjual, lalu ubah statusnya bila perlu."
      error={state.adminUsersError}
      loading={state.isLoadingAdminUsers && state.adminUsers.length === 0}
    >
      <form onSubmit={search} style={{ maxWidth: 420, marginBottom: 14 }}>
        <AppTextField
          type="search"
          value={query}
          aria-label="Cari nama atau email"
          placeholder="Cari nama atau email, lalu tekan Enter"
          leading={<Icon name="search" size={18} color={C.muted} />}
          onChange={(event) => setQuery(event.target.value)}
        />
      </form>
      <AdminTable
        columns={columns}
        rows={state.adminUsers}
        rowKey={(row) => row.id}
        emptyIcon="search"
        emptyTitle="Pengguna tidak ditemukan"
        emptyMessage="Coba kata kunci lain."
      />
    </AdminPage>
  );
}
