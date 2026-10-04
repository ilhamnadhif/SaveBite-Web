"use client";

import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { EMPTY_FILTER, isFilterEmpty, type BagFilter } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { BagCompactCard, BagHeroCard } from "../../ui/bagCards";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { ColoredHeader, CountBadge, EmptyState, Gap, RefreshScroll, Scroll, SectionHeading, Spinner } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { C, clamp, ellipsis, ui } from "../../ui/theme";
import { useShellScope } from "../ShellFrame";
import { showConsumerLocationPicker } from "./LocationPickerSheet";

/** `SampleData.categories`: the category chips above the bag list. */
const CATEGORIES = ["Semua", "Bakery", "Kafe", "Resto", "Supermarket", "Sehat"] as const;

/** Consumer discovery home, driven by the chosen location and the active filter. */
export function HomeScreen() {
  const state = useAppState();
  const shell = useShellScope();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = () => state.loadConsumerHome();

  const showFilters = async () => {
    const filter = await AppNav.showFilter();
    if (!mounted.current || !filter) return;
    await state.setBagFilter(filter);
  };

  const selectCategory = (category: string) => {
    const categories = category === "Semua" ? new Set<string>() : new Set([category]);
    void state.setBagFilter({ ...state.currentFilter, categories });
  };

  const showLocationPicker = async () => {
    await showConsumerLocationPicker();
  };

  const content = (): ReactNode => {
    const hasData = state.nearbyBags.some((bag) => !bag.soldOut);
    if (!state.hasValidUserLocation) {
      return <LocationRequiredState onPickArea={() => void showLocationPicker()} />;
    }
    if (state.isLoadingConsumer && !hasData) {
      return <LoadingState />;
    }
    if (state.consumerError !== null && !hasData) {
      return (
        <ErrorState
          message={state.consumerError}
          onRetry={() => void refresh()}
          onChangeLocation={() => void showLocationPicker()}
        />
      );
    }
    if (!hasData) {
      return (
        <EmptyHomeState
          filter={state.currentFilter}
          onRefresh={refresh}
          onResetFilter={() => void state.setBagFilter(EMPTY_FILTER)}
          onChangeArea={() => void showLocationPicker()}
        />
      );
    }
    return bagList();
  };

  const bagList = () => {
    const bags = state.nearbyBags
      .filter((bag) => !bag.soldOut)
      .sort((a, b) => {
        const aEnd = a.pickupEndsAt;
        const bEnd = b.pickupEndsAt;
        if (aEnd === null && bEnd === null) return 0;
        if (aEnd === null) return 1;
        if (bEnd === null) return -1;
        return aEnd.getTime() - bEnd.getTime();
      });
    const first = bags[0];
    const filter = state.currentFilter;

    return (
      <RefreshScroll color={C.greenBright} onRefresh={refresh} style={{ padding: "16px 20px 24px" }}>
        {state.consumerError !== null ? (
          <>
            <InlineError message={state.consumerError} onRetry={() => void refresh()} />
            <Gap h={14} />
          </>
        ) : null}
        <div className="sb-hscroll" style={{ display: "flex", gap: 8 }}>
          {CATEGORIES.map((category) => (
            <SelectChip
              key={category}
              label={category}
              selected={category === "Semua" ? filter.categories.size === 0 : filter.categories.has(category)}
              onTap={() => selectCategory(category)}
            />
          ))}
        </div>
        <Gap h={18} />
        <SectionHeading
          title="Segera tutup"
          leadingIcon={<Icon name="local_fire_department" size={16} color={C.terracotta} />}
          actionLabel="Lihat peta"
          onAction={() => shell?.selectTab(1)}
          fontSize={18}
        />
        <Gap h={12} />
        <BagHeroCard bag={first} onTap={() => AppNav.toDetail(first)} />
        {bags.slice(1).map((bag) => (
          <Fragment key={bag.id}>
            <Gap h={14} />
            <BagCompactCard bag={bag} onTap={() => AppNav.toDetail(bag)} />
          </Fragment>
        ))}
      </RefreshScroll>
    );
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ColoredHeader background={C.green}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <LocationPickerButton location={state.location} onTap={() => void showLocationPicker()} />
          </div>
          <Gap w={8} />
          <BellButton unreadCount={state.unreadCount} />
        </div>
        <Gap h={14} />
        <SearchBar filterCount={activeFilterCount(state.currentFilter)} onShowFilters={() => void showFilters()} />
      </ColoredHeader>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{content()}</div>
    </div>
  );
}

