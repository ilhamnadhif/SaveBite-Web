"use client";

import { Icon, type IconName } from "./Icon";
import { C, ui } from "./theme";

export type NavItem = { outlined: IconName; filled: IconName; label: string };

export const CONSUMER_NAV_ITEMS: readonly NavItem[] = [
  { outlined: "home_outlined", filled: "home_rounded", label: "Beranda" },
  { outlined: "map_outlined", filled: "map_rounded", label: "Peta" },
  { outlined: "shopping_bag_outlined", filled: "shopping_bag_rounded", label: "Pesanan" },
  { outlined: "favorite_border_rounded", filled: "favorite_rounded", label: "Favorit" },
  { outlined: "person_outline_rounded", filled: "person_rounded", label: "Profil" },
];

export const MERCHANT_NAV_ITEMS: readonly NavItem[] = [
  { outlined: "grid_view_outlined", filled: "grid_view_rounded", label: "Dashboard" },
  { outlined: "shopping_bag_outlined", filled: "shopping_bag_rounded", label: "Bag" },
  { outlined: "receipt_long_outlined", filled: "receipt_long_rounded", label: "Pesanan" },
  { outlined: "account_balance_wallet_outlined", filled: "account_balance_wallet_rounded", label: "Saldo" },
  { outlined: "person_outline_rounded", filled: "person_rounded", label: "Profil" },
];

/** Generic bottom navigation used by the consumer and merchant shells. */
export function AppBottomNav({
  items,
  currentIndex,
  onTap,
  activeColor = C.green,
}: {
  items: readonly NavItem[];
  currentIndex: number;
  onTap: (index: number) => void;
  activeColor?: string;
}) {
  return (
    <nav
      aria-label="Navigasi utama"
      style={{
        flex: "none",
        background: C.white,
        borderTop: `1px solid ${C.border}`,
        padding: "10px 8px",
        paddingBottom: "calc(12px + var(--safe-bottom))",
        display: "flex",
        justifyContent: "space-around",
      }}
    >
      {items.map((item, index) => {
        const active = index === currentIndex;
        const color = active ? activeColor : C.navInactive;
        return (
          <button
            key={item.label}
            type="button"
            className="sb-tap"
            aria-current={active ? "page" : undefined}
            onClick={() => onTap(index)}
            style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 56 }}
          >
            <Icon name={active ? item.filled : item.outlined} size={23} color={color} />
            <span style={ui(10.5, { weight: active ? 700 : 600, color })}>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
