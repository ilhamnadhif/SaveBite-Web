"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { BackendException } from "../../lib/backend/types";
import {
  COMPLAINT_CATEGORY_LABELS,
  MAX_COMPLAINT_LENGTH,
  MIN_COMPLAINT_LENGTH,
  formatRupiah,
  type ComplaintCategory,
  type OrderRecord,
} from "../../lib/models";
import { PrimaryButton } from "../../ui/buttons";
import { SelectChip } from "../../ui/chips";
import { AppCard, AppTextArea, FieldError, FieldLabel, Screen, Scroll, SimpleHeader, Wrap, safeBottom } from "../../ui/common";
import { snack } from "../../ui/overlays";
import { C, ui } from "../../ui/theme";

const CATEGORIES = Object.keys(COMPLAINT_CATEGORY_LABELS) as ComplaintCategory[];

/** A complaint belongs to one paid order and goes to the Admin. */
export function ComplaintScreen({ order }: { order: OrderRecord }) {
  const [category, setCategory] = useState<ComplaintCategory | null>(null);
  const [description, setDescription] = useState("");
  const [showError, setShowError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const descriptionId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const tooShort = description.trim().length < MIN_COMPLAINT_LENGTH;

  const submit = async () => {
    if (submitting || category === null) return;
    if (tooShort) {
      setShowError(true);
      return;
    }
    setSubmitting(true);
    try {
      await appState.submitComplaint(order, category, description);
      if (!alive.current) return;
      snack("Pengaduan terkirim. Admin akan menindaklanjuti.");
      void AppNav.pop(true);
    } catch (error) {
      if (!alive.current) return;
      if (error instanceof BackendException) snack(error.message, "error_outline");
      else snack("Pengaduan gagal dikirim. Periksa koneksi lalu coba lagi.", "error_outline");
    } finally {
      if (alive.current) setSubmitting(false);
    }
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Ajukan pengaduan" background={C.cream} />
      <Scroll style={{ padding: "12px 24px 24px" }}>
        <AppCard>
          <div style={ui(14, { weight: 700, color: C.ink })}>{order.bag.merchant.name}</div>
          <div style={{ ...ui(12.5, { color: C.body }), marginTop: 3 }}>
            {`${order.bag.title} · ${order.code} · ${formatRupiah(order.amount)}`}
          </div>
        </AppCard>
        <p style={{ ...ui(13, { weight: 700, color: C.body }), marginTop: 22 }}>Apa masalahnya?</p>
        <Wrap spacing={8} runSpacing={8} style={{ marginTop: 10 }}>
          {CATEGORIES.map((item) => (
            <SelectChip
              key={item}
              label={COMPLAINT_CATEGORY_LABELS[item]}
              selected={category === item}
              onTap={submitting ? undefined : () => setCategory(item)}
              padding="8px 13px"
              fontSize={12.5}
            />
          ))}
        </Wrap>
        <div style={{ marginTop: 22 }}>
          <FieldLabel htmlFor={descriptionId}>Ceritakan yang terjadi</FieldLabel>
          <AppTextArea
            id={descriptionId}
            rows={5}
            value={description}
            maxLength={MAX_COMPLAINT_LENGTH}
            disabled={submitting}
            invalid={showError && tooShort}
            placeholder="Contoh: isi bag kurang satu roti dari yang tertulis."
            onChange={(event) => setDescription(event.target.value)}
          />
          {showError && tooShort ? <FieldError>{`Tulis minimal ${MIN_COMPLAINT_LENGTH} karakter.`}</FieldError> : null}
        </div>
      </Scroll>
      <div style={{ flex: "none", padding: "14px 24px", paddingBottom: safeBottom(14), background: C.white, borderTop: `1px solid ${C.border}` }}>
        <PrimaryButton
          label={submitting ? "Mengirim…" : "Kirim pengaduan"}
          onTap={category !== null && !submitting ? () => void submit() : null}
        />
      </div>
    </Screen>
  );
}
