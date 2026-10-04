"use client";

import { PrimaryButton } from "../../ui/buttons";
import { EmptyState, Screen } from "../../ui/common";

/** Shown for an unknown URL; the mobile app has no equivalent route. */
export function NotFoundScreen() {
  return (
    <Screen>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 0" }}>
        <EmptyState
          icon="search_off"
          title="Halaman tidak ditemukan"
          message="Alamat yang kamu buka tidak ada di SaveBite."
          action={
            <div style={{ width: "100%", maxWidth: 260 }}>
              <PrimaryButton
                label="Buka SaveBite"
                onTap={() => {
                  // A full load runs the normal startup routing from "/".
                  window.location.assign("/");
                }}
              />
            </div>
          }
        />
      </div>
    </Screen>
  );
}
