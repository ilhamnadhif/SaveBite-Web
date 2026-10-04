"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import type { AppNotification, NotifType } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { TextButton } from "../../ui/buttons";
import { CenteredSpinner, EmptyState, Gap, RefreshScroll, Screen, SimpleHeader } from "../../ui/common";
import { Icon, type IconName } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, ui } from "../../ui/theme";

/**
 * In-app notification centre. Realtime is handled by `appState`; this screen
 * owns the initial load, retry, empty state, and where a tapped card leads.
 */
export function NotificationsScreen() {
  const state = useAppState();
  const [loading, setLoading] = useState(() => appState.notifications.length === 0);
  const [markingRead, setMarkingRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      await appState.loadNotifications();
      if (!alive.current) return;
      setError(appState.notificationsError);
    } catch {
      if (!alive.current) return;
      setError("Notifikasi gagal dimuat. Periksa koneksi lalu coba lagi.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markAllRead = async () => {
    if (markingRead || appState.unreadCount === 0) return;
    setMarkingRead(true);
    try {
      await appState.markAllNotificationsRead();
      if (!alive.current) return;
      snack("Semua notifikasi ditandai dibaca");
    } catch {
      if (!alive.current) return;
      snack("Status notifikasi gagal diperbarui. Coba lagi.", "error_outline");
    } finally {
      if (alive.current) setMarkingRead(false);
    }
  };

  const notifications = state.notifications;
  const groups = new Map<string, AppNotification[]>();
  for (const notification of notifications) {
    const group = groups.get(notification.group);
    if (group) group.push(notification);
    else groups.set(notification.group, [notification]);
  }
  const isEmpty = notifications.length === 0;
  const shownError = error ?? state.notificationsError;

  return (
    <Screen background={C.cream}>
      <SimpleHeader
        title="Notifikasi"
        titleSize={24}
        trailing={
          state.unreadCount === 0 ? undefined : (
            <TextButton
              label={
                <span style={ui(12.5, { weight: 700, color: C.greenBright })}>
                  {markingRead ? "Memproses…" : "Tandai dibaca"}
                </span>
              }
              onTap={markingRead ? null : () => void markAllRead()}
            />
          )
        }
      />
      {loading && isEmpty ? (
        <CenteredSpinner />
      ) : (
        <RefreshScroll onRefresh={load} style={{ padding: "12px 16px 24px" }}>
          {shownError !== null ? (
            <>
              <NotificationError message={shownError} onRetry={() => void load()} />
              <Gap h={14} />
            </>
          ) : null}
          {isEmpty ? (
            <div style={{ paddingTop: 84 }}>
              <EmptyState
                icon="notifications_none_rounded"
                title="Belum ada notifikasi"
                message="Kabar pesanan dan Surprise Bag terbaru akan muncul di sini."
              />
            </div>
          ) : (
            [...groups.entries()].map(([group, items]) => (
              <Fragment key={group}>
                <h2 style={{ ...ui(12, { weight: 700, color: C.muted, letterSpacing: 0.5 }), padding: "8px 6px" }}>
                  {group.toUpperCase()}
                </h2>
                {items.map((notification) => (
                  <div key={notification.id} style={{ paddingBottom: 10 }}>
                    <NotificationCard notification={notification} onTap={() => AppNav.openNotification(notification)} />
                  </div>
                ))}
              </Fragment>
            ))
          )}
        </RefreshScroll>
      )}
    </Screen>
  );
}

function NotificationCard({ notification, onTap }: { notification: AppNotification; onTap: () => void }) {
  const unread = notification.unread;
  return (
    <button
      type="button"
      className="sb-ink"
      onClick={onTap}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "flex-start",
        textAlign: "left",
        padding: 13,
        borderRadius: 16,
        background: unread ? C.greenSoftBg : C.white,
        border: `1px solid ${unread ? C.greenSoftBorder : C.border}`,
        opacity: unread ? 1 : 0.88,
      }}
    >
      <IconBox type={notification.type} />
      <span style={{ display: "block", flex: 1, minWidth: 0, marginLeft: 12, overflowWrap: "break-word" }}>
        <span style={{ display: "block", ...ui(13.5, { weight: 700, color: C.ink }) }}>{notification.title}</span>
        <span style={{ display: "block", ...ui(12.5, { color: C.body, height: 1.45 }), marginTop: 2 }}>{notification.body}</span>
        <span style={{ display: "block", ...ui(11.5, { color: C.muted }), marginTop: 5 }}>{notification.time}</span>
      </span>
      {unread ? (
        <span
          role="img"
          aria-label="Belum dibaca"
          style={{ width: 8, height: 8, marginLeft: 8, borderRadius: "50%", background: C.greenBright, flex: "none" }}
        />
      ) : null}
    </button>
  );
}

const ICON_BOXES: Record<NotifType, { background: string; icon: IconName; color: string }> = {
  ready: { background: C.greenBright, icon: "check_rounded", color: C.white },
  newBag: { background: C.terracottaSoftBg, icon: "shopping_bag_outlined", color: C.terracotta },
  rating: { background: C.ratingBg, icon: "star_rounded", color: C.amber },
  payment: { background: C.greenSoftBg, icon: "check_circle_outline", color: C.greenAccent },
};

function IconBox({ type }: { type: NotifType }) {
  const box = ICON_BOXES[type];
  return (
    <span
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        background: box.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
      }}
    >
      <Icon name={box.icon} size={20} color={box.color} />
    </span>
  );
}

function NotificationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" style={{ display: "flex", alignItems: "center", padding: 13, background: C.dangerBg, borderRadius: 14 }}>
      <Icon name="error_outline" size={20} color={C.danger} />
      <span style={{ ...ui(12.5, { color: C.body, height: 1.4 }), flex: 1, minWidth: 0, marginLeft: 10 }}>{message}</span>
      <TextButton label="Coba lagi" onTap={onRetry} />
    </div>
  );
}

