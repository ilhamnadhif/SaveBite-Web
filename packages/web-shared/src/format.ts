const rupiahFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
});

/**
 * Formats a money amount for display.
 *
 * Any non-finite input (a bad column value, `undefined`, `"n/a"`) renders as
 * `Rp0` rather than the literal string `RpNaN`, which Intl happily produces for
 * `NaN` and which used to reach the UI.
 */
export const rupiah = (value: number | string | null | undefined) => {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return rupiahFormatter.format(Number.isFinite(numeric) ? numeric : 0);
};

export const shortDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export const makeIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
