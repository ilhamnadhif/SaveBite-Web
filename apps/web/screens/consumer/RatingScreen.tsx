"use client";

import { useEffect, useId, useRef, useState, type TouchEvent } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import type { OrderRecord } from "../../lib/models";
import { StoreAvatar } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { Screen, Scroll, SimpleHeader, Wrap, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { C, R, display, ui } from "../../ui/theme";

const TAGS = ["Porsi banyak", "Masih fresh", "Pelayanan ramah", "Sesuai deskripsi", "Pickup cepat"] as const;

/** `LengthLimitingTextInputFormatter(500)`. */
const MAX_COMMENT_LENGTH = 500;

/**
 * A review always belongs to one picked-up order. Returns `true` to the
 * caller (`AppNav.toRating`) once the review is sent.
 */
export function RatingScreen({ order }: { order: OrderRecord }) {
  const merchant = order.bag.merchant;
  const date = order.dateLabel;
  const [comment, setComment] = useState("");
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(() => new Set());
  const [rating, setRating] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const commentId = useId();
  const dismissKeyboardOnDrag = useKeyboardDismissOnDrag();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const toggleTag = (tag: string) => {
    if (submitting) return;
    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const changeComment = (value: string) => {
    if (characters(value).length <= MAX_COMMENT_LENGTH) {
      setComment(value);
      return;
    }
    // Already full: keep the old text, like the Flutter formatter.
    if (characters(comment).length === MAX_COMMENT_LENGTH) return;
    setComment(characters(value).slice(0, MAX_COMMENT_LENGTH).join(""));
  };

  const submit = async () => {
    if (submitting || rating === 0) return;
    unfocus();
    setSubmitting(true);
    try {
      await appState.submitReview(order, rating, [...selectedTags], comment.trim());
      if (!alive.current) return;
      snack("Terima kasih, ulasanmu terkirim");
      void AppNav.pop(true);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof BackendException) snack(error.message, "error_outline");
      else snack("Ulasan gagal dikirim. Periksa koneksi lalu coba lagi.", "error_outline");
    } finally {
      if (alive.current) setSubmitting(false);
    }
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Beri ulasan" background={C.cream} />
      <Scroll style={{ padding: "12px 24px 24px" }} {...dismissKeyboardOnDrag}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
          <StoreAvatar initial={merchant.initial} color={merchant.avatarColor} size={64} radius={18} />
          <h2 style={{ ...display(18, { weight: 700 }), marginTop: 14 }}>Bagaimana Surprise Bag-nya?</h2>
          <p style={{ ...ui(13.5, { color: C.body }), marginTop: 4 }}>{`${merchant.name} · ${date}`}</p>
        </div>
        <div
          role="group"
          aria-label={rating === 0 ? "Belum memilih rating" : `Rating ${rating} dari 5`}
          style={{ display: "flex", justifyContent: "center", gap: 7, marginTop: 26 }}
        >
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              className="sb-tap"
              aria-label={`${star} dari 5 bintang`}
              aria-pressed={star === rating}
              disabled={submitting}
              onClick={() => setRating(star)}
              style={{ display: "flex", padding: "4px 0", borderRadius: "50%" }}
            >
              <Icon
                name={star <= rating ? "star_rounded" : "star_outline_rounded"}
                size={38}
                color={star <= rating ? C.amber : C.handle}
              />
            </button>
          ))}
        </div>
        <p style={{ ...ui(13, { weight: 700, color: C.body }), marginTop: 25 }}>Apa yang paling kamu suka? (opsional)</p>
        <Wrap spacing={8} runSpacing={8} style={{ marginTop: 10 }}>
          {TAGS.map((tag) => (
            <SelectChip
              key={tag}
              label={tag}
              selected={selectedTags.has(tag)}
              onTap={submitting ? undefined : () => toggleTag(tag)}
              padding="8px 13px"
              fontSize={12.5}
            />
          ))}
        </Wrap>
        <label htmlFor={commentId} style={{ display: "block", ...ui(13, { weight: 700, color: C.body }), marginTop: 20 }}>
          Ceritakan pengalamanmu (opsional)
        </label>
        <div
          style={{
            marginTop: 8,
            background: C.white,
            borderRadius: R.input,
            border: `1.5px solid ${C.border}`,
            padding: "0 14px",
          }}
        >
          <textarea
            id={commentId}
            className="sb-input"
            rows={4}
            value={comment}
            disabled={submitting}
            autoCapitalize="sentences"
            placeholder="Makanan, porsi, atau proses pickup…"
            onChange={(event) => changeComment(event.target.value)}
            // M3 underline-less TextField: 8 px vertical content padding and
            // the inherited bodyLarge line height (1.5).
            style={{ ...ui(14, { color: C.ink, height: 1.5 }), padding: "8px 0", caretColor: C.greenBright }}
          />
        </div>
      </Scroll>
      <div
        style={{
          flex: "none",
          background: C.cream,
          borderTop: `1px solid ${C.border}`,
          padding: "14px 24px",
          paddingBottom: safeBottom(14),
        }}
      >
        <PrimaryButton
          label={submitting ? "Mengirim…" : "Kirim ulasan"}
          onTap={rating > 0 && !submitting ? () => void submit() : null}
        />
      </div>
    </Screen>
  );
}

/** Flutter's `characters` (grapheme clusters) for the length limit. */
function characters(value: string): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

/** `FocusScope.of(context).unfocus()`. */
function unfocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * `keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag`: a
 * scroll drag past the touch slop closes the keyboard.
 */
function useKeyboardDismissOnDrag() {
  const startY = useRef<number | null>(null);
  return {
    onTouchStart: (event: TouchEvent<HTMLDivElement>) => {
      startY.current = event.touches[0]?.clientY ?? null;
    },
    onTouchMove: (event: TouchEvent<HTMLDivElement>) => {
      const start = startY.current;
      const y = event.touches[0]?.clientY;
      if (start === null || y === undefined || Math.abs(y - start) < 18) return;
      startY.current = null;
      unfocus();
    },
  };
}
