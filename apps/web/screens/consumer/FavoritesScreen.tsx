"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { AppNav } from "../../lib/appNav";
import { assetUrl, type FavoriteStore } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { ColoredHeader, EmptyState, Gap, Scroll } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

/** B11 Favorit. Tab content: header + scrolling list, no Scaffold of its own. */
export function FavoritesScreen() {
  const state = useAppState();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const favorites = state.favoriteStores;
  const error = state.favoritesError;
  const retry = () => void state.loadFavorites();

  const removeFavorite = async (favorite: FavoriteStore) => {
    const id = favorite.merchant.id;
    await state.toggleFavorite(id);
    if (mounted.current) snack("Dihapus dari favorit");
  };

  let body: ReactNode;
  if (favorites.length === 0) {
    body =
      error !== null ? (
        <CenteredFill>
          <EmptyState
            icon="cloud_off_outlined"
            title="Favorit belum dapat dimuat"
            message={error}
            action={
              <div style={{ width: 190, maxWidth: "100%" }}>
                <PrimaryButton label="Coba lagi" onTap={retry} />
              </div>
            }
          />
        </CenteredFill>
      ) : (
        <CenteredFill>
          <EmptyState
            icon="favorite_border"
            title="Belum ada favorit"
            message="Simpan toko favoritmu agar mudah ditemukan dan dapat info bag baru."
          />
        </CenteredFill>
      );
  } else {
    body = (
      <Scroll style={{ padding: "16px 20px" }}>
        {error !== null ? (
          <>
            <ErrorBanner message={error} onRetry={retry} />
            <Gap h={14} />
          </>
        ) : null}
        {favorites.map((favorite) => (
          <Fragment key={favorite.merchant.id}>
            <FavoriteCard favorite={favorite} onRemove={() => void removeFavorite(favorite)} />
            <Gap h={14} />
          </Fragment>
        ))}
      </Scroll>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <ColoredHeader background={C.white} bottomPadding={14}>
        <h1 style={display(24, { weight: 800, color: C.ink })}>Favorit</h1>
        <Gap h={3} />
        <p style={ui(13, { color: C.body })}>Kami kabari kalau ada bag baru dari toko ini.</p>
      </ColoredHeader>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>{body}</div>
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "8px 8px 8px 14px",
        background: C.dangerBg,
        borderRadius: 13,
      }}
    >
      <Icon name="error_outline" size={18} color={C.danger} />
      <Gap w={9} />
      <span style={{ flex: 1, minWidth: 0, ...ui(12.5, { color: C.danger }) }}>{message}</span>
      <TextButton label="Coba lagi" onTap={onRetry} />
    </div>
  );
}

function FavoriteCard({ favorite, onRemove }: { favorite: FavoriteStore; onRemove: () => void }) {
  const merchant = favorite.merchant;
  return (
    <div
      style={{
        position: "relative",
        background: C.white,
        borderRadius: 18,
        border: `1px solid ${C.border}`,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        className="sb-tap"
        onClick={() => AppNav.toStoreProfile(merchant)}
        style={{ width: "100%", display: "flex", alignItems: "stretch", textAlign: "left" }}
      >
        {/* IntrinsicHeight: the row is as tall as the text or the cover's aspect height. */}
        <span style={{ position: "relative", display: "block", width: 96, flex: "none" }}>
          <IntrinsicImageHeight path={merchant.coverImage} />
          <FoodImage path={merchant.coverImage} style={{ position: "absolute", inset: 0 }} />
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            padding: 13,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
          }}
        >
          <span style={ui(14, { weight: 700, color: C.ink })}>{merchant.name}</span>
          <span style={{ ...ui(12, { color: C.body }), marginTop: 3 }}>
            {`★ ${merchant.rating.toFixed(1)} · ${merchant.distance}`}
          </span>
          <span style={{ display: "flex", marginTop: 8 }}>
            {favorite.soldOut ? (
              <StatusBadge.neutral text={favorite.availability} />
            ) : (
              <StatusBadge.available text={favorite.availability} />
            )}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="sb-tap"
        aria-label="Favorit"
        aria-pressed
        onClick={onRemove}
        style={{ position: "absolute", top: 12, right: 12, display: "flex" }}
      >
        <Icon name="favorite" size={20} color={C.terracotta} />
      </button>
    </div>
  );
}

/**
 * An invisible, in-flow copy of the cover. Flutter's `IntrinsicHeight` sizes
 * the row by the loaded image's aspect ratio at 96px wide (nothing before it
 * loads or when it fails), and the visible cover then fills that height.
 */
function IntrinsicImageHeight({ path }: { path: string }) {
  const src = assetUrl(path);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (failedSrc === src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailedSrc(src)}
      style={{ display: "block", width: "100%", height: "auto", visibility: "hidden" }}
    />
  );
}

/** An `EmptyState` placed directly in an `Expanded`: centred, scrolls if it cannot fit. */
function CenteredFill({ children }: { children: ReactNode }) {
  return (
    <div className="sb-scroll" style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ margin: "auto 0" }}>{children}</div>
    </div>
  );
}
