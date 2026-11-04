"use client";

import { useEffect, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { paths } from "../../lib/routes";
import { useAppState } from "../../lib/useAppState";
import { ADMIN_NAV_ITEMS } from "../../ui/bottomNav";
import { Icon } from "../../ui/Icon";
import { C, display, ui, withAlpha } from "../../ui/theme";
import { ShellFrame } from "../ShellFrame";
import { AdminComplaintsScreen } from "./AdminComplaintsScreen";
import { AdminDashboardScreen } from "./AdminDashboardScreen";
import { AdminReportsScreen } from "./AdminReportsScreen";
import { AdminSellersScreen } from "./AdminSellersScreen";
import { AdminUsersScreen } from "./AdminUsersScreen";

function AdminSidebar({ index, select }: { index: number; select: (index: number) => void }) {
  const state = useAppState();
  return (
    <aside className="sb-admin-side" aria-label="Navigasi Admin">
      <div style={{ padding: "2px 12px 18px" }}>
        <div style={display(21, { weight: 800, color: C.cream })}>SaveBite</div>
        <div style={{ ...ui(12, { color: C.greenMuted }), marginTop: 2 }}>Panel Admin</div>
      </div>
      <nav className="sb-admin-nav">
        {ADMIN_NAV_ITEMS.map((item, tab) => {
          const active = tab === index;
          return (
            <button
              key={item.label}
              type="button"
              className="sb-tap"
              aria-current={active ? "page" : undefined}
              onClick={() => select(tab)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                flex: "none",
                padding: "10px 12px",
                borderRadius: 12,
                background: active ? withAlpha(C.cream, 0.14) : "transparent",
              }}
            >
              <Icon name={active ? item.filled : item.outlined} size={20} color={active ? C.cream : C.greenMuted} />
              <span style={{ ...ui(13.5, { weight: active ? 700 : 500, color: active ? C.cream : C.greenMuted }), whiteSpace: "nowrap" }}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
      <div style={{ padding: "14px 12px 0" }}>
        <div style={{ ...ui(12.5, { weight: 700, color: C.cream }), overflow: "hidden", textOverflow: "ellipsis" }}>{state.userName}</div>
        <button
          type="button"
          className="sb-tap"
          onClick={() => AppNav.leaveAdmin()}
          style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}
        >
          <Icon name="home_outlined" size={16} color={C.greenMuted} />
          <span style={ui(12.5, { color: C.greenMuted })}>Buka aplikasi</span>
        </button>
        <button
          type="button"
          className="sb-tap"
          onClick={() => void AppNav.logout()}
          style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}
        >
          <Icon name="logout_rounded" size={16} color={C.greenMuted} />
          <span style={ui(12.5, { color: C.greenMuted })}>Keluar</span>
        </button>
      </div>
    </aside>
  );
}

/**
 * Admin workspace: Dashboard, Verifikasi Penjual, Pengguna, Pengaduan, Laporan.
 * The app column is phone-width, so this workspace widens it while mounted.
 */
export function AdminShell({ initialIndex = 0 }: { initialIndex?: number }) {
  const [index, setIndex] = useState(Math.max(0, Math.min(ADMIN_NAV_ITEMS.length - 1, initialIndex)));

  useEffect(() => {
    const root = document.getElementById("savebite-app");
    root?.setAttribute("data-space", "admin");
    return () => root?.removeAttribute("data-space");
  }, []);

  return (
    <ShellFrame
      index={index}
      setIndex={setIndex}
      items={ADMIN_NAV_ITEMS}
      activeColor={C.green}
      tabUrl={(tab) => paths.adminTab(tab)}
      onSelect={(tab) => {
        if (tab === 2) void appState.loadAdminUsers();
        else if (tab !== 4) void appState.loadAdminData();
      }}
      reloadAll={() => Promise.all([appState.loadAdminData(), appState.loadAdminUsers()])}
      sidebar={(select) => <AdminSidebar index={index} select={select} />}
      tabs={(tab) => {
        switch (tab) {
          case 0:
            return <AdminDashboardScreen />;
          case 1:
            return <AdminSellersScreen />;
          case 2:
            return <AdminUsersScreen />;
          case 3:
            return <AdminComplaintsScreen />;
          default:
            return <AdminReportsScreen />;
        }
      }}
    />
  );
}
