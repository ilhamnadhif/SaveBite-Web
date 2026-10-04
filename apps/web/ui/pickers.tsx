"use client";

import { useState } from "react";
import type { TimeOfDay } from "../lib/models";
import { TextButton } from "./buttons";
import { DialogSurface, showDialog } from "./overlays";
import { C, R, ui } from "./theme";

/**
 * `showTimePicker` / `showDatePicker`: a brand dialog around the browser's
 * native time/date input, which opens the platform picker on phones.
 * Resolves null when cancelled.
 */

const pad = (value: number) => String(value).padStart(2, "0");
const timeText = (time: TimeOfDay) => `${pad(time.hour)}:${pad(time.minute)}`;
const dateText = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

const inputStyle = {
  width: "100%",
  padding: "14px 14px",
  borderRadius: R.input,
  border: `1.5px solid ${C.inputBorder}`,
  background: C.white,
  outline: "none",
  ...ui(18, { weight: 700, color: C.ink }),
} as const;

function TimeDialog({
  initial,
  helpText,
  cancelText,
  confirmText,
  close,
}: {
  initial: TimeOfDay;
  helpText: string;
  cancelText: string;
  confirmText: string;
  close: (value?: TimeOfDay) => void;
}) {
  const [value, setValue] = useState(timeText(initial));
  const parsed = /^(\d{2}):(\d{2})$/.exec(value);
  const result = parsed ? { hour: Number(parsed[1]), minute: Number(parsed[2]) } : null;
  return (
    <DialogSurface
      title={<span style={ui(12.5, { weight: 700, color: C.body })}>{helpText}</span>}
      actions={
        <>
          <TextButton label={cancelText} onTap={() => close()} color={C.body} fontWeight={700} />
          <TextButton
            label={confirmText}
            onTap={result ? () => close(result) : null}
            color={C.greenAccent}
            fontWeight={800}
          />
        </>
      }
    >
      <input
        type="time"
        aria-label={helpText}
        className="sb-field"
        value={value}
        step={60}
        onChange={(event) => setValue(event.target.value)}
        style={inputStyle}
        autoFocus
      />
    </DialogSurface>
  );
}

function DateDialog({
  initial,
  first,
  last,
  helpText,
  cancelText,
  confirmText,
  close,
}: {
  initial: Date;
  first: Date;
  last: Date;
  helpText: string;
  cancelText: string;
  confirmText: string;
  close: (value?: Date) => void;
}) {
  const [value, setValue] = useState(dateText(initial));
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const candidate = parsed ? new Date(Number(parsed[1]), Number(parsed[2]) - 1, Number(parsed[3])) : null;
  const inRange = candidate !== null && candidate >= startOfDay(first) && candidate <= startOfDay(last);
  return (
    <DialogSurface
      title={<span style={ui(12.5, { weight: 700, color: C.body })}>{helpText}</span>}
      actions={
        <>
          <TextButton label={cancelText} onTap={() => close()} color={C.body} fontWeight={700} />
          <TextButton
            label={confirmText}
            onTap={inRange && candidate ? () => close(candidate) : null}
            color={C.greenAccent}
            fontWeight={800}
          />
        </>
      }
    >
      <input
        type="date"
        aria-label={helpText}
        className="sb-field"
        value={value}
        min={dateText(first)}
        max={dateText(last)}
        onChange={(event) => setValue(event.target.value)}
        style={inputStyle}
        autoFocus
      />
    </DialogSurface>
  );
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export async function pickTime({
  initial,
  helpText = "Pilih waktu",
  cancelText = "Batal",
  confirmText = "Pilih",
}: {
  initial: TimeOfDay;
  helpText?: string;
  cancelText?: string;
  confirmText?: string;
}): Promise<TimeOfDay | null> {
  const result = await showDialog<TimeOfDay>(
    (close) => <TimeDialog initial={initial} helpText={helpText} cancelText={cancelText} confirmText={confirmText} close={close} />,
    { label: helpText },
  );
  return result ?? null;
}

export async function pickDate({
  initial,
  first,
  last,
  helpText = "Pilih tanggal",
  cancelText = "Batal",
  confirmText = "Pilih",
}: {
  initial: Date;
  first: Date;
  last: Date;
  helpText?: string;
  cancelText?: string;
  confirmText?: string;
}): Promise<Date | null> {
  const result = await showDialog<Date>(
    (close) => (
      <DateDialog
        initial={initial}
        first={first}
        last={last}
        helpText={helpText}
        cancelText={cancelText}
        confirmText={confirmText}
        close={close}
      />
    ),
    { label: helpText },
  );
  return result ?? null;
}
