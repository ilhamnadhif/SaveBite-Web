"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { e2eMode } from "../../lib/env";
import { assetUrl, bagContentsValidationError, parseBagContents, type TimeOfDay } from "../../lib/models";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton, TextButton } from "../../ui/buttons";
import { FieldLabel, Gap, QtyStepper, Screen, Scroll, SimpleHeader, Spinner, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { pickDate, pickTime } from "../../ui/pickers";
import { C, R, ui } from "../../ui/theme";
import {
  MerchantFormField,
  formatMerchantDate,
  formatMerchantTime,
  formatRupiahInput,
  merchantDateOnly,
  merchantDateTime,
  merchantTimeFromText,
  parseMerchantPrice,
  parseMerchantTimeMinutes,
} from "./MerchantFormFields";

const DAY_MS = 24 * 60 * 60 * 1000;
const PICKUP_START_FALLBACK: TimeOfDay = { hour: 20, minute: 0 };
const PICKUP_END_FALLBACK: TimeOfDay = { hour: 21, minute: 0 };

type FormValues = {
  readonly title: string;
  readonly description: string;
  readonly contents: string;
  readonly originalPrice: string;
  readonly salePrice: string;
  readonly pickupStart: string;
  readonly pickupEnd: string;
  readonly availableOn: Date;
};

type FormErrors = {
  readonly [K in "title" | "description" | "contents" | "originalPrice" | "salePrice" | "date" | "pickupStart" | "pickupEnd"]:
    | string
    | null;
};

const NO_ERRORS: FormErrors = {
  title: null,
  description: null,
  contents: null,
  originalPrice: null,
  salePrice: null,
  date: null,
  pickupStart: null,
  pickupEnd: null,
};

/** C3 Buat Surprise Bag: a full screen with its own bottom bar. */
export function CreateBagScreen() {
  const id = useId();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contents, setContents] = useState("");
  const [originalPrice, setOriginalPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [pickupStart, setPickupStart] = useState("20.00");
  const [pickupEnd, setPickupEnd] = useState("21.00");
  const [availableOn, setAvailableOn] = useState(() => merchantDateOnly(new Date()));
  const [qty, setQty] = useState(1);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  // Form(autovalidateMode: onUserInteraction): after the first field change
  // or the first validate(), every field re-validates on every build.
  const [autovalidate, setAutovalidate] = useState(false);
  const busy = useRef({ saving: false, uploading: false });
  const alive = useAlive();

  const values: FormValues = { title, description, contents, originalPrice, salePrice, pickupStart, pickupEnd, availableOn };
  const latest = useRef(values);
  latest.current = values;
  const errors = autovalidate ? validateForm(values) : NO_ERRORS;
  const discount = discountPercentOf(originalPrice, salePrice);

  const edit = (setter: (value: string) => void, previous: string, next: string) => {
    if (next === previous) return;
    setter(next);
    setAutovalidate(true);
  };

  const runUpload = async (upload: Promise<string | null>, successMessage: string, errorMessage: string) => {
    busy.current.uploading = true;
    setIsUploading(true);
    try {
      const url = await upload;
      if (!alive.current || url === null) return;
      setImageUrl(url);
      snack(successMessage);
    } catch {
      if (!alive.current) return;
      snack(errorMessage, "error_outline");
    } finally {
      busy.current.uploading = false;
      if (alive.current) setIsUploading(false);
    }
  };

  const changeCover = () => {
    if (busy.current.saving || busy.current.uploading) return;
    // The browser only opens the file chooser during the tap itself.
    const upload = new Promise<string | null>((resolve) => resolve(appState.uploadImage("bag")));
    void runUpload(upload, "Foto bag diperbarui", "Foto bag gagal diunggah. Coba lagi.");
  };

  const uploadBundledTestCover = () => {
    if (!e2eMode() || busy.current.saving || busy.current.uploading) return;
    const upload = (async () => {
      const response = await fetch(assetUrl("assets/images/food4.jpg"));
      if (!response.ok) throw new Error(`Bundled test cover unavailable (${response.status})`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      return appState.uploadImageBytes("bag", bytes, "savebite-e2e-food.jpg");
    })();
    void runUpload(upload, "Foto staging berhasil diunggah", "Foto staging gagal diunggah. Coba lagi.");
  };

  const pickAvailableDate = async () => {
    unfocus();
    const today = merchantDateOnly(new Date());
    const current = latest.current.availableOn;
    const selected = await pickDate({
      initial: current.getTime() < today.getTime() ? today : current,
      first: today,
      last: new Date(today.getTime() + 365 * DAY_MS),
      helpText: "Pilih tanggal bag tersedia",
      cancelText: "Batal",
      confirmText: "Pilih",
    });
    if (!alive.current || selected === null) return;
    setAvailableOn(merchantDateOnly(selected));
    setAutovalidate(true);
  };

  const pickPickupTime = async (field: "start" | "end") => {
    unfocus();
    const text = field === "start" ? latest.current.pickupStart : latest.current.pickupEnd;
    const selected = await pickTime({
      initial: merchantTimeFromText(text, field === "start" ? PICKUP_START_FALLBACK : PICKUP_END_FALLBACK),
      helpText: "Pilih waktu pickup",
      cancelText: "Batal",
      confirmText: "Pilih",
    });
    if (!alive.current || selected === null) return;
    if (field === "start") setPickupStart(formatMerchantTime(selected));
    else setPickupEnd(formatMerchantTime(selected));
    setAutovalidate(true);
  };

  const publish = async () => {
    if (busy.current.saving || busy.current.uploading) return;
    unfocus();
    setAutovalidate(true);
    if (hasErrors(validateForm(values))) {
      snack("Periksa kembali data bag.", "error_outline");
      return;
    }
    if (imageUrl === null || imageUrl === "") {
      snack("Tambahkan foto bag sebelum dipublikasikan.", "add_a_photo_outlined");
      return;
    }

    const original = parseMerchantPrice(originalPrice);
    const sale = parseMerchantPrice(salePrice);
    if (original === null || sale === null) return;
    const pickupStartsAt = merchantDateTime(availableOn, pickupStart);
    const pickupEndsAt = merchantDateTime(availableOn, pickupEnd);

    busy.current.saving = true;
    setIsSaving(true);
    try {
      await appState.addBag({
        title: title.trim(),
        description: description.trim(),
        contents: parseBagContents(contents),
        originalPrice: original,
        salePrice: sale,
        pickupWindow: `${pickupStart}–${pickupEnd}`,
        pickupStartsAt,
        pickupEndsAt,
        availableOn,
        total: qty,
        imageUrl,
      });
      if (!alive.current) return;
      snack("Bag dipublikasikan");
      void AppNav.back();
    } catch {
      if (!alive.current) return;
      snack("Bag gagal dipublikasikan. Coba lagi.", "error_outline");
    } finally {
      busy.current.saving = false;
      if (alive.current) setIsSaving(false);
    }
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Buat Surprise Bag" />
      <Scroll data-bag-form="" onTouchMove={dismissKeyboardOnDrag} style={{ padding: "18px 20px" }}>
        <FieldLabel>Foto bag</FieldLabel>
        <CoverPicker imageUrl={imageUrl} uploading={isUploading} onTap={isSaving || isUploading ? null : changeCover} />
        {e2eMode() ? (
          <>
            <Gap h={6} />
            <div data-testid="e2e-bag-photo-button" style={{ display: "flex" }}>
              <TextButton
                icon="science_outlined"
                label="Gunakan foto staging"
                onTap={isSaving || isUploading ? null : uploadBundledTestCover}
                style={{ width: "100%" }}
              />
            </div>
          </>
        ) : null}
        <Gap h={16} />
        <FieldLabel htmlFor={`${id}-title`}>Judul bag</FieldLabel>
        <MerchantFormField
          id={`${id}-title`}
          value={title}
          onChange={(next) => edit(setTitle, title, next)}
          error={errors.title}
          hintText="Contoh: Surprise Bag Roti & Pastry"
          autoCapitalize="words"
          enterKeyHint="next"
          inputProps={{ onKeyDown: focusNextField }}
        />
        <Gap h={16} />
        <FieldLabel htmlFor={`${id}-description`}>Deskripsi isi</FieldLabel>
        <MerchantFormField
          id={`${id}-description`}
          value={description}
          onChange={(next) => edit(setDescription, description, next)}
          error={errors.description}
          hintText="Jelaskan perkiraan isi dan kondisi produk"
          maxLines={3}
          autoCapitalize="sentences"
        />
        <Gap h={16} />
        <FieldLabel htmlFor={`${id}-contents`}>Perkiraan isi (opsional)</FieldLabel>
        <MerchantFormField
          id={`${id}-contents`}
          value={contents}
          onChange={(next) => edit(setContents, contents, next)}
          error={errors.contents}
          hintText="Contoh: Roti manis, Croissant, Donat"
          maxLines={3}
          autoCapitalize="sentences"
        />
        <Gap h={6} />
        <div style={ui(11.5, { color: C.muted })}>
          {`${parseBagContents(contents).length}/20 item · pisahkan dengan koma atau baris baru`}
        </div>
        <Gap h={16} />
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldLabel htmlFor={`${id}-original`}>Harga asli</FieldLabel>
            <PriceField
              id={`${id}-original`}
              value={originalPrice}
              onChange={(raw) => edit(setOriginalPrice, originalPrice, formatRupiahInput(raw))}
              error={errors.originalPrice}
            />
          </div>
          <Gap w={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldLabel htmlFor={`${id}-sale`}>Harga jual</FieldLabel>
            <PriceField
              id={`${id}-sale`}
              value={salePrice}
              onChange={(raw) => edit(setSalePrice, salePrice, formatRupiahInput(raw))}
              error={errors.salePrice}
              highlight
              trailing={discount !== null ? <DiscountBadge discount={discount} /> : undefined}
            />
          </div>
        </div>
        <Gap h={16} />
        <FieldLabel>Jumlah tersedia</FieldLabel>
        <div
          style={{
            display: "flex",
            background: C.white,
            borderRadius: R.input,
            border: `1.5px solid ${C.inputBorder}`,
            padding: "11px 16px",
          }}
        >
          <QtyStepper
            value={qty}
            suffix="bag"
            plusColor={C.terracotta}
            onMinus={isSaving || qty <= 1 ? null : () => setQty((value) => value - 1)}
            onPlus={isSaving || qty >= 999 ? null : () => setQty((value) => value + 1)}
          />
        </div>
        <Gap h={16} />
        <FieldLabel>Tanggal tersedia</FieldLabel>
        <PickerField
          value={formatMerchantDate(availableOn)}
          error={errors.date}
          ariaLabel="Tanggal tersedia"
          icon="calendar_today_outlined"
          onPick={isSaving ? null : () => void pickAvailableDate()}
        />
        <Gap h={16} />
        <FieldLabel>Window pickup</FieldLabel>
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PickerField
              value={pickupStart}
              error={errors.pickupStart}
              ariaLabel="Window pickup mulai"
              icon="schedule_outlined"
              onPick={isSaving ? null : () => void pickPickupTime("start")}
            />
          </div>
          <Gap w={12} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <PickerField
              value={pickupEnd}
              error={errors.pickupEnd}
              ariaLabel="Window pickup selesai"
              icon="schedule_outlined"
              onPick={isSaving ? null : () => void pickPickupTime("end")}
            />
          </div>
        </div>
      </Scroll>
      <div
        style={{
          flex: "none",
          background: C.white,
          borderTop: `1px solid ${C.border}`,
          paddingTop: 14,
          paddingRight: 20,
          paddingBottom: safeBottom(30),
          paddingLeft: 20,
        }}
      >
        <PrimaryButton
          merchant
          label={isSaving ? "Mempublikasikan..." : "Publikasikan bag"}
          onTap={isSaving || isUploading ? null : () => void publish()}
        />
      </div>
    </Screen>
  );
}

function CoverPicker({
  imageUrl,
  uploading,
  onTap,
}: {
  imageUrl: string | null;
  uploading: boolean;
  onTap: (() => void) | null;
}) {
  const image = imageUrl ?? "";
  const hasImage = image !== "";
  return (
    <button
      type="button"
      className="sb-tap"
      aria-label={hasImage ? "Ganti foto bag" : "Tambah foto bag"}
      aria-busy={uploading || undefined}
      disabled={!onTap}
      onClick={onTap ?? undefined}
      style={{
        width: "100%",
        height: 160,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.white,
        borderRadius: R.input,
        border: `1.5px solid ${C.inputBorder}`,
        overflow: "hidden",
      }}
    >
      {uploading ? (
        <Spinner size={36} strokeWidth={2.5} color={C.terracotta} />
      ) : hasImage ? (
        <FoodImage path={image} />
      ) : (
        <span style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: C.greenSoftBg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="add_a_photo_outlined" size={22} color={C.greenAccent} />
          </span>
          <span style={{ ...ui(13.5, { weight: 700, color: C.body }), marginTop: 10 }}>Tambah foto</span>
        </span>
      )}
    </button>
  );
}

function PriceField({
  id,
  value,
  onChange,
  error,
  highlight = false,
  trailing,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  highlight?: boolean;
  trailing?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <MerchantFormField
      id={id}
      value={value}
      onChange={onChange}
      error={error}
      inputMode="numeric"
      enterKeyHint="next"
      // Flutter only shows `prefixText` while the field is focused or filled.
      prefixText={focused || value !== "" ? "Rp " : undefined}
      borderColor={highlight ? C.greenBright : C.inputBorder}
      trailing={trailing}
      inputProps={{ onKeyDown: focusNextField, onFocus: () => setFocused(true), onBlur: () => setFocused(false) }}
    />
  );
}

function DiscountBadge({ discount }: { discount: number }) {
  return (
    <span
      style={{
        display: "block",
        padding: "3px 7px",
        background: C.greenSoftBg,
        borderRadius: 6,
        whiteSpace: "nowrap",
        ...ui(11, { weight: 800, color: C.greenAccent }),
      }}
    >
      {`-${discount}%`}
    </span>
  );
}

/** Read-only field that opens the date/time picker (`readOnly` + `onTap`). */
function PickerField({
  value,
  error,
  ariaLabel,
  icon,
  onPick,
}: {
  value: string;
  error: string | null;
  ariaLabel: string;
  icon: "calendar_today_outlined" | "schedule_outlined";
  onPick: (() => void) | null;
}) {
  return (
    <MerchantFormField
      value={value}
      readOnly
      error={error}
      onTap={onPick ?? undefined}
      ariaLabel={ariaLabel}
      trailing={<Icon name={icon} size={18} color={C.muted} />}
      inputProps={onPick ? { onKeyDown: openOnActivationKey(onPick) } : undefined}
    />
  );
}

function validateForm(values: FormValues): FormErrors {
  return {
    title: validateTitle(values.title),
    description: validateDescription(values.description),
    contents: bagContentsValidationError(parseBagContents(values.contents)),
    originalPrice: validateOriginalPrice(values.originalPrice, values.salePrice),
    salePrice: validateSalePrice(values.salePrice, values.originalPrice),
    date: validateDate(values.availableOn),
    pickupStart: validateTime(values.pickupStart),
    pickupEnd: validatePickupEnd(values.pickupEnd, values.pickupStart, values.availableOn),
  };
}

function hasErrors(errors: FormErrors): boolean {
  return Object.values(errors).some((error) => error !== null);
}

function validateTitle(value: string): string | null {
  const text = value.trim();
  if (text === "") return "Judul bag wajib diisi";
  if (text.length < 3) return "Minimal 3 karakter";
  if (text.length > 80) return "Maksimal 80 karakter";
  return null;
}

function validateDescription(value: string): string | null {
  const text = value.trim();
  if (text === "") return "Deskripsi wajib diisi";
  if (text.length < 10) return "Minimal 10 karakter";
  if (text.length > 500) return "Maksimal 500 karakter";
  return null;
}

function validateOriginalPrice(value: string, saleText: string): string | null {
  const original = parseMerchantPrice(value);
  if (original === null) return "Wajib diisi";
  if (original < 1000) return "Minimal Rp1.000";
  const sale = parseMerchantPrice(saleText);
  if (sale !== null && original <= sale) return "Harus di atas harga jual";
  return null;
}

function validateSalePrice(value: string, originalText: string): string | null {
  const sale = parseMerchantPrice(value);
  if (sale === null) return "Wajib diisi";
  if (sale < 1000) return "Minimal Rp1.000";
  const original = parseMerchantPrice(originalText);
  if (original !== null && sale >= original) return "Harus lebih rendah";
  return null;
}

function validateDate(availableOn: Date): string | null {
  const today = merchantDateOnly(new Date());
  if (availableOn.getTime() < today.getTime()) return "Tanggal sudah lewat";
  return null;
}

function validateTime(value: string): string | null {
  if (parseMerchantTimeMinutes(value) === null) return "Waktu tidak valid";
  return null;
}

function validatePickupEnd(value: string, startText: string, availableOn: Date): string | null {
  const error = validateTime(value);
  if (error !== null) return error;
  const start = parseMerchantTimeMinutes(startText);
  const end = parseMerchantTimeMinutes(value);
  if (start !== null && end !== null && end <= start) return "Harus setelah mulai";
  const pickupEnd = merchantDateTime(availableOn, value);
  if (!(pickupEnd.getTime() > Date.now())) return "Waktu sudah lewat";
  return null;
}

function discountPercentOf(originalText: string, saleText: string): number | null {
  const original = parseMerchantPrice(originalText);
  const sale = parseMerchantPrice(saleText);
  if (original === null || sale === null || original <= sale || sale <= 0) return null;
  return Math.round(((original - sale) * 100) / original);
}

/** `if (!mounted) return;` after an await. */
function useAlive() {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  return alive;
}

/** `FocusScope.of(context).unfocus()`: closes the keyboard. */
function unfocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
}

/** `TextInputAction.next`: Enter moves focus to the next field of the form. */
function focusNextField(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
  const scope = event.currentTarget.closest("[data-bag-form]");
  if (!scope) return;
  event.preventDefault();
  const fields = Array.from(scope.querySelectorAll<HTMLElement>("input, textarea"));
  const index = fields.indexOf(event.currentTarget);
  if (index >= 0) fields[index + 1]?.focus();
}

/** Keyboard activation for the read-only picker fields. */
function openOnActivationKey(open: () => void) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  };
}

/** `ScrollViewKeyboardDismissBehavior.onDrag`: dragging the form closes the keyboard. */
function dismissKeyboardOnDrag(event: TouchEvent<HTMLElement>) {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)) return;
  if (event.target instanceof Node && active.contains(event.target)) return;
  active.blur();
}
