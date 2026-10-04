"use client";

import { useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import type { TimeOfDay } from "../../lib/models";
import { C, R, ui } from "../../ui/theme";

/**
 * Form field used only by the merchant screens (`merchant_form_fields.dart`).
 * Controlled: pass `value` and `onChange`. `error` is the validator message,
 * shown inside the field like Flutter's borderless `InputDecoration`.
 */
export function MerchantFormField({
  value,
  onChange,
  error,
  hintText,
  maxLines = 1,
  inputMode,
  enterKeyHint,
  autoCapitalize,
  prefixText,
  trailing,
  readOnly = false,
  enabled = true,
  onTap,
  borderColor = C.inputBorder,
  id,
  ariaLabel,
  maxLength,
  inputProps,
}: {
  value: string;
  onChange?: (value: string) => void;
  error?: string | null;
  hintText?: string;
  maxLines?: number;
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
  enterKeyHint?: InputHTMLAttributes<HTMLInputElement>["enterKeyHint"];
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  prefixText?: string;
  trailing?: ReactNode;
  readOnly?: boolean;
  enabled?: boolean;
  onTap?: () => void;
  borderColor?: string;
  id?: string;
  ariaLabel?: string;
  maxLength?: number;
  inputProps?: InputHTMLAttributes<HTMLInputElement> & TextareaHTMLAttributes<HTMLTextAreaElement>;
}) {
  // Flutter shows `prefixText` only while the field is focused or filled.
  const [focused, setFocused] = useState(false);
  const showPrefix = Boolean(prefixText) && (focused || value.length > 0);
  const shared = {
    id,
    value,
    onFocus: () => setFocused(true),
    onBlur: () => setFocused(false),
    readOnly: readOnly || Boolean(onTap),
    disabled: !enabled,
    placeholder: hintText,
    autoCapitalize,
    maxLength,
    "aria-label": ariaLabel,
    "aria-invalid": error ? true : undefined,
    onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
    onClick: onTap,
    className: "sb-input",
    style: { ...ui(14.5, { color: C.ink, height: maxLines > 1 ? 1.45 : undefined }), cursor: onTap ? "pointer" : undefined },
  };
  return (
    <div
      className="sb-field"
      data-error={error ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        background: C.white,
        borderRadius: R.input,
        border: `1.5px solid ${borderColor}`,
        padding: "2px 14px",
        opacity: enabled ? 1 : 0.6,
        transition: "border-color 120ms ease",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline" }}>
          {showPrefix ? <span style={{ ...ui(14.5, { color: C.body }), whiteSpace: "pre" }}>{prefixText}</span> : null}
          {maxLines > 1 ? (
            <textarea {...inputProps} {...shared} rows={maxLines} />
          ) : (
            <input {...inputProps} {...shared} inputMode={inputMode} enterKeyHint={enterKeyHint} />
          )}
        </div>
        {error ? (
          <div role="alert" style={{ ...ui(12, { color: C.danger, height: 1.35 }), paddingBottom: 8, marginTop: -4 }}>
            {error}
          </div>
        ) : null}
      </div>
      {trailing ? <div style={{ paddingTop: 10 }}>{trailing}</div> : null}
    </div>
  );
}

/**
 * `RupiahInputFormatter`: keeps a price as digits with Indonesian thousand
 * separators. Apply to every `onChange` value of a price field.
 */
export function formatRupiahInput(raw: string, maxDigits = 9): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
  digits = digits.replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  return formatMerchantPriceInput(digits);
}

export function formatMerchantPriceInput(value: string | number): string {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return "";
  let result = "";
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) result += ".";
    result += digits[i];
  }
  return result;
}

export function parseMerchantPrice(raw: string): number | null {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const value = Number.parseInt(digits, 10);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseMerchantTimeMinutes(raw: string): number | null {
  const match = /^(\d{2})[.:](\d{2})$/.exec(raw.trim());
  if (!match) return null;
  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function merchantTimeFromText(raw: string, fallback: TimeOfDay): TimeOfDay {
  const minutes = parseMerchantTimeMinutes(raw);
  if (minutes === null) return fallback;
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}

export function formatMerchantTime(time: TimeOfDay): string {
  return `${String(time.hour).padStart(2, "0")}.${String(time.minute).padStart(2, "0")}`;
}

export function merchantDateOnly(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/** `merchantDateTime`: `time` must already be a valid "HH.mm". */
export function merchantDateTime(date: Date, time: string): Date {
  const minutes = parseMerchantTimeMinutes(time) ?? 0;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), Math.floor(minutes / 60), minutes % 60);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

export function formatMerchantDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}
