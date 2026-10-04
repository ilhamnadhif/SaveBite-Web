"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { formatRupiah, type MerchantBag } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { EmptyState, Gap, ProgressBar, Screen, Scroll, Spinner, TabSwitch, safeTop } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { confirmDialog, snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

/** Bags without an id still need a stable busy key (Dart `identityHashCode`). */
const bagIdentities = new WeakMap<MerchantBag, string>();
let bagIdentitySequence = 0;

function bagKey(bag: MerchantBag): string {
  if (bag.id !== "") return bag.id;
  let key = bagIdentities.get(bag);
  if (key === undefined) {
    key = `identity:${++bagIdentitySequence}`;
    bagIdentities.set(bag, key);
  }
  return key;
}

/** True while a bag can be (re)activated: stock left and pickup not over. */
function canActivateBag(bag: MerchantBag): boolean {
  return bag.quantityLeft > 0 && (bag.pickupEndsAt === null || bag.pickupEndsAt.getTime() > Date.now());
}

/**
 * C7 Kelola Bag — edit, deactivate, duplicate (tab 1 of the merchant shell):
 * header + scrolling list + bottom bar, without a bottom navigation.
 */
export function ManageBagsScreen() {
  const state = useAppState();
  const [tab, setTab] = useState(0);
  const [busyBagIds, setBusyBagIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyRef = useRef(new Set<string>());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const isBusy = (bag: MerchantBag) => busyBagIds.has(bagKey(bag));

  const runBagAction = async (
    bag: MerchantBag,
    { action, successMessage, errorMessage }: { action: () => Promise<void>; successMessage: string; errorMessage: string },
  ) => {
    const key = bagKey(bag);
    if (busyRef.current.has(key)) return;
    busyRef.current.add(key);
    setBusyBagIds(new Set(busyRef.current));
    try {
      await action();
      if (!alive.current) return;
      snack(successMessage);
    } catch {
      if (!alive.current) return;
      snack(errorMessage, "error_outline");
    } finally {
      if (alive.current) {
        busyRef.current.delete(key);
        setBusyBagIds(new Set(busyRef.current));
      }
    }
  };

  const setActive = async (bag: MerchantBag, active: boolean) => {
    if (bag.active === active) return;
    await runBagAction(bag, {
      action: () => appState.toggleBagActive(bag),
      successMessage: active ? "Bag diaktifkan" : "Bag dinonaktifkan",
      errorMessage: active ? "Bag gagal diaktifkan. Coba lagi." : "Bag gagal dinonaktifkan. Coba lagi.",
    });
  };

  const activate = (bag: MerchantBag) => setActive(bag, true);

  const onTogglePill = async (bag: MerchantBag) => {
    if (busyRef.current.has(bagKey(bag))) return;
    if (bag.active) {
      const ok = await confirmDialog({
        title: "Nonaktifkan bag?",
        message: "Bag tidak akan tampil ke pembeli.",
        confirmLabel: "Nonaktifkan",
        destructive: true,
      });
      if (!alive.current || !ok) return;
      await setActive(bag, false);
    } else {
      await activate(bag);
    }
  };

  const duplicate = (bag: MerchantBag) =>
    runBagAction(bag, {
      action: () => appState.duplicateBag(bag),
      successMessage: "Bag dijadwalkan untuk besok",
      errorMessage: "Bag gagal diduplikat. Coba lagi.",
    });

  const bags = tab === 0 ? state.activeBags : state.inactiveBags;

  return (
    <Screen background={C.cream}>
      <div
        style={{
          flex: "none",
          width: "100%",
          paddingTop: safeTop(14),
          paddingRight: 20,
          paddingBottom: 12,
          paddingLeft: 20,
          background: C.white,
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <h1 style={display(24, { weight: 800 })}>Bag saya</h1>
        <Gap h={14} />
        <TabSwitch
          tabs={["Aktif", "Nonaktif"]}
          index={tab}
          onTap={setTab}
          activeColor={C.brown}
          underlineColor={C.terracotta}
        />
      </div>
      {bags.length === 0 ? (
        <Scroll style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ margin: "auto 0" }}>
            {tab === 0 ? (
              <EmptyState
                icon="shopping_bag_outlined"
                title="Belum ada bag aktif"
                message="Buat Surprise Bag untuk mulai berjualan."
              />
            ) : (
              <EmptyState
                icon="inventory_2_outlined"
                title="Tidak ada bag nonaktif"
                message="Bag yang kamu nonaktifkan akan muncul di sini."
              />
            )}
          </div>
        </Scroll>
      ) : (
        <Scroll style={{ padding: "16px 20px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bags.map((bag) => {
              const busy = isBusy(bag);
              return tab === 0 ? (
                <ActiveCard
                  key={bagKey(bag)}
                  bag={bag}
                  busy={busy}
                  onToggle={() => void onTogglePill(bag)}
                  onDuplicate={() => void duplicate(bag)}
                />
              ) : (
                <InactiveCard
                  key={bagKey(bag)}
                  bag={bag}
                  busy={busy}
                  onToggle={() => void onTogglePill(bag)}
                  onActivate={() => void activate(bag)}
                  onDuplicate={() => void duplicate(bag)}
                />
              );
            })}
          </div>
        </Scroll>
      )}
      <div style={{ flex: "none", padding: "14px 20px 30px", background: C.white, borderTop: `1px solid ${C.border}` }}>
        <PrimaryButton
          merchant
          label="Buat Surprise Bag"
          icon={<Icon name="add" color={C.white} size={20} />}
          onTap={() => AppNav.toCreateBag()}
        />
      </div>
    </Screen>
  );
}

// ───────────── Aktif ─────────────

