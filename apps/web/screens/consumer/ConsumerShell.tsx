"use client";

import { useState } from "react";
import { appState } from "../../lib/appState";
import type { ConsumerOrdersTab } from "../../lib/notificationRoute";
import { paths } from "../../lib/routes";
import { CONSUMER_NAV_ITEMS } from "../../ui/bottomNav";
import { C } from "../../ui/theme";
import { ShellFrame } from "../ShellFrame";
import { FavoritesScreen } from "./FavoritesScreen";
import { HomeScreen } from "./HomeScreen";
import { MapScreen } from "./MapScreen";
import { OrdersScreen } from "./OrdersScreen";
import { ProfileScreen } from "./ProfileScreen";

/** Consumer workspace: Beranda, Peta, Pesanan, Favorit, Profil. */
export function ConsumerShell({
  initialIndex = 0,
  initialOrdersTab = "active",
  referencedOrderId = null,
}: {
  initialIndex?: number;
  initialOrdersTab?: ConsumerOrdersTab;
  referencedOrderId?: string | null;
}) {
  const [index, setIndex] = useState(initialIndex);

  const onSelect = (tab: number) => {
    switch (tab) {
      case 0:
      case 1:
        void appState.loadConsumerHome();
        break;
      case 2:
        void appState.loadOrders();
        break;
      case 3:
        void appState.loadFavorites();
        break;
      case 4:
        void appState.loadProfile();
        break;
    }
  };

  return (
    <ShellFrame
      index={index}
      setIndex={setIndex}
      items={CONSUMER_NAV_ITEMS}
      activeColor={C.green}
      tabUrl={(tab) => paths.consumerTab(tab)}
      onSelect={onSelect}
      reloadAll={() =>
        Promise.all([appState.loadConsumerHome(), appState.loadOrders(), appState.loadFavorites(), appState.loadNotifications()])
      }
      tabs={(tab) => {
        switch (tab) {
          case 0:
            return <HomeScreen />;
          case 1:
            return <MapScreen />;
          case 2:
            return <OrdersScreen initialTab={initialOrdersTab} referencedOrderId={referencedOrderId} />;
          case 3:
            return <FavoritesScreen />;
          default:
            return <ProfileScreen />;
        }
      }}
    />
  );
}
