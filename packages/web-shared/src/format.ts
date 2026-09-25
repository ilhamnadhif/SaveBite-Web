export const rupiah = (value: number | string | null | undefined) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value ?? 0));
export const shortDate = (value: string | null | undefined) =>
  value ? new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
export const errorMessage = (error: unknown, fallback = "Terjadi kendala. Coba lagi.") =>
  error instanceof Error ? error.message : fallback;
export const makeIdempotencyKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36);
