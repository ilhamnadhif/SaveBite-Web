"use client";

import { useState, type ReactNode } from "react";
import {
  COMPLAINT_STATUS_LABELS,
  MIN_ADMIN_NOTE_LENGTH,
  VERIFICATION_LABELS,
  type ComplaintStatus,
  type VerificationStatus,
} from "../../lib/models";
import { TextButton } from "../../ui/buttons";
import { StatusBadge } from "../../ui/chips";
import { AppTextArea, CenteredSpinner, EmptyState, ErrorBox, FieldError, Screen, Scroll } from "../../ui/common";
import type { IconName } from "../../ui/Icon";
import { DialogSurface, showDialog, snack } from "../../ui/overlays";
import { C, display, ui } from "../../ui/theme";

const dateFormat = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", year: "numeric" });

/** No-break spaces keep a date on one line inside a table cell. */
export const formatAdminDate = (date: Date | null) => (date ? dateFormat.format(date).replace(/ /g, "\u00a0") : "–");

/** Admin actions fail with a message that is safe to show. */
export function reportAdminError(error: unknown, message: (error: unknown) => string) {
  snack(message(error), "error_outline");
}

export function AdminPage({
  title,
  subtitle,
  actions,
  error,
  loading,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  error?: string | null;
  /** True only while there is nothing to show yet. */
  loading?: boolean;
  children: ReactNode;
}) {
  return (
    <Screen>
      <Scroll>
        <div style={{ maxWidth: 1120, margin: "0 auto", padding: "32px 32px 48px" }}>
          <div style={{ display: "flex", alignItems: "flex-end", flexWrap: "wrap", gap: 16, marginBottom: 22 }}>
            <div style={{ flex: "1 1 280px", minWidth: 0 }}>
              <h1 style={display(26, { weight: 800 })}>{title}</h1>
              <p style={{ ...ui(14, { color: C.body, height: 1.5 }), marginTop: 4 }}>{subtitle}</p>
            </div>
            {actions}
          </div>
          {error ? <ErrorBox style={{ marginBottom: 16 }}>{error}</ErrorBox> : null}
          {loading ? <CenteredSpinner /> : children}
        </div>
      </Scroll>
    </Screen>
  );
}

export type AdminColumn<T> = { header: string; render: (row: T) => ReactNode };

export function AdminTable<T>({
  columns,
  rows,
  rowKey,
  emptyIcon,
  emptyTitle,
  emptyMessage,
}: {
  columns: readonly AdminColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  emptyIcon: IconName;
  emptyTitle: string;
  emptyMessage: string;
}) {
  if (rows.length === 0) return <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} />;
  return (
    <div className="sb-admin-table">
      <table>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.header}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Two stacked lines inside one table cell. */
export function CellText({ primary, secondary }: { primary: string; secondary?: string | null }) {
  return (
    <>
      <div style={ui(13.5, { weight: 700, color: C.ink })}>{primary}</div>
      {secondary ? <div style={{ ...ui(12, { color: C.body }), marginTop: 2 }}>{secondary}</div> : null}
    </>
  );
}

export function VerifiedBadge({ text }: { text: string }) {
  return <StatusBadge text={text} background={C.greenSoftBg} foreground={C.greenAccent} />;
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const text = VERIFICATION_LABELS[status];
  if (status === "verified") return <VerifiedBadge text={text} />;
  return status === "pending" ? <StatusBadge.waiting text={text} /> : <StatusBadge.expired text={text} />;
}

export function ComplaintBadge({ status }: { status: ComplaintStatus }) {
  const text = COMPLAINT_STATUS_LABELS[status];
  if (status === "resolved") return <VerifiedBadge text={text} />;
  if (status === "rejected") return <StatusBadge.expired text={text} />;
  return <StatusBadge.waiting text={text} />;
}

function NoteDialog({
  title,
  message,
  placeholder,
  confirmLabel,
  destructive,
  close,
}: {
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
  destructive: boolean;
  close: (value?: string) => void;
}) {
  const [note, setNote] = useState("");
  const [invalid, setInvalid] = useState(false);
  const submit = () => {
    const trimmed = note.trim();
    if (trimmed.length < MIN_ADMIN_NOTE_LENGTH) {
      setInvalid(true);
      return;
    }
    close(trimmed);
  };
  return (
    <DialogSurface
      title={title}
      style={{ width: "100%", maxWidth: 440, margin: "0 auto" }}
      actions={
        <>
          <TextButton label="Batal" onTap={() => close()} color={C.body} fontWeight={700} />
          <TextButton label={confirmLabel} onTap={submit} color={destructive ? C.danger : C.greenAccent} fontWeight={800} />
        </>
      }
    >
      <p style={{ ...ui(14, { color: C.body, height: 1.5 }), marginBottom: 12 }}>{message}</p>
      <AppTextArea
        rows={3}
        value={note}
        maxLength={500}
        aria-label={title}
        placeholder={placeholder}
        invalid={invalid}
        onChange={(event) => {
          setNote(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? <FieldError>{`Tuliskan minimal ${MIN_ADMIN_NOTE_LENGTH} karakter.`}</FieldError> : null}
    </DialogSurface>
  );
}

/** Asks the admin for a written reason. Resolves null when cancelled. */
export async function promptNote(options: {
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
  destructive?: boolean;
}): Promise<string | null> {
  const note = await showDialog<string>(
    (close) => <NoteDialog {...options} destructive={options.destructive ?? false} close={close} />,
    { label: options.title },
  );
  return note ?? null;
}