function ActiveCard({
  bag,
  busy,
  onToggle,
  onDuplicate,
}: {
  bag: MerchantBag;
  busy: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
}) {
  const fraction = bag.total === 0 ? 0 : Math.min(1, Math.max(0, bag.sold / bag.total));
  return (
    <BagCardFrame>
      <div style={{ display: "flex", alignItems: "flex-start", padding: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: 13, overflow: "hidden", flex: "none" }}>
          <FoodImage path={bag.image} width={64} height={64} />
        </div>
        <Gap w={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ ...ui(14, { weight: 700, color: C.ink }), flex: 1, minWidth: 0 }}>{bag.title}</div>
            <Gap w={8} />
            <TogglePill bag={bag} busy={busy} onToggle={onToggle} />
          </div>
          <Gap h={5} />
          <div style={ui(12, { color: C.body })}>{`${formatRupiah(bag.salePrice)} · ambil ${bag.pickupWindow}`}</div>
          <Gap h={8} />
          <ProgressBar fraction={fraction} height={6} />
          <Gap h={5} />
          <div style={ui(11.5, { color: C.muted })}>{`${bag.sold} dari ${bag.total} terjual`}</div>
        </div>
      </div>
      <ActionsRow
        left={<ActionCell label="Edit" color={C.body} onTap={busy ? null : () => AppNav.toEditBag(bag)} />}
        right={
          <ActionCell label="Duplikat besok" color={C.terracotta} withCopyIcon busy={busy} onTap={busy ? null : onDuplicate} />
        }
      />
    </BagCardFrame>
  );
}

// ───────────── Nonaktif ─────────────

function InactiveCard({
  bag,
  busy,
  onToggle,
  onActivate,
  onDuplicate,
}: {
  bag: MerchantBag;
  busy: boolean;
  onToggle: () => void;
  onActivate: () => void;
  onDuplicate: () => void;
}) {
  const canActivate = canActivateBag(bag);
  return (
    <BagCardFrame opacity={0.92}>
      <div style={{ display: "flex", alignItems: "flex-start", padding: 14 }}>
        <div style={{ width: 64, height: 64, borderRadius: 13, overflow: "hidden", flex: "none" }}>
          <FoodImage path={bag.image} width={64} height={64} saturation={0.5} />
        </div>
        <Gap w={12} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={{ ...ui(14, { weight: 700, color: C.ink }), flex: 1, minWidth: 0 }}>{bag.title}</div>
            <Gap w={8} />
            <TogglePill bag={bag} busy={busy} onToggle={onToggle} />
          </div>
          <Gap h={5} />
          <div style={ui(12, { color: C.body })}>{`${formatRupiah(bag.salePrice)} · nonaktif`}</div>
          {bag.statusNote !== null ? (
            <>
              <Gap h={6} />
              <div style={{ display: "flex" }}>
                <StatusBadge.neutral text={bag.statusNote} />
              </div>
            </>
          ) : null}
        </div>
      </div>
      <ActionsRow
        left={
          <ActionCell
            label={canActivate ? "Aktifkan" : "Edit stok/jadwal"}
            color={C.body}
            busy={busy}
            onTap={busy ? null : canActivate ? onActivate : () => AppNav.toEditBag(bag)}
          />
        }
        right={
          <ActionCell label="Duplikat besok" color={C.terracotta} withCopyIcon busy={busy} onTap={busy ? null : onDuplicate} />
        }
      />
    </BagCardFrame>
  );
}

// ───────────── Bagian bersama ─────────────

function BagCardFrame({ children, opacity }: { children: ReactNode; opacity?: number }) {
  return (
    <div
      style={{
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
        opacity,
      }}
    >
      {children}
    </div>
  );
}

function TogglePill({ bag, busy, onToggle }: { bag: MerchantBag; busy: boolean; onToggle: () => void }) {
  const on = bag.active;
  const canToggle = on || canActivateBag(bag);
  return (
    <button
      type="button"
      role="switch"
      className="sb-tap"
      aria-checked={on}
      aria-label={on ? `Nonaktifkan ${bag.title}` : `Aktifkan ${bag.title}`}
      aria-busy={busy || undefined}
      disabled={busy || !canToggle}
      onClick={onToggle}
      style={{
        position: "relative",
        width: 40,
        height: 23,
        flex: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: on ? C.greenBright : C.handle,
        borderRadius: 12,
      }}
    >
      {busy ? (
        <Spinner size={13} strokeWidth={2} color={C.white} />
      ) : (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 2.5,
            left: on ? undefined : 2.5,
            right: on ? 2.5 : undefined,
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: C.white,
          }}
        />
      )}
    </button>
  );
}

function ActionsRow({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: "flex", borderTop: `1px solid ${C.divider}` }}>
      <div style={{ flex: 1, minWidth: 0, display: "flex", borderRight: `1px solid ${C.divider}` }}>{left}</div>
      <div style={{ flex: 1, minWidth: 0, display: "flex" }}>{right}</div>
    </div>
  );
}

function ActionCell({
  label,
  color,
  onTap,
  withCopyIcon = false,
  busy = false,
}: {
  label: string;
  color: string;
  onTap: (() => void) | null;
  withCopyIcon?: boolean;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      className="sb-tap"
      disabled={!onTap}
      aria-busy={busy || undefined}
      onClick={onTap ?? undefined}
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 12,
        opacity: !onTap && !busy ? 0.5 : undefined,
      }}
    >
      {busy ? (
        <Spinner size={15} strokeWidth={2} color={color} />
      ) : withCopyIcon ? (
        <>
          <Icon name="copy_outlined" size={15} color={color} />
          <Gap w={6} />
        </>
      ) : null}
      {busy ? <Gap w={6} /> : null}
      <span style={ui(13, { weight: 700, color })}>{label}</span>
    </button>
  );
}
