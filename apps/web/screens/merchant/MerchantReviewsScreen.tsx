"use client";

import { Fragment, useEffect } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { customerInitial, type MerchantReview } from "../../lib/models";
import { useAppState } from "../../lib/useAppState";
import { TextButton } from "../../ui/buttons";
import { AppCard, EmptyState, Gap, RefreshScroll, Screen, SimpleHeader, Spinner, Wrap } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { usePopGuard } from "../../ui/NavigatorView";
import { C, display, ellipsis, ui } from "../../ui/theme";

/**
 * Reviews only the owner of the merchant can read. Opened from a
 * notification as a new root (`rootEntry`), back goes to the merchant home
 * instead of trying to close the root route.
 */
export function MerchantReviewsScreen({ rootEntry }: { rootEntry: boolean }) {
  const state = useAppState();

  useEffect(() => {
    void appState.loadMerchantReviews();
  }, []);

  const back = () => {
    if (rootEntry) AppNav.toMerchantHome();
    else void AppNav.back();
  };

  // PopScope(canPop: !rootEntry, onPopInvoked: (didPop) => if (!didPop) _back()).
  usePopGuard(
    rootEntry
      ? () => {
          AppNav.toMerchantHome();
          return true;
        }
      : null,
  );

  const reviews = state.merchantReviews;
  const error = state.merchantReviewsError;
  const loading = state.isLoadingMerchantReviews;

  return (
    <Screen>
      <SimpleHeader title="Ulasan pelanggan" titleSize={22} onBack={back} />
      <RefreshScroll
        color={C.terracotta}
        onRefresh={() => appState.loadMerchantReviews()}
        style={{ padding: "18px 20px 28px" }}
      >
        {reviews.length > 0 ? (
          <>
            <Summary reviews={reviews} loading={loading} />
            <Gap h={18} />
          </>
        ) : null}
        {error !== null ? (
          <>
            <ErrorCard message={error} />
            <Gap h={14} />
          </>
        ) : null}
        {loading && reviews.length === 0 ? (
          <div style={{ paddingTop: 96, display: "flex", justifyContent: "center" }}>
            <Spinner color={C.terracotta} label="Memuat" />
          </div>
        ) : reviews.length === 0 ? (
          <div style={{ paddingTop: 72 }}>
            <EmptyState
              icon="reviews_outlined"
              title="Belum ada ulasan"
              message="Rating, tag, dan komentar pelanggan akan muncul setelah pesanan selesai."
            />
          </div>
        ) : (
          reviews.map((review, index) => (
            <Fragment key={review.id || `review-${index}`}>
              {index > 0 ? <Gap h={12} /> : null}
              <ReviewCard review={review} />
            </Fragment>
          ))
        )}
      </RefreshScroll>
    </Screen>
  );
}

function Summary({ reviews, loading }: { reviews: readonly MerchantReview[]; loading: boolean }) {
  const average = reviews.reduce((sum, item) => sum + item.rating, 0) / reviews.length;
  return (
    <AppCard>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div
          style={{
            width: 54,
            height: 54,
            flex: "none",
            background: C.ratingBg,
            borderRadius: 15,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon name="star_rounded" size={31} color={C.amber} />
        </div>
        <div style={{ width: 13, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={display(24, { weight: 800, color: C.ink })}>{average.toFixed(1)}</div>
          <div style={ui(12.5, { color: C.muted })}>{`${reviews.length} ulasan terbaru`}</div>
        </div>
        {loading ? <Spinner size={18} strokeWidth={2} /> : null}
      </div>
    </AppCard>
  );
}

function ReviewCard({ review }: { review: MerchantReview }) {
  const hasComment = review.comment.trim() !== "";
  return (
    <AppCard>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <div
          style={{
            width: 42,
            height: 42,
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: C.greenSoftBg,
            borderRadius: 12,
            ...ui(13, { weight: 800, color: C.greenAccent }),
          }}
        >
          {customerInitial(review)}
        </div>
        <div style={{ width: 11, flex: "none" }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...ui(14, { weight: 700, color: C.ink }), ...ellipsis }}>{review.customerName}</div>
          <div style={{ ...ui(11.5, { color: C.muted }), marginTop: 3 }}>
            {`${review.orderReference} · ${dateLabel(review.createdAt)}`}
          </div>
        </div>
        <div style={{ width: 8, flex: "none" }} />
        <Rating rating={review.rating} />
      </div>
      {review.tags.length > 0 ? (
        <>
          <Gap h={13} />
          <Wrap spacing={7} runSpacing={7}>
            {review.tags.map((tag, index) => (
              <span
                key={`${tag}-${index}`}
                style={{
                  padding: "6px 9px",
                  background: C.terracottaSoftBg,
                  borderRadius: 20,
                  ...ui(11, { color: C.brown }),
                  // AppText.ui(11, weight: 650): the variable font renders wght 650.
                  fontWeight: 650,
                }}
              >
                {tag}
              </span>
            ))}
          </Wrap>
        </>
      ) : null}
      <Gap h={12} />
      <p
        style={{
          ...ui(13, { color: hasComment ? C.body : C.muted, height: 1.5 }),
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
      >
        {hasComment ? review.comment : "Tidak ada komentar tertulis."}
      </p>
    </AppCard>
  );
}

function Rating({ rating }: { rating: number }) {
  return (
    <div
      style={{
        flex: "none",
        display: "flex",
        alignItems: "center",
        padding: "5px 8px",
        background: C.ratingBg,
        borderRadius: 10,
      }}
    >
      <Icon name="star_rounded" size={16} color={C.amber} />
      <div style={{ width: 3, flex: "none" }} />
      <span style={ui(12, { weight: 800, color: C.brown })}>{rating}</span>
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <div
      role="alert"
      style={{ display: "flex", alignItems: "center", padding: 13, background: C.dangerTintBg, borderRadius: 14 }}
    >
      <Icon name="error_outline_rounded" color={C.danger} />
      <div style={{ width: 9, flex: "none" }} />
      <span style={{ ...ui(12.5, { color: C.danger }), flex: 1, minWidth: 0 }}>{message}</span>
      <TextButton label="Coba lagi" onTap={() => void appState.loadMerchantReviews()} />
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function dateLabel(value: Date | null): string {
  if (!value) return "Tanggal tidak tersedia";
  return `${value.getDate()} ${MONTHS[value.getMonth()]} ${value.getFullYear()}`;
}
