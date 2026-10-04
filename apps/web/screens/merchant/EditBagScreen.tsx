"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type TouchEvent } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { bagContentsValidationError, parseBagContents, type MerchantBag, type TimeOfDay } from "../../lib/models";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { FieldLabel, Gap, QtyStepper, Screen, Scroll, SimpleHeader, Spinner, safeBottom } from "../../ui/common";
import { Icon } from "../../ui/Icon";
import { snack } from "../../ui/overlays";
import { pickDate, pickTime } from "../../ui/pickers";
import { C, R, ui } from "../../ui/theme";
import {
  MerchantFormField,
  formatMerchantDate,
  formatMerchantPriceInput,
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

/** "20.00–21.00" → ["20.00", "21.00"], falling back per invalid half. */
function splitWindow(raw: string): [string, string] {
  const parts = raw.split(/\s*[–—-]\s*/);
  const start = parts.length > 0 ? parts[0].trim() : "";
  const end = parts.length > 1 ? parts[1].trim() : "";
  return [
    parseMerchantTimeMinutes(start) === null ? "20.00" : start,
    parseMerchantTimeMinutes(end) === null ? "21.00" : end,
  ];
}

/** The stored pickup instant as "HH.mm" (local time), else the window text. */
function pickupText(date: Date | null, fallback: string): string {
  if (date !== null) return formatMerchantTime({ hour: date.getHours(), minute: date.getMinutes() });
  return fallback;
}

/** Edit Surprise Bag: a full screen with its own bottom bar. */
export function EditBagScreen({ bag }: { bag: MerchantBag }) {
  const id = useId();
  const minimumTotal = bag.sold > 1 ? bag.sold : 1;
  const [title, setTitle] = useState(bag.title);
  const [description, setDescription] = useState(bag.description);
  const [contents, setContents] = useState(() => bag.contents.join(", "));
  const [originalPrice, setOriginalPrice] = useState(() =>
    bag.originalPrice > 0 ? formatMerchantPriceInput(bag.originalPrice) : "",
  );
  const [salePrice, setSalePrice] = useState(() => formatMerchantPriceInput(bag.salePrice));
  const [pickupStart, setPickupStart] = useState(() => pickupText(bag.pickupStartsAt, splitWindow(bag.pickupWindow)[0]));
  const [pickupEnd, setPickupEnd] = useState(() => pickupText(bag.pickupEndsAt, splitWindow(bag.pickupWindow)[1]));
  const [availableOn, setAvailableOn] = useState(() => merchantDateOnly(bag.availableOn ?? bag.pickupStartsAt ?? new Date()));
  const [qty, setQty] = useState(() => (bag.total < minimumTotal ? minimumTotal : bag.total));
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
  const displayImage = imageUrl !== null && imageUrl !== "" ? imageUrl : bag.image;

  const edit = (setter: (value: string) => void, previous: string, next: string) => {
    if (next === previous) return;
    setter(next);
    setAutovalidate(true);
  };

  const changeCover = () => {
    if (busy.current.saving || busy.current.uploading) return;
    // The browser only opens the file chooser during the tap itself.
    const upload = new Promise<string | null>((resolve) => resolve(appState.uploadImage("bag")));
    busy.current.uploading = true;
    setIsUploading(true);
    void (async () => {
      try {
        const url = await upload;
        if (!alive.current || url === null) return;
        setImageUrl(url);
        snack("Foto bag diperbarui");
      } catch {
        if (!alive.current) return;
        snack("Foto bag gagal diunggah. Coba lagi.", "error_outline");
      } finally {
        busy.current.uploading = false;
        if (alive.current) setIsUploading(false);
      }
    })();
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

  const save = async () => {
    if (busy.current.saving || busy.current.uploading) return;
    unfocus();
    setAutovalidate(true);
    if (hasErrors(validateForm(values))) {
      snack("Periksa kembali data bag.", "error_outline");
      return;
    }
    if (displayImage === "") {
      snack("Tambahkan foto bag sebelum menyimpan.", "add_a_photo_outlined");
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
      await appState.updateBag(bag, {
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
      snack("Perubahan disimpan");
      void AppNav.back();
    } catch {
      if (!alive.current) return;
      snack("Perubahan bag gagal disimpan. Coba lagi.", "error_outline");
    } finally {
      busy.current.saving = false;
      if (alive.current) setIsSaving(false);
    }
  };

  return (
    <Screen background={C.cream}>
      <SimpleHeader title="Edit Surprise Bag" />
      <Scroll data-bag-form="" onTouchMove={dismissKeyboardOnDrag} style={{ padding: "18px 20px" }}>
        <FieldLabel>Foto bag</FieldLabel>
        <CoverPicker image={displayImage} uploading={isUploading} onTap={isSaving || isUploading ? null : changeCover} />
        <Gap h={16} />
        <FieldLabel htmlFor={`${id}-title`}>Judul bag</FieldLabel>
        <MerchantFormField
          id={`${id}-title`}
          value={title}
          onChange={(next) => edit(setTitle, title, next)}
          error={errors.title}
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
        <FieldLabel>Jumlah total</FieldLabel>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
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
            onMinus={isSaving || qty <= minimumTotal ? null : () => setQty((value) => value - 1)}
            onPlus={isSaving || qty >= 999 ? null : () => setQty((value) => value + 1)}
          />
          {bag.sold > 0 ? (
            <>
              <Gap h={7} />
              <div style={ui(11.5, { color: C.muted })}>{`${bag.sold} bag sudah terjual dan tidak dapat dikurangi.`}</div>
            </>
          ) : null}
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
          label={isSaving ? "Menyimpan..." : "Simpan perubahan"}
          onTap={isSaving || isUploading ? null : () => void save()}
        />
      </div>
    </Screen>
  );
}

function CoverPicker({ image, uploading, onTap }: { image: string; uploading: boolean; onTap: (() => void) | null }) {
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
        height: 140,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.tanPlaceholder,
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
          <Icon name="photo_camera_outlined" size={24} color={C.captionWarm} />
          <span style={{ ...ui(13, { weight: 600, color: C.muted }), marginTop: 6 }}>Tambah foto</span>
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
  if (availableOn.getTime() < today.getTime()) return "Pilih hari ini atau setelahnya";
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
