"use client";

import { useState } from "react";
import { appState } from "../../lib/appState";
import type { MerchantOrdersTab } from "../../lib/notificationRoute";
import { paths } from "../../lib/routes";
import { MERCHANT_NAV_ITEMS } from "../../ui/bottomNav";
import { C } from "../../ui/theme";
import { ShellFrame } from "../ShellFrame";
import { BalanceScreen } from "./BalanceScreen";
import { DashboardScreen } from "./DashboardScreen";
import { IncomingOrdersScreen } from "./IncomingOrdersScreen";
import { ManageBagsScreen } from "./ManageBagsScreen";
import { MerchantProfileScreen } from "./MerchantProfileScreen";

/**
 * Merchant workspace: Dashboard, Bag, Pesanan, Saldo, Profil. Initial data
 * loads in parallel; order, transaction, and notification changes arrive
 * through the AppState subscriptions.
 */
export function MerchantShell({
  initialIndex = 0,
  initialOrdersTab = "active",
  referencedOrderId = null,
}: {
  initialIndex?: number;
  initialOrdersTab?: MerchantOrdersTab;
  referencedOrderId?: string | null;
}) {
  const [index, setIndex] = useState(Math.max(0, Math.min(4, initialIndex)));

  const onSelect = (tab: number) => {
    switch (tab) {
      case 0:
      case 1:
      case 2:
        void appState.loadMerchantData();
        break;
      case 3:
        void appState.loadBalance();
        break;
      case 4:
        void appState.loadStore();
        break;
    }
  };

  return (
    <ShellFrame
      index={index}
      setIndex={setIndex}
      items={MERCHANT_NAV_ITEMS}
      activeColor={C.brown}
      tabUrl={(tab) => paths.merchantTab(tab)}
      onSelect={onSelect}
      reloadAll={() =>
        Promise.all([
          appState.loadStore(),
          appState.loadMerchantData(),
          appState.loadMerchantReviews(),
          appState.loadBalance(),
          appState.loadNotifications(),
        ])
      }
      tabs={(tab) => {
        switch (tab) {
          case 0:
            return <DashboardScreen />;
          case 1:
            return <ManageBagsScreen />;
          case 2:
            return <IncomingOrdersScreen initialTab={initialOrdersTab} referencedOrderId={referencedOrderId} />;
          case 3:
            return <BalanceScreen />;
          default:
            return <MerchantProfileScreen />;
        }
      }}
    />
  );
}