function activeFilterCount(filter: BagFilter): number {
  let count = 0;
  if (filter.categories.size > 0) count++;
  if (filter.maxDistanceKm !== null) count++;
  if (filter.minPrice !== null || filter.maxPrice !== null) count++;
  if (filter.pickupAfter !== null || filter.pickupBefore !== null) count++;
  return count;
}

function LocationPickerButton({ location, onTap }: { location: string; onTap: () => void }) {
  return (
    <button
      type="button"
      className="sb-ink"
      aria-label={`Lokasi kamu, ${location}. Ketuk untuk mengubah.`}
      onClick={onTap}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "3px 0",
        borderRadius: 10,
        textAlign: "left",
      }}
    >
      <span style={ui(12, { weight: 600, color: C.greenMuted })}>Lokasi kamu</span>
      <span style={{ width: "100%", display: "flex", alignItems: "center", marginTop: 2 }}>
        <Icon name="location_on" size={16} color={C.amber} />
        <span
          style={{ ...ui(16, { weight: 700, color: C.cream }), ...ellipsis, flex: "0 1 auto", marginLeft: 5 }}
        >
          {location}
        </span>
        <Icon name="arrow_drop_down" size={20} color={C.cream} />
      </span>
    </button>
  );
}

function BellButton({ unreadCount }: { unreadCount: number }) {
  return (
    <button
      type="button"
      className="sb-tap"
      aria-label={unreadCount > 0 ? `${unreadCount} notifikasi belum dibaca` : "Notifikasi"}
      onClick={() => AppNav.toNotifications()}
      style={{
        position: "relative",
        width: 42,
        height: 42,
        flex: "none",
        borderRadius: "50%",
        background: C.greenDark,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="notifications_none_rounded" size={21} color={C.amber} />
      {unreadCount > 0 ? (
        <span
          aria-hidden
          style={{
            position: "absolute",
            top: 9,
            right: 9,
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: C.terracotta,
            border: `1.5px solid ${C.greenDark}`,
          }}
        />
      ) : null}
    </button>
  );
}

/**
 * The white bar opens search; the filter button inside it opens the filter
 * sheet. The bar's tap target sits underneath so the two buttons never nest.
 */
function SearchBar({ filterCount, onShowFilters }: { filterCount: number; onShowFilters: () => void }) {
  return (
    <div style={{ position: "relative", height: 48, background: C.white, borderRadius: 14 }}>
      <button
        type="button"
        className="sb-ink"
        aria-label="Cari toko atau makanan…"
        onClick={() => AppNav.toSearch()}
        style={{ position: "absolute", inset: 0, borderRadius: 14 }}
      />
      <div style={{ position: "relative", height: "100%", display: "flex", alignItems: "center", pointerEvents: "none" }}>
        <Gap w={14} />
        <Icon name="search" size={19} color={C.muted} />
        <Gap w={10} />
        <span aria-hidden style={{ flex: 1, minWidth: 0, ...ui(14.5, { color: C.mutedAlt }) }}>
          Cari toko atau makanan…
        </span>
        <span style={{ display: "flex", pointerEvents: "auto" }}>
          <button
            type="button"
            className="sb-ink"
            title="Filter"
            aria-label={filterCount === 0 ? "Buka filter" : `Buka filter, ${filterCount} filter aktif`}
            onClick={onShowFilters}
            style={{
              width: 48,
              height: 48,
              flex: "none",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span style={{ position: "relative", display: "flex" }}>
              <Icon name="tune" size={19} color={C.green} />
              {filterCount > 0 ? <CountBadge count={filterCount} /> : null}
            </span>
          </button>
        </span>
        <Gap w={3} />
      </div>
    </div>
  );
}

/** `SizedBox(width:)` around an empty-state button; shrinks on narrow screens. */
function ActionBox({ width, children }: { width: number; children: ReactNode }) {
  return <div style={{ width, maxWidth: "100%" }}>{children}</div>;
}

/** An `EmptyState` placed directly in an `Expanded`: centred, scrolls if it cannot fit. */
function CenteredFill({ children }: { children: ReactNode }) {
  return (
    <div className="sb-scroll" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ margin: "auto 0" }}>{children}</div>
    </div>
  );
}

function LocationRequiredState({ onPickArea }: { onPickArea: () => void }) {
  return (
    <Scroll>
      <div aria-hidden style={{ height: "12dvh" }} />
      <EmptyState
        icon="location_searching_rounded"
        title="Pilih area untuk melihat Surprise Bag"
        message="Atur lokasi agar SaveBite dapat menampilkan bag yang tersedia di sekitarmu."
        action={
          <ActionBox width={240}>
            <PrimaryButton label="Pilih area" height={50} onTap={onPickArea} />
          </ActionBox>
        }
      />
      <Gap h={32} />
    </Scroll>
  );
}

function EmptyHomeState({
  filter,
  onRefresh,
  onResetFilter,
  onChangeArea,
}: {
  filter: BagFilter;
  onRefresh: () => Promise<unknown>;
  onResetFilter: () => void;
  onChangeArea: () => void;
}) {
  const hasFilter = !isFilterEmpty(filter);
  return (
    <RefreshScroll color={C.greenBright} onRefresh={onRefresh}>
      <div aria-hidden style={{ height: "12dvh" }} />
      <EmptyState
        icon={hasFilter ? "filter_alt_off_outlined" : "remove_shopping_cart_outlined"}
        title={hasFilter ? "Tak ada bag yang cocok" : "Belum ada bag di sini"}
        message={
          hasFilter
            ? "Ubah atau reset filter untuk melihat lebih banyak pilihan."
            : "Toko di area ini belum merilis Surprise Bag. Coba lagi nanti atau pilih area lain."
        }
        action={
          <ActionBox width={240}>
            <PrimaryButton
              label={hasFilter ? "Atur ulang filter" : "Ubah area"}
              height={50}
              onTap={hasFilter ? onResetFilter : onChangeArea}
            />
          </ActionBox>
        }
        secondaryAction={<TextButton label="Muat ulang" icon="refresh" iconSize={18} onTap={() => void onRefresh()} />}
      />
      <Gap h={32} />
    </RefreshScroll>
  );
}

function LoadingState() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Memuat Surprise Bag di sekitar"
      style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}
    >
      <Spinner color={C.greenBright} />
      <Gap h={14} />
      {/* Unstyled Text: the theme's bodyMedium. */}
      <span style={ui(14, { weight: 400, letterSpacing: 0.25, height: 1.43 })}>Mencari bag di sekitarmu…</span>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
  onChangeLocation,
}: {
  message: string;
  onRetry: () => void;
  onChangeLocation: () => void;
}) {
  return (
    <CenteredFill>
      <EmptyState
        icon="cloud_off_outlined"
        title="Bag belum dapat dimuat"
        message={message}
        action={
          <ActionBox width={220}>
            <PrimaryButton label="Coba lagi" onTap={onRetry} height={50} />
          </ActionBox>
        }
        secondaryAction={<TextButton label="Ubah area" onTap={onChangeLocation} />}
      />
    </CenteredFill>
  );
}

function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 8px 10px 12px",
        background: C.dangerBg,
        borderRadius: 12,
      }}
    >
      <Icon name="info_outline" color={C.danger} size={19} />
      <Gap w={9} />
      <span style={{ flex: 1, ...ui(12.5, { color: C.danger }), ...clamp(2) }}>{message}</span>
      <TextButton label="Ulangi" onTap={onRetry} />
    </div>
  );
}

