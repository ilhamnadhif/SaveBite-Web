"use client";

/**
 * Supabase backend: Postgres (tables + RPC), Storage, Edge Functions and
 * Realtime, all under RLS. A line-by-line port of
 * `lib/data/backend/supabase_backend.dart`, including the Indonesian error
 * mapping, so the web shows exactly the messages the mobile app shows.
 */
import type { PostgrestError, RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from "@supabase/supabase-js";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { authCallbackUrl, publicConfig } from "@savebite/web-shared";
import { compressImage, pickImageFile } from "../imagePicker";
import {
  adminComplaintFromMap,
  adminMerchantFromMap,
  adminStatsFromMap,
  adminUserFromMap,
  bagFromMap,
  bankAccountFromMap,
  complaintFromMap,
  incomingOrderFromMap,
  initials2,
  merchantBagFromMap,
  merchantFromMap,
  merchantReviewFromMap,
  notificationFromMap,
  orderRecordFromMap,
  parseDate,
  payoutRequestFromMap,
  profileFromMap,
  storeFromMap,
  transactionReportFromMap,
  timeLabel,
  txFromMap,
  type Row,
} from "../mappers";
import {
  EMPTY_FILTER,
  EMPTY_STATS,
  bagContentsValidationError,
  bagMatchesFilter,
  incomingOrder,
  normalizeBagContents,
  type AdminComplaint,
  type AdminMerchant,
  type AdminStats,
  type AdminUser,
  type AppNotification,
  type Bag,
  type BagFilter,
  type BankAccount,
  type Complaint,
  type ComplaintCategory,
  type ComplaintStatus,
  type FavoriteStore,
  type IncomingOrder,
  type Merchant,
  type MerchantBag,
  type MerchantReview,
  type MerchantStats,
  type OrderRecord,
  type PayoutRequest,
  type Profile,
  type StoreProfile,
  type TransactionReport,
  type TxRecord,
} from "../models";
import {
  BackendException,
  DEFAULT_BUSINESS_CONFIG,
  businessConfigFromMap,
  type Backend,
  type BackendBucket,
  type BagInput,
  type BusinessConfig,
  type StoreInput,
  type Unsubscribe,
} from "./types";

const PAGE_SIZE = 500;
const PAYOUT_SELECT = "*, bank_accounts(id, bank_code, account_holder, account_number_last4, status, is_default)";
const HOUR_MS = 3_600_000;

type Result<T> = { data: T | null; error: PostgrestError | null };

/** Raised for failures Dart did not route through `_guard` (raw exceptions). */
class RawBackendError extends Error {
  constructor(readonly cause: unknown) {
    super("Supabase request failed");
    this.name = "RawBackendError";
  }
}

function sessionExpired(): BackendException {
  return new BackendException("not_authenticated", "Sesi berakhir. Silakan masuk kembali.");
}

function dateText(value: Date): string {
  return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function utcDateText(value: Date): string {
  return `${String(value.getUTCFullYear()).padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

/** "Now" on the Asia/Jakarta wall clock, read through the UTC getters. */
const jakartaNow = () => new Date(Date.now() + 7 * HOUR_MS);

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const radians = (value: number) => (value * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * PostgREST may return a JSON RPC result as an object or a one-row list,
 * depending on the function shape. Both are treated identically.
 */
export function decodeRpcRow(value: unknown): Row {
  const row = Array.isArray(value) ? (value.length ? value[0] : null) : value;
  if (row && typeof row === "object" && !Array.isArray(row)) return row as Row;
  throw new BackendException("invalid_response", "Respons server tidak valid.");
}

/** A `jsonb` array returned by an RPC. */
function rowList(value: unknown): Row[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new BackendException("invalid_response", "Respons server tidak valid.");
  return value as Row[];
}

function rpcBool(value: unknown): boolean {
  const result = Array.isArray(value) ? (value.length ? value[0] : null) : value;
  if (typeof result === "boolean") return result;
  throw new BackendException("invalid_response", "Respons server tidak valid.");
}

/**
 * Maps bank-account RPC errors to actionable messages. `null` means the
 * error is not from the bank flow and falls through to the general mapper.
 */
export function bankAccountExceptionFromMessage(message: string): BackendException | null {
  const raw = message.toLowerCase();
  if (raw.includes("invalid bank code")) {
    return new BackendException("invalid_bank_code", "Bank yang dipilih tidak valid. Pilih ulang lalu coba lagi.");
  }
  if (raw.includes("invalid account number")) {
    return new BackendException("invalid_bank_account_number", "Nomor rekening harus berisi 6–20 digit.");
  }
  if (raw.includes("invalid account holder")) {
    return new BackendException("invalid_bank_account_holder", "Nama pemilik rekening harus berisi 2–100 karakter.");
  }
  if (raw.includes("idempotency key must contain")) {
    return new BackendException("invalid_idempotency_key", "Permintaan rekening tidak valid. Silakan coba lagi.");
  }
  if (raw.includes("bank account registration is no longer active")) {
    return new BackendException(
      "bank_registration_inactive",
      "Pendaftaran rekening sebelumnya sudah tidak aktif. Masukkan kembali data rekening untuk membuat permintaan baru.",
    );
  }
  if (raw.includes("bank security configuration is unavailable") || raw.includes("stored bank destination does not match registration")) {
    return new BackendException("bank_registration_unavailable", "Pendaftaran rekening sedang tidak tersedia. Coba lagi nanti.");
  }
  if (raw.includes("bank account not found")) {
    return new BackendException("bank_account_not_found", "Rekening tidak ditemukan atau sudah dinonaktifkan.");
  }
  return null;
}

/** Same normalisation as the `register_bank_account` contract. */
export function buildBankAccountRpcParams(input: {
  bankCode: string;
  accountNumber: string;
  accountHolder: string;
  idempotencyKey: string;
}): Record<string, string> {
  const code = input.bankCode.trim().toUpperCase();
  const number = input.accountNumber.replace(/[^0-9]/g, "");
  const holder = input.accountHolder.trim();
  const key = input.idempotencyKey.trim();
  if (!/^[A-Z0-9_]{2,20}$/.test(code)) throw new BackendException("invalid_bank_code", "Pilih bank yang valid.");
  if (number.length < 6 || number.length > 20) {
    throw new BackendException("invalid_bank_account_number", "Nomor rekening harus berisi 6–20 digit.");
  }
  if (holder.length < 2 || holder.length > 100) {
    throw new BackendException("invalid_bank_account_holder", "Nama pemilik rekening harus berisi 2–100 karakter.");
  }
  if (key.length < 8 || key.length > 128) {
    throw new BackendException("invalid_idempotency_key", "Permintaan rekening tidak valid. Silakan coba lagi.");
  }
  return {
    p_bank_code: code,
    p_account_holder: holder,
    p_account_number: number,
    p_idempotency_key: key,
  };
}

export function shouldRetryBankAccountRegistration(error: unknown): boolean {
  if (!(error instanceof BackendException)) return true;
  return error.code === "server_error" || error.code === "invalid_response" || error.code === "network_error";
}

function isNetworkFailure(error: { message?: string } | null | undefined): boolean {
  return /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(error?.message ?? "");
}

/** Dart `_guard`: PostgREST errors become actionable `BackendException`s. */
export function mapPostgrestError(error: PostgrestError | { message?: string; details?: string; hint?: string; code?: string }): Error {
  if (isNetworkFailure(error)) return new RawBackendError(error);
  const raw = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""} ${error.code ?? ""}`.toLowerCase();
  const bank = bankAccountExceptionFromMessage(raw);
  if (bank) return bank;
  const rules: Array<[boolean, string, string]> = [
    [raw.includes("admin access required"), "admin_required", "Akses ini khusus Admin."],
    [raw.includes("account is suspended"), "account_suspended", "Akun ini sedang ditangguhkan."],
    [raw.includes("merchant is not verified"), "merchant_not_verified", "Toko ini belum terverifikasi."],
    [raw.includes("complaint already submitted"), "complaint_exists", "Pengaduan untuk pesanan ini sudah pernah dikirim."],
    [raw.includes("not eligible for a complaint"), "complaint_not_allowed", "Pesanan ini belum bisa diadukan."],
    [raw.includes("invalid complaint description"), "invalid_complaint", "Jelaskan masalahnya minimal 10 karakter."],
    [raw.includes("complaint is already closed"), "complaint_closed", "Pengaduan ini sudah ditutup."],
    [raw.includes("complaint not found"), "complaint_not_found", "Pengaduan tidak ditemukan."],
    [
      raw.includes("note is required") || raw.includes("follow-up is required") || raw.includes("reason is required"),
      "note_required",
      "Tuliskan alasannya minimal 5 karakter.",
    ],
    [raw.includes("cannot suspend their own account"), "self_suspend", "Admin tidak dapat menangguhkan akunnya sendiri."],
    [raw.includes("admin accounts cannot be suspended"), "admin_suspend", "Akun Admin tidak dapat ditangguhkan."],
    [raw.includes("user not found"), "user_not_found", "Pengguna tidak ditemukan."],
    [raw.includes("invalid report period"), "invalid_period", "Periode laporan tidak valid."],
    [raw.includes("report period is too long"), "invalid_period", "Periode laporan maksimal satu tahun."],
    [raw.includes("insufficient stock"), "insufficient_stock", "Stok bag sudah berubah. Silakan cek kembali."],
    [raw.includes("not authenticated"), "not_authenticated", "Sesi berakhir. Silakan masuk kembali."],
    [raw.includes("merchant cannot purchase"), "self_purchase_forbidden", "Merchant tidak dapat membeli bag dari tokonya sendiri."],
    [raw.includes("merchant not found"), "merchant_not_found", "Toko tidak ditemukan atau sudah tidak aktif."],
    [raw.includes("order not found"), "order_not_found", "Pesanan tidak ditemukan."],
    [raw.includes("invalid pickup token"), "invalid_pickup_code", "QR pickup tidak valid."],
    [raw.includes("pickup window has not started"), "pickup_not_started", "Waktu pickup pesanan belum dimulai."],
    [raw.includes("only paid orders can be marked ready"), "invalid_order_status", "Status pesanan sudah berubah. Muat ulang daftar pesanan."],
    [
      raw.includes("order is not ready for pickup") || raw.includes("order is not redeemable"),
      "order_not_redeemable",
      "QR baru tersedia setelah merchant menandai pesanan siap.",
    ],
    [raw.includes("payouts are disabled"), "payout_disabled", "Fitur penarikan dana belum diaktifkan oleh operator."],
    [raw.includes("idempotency"), "idempotency_conflict", "Permintaan yang sama sudah diproses dengan data berbeda."],
    [raw.includes("pickup token has expired"), "pickup_token_expired", "QR sudah diperbarui. Minta pembeli menampilkan QR terbaru."],
    [raw.includes("expired"), "expired", "Masa berlaku pesanan sudah berakhir."],
    [raw.includes("already redeemed"), "already_redeemed", "Pesanan sudah pernah diambil."],
    [
      raw.includes("cannot be cancelled") || raw.includes("order status changed"),
      "invalid_order_status",
      "Status pesanan sudah berubah dan tidak dapat dibatalkan.",
    ],
    [raw.includes("does not belong to your merchant"), "order_not_found", "Pesanan tidak ditemukan."],
    [raw.includes("not verified"), "bank_not_verified", "Rekening masih dalam verifikasi."],
    [raw.includes("insufficient balance"), "insufficient_balance", "Saldo tidak mencukupi."],
    [
      raw.includes("account cannot be deleted") && raw.includes("payout"),
      "payout_in_progress",
      "Akun belum dapat dihapus karena penarikan dana masih diproses.",
    ],
    [
      raw.includes("account cannot be deleted") && raw.includes("order"),
      "active_order_exists",
      "Akun belum dapat dihapus karena masih ada pesanan aktif.",
    ],
  ];
  for (const [matches, code, message] of rules) {
    if (matches) return new BackendException(code, message);
  }
  return new BackendException("server_error", "Layanan sedang bermasalah. Silakan coba lagi.");
}

/** Dart `_paymentException`. */
export function paymentException(code: string, message: string, status: number): BackendException {
  const normalized = `${code} ${message}`.toLowerCase();
  if (status === 401 || normalized.includes("not authenticated")) return sessionExpired();
  if (code === "merchant_cancellation_pending") {
    return new BackendException(code, "Konfirmasi pembatalan dari Midtrans masih diproses. Coba lagi sebentar.");
  }
  if (code === "merchant_cancellation_requires_review") {
    return new BackendException(code, "Pembatalan ditahan untuk pemeriksaan operator. Pesanan tidak dapat diproses sementara.");
  }
  if (code === "invalid_order_status") {
    return new BackendException(code, "Status pesanan sudah berubah dan tidak dapat dibatalkan.");
  }
  if (code === "cancellation_claim_failed" || code === "payment_state_not_persisted") {
    return new BackendException(code, message.trim() ? message : "Pembatalan belum dapat diproses. Coba lagi.");
  }
  if (
    normalized.includes("midtrans") &&
    (normalized.includes("credential") || normalized.includes("server key") || normalized.includes("not configured"))
  ) {
    return new BackendException("payment_not_configured", "Layanan pembayaran sedang tidak tersedia. Coba lagi nanti.");
  }
  if (normalized.includes("insufficient stock")) {
    return new BackendException("insufficient_stock", "Stok bag sudah berubah. Silakan cek kembali.");
  }
  if (normalized.includes("idempotency")) {
    return new BackendException("idempotency_conflict", "Permintaan pembayaran sudah diproses dengan data berbeda.");
  }
  if (normalized.includes("expired") || normalized.includes("expire")) {
    return new BackendException("payment_expired", "Waktu pembayaran sudah berakhir. Silakan buat pesanan baru.");
  }
  if (normalized.includes("cancel") || normalized.includes("deny")) {
    return new BackendException("payment_cancelled", "Pembayaran dibatalkan atau ditolak oleh penyedia pembayaran.");
  }
  if (normalized.includes("order not found")) {
    return new BackendException("order_not_found", "Pesanan tidak ditemukan.");
  }
  return new BackendException(code || "payment_failed", "Pembayaran belum dapat diproses. Coba lagi.");
}

export class SupabaseBackend implements Backend {
  readonly isRemote = true;

  private storeIdCache: string | null = null;
  private cacheUid: string | null = null;

  private get sb(): SupabaseClient {
    return supabaseBrowser();
  }

  /** The signed-in user id (Dart `currentUser?.id`), read from the local session. */
  private async uid(): Promise<string | null> {
    const { data } = await this.sb.auth.getSession();
    return data.session?.user.id ?? null;
  }

  private async requireUid(): Promise<string> {
    const uid = await this.uid();
    if (!uid) throw sessionExpired();
    return uid;
  }

  private async requireStoreId(): Promise<string> {
    const id = await this.storeId();
    if (!id) throw new BackendException("merchant_not_found", "Profil toko belum tersedia. Lengkapi toko terlebih dahulu.");
    return id;
  }

  clearSessionCache(): void {
    this.storeIdCache = null;
    this.cacheUid = null;
  }

  private async storeId(): Promise<string | null> {
    const uid = await this.uid();
    if (!uid) return null;
    if (this.cacheUid === uid && this.storeIdCache) return this.storeIdCache;
    if (this.cacheUid !== uid) this.clearSessionCache();
    const response = await this.raw(this.sb.rpc("get_my_merchant"));
    const row = response === null || response === undefined ? null : decodeRpcRow(response);
    this.cacheUid = uid;
    this.storeIdCache = row?.id ? String(row.id) : null;
    return this.storeIdCache;
  }

  /** A request Dart made without `_guard`: errors stay generic. */
  private async raw<T>(request: PromiseLike<Result<T>>): Promise<T | null> {
    const { data, error } = await request;
    if (error) throw new RawBackendError(error);
    return data;
  }

  /** A request Dart wrapped in `_guard`: errors become `BackendException`. */
  private async guard<T>(request: PromiseLike<Result<T>>): Promise<T | null> {
    let result: Result<T>;
    try {
      result = await request;
    } catch (error) {
      throw new RawBackendError(error);
    }
    if (result.error) throw mapPostgrestError(result.error);
    return result.data;
  }

  private async pagedRows(fetch: (from: number, to: number) => PromiseLike<Result<unknown[]>>): Promise<Row[]> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const value = await this.raw(fetch(from, from + PAGE_SIZE - 1));
      if (!Array.isArray(value)) throw new BackendException("invalid_response", "Respons server tidak valid.");
      const page = value as Row[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    return rows;
  }

  async businessConfig(): Promise<BusinessConfig> {
    try {
      return businessConfigFromMap(decodeRpcRow(await this.raw(this.sb.rpc("get_public_app_config"))));
    } catch {
      return DEFAULT_BUSINESS_CONFIG;
    }
  }

  // ── Profil ──
  async currentProfile(): Promise<Profile | null> {
    const { data } = await this.sb.auth.getSession();
    const user = data.session?.user;
    if (!user) return null;
    const row = await this.raw(this.sb.from("profiles").select().eq("id", user.id).maybeSingle());
    if (row) return profileFromMap(row as Row);
    // Fall back to auth metadata when the profile row was not created yet.
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    return {
      id: user.id,
      name: String(metadata.full_name ?? metadata.name ?? "Pengguna"),
      email: user.email ?? "",
      phone: "",
      avatarUrl: typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
      lastMode: "consumer",
      suspendedAt: null,
      suspendedReason: null,
    };
  }

  async updateProfile(fields: { name?: string; email?: string; phone?: string; avatarUrl?: string }): Promise<void> {
    const uid = await this.requireUid();
    const data: Record<string, unknown> = {};
    if (fields.name !== undefined) data.name = fields.name;
    if (fields.email !== undefined) {
      const { data: current } = await this.sb.auth.getSession();
      if (fields.email.trim() !== current.session?.user.email) {
        const { error } = await this.sb.auth.updateUser(
          { email: fields.email.trim() },
          { emailRedirectTo: authCallbackUrl(window.location.origin, "/profile") },
        );
        if (error) throw new BackendException("authentication_required", "Sesi berakhir. Silakan masuk kembali.");
      }
    }
    if (fields.phone !== undefined) data.phone = fields.phone;
    if (fields.avatarUrl !== undefined) data.avatar_url = fields.avatarUrl;
    if (!Object.keys(data).length) return;
    await this.raw(this.sb.from("profiles").update(data).eq("id", uid));
  }

  async setLastMode(mode: string): Promise<void> {
    const uid = await this.requireUid();
    await this.raw(this.sb.from("profiles").update({ last_mode: mode }).eq("id", uid));
  }

  // ── Browse ──
  async nearbyBags({
    latitude,
    longitude,
    filter = EMPTY_FILTER,
  }: {
    latitude?: number | null;
    longitude?: number | null;
    filter?: BagFilter;
  }): Promise<Bag[]> {
    // `available_bags` already filters date, stock and pickup on Jakarta
    // server time. Do not repeat it with the device clock.
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("available_bags")
        .select()
        .eq("status", "active")
        .gt("quantity_left", 0)
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    const hasPoint = latitude !== null && latitude !== undefined && longitude !== null && longitude !== undefined;
    const bags = rows
      .map((row) => bagFromMap(row))
      .map((bag) => {
        const lat = bag.merchant.latitude;
        const lng = bag.merchant.longitude;
        if (!hasPoint || lat === null || lng === null) return bag;
        const km = distanceKm(latitude, longitude, lat, lng);
        return { ...bag, merchant: { ...bag.merchant, distance: `${km.toFixed(1)} km` } };
      })
      .filter((bag) => bagMatchesFilter(bag, filter));
    if (hasPoint) {
      const km = (bag: Bag) => {
        const value = Number.parseFloat(bag.merchant.distance.split(" ")[0]);
        return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
      };
      bags.sort((a, b) => km(a) - km(b));
    }
    return bags;
  }

  async searchBags(
    query: string,
    options: { latitude?: number | null; longitude?: number | null; filter?: BagFilter },
  ): Promise<Bag[]> {
    const all = await this.nearbyBags(options);
    const q = query.toLowerCase();
    return all.filter(
      (bag) =>
        bag.title.toLowerCase().includes(q) ||
        bag.merchant.name.toLowerCase().includes(q) ||
        bag.merchant.category.toLowerCase().includes(q),
    );
  }

  async bagsByMerchant(merchantId: string): Promise<Bag[]> {
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("available_bags")
        .select()
        .eq("merchant_id", merchantId)
        .eq("status", "active")
        .gt("quantity_left", 0)
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    return rows.map((row) => bagFromMap(row));
  }

  async bagById(bagId: string): Promise<Bag | null> {
    const row = await this.raw(this.sb.from("available_bags").select().eq("id", bagId).maybeSingle());
    return row ? bagFromMap(row as Row) : null;
  }

  async merchantById(merchantId: string): Promise<Merchant | null> {
    const row = await this.raw(this.sb.from("public_merchants").select().eq("id", merchantId).maybeSingle());
    return row ? merchantFromMap(row as Row) : null;
  }

  // ── Favorit ──
  async favoriteMerchantIds(): Promise<Set<string>> {
    const uid = await this.uid();
    if (!uid) return new Set();
    const rows = await this.pagedRows((from, to) =>
      this.sb.from("favorites").select("merchant_id").eq("consumer_id", uid).range(from, to),
    );
    return new Set(rows.map((row) => String(row.merchant_id)));
  }

  async toggleFavorite(merchantId: string): Promise<boolean> {
    await this.requireUid();
    return rpcBool(await this.guard(this.sb.rpc("toggle_favorite", { p_merchant_id: merchantId })));
  }

  async favoriteStores(): Promise<FavoriteStore[]> {
    const ids = [...(await this.favoriteMerchantIds())];
    if (!ids.length) return [];
    const merchants = (await this.raw(this.sb.from("public_merchants").select().in("id", ids))) ?? [];
    const counts =
      (await this.raw(
        this.sb.from("available_bags").select("merchant_id").eq("status", "active").gt("quantity_left", 0).in("merchant_id", ids),
      )) ?? [];
    const byMerchant = new Map<string, number>();
    for (const count of counts as Row[]) {
      const id = String(count.merchant_id);
      byMerchant.set(id, (byMerchant.get(id) ?? 0) + 1);
    }
    return (merchants as Row[]).map((row) => {
      const merchant = merchantFromMap(row);
      const n = byMerchant.get(merchant.id) ?? 0;
      return { merchant, availability: n > 0 ? `${n} bag tersedia` : "Habis hari ini", soldOut: n === 0 };
    });
  }

  // ── Pesanan konsumen ──
  async placeOrder(bag: Bag, quantity: number, method: string, idempotencyKey: string): Promise<OrderRecord> {
    if (quantity <= 0) throw new BackendException("invalid_quantity", "Jumlah bag minimal 1.");
    const row = await this.invokePaymentFunction("midtrans-create", {
      bag_id: bag.id,
      quantity,
      payment_method: method,
      idempotency_key: idempotencyKey,
    });
    return { ...orderRecordFromMap(row), bag };
  }

  // ── Pengaduan ──
  async myComplaints(): Promise<Complaint[]> {
    const uid = await this.uid();
    if (!uid) return [];
    const rows = await this.raw(this.sb.from("complaints").select().eq("consumer_id", uid));
    return ((rows ?? []) as Row[]).map(complaintFromMap);
  }

  async submitComplaint(order: OrderRecord, category: ComplaintCategory, description: string): Promise<Complaint> {
    const row = await this.guard(
      this.sb.rpc("submit_complaint", { p_order_id: order.id, p_category: category, p_description: description.trim() }),
    );
    return complaintFromMap(decodeRpcRow(row));
  }

  // ── Admin ──
  async isAdmin(): Promise<boolean> {
    if (!(await this.uid())) return false;
    return rpcBool(await this.raw(this.sb.rpc("current_user_is_admin")));
  }

  async adminStats(): Promise<AdminStats> {
    return adminStatsFromMap(decodeRpcRow(await this.guard(this.sb.rpc("admin_dashboard_stats"))));
  }

  async adminMerchants(): Promise<AdminMerchant[]> {
    return rowList(await this.guard(this.sb.rpc("admin_list_merchants"))).map(adminMerchantFromMap);
  }

  async setMerchantVerification(merchantId: string, status: "verified" | "rejected", note?: string): Promise<void> {
    await this.guard(
      this.sb.rpc("admin_set_merchant_verification", { p_merchant_id: merchantId, p_status: status, p_note: note ?? null }),
    );
  }

  async adminUsers(search?: string): Promise<AdminUser[]> {
    return rowList(await this.guard(this.sb.rpc("admin_list_users", { p_search: search?.trim() || null }))).map(adminUserFromMap);
  }

  async setUserSuspended(userId: string, suspended: boolean, reason?: string): Promise<void> {
    await this.guard(
      this.sb.rpc("admin_set_user_suspended", { p_user_id: userId, p_suspended: suspended, p_reason: reason ?? null }),
    );
  }

  async adminComplaints(): Promise<AdminComplaint[]> {
    return rowList(await this.guard(this.sb.rpc("admin_list_complaints"))).map(adminComplaintFromMap);
  }

  async updateComplaint(complaintId: string, status: Exclude<ComplaintStatus, "open">, note?: string): Promise<void> {
    await this.guard(
      this.sb.rpc("admin_update_complaint", { p_complaint_id: complaintId, p_status: status, p_note: note ?? null }),
    );
  }

  async transactionReport(from: string, to: string): Promise<TransactionReport> {
    return transactionReportFromMap(
      decodeRpcRow(await this.guard(this.sb.rpc("admin_transaction_report", { p_from: from, p_to: to }))),
    );
  }

  async refreshPayment(order: OrderRecord): Promise<OrderRecord> {
    if (!order.id) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    const row = await this.invokePaymentFunction("midtrans-status", { order_id: order.id });
    return { ...orderRecordFromMap(row), bag: order.bag };
  }

  async activeOrders(): Promise<OrderRecord[]> {
    const uid = await this.uid();
    if (!uid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("consumer_orders")
        .select()
        .eq("consumer_id", uid)
        .in("status", ["pending", "paid", "preparing", "ready"])
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    return rows.map(orderRecordFromMap);
  }

  async orderHistory(): Promise<OrderRecord[]> {
    const uid = await this.uid();
    if (!uid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("consumer_orders")
        .select()
        .eq("consumer_id", uid)
        .in("status", ["redeemed", "expired", "cancelled", "refunded"])
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    return rows.map(orderRecordFromMap);
  }

  async issuePickupToken(order: OrderRecord): Promise<OrderRecord> {
    if (!order.id) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    const row = decodeRpcRow(await this.guard(this.sb.rpc("issue_pickup_token", { p_order_id: order.id })));
    const token = String(row.pickup_code ?? "");
    if (!token) throw new BackendException("pickup_token_unavailable", "QR pickup belum dapat dibuat. Coba lagi.");
    return { ...order, pickupToken: token };
  }

  async submitReview(order: OrderRecord, rating: number, tags: string[], comment: string): Promise<void> {
    await this.requireUid();
    if (!order.id) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    await this.guard(
      this.sb.rpc("submit_review", { p_order_id: order.id, p_rating: rating, p_tags: tags, p_comment: comment.trim() }),
    );
  }

  // ── Notifikasi ──
  async notifications(): Promise<AppNotification[]> {
    const uid = await this.uid();
    if (!uid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb.from("notifications").select().eq("user_id", uid).order("created_at", { ascending: false }).range(from, to),
    );
    return rows.map(notificationFromMap);
  }

  async markAllNotificationsRead(): Promise<void> {
    const uid = await this.requireUid();
    await this.raw(this.sb.from("notifications").update({ read: true }).eq("user_id", uid));
  }

  /**
   * Dart's `.stream()` emits the current rows and then re-emits on every
   * change. Here: an initial fetch, then a debounced refetch per change.
   */
  private watch<T>(
    topic: string,
    table: string,
    filter: () => Promise<string | null>,
    load: () => Promise<T[]>,
    onData: (values: T[]) => void,
    onError: (error: unknown) => void,
  ): Unsubscribe {
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let sequence = 0;

    const emit = () => {
      const current = ++sequence;
      load().then(
        (values) => {
          if (!disposed && current === sequence) onData(values);
        },
        (error: unknown) => {
          if (!disposed) onError(error);
        },
      );
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(emit, 250);
    };

    void (async () => {
      try {
        const value = await filter();
        if (disposed) return;
        if (value === null) {
          onData([]);
          return;
        }
        emit();
        channel = this.sb
          .channel(`${topic}:${value}:${Math.random().toString(36).slice(2, 8)}`)
          .on("postgres_changes", { event: "*", schema: "public", table, filter: value }, () => {
            if (!disposed) schedule();
          })
          .subscribe((status) => {
            if (disposed) return;
            if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              // Realtime is an enhancement: keep the last snapshot and let
              // the screens' manual refresh paths recover.
            }
          });
      } catch (error) {
        if (!disposed) onError(error);
      }
    })();

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      if (channel) {
        const active = channel;
        channel = null;
        void this.sb.removeChannel(active).catch(() => undefined);
      }
    };
  }

  watchNotifications(onData: (values: AppNotification[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return this.watch(
      "notifications",
      "notifications",
      async () => {
        const uid = await this.uid();
        return uid ? `user_id=eq.${uid}` : null;
      },
      () => this.notifications(),
      onData,
      onError,
    );
  }

  // ── Toko ──
  async myStore(): Promise<StoreProfile | null> {
    if (!(await this.uid())) return null;
    const response = await this.raw(this.sb.rpc("get_my_merchant"));
    if (response === null || response === undefined) return null;
    return storeFromMap(decodeRpcRow(response));
  }

  async upsertStore(input: StoreInput): Promise<void> {
    const uid = await this.requireUid();
    const data: Record<string, unknown> = {
      store_name: input.name,
      category: input.category,
      address: input.address,
      open_time: input.open,
      close_time: input.close,
      description: input.description ?? "",
      ...(input.logoUrl ? { logo_url: input.logoUrl } : {}),
      ...(input.latitude !== null && input.latitude !== undefined ? { lat: input.latitude } : {}),
      ...(input.longitude !== null && input.longitude !== undefined ? { lng: input.longitude } : {}),
    };
    const existingId = await this.storeId();
    if (!existingId) await this.raw(this.sb.from("merchants").insert({ ...data, user_id: uid }));
    else await this.raw(this.sb.from("merchants").update(data).eq("id", existingId));
    this.clearSessionCache();
  }

  // ── Bag merchant ──
  async myBags(): Promise<MerchantBag[]> {
    const sid = await this.storeId();
    if (!sid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb.from("surprise_bags").select().eq("merchant_id", sid).order("created_at", { ascending: false }).range(from, to),
    );
    return rows.map(merchantBagFromMap);
  }

  async addBag(input: BagInput): Promise<void> {
    const contentsError = bagContentsValidationError(input.contents);
    if (contentsError) throw new BackendException("invalid_bag_contents", contentsError);
    const sid = await this.requireStoreId();
    await this.raw(
      this.sb.from("surprise_bags").insert({
        merchant_id: sid,
        title: input.title,
        description: input.description.trim(),
        contents: normalizeBagContents(input.contents),
        original_price: input.originalPrice,
        sale_price: input.salePrice,
        quantity_total: input.total,
        quantity_left: input.total,
        pickup_window: input.pickupWindow,
        available_on: input.availableOn ? dateText(input.availableOn) : null,
        pickup_start_at: input.pickupStartsAt ? input.pickupStartsAt.toISOString() : null,
        pickup_end_at: input.pickupEndsAt ? input.pickupEndsAt.toISOString() : null,
        image_url: input.imageUrl ?? null,
        status: "active",
      }),
    );
  }

  async updateBag(bag: MerchantBag, input: BagInput): Promise<void> {
    const contentsError = bagContentsValidationError(input.contents);
    if (contentsError) throw new BackendException("invalid_bag_contents", contentsError);
    if (input.total < bag.sold) {
      throw new BackendException(
        "invalid_quantity",
        "Jumlah total tidak boleh lebih kecil dari jumlah yang sudah terjual.",
      );
    }
    const now = jakartaNow();
    const effectiveDate =
      input.availableOn ?? bag.availableOn ?? new Date(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const effectiveStart = input.pickupStartsAt ?? bag.pickupStartsAt;
    const effectiveEnd = input.pickupEndsAt ?? bag.pickupEndsAt;
    await this.guard(
      this.sb.rpc("update_surprise_bag", {
        p_bag_id: bag.id,
        p_title: input.title,
        p_description: input.description.trim(),
        p_original_price: input.originalPrice,
        p_sale_price: input.salePrice,
        p_quantity_total: input.total,
        p_pickup_window: input.pickupWindow,
        p_image_url: input.imageUrl ?? (bag.image.startsWith("http") ? bag.image : null),
        p_available_on: dateText(effectiveDate),
        p_pickup_start_at: effectiveStart ? effectiveStart.toISOString() : null,
        p_pickup_end_at: effectiveEnd ? effectiveEnd.toISOString() : null,
        p_contents: normalizeBagContents(input.contents),
      }),
    );
  }

  async setBagActive(bag: MerchantBag, active: boolean): Promise<void> {
    await this.guard(this.sb.rpc("set_bag_active", { p_bag_id: bag.id, p_active: active }));
  }

  async duplicateBag(bag: MerchantBag): Promise<void> {
    const sid = await this.requireStoreId();
    const now = jakartaNow();
    const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const moveToTomorrow = (value: Date | null) => {
      if (!value) return null;
      const local = new Date(value.getTime() + 7 * HOUR_MS);
      return new Date(
        Date.UTC(
          tomorrow.getUTCFullYear(),
          tomorrow.getUTCMonth(),
          tomorrow.getUTCDate(),
          local.getUTCHours(),
          local.getUTCMinutes(),
          local.getUTCSeconds(),
        ) - 7 * HOUR_MS,
      );
    };
    await this.raw(
      this.sb.from("surprise_bags").insert({
        merchant_id: sid,
        title: bag.title,
        description: bag.description,
        contents: bag.contents,
        original_price: bag.originalPrice,
        sale_price: bag.salePrice,
        quantity_total: bag.total,
        quantity_left: bag.total,
        pickup_window: bag.pickupWindow,
        available_on: utcDateText(tomorrow),
        pickup_start_at: moveToTomorrow(bag.pickupStartsAt)?.toISOString() ?? null,
        pickup_end_at: moveToTomorrow(bag.pickupEndsAt)?.toISOString() ?? null,
        image_url: bag.image.startsWith("http") ? bag.image : null,
        status: "active",
      }),
    );
  }

  // ── Order masuk + statistik ──
  async incomingOrders(): Promise<IncomingOrder[]> {
    const sid = await this.storeId();
    if (!sid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb.from("merchant_orders").select().eq("merchant_id", sid).order("created_at", { ascending: false }).range(from, to),
    );
    return rows.map(incomingOrderFromMap);
  }

  watchIncomingOrders(onData: (values: IncomingOrder[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return this.watch(
      "merchant-orders",
      "orders",
      async () => {
        const sid = await this.storeId();
        return sid ? `merchant_id=eq.${sid}` : null;
      },
      () => this.incomingOrders(),
      onData,
      onError,
    );
  }

  async markOrderReady(orderId: string): Promise<void> {
    if (!orderId) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    await this.guard(this.sb.rpc("mark_order_ready", { p_order_id: orderId }));
  }

  async cancelMerchantOrder(orderId: string): Promise<IncomingOrder> {
    if (!orderId) throw new BackendException("order_not_found", "Pesanan tidak ditemukan.");
    return incomingOrderFromMap(await this.invokePaymentFunction("midtrans-cancel", { order_id: orderId }));
  }

  async redeemOrder(code: string): Promise<IncomingOrder | null> {
    if (!code.trim()) throw new BackendException("invalid_pickup_code", "QR pickup tidak valid.");
    try {
      const response = await this.guard(this.sb.rpc("redeem_order", { p_code: code.trim() }));
      if (response === null || response === undefined || (Array.isArray(response) && !response.length)) return null;
      const row = decodeRpcRow(response);
      const name = String(row.customer_name ?? "Pelanggan");
      return incomingOrder({
        id: String(row.order_id ?? ""),
        customer: name,
        initial: initials2(name),
        time: timeLabel(row.created_at),
        bags: typeof row.quantity === "number" ? Math.trunc(row.quantity) : 1,
        code: String(row.pickup_code ?? ""),
        needsAction: false,
        redeemed: true,
        status: "redeemed",
        bagTitle: String(row.bag_title ?? ""),
        redeemedAt: parseDate(row.redeemed_at),
      });
    } catch (error) {
      // Unknown, rotated, or already used tokens deliberately look the same
      // to the scanner instead of becoming a generic server error.
      if (error instanceof BackendException && error.code === "order_not_found") return null;
      throw error;
    }
  }

  async merchantReviews(): Promise<MerchantReview[]> {
    if (!(await this.uid())) return [];
    const rows = await this.guard(this.sb.rpc("get_my_merchant_reviews"));
    if (rows === null || rows === undefined) return [];
    if (!Array.isArray(rows)) throw new BackendException("invalid_response", "Respons server tidak valid.");
    return (rows as Row[]).map(merchantReviewFromMap);
  }

  async merchantStats(): Promise<MerchantStats> {
    const sid = await this.storeId();
    if (!sid) return EMPTY_STATS;
    const bags = await this.pagedRows((from, to) =>
      this.sb.from("surprise_bags").select("id").eq("merchant_id", sid).eq("status", "active").range(from, to),
    );
    const now = jakartaNow();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 7 * HOUR_MS;
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()) - 7 * HOUR_MS).toISOString();
    const redeemed = await this.pagedRows((from, to) =>
      this.sb
        .from("orders")
        .select("quantity, merchant_net_amount, total_amount, redeemed_at")
        .eq("merchant_id", sid)
        .eq("status", "redeemed")
        .gte("redeemed_at", month)
        .order("redeemed_at", { ascending: false })
        .range(from, to),
    );
    const pending = await this.pagedRows((from, to) =>
      this.sb.from("orders").select("id").eq("merchant_id", sid).in("status", ["paid", "preparing", "ready"]).range(from, to),
    );
    let sold = 0;
    let income = 0;
    let monthlyIncome = 0;
    for (const order of redeemed) {
      const value =
        typeof order.merchant_net_amount === "number"
          ? Math.trunc(order.merchant_net_amount)
          : Math.round((typeof order.total_amount === "number" ? Math.trunc(order.total_amount) : 0) * 0.9);
      monthlyIncome += value;
      const redeemedAt = parseDate(order.redeemed_at);
      if (redeemedAt && redeemedAt.getTime() >= today) {
        sold += typeof order.quantity === "number" ? Math.trunc(order.quantity) : 0;
        income += value;
      }
    }
    return {
      bagsSoldToday: sold,
      incomeToday: income,
      activeBagCount: bags.length,
      pendingOrderCount: pending.length,
      incomeThisMonth: monthlyIncome,
      foodSavedKg: sold * 0.5,
    };
  }

  // ── Saldo ──
  async balance(): Promise<number> {
    const sid = await this.storeId();
    if (!sid) return 0;
    const row = (await this.raw(this.sb.from("merchant_balance").select("available").eq("merchant_id", sid).maybeSingle())) as Row | null;
    return typeof row?.available === "number" ? Math.trunc(row.available) : 0;
  }

  async transactions(): Promise<TxRecord[]> {
    const sid = await this.storeId();
    if (!sid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb.from("transactions").select().eq("merchant_id", sid).order("created_at", { ascending: false }).range(from, to),
    );
    return rows.map(txFromMap);
  }

  watchTransactions(onData: (values: TxRecord[]) => void, onError: (error: unknown) => void): Unsubscribe {
    return this.watch(
      "transactions",
      "transactions",
      async () => {
        const sid = await this.storeId();
        return sid ? `merchant_id=eq.${sid}` : null;
      },
      () => this.transactions(),
      onData,
      onError,
    );
  }

  async bankAccounts(): Promise<BankAccount[]> {
    if (!(await this.uid())) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("my_bank_accounts")
        .select()
        .order("is_default", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, to),
    );
    return rows.map(bankAccountFromMap);
  }

  async setDefaultBankAccount(bankAccountId: string): Promise<void> {
    if (!(await this.uid())) throw sessionExpired();
    await this.guard(this.sb.rpc("set_default_bank_account", { p_bank_account_id: bankAccountId }));
  }

  async saveBankAccount(input: {
    bankCode: string;
    bankName: string;
    accountNumber: string;
    accountHolder: string;
    idempotencyKey: string;
  }): Promise<BankAccount> {
    const params = buildBankAccountRpcParams(input);
    const register = async () => {
      const row = { ...decodeRpcRow(await this.guard(this.sb.rpc("register_bank_account", params))) };
      const normalizedCode = params.p_bank_code;
      const returnedName = typeof row.bank_name === "string" ? row.bank_name.trim() : "";
      const fallbackName = input.bankName.trim();
      if (!returnedName || returnedName.toUpperCase() === normalizedCode) {
        row.bank_name = fallbackName || normalizedCode;
      }
      return bankAccountFromMap(row);
    };
    try {
      return await register();
    } catch (error) {
      if (!shouldRetryBankAccountRegistration(error)) throw error;
      // `register_bank_account` is idempotent: one retry with the same payload
      // recovers a lost response without creating a duplicate account.
      return register();
    }
  }

  async payoutRequests(): Promise<PayoutRequest[]> {
    const sid = await this.storeId();
    if (!sid) return [];
    const rows = await this.pagedRows((from, to) =>
      this.sb
        .from("payout_requests")
        .select(PAYOUT_SELECT)
        .eq("merchant_id", sid)
        .order("requested_at", { ascending: false })
        .range(from, to),
    );
    return rows.map((row) => payoutRequestFromMap(row));
  }

  async requestPayout(input: { amount: number; bankAccountId: string; idempotencyKey: string }): Promise<PayoutRequest> {
    const row = decodeRpcRow(
      await this.guard(
        this.sb.rpc("request_withdrawal", {
          p_bank_account_id: input.bankAccountId,
          p_amount: input.amount,
          p_idempotency_key: input.idempotencyKey,
        }),
      ),
    );
    const accounts = await this.bankAccounts();
    const account = accounts.find((item) => item.id === input.bankAccountId) ?? null;
    return payoutRequestFromMap(row, account);
  }

  async deleteAccount(): Promise<void> {
    const uid = await this.requireUid();
    // Phase one locks the account and checks active orders/payouts before any
    // Storage object is deleted. The marker is idempotent, so retries are safe.
    await this.guard(this.sb.rpc("prepare_delete_my_account"));
    for (const bucket of ["bag-images", "store-logos", "avatars"]) {
      await this.deleteStorageFolder(bucket, uid);
    }
    await this.guard(this.sb.rpc("delete_my_account"));
    this.clearSessionCache();
  }

  private async deleteStorageFolder(bucket: string, uid: string): Promise<void> {
    for (;;) {
      const { data, error } = await this.sb.storage.from(bucket).list(uid, { limit: 100, offset: 0 });
      if (error) throw new BackendException("upload_failed", "Gambar gagal diunggah. Periksa koneksi dan coba lagi.");
      const objects = data ?? [];
      if (!objects.length) return;
      const removal = await this.sb.storage.from(bucket).remove(objects.map((object) => `${uid}/${object.name}`));
      if (removal.error) throw new BackendException("upload_failed", "Gambar gagal diunggah. Periksa koneksi dan coba lagi.");
      if (objects.length < 100) return;
    }
  }

  // ── Storage ──
  uploadImage(bucket: BackendBucket): Promise<string | null> {
    // Opened synchronously so the browser still sees the user's tap.
    const picked = pickImageFile();
    return picked.then(async (file) => {
      if (!file) return null;
      let bytes: Uint8Array;
      let filename: string;
      try {
        ({ bytes, filename } = await compressImage(file, 1280, 0.8));
      } catch {
        throw new BackendException("upload_failed", "Gambar gagal diunggah. Periksa koneksi dan coba lagi.");
      }
      return this.uploadImageBytes(bucket, bytes, filename);
    });
  }

  async uploadImageBytes(bucket: BackendBucket, bytes: Uint8Array, filename: string): Promise<string | null> {
    const uid = await this.requireUid();
    if (bytes.length > 2 * 1024 * 1024) throw new BackendException("image_too_large", "Ukuran gambar maksimal 2 MB.");
    const bucketName = bucket === "bag" ? "bag-images" : bucket === "logo" ? "store-logos" : "avatars";
    const rawExt = filename.includes(".") ? (filename.split(".").pop() ?? "jpg").toLowerCase() : "jpg";
    const ext = ["jpg", "jpeg", "png", "webp"].includes(rawExt) ? rawExt : "jpg";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const path = `${uid}/${Date.now()}.${ext}`;
    const { error } = await this.sb.storage
      .from(bucketName)
      .upload(path, new Blob([bytes as BlobPart], { type: mime }), { upsert: false, contentType: mime, cacheControl: "31536000" });
    if (error) throw new BackendException("upload_failed", "Gambar gagal diunggah. Periksa koneksi dan coba lagi.");
    return this.sb.storage.from(bucketName).getPublicUrl(path).data.publicUrl;
  }

  // ── Edge Functions ──
  private async invokePaymentFunction(name: string, body: Record<string, unknown>): Promise<Row> {
    await this.requireUid();
    let payload: unknown;
    try {
      const { data, error } = await this.sb.functions.invoke(name, { body });
      if (error) throw error;
      payload = data;
    } catch (error) {
      if (error instanceof BackendException) throw error;
      if (error instanceof FunctionsHttpError) {
        const response = error.context as Response | undefined;
        let details: unknown = null;
        try {
          details = await response?.clone().json();
        } catch {
          try {
            details = await response?.text();
          } catch {
            details = null;
          }
        }
        const detailMap = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
        const code = String(detailMap.code ?? "");
        const message = String(detailMap.message ?? detailMap.error ?? (typeof details === "string" ? details : ""));
        throw paymentException(code, message, response?.status ?? 500);
      }
      if (error instanceof FunctionsRelayError || error instanceof FunctionsFetchError || error instanceof Error) {
        throw new BackendException(
          "payment_unreachable",
          "Layanan pembayaran belum dapat dihubungi. Periksa koneksi lalu coba lagi.",
        );
      }
      throw new BackendException(
        "payment_unreachable",
        "Layanan pembayaran belum dapat dihubungi. Periksa koneksi lalu coba lagi.",
      );
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BackendException("invalid_response", "Respons pembayaran tidak valid.");
    }
    const data = payload as Row;
    const rawOrder = data.order ?? data;
    if (!rawOrder || typeof rawOrder !== "object" || Array.isArray(rawOrder)) {
      throw new BackendException("invalid_response", "Data pesanan dari pembayaran tidak valid.");
    }
    const order: Row = { ...(rawOrder as Row) };
    // Simulator metadata only comes from the fail-closed sandbox helper in
    // the Edge Function; production never receives it.
    const simulatorUrl = data.simulator_qr_image_url;
    let sandbox = false;
    try {
      sandbox = publicConfig().midtransEnvironment === "sandbox";
    } catch {
      sandbox = false;
    }
    if (
      sandbox &&
      name === "midtrans-status" &&
      typeof simulatorUrl === "string" &&
      simulatorUrl.trim() &&
      simulatorUrl.length <= 2048
    ) {
      order.simulator_qr_image_url = simulatorUrl.trim();
    }
    return order;
  }
}

export { RawBackendError };
