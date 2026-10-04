/**
 * The pure helpers of `lib/backend/supabase.ts`: the static members of
 * `SupabaseBackend` covered by `test/finance_mapping_test.dart`, plus the
 * Indonesian error mapping of Dart's `_guard` and `_paymentException`.
 */
import { describe, expect, it } from "vitest";
import {
  RawBackendError,
  bankAccountExceptionFromMessage,
  buildBankAccountRpcParams,
  decodeRpcRow,
  mapPostgrestError,
  paymentException,
  shouldRetryBankAccountRegistration,
} from "../lib/backend/supabase";
import { BackendException } from "../lib/backend/types";
import { bankAccountFromMap } from "../lib/mappers";

function thrown(action: () => unknown): BackendException {
  try {
    action();
  } catch (error) {
    if (error instanceof BackendException) return error;
    throw error;
  }
  throw new Error("Expected a BackendException");
}

describe("buildBankAccountRpcParams", () => {
  it("payload RPC rekening dinormalisasi sesuai kontrak server", () => {
    const params = buildBankAccountRpcParams({
      bankCode: " bca ",
      accountNumber: "1234-5678 90",
      accountHolder: "  TEST USER  ",
      idempotencyKey: " bank-request-1 ",
    });

    expect(params).toEqual({
      p_bank_code: "BCA",
      p_account_holder: "TEST USER",
      p_account_number: "1234567890",
      p_idempotency_key: "bank-request-1",
    });
  });

  it("payload RPC rekening menolak data invalid sebelum request", () => {
    const error = thrown(() =>
      buildBankAccountRpcParams({
        bankCode: "BCA",
        accountNumber: "12345",
        accountHolder: "TEST USER",
        idempotencyKey: "bank-request-2",
      }),
    );
    expect(error.code).toBe("invalid_bank_account_number");
    expect(error.message).toBe("Nomor rekening harus berisi 6–20 digit.");
  });

  const valid = { bankCode: "BCA", accountNumber: "123456", accountHolder: "TE", idempotencyKey: "12345678" };

  it("accepts the boundaries of every field", () => {
    expect(() => buildBankAccountRpcParams(valid)).not.toThrow();
    expect(() =>
      buildBankAccountRpcParams({
        bankCode: "BANK_CODE_20_CHARS_X",
        accountNumber: "1".repeat(20),
        accountHolder: "A".repeat(100),
        idempotencyKey: "k".repeat(128),
      }),
    ).not.toThrow();
  });

  it.each([
    [{ bankCode: "B" }, "invalid_bank_code", "Pilih bank yang valid."],
    [{ bankCode: "BCA!" }, "invalid_bank_code", "Pilih bank yang valid."],
    [{ bankCode: "B".repeat(21) }, "invalid_bank_code", "Pilih bank yang valid."],
    [{ accountNumber: "1".repeat(21) }, "invalid_bank_account_number", "Nomor rekening harus berisi 6–20 digit."],
    [{ accountNumber: "abc-def" }, "invalid_bank_account_number", "Nomor rekening harus berisi 6–20 digit."],
    [{ accountHolder: " A " }, "invalid_bank_account_holder", "Nama pemilik rekening harus berisi 2–100 karakter."],
    [{ accountHolder: "A".repeat(101) }, "invalid_bank_account_holder", "Nama pemilik rekening harus berisi 2–100 karakter."],
    [{ idempotencyKey: " 1234567 " }, "invalid_idempotency_key", "Permintaan rekening tidak valid. Silakan coba lagi."],
    [{ idempotencyKey: "k".repeat(129) }, "invalid_idempotency_key", "Permintaan rekening tidak valid. Silakan coba lagi."],
  ])("rejects %o with %s", (patch, code, message) => {
    const error = thrown(() => buildBankAccountRpcParams({ ...valid, ...patch }));
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
  });
});

describe("decodeRpcRow", () => {
  it("respons RPC object dan single-row list dipetakan identik", () => {
    const row = {
      id: "bank-remote",
      bank_code: "BCA",
      bank_name: "Bank Central Asia",
      account_number_last4: "7890",
      account_holder: "TEST USER",
      status: "pending",
      is_default: true,
    };

    for (const response of [row, [row]]) {
      const account = bankAccountFromMap(decodeRpcRow(response));
      expect(account.id).toBe("bank-remote");
      expect(account.accountNumberMasked).toBe("•••• 7890");
      expect(account.status).toBe("pending");
      expect(account.isDefault).toBe(true);
    }
  });

  it("rejects empty, scalar, and nested-list responses", () => {
    const invalid: unknown[] = [null, undefined, [], "row", 42, true, [42], [null], [[{ id: "nested" }]]];
    for (const value of invalid) {
      const error = thrown(() => decodeRpcRow(value));
      expect(error.code).toBe("invalid_response");
      expect(error.message).toBe("Respons server tidak valid.");
    }
  });

  it("only the first row of a list is used", () => {
    expect(decodeRpcRow([{ id: "first" }, { id: "second" }])).toEqual({ id: "first" });
  });
});

describe("bankAccountExceptionFromMessage", () => {
  it("error RPC rekening tidak jatuh ke pesan server generik", () => {
    const invalidNumber = bankAccountExceptionFromMessage("invalid account number");
    const unavailable = bankAccountExceptionFromMessage("bank security configuration is unavailable");

    expect(invalidNumber?.code).toBe("invalid_bank_account_number");
    expect(invalidNumber?.message).toContain("6–20 digit");
    expect(unavailable?.code).toBe("bank_registration_unavailable");
    expect(unavailable?.message).not.toContain("security configuration");
    expect(bankAccountExceptionFromMessage("insufficient stock")).toBeNull();
  });

  it.each([
    ["ERROR: Invalid Bank Code", "invalid_bank_code", "Bank yang dipilih tidak valid. Pilih ulang lalu coba lagi."],
    ["invalid account holder", "invalid_bank_account_holder", "Nama pemilik rekening harus berisi 2–100 karakter."],
    ["idempotency key must contain 8-128 characters", "invalid_idempotency_key", "Permintaan rekening tidak valid. Silakan coba lagi."],
    [
      "bank account registration is no longer active",
      "bank_registration_inactive",
      "Pendaftaran rekening sebelumnya sudah tidak aktif. Masukkan kembali data rekening untuk membuat permintaan baru.",
    ],
    [
      "stored bank destination does not match registration",
      "bank_registration_unavailable",
      "Pendaftaran rekening sedang tidak tersedia. Coba lagi nanti.",
    ],
    ["bank account not found", "bank_account_not_found", "Rekening tidak ditemukan atau sudah dinonaktifkan."],
  ])("%s → %s", (message, code, text) => {
    const error = bankAccountExceptionFromMessage(message);
    expect(error?.code).toBe(code);
    expect(error?.message).toBe(text);
  });
});

describe("shouldRetryBankAccountRegistration", () => {
  it("hanya kegagalan ambigu pendaftaran rekening yang aman diulang", () => {
    expect(shouldRetryBankAccountRegistration(new BackendException("invalid_response", "Respons terputus."))).toBe(true);
    expect(shouldRetryBankAccountRegistration(new Error("network response closed"))).toBe(true);
    expect(
      shouldRetryBankAccountRegistration(new BackendException("invalid_bank_account_number", "Nomor rekening invalid.")),
    ).toBe(false);
    expect(shouldRetryBankAccountRegistration(new BackendException("not_authenticated", "Sesi berakhir."))).toBe(false);
    expect(shouldRetryBankAccountRegistration(new BackendException("server_error", "x"))).toBe(true);
    expect(shouldRetryBankAccountRegistration(new BackendException("network_error", "x"))).toBe(true);
  });
});

describe("mapPostgrestError (Dart `_guard`)", () => {
  const map = (message: string, extra: { details?: string; hint?: string; code?: string } = {}) => {
    const error = mapPostgrestError({ message, ...extra });
    if (!(error instanceof BackendException)) throw new Error(`Not a BackendException: ${String(error)}`);
    return error;
  };

  it.each([
    ["insufficient stock for bag", "insufficient_stock", "Stok bag sudah berubah. Silakan cek kembali."],
    ["not authenticated", "not_authenticated", "Sesi berakhir. Silakan masuk kembali."],
    ["merchant cannot purchase own bag", "self_purchase_forbidden", "Merchant tidak dapat membeli bag dari tokonya sendiri."],
    ["merchant not found", "merchant_not_found", "Toko tidak ditemukan atau sudah tidak aktif."],
    ["order not found", "order_not_found", "Pesanan tidak ditemukan."],
    ["invalid pickup token", "invalid_pickup_code", "QR pickup tidak valid."],
    ["pickup window has not started", "pickup_not_started", "Waktu pickup pesanan belum dimulai."],
    ["only paid orders can be marked ready", "invalid_order_status", "Status pesanan sudah berubah. Muat ulang daftar pesanan."],
    ["order is not ready for pickup", "order_not_redeemable", "QR baru tersedia setelah merchant menandai pesanan siap."],
    ["order is not redeemable", "order_not_redeemable", "QR baru tersedia setelah merchant menandai pesanan siap."],
    ["payouts are disabled", "payout_disabled", "Fitur penarikan dana belum diaktifkan oleh operator."],
    ["idempotency key reused with a different payload", "idempotency_conflict", "Permintaan yang sama sudah diproses dengan data berbeda."],
    ["pickup token has expired", "pickup_token_expired", "QR sudah diperbarui. Minta pembeli menampilkan QR terbaru."],
    ["order expired", "expired", "Masa berlaku pesanan sudah berakhir."],
    ["order already redeemed", "already_redeemed", "Pesanan sudah pernah diambil."],
    ["order cannot be cancelled", "invalid_order_status", "Status pesanan sudah berubah dan tidak dapat dibatalkan."],
    ["order status changed", "invalid_order_status", "Status pesanan sudah berubah dan tidak dapat dibatalkan."],
    ["order does not belong to your merchant", "order_not_found", "Pesanan tidak ditemukan."],
    ["bank account not verified", "bank_not_verified", "Rekening masih dalam verifikasi."],
    ["insufficient balance", "insufficient_balance", "Saldo tidak mencukupi."],
    ["account cannot be deleted: payout pending", "payout_in_progress", "Akun belum dapat dihapus karena penarikan dana masih diproses."],
    ["account cannot be deleted: active order", "active_order_exists", "Akun belum dapat dihapus karena masih ada pesanan aktif."],
    ["duplicate key value violates unique constraint", "server_error", "Layanan sedang bermasalah. Silakan coba lagi."],
  ])("%s → %s", (message, code, text) => {
    const error = map(message);
    expect(error.code).toBe(code);
    expect(error.message).toBe(text);
  });

  it("reads details, hint, and code too, case-insensitively", () => {
    expect(map("P0001", { details: "Insufficient Balance" }).code).toBe("insufficient_balance");
    expect(map("error", { hint: "Order Not Found" }).code).toBe("order_not_found");
    expect(map("error", { code: "not authenticated" }).code).toBe("not_authenticated");
  });

  it("bank RPC errors win over the generic rules (Dart checks them first)", () => {
    expect(map("idempotency key must contain 8-128 characters").code).toBe("invalid_idempotency_key");
    expect(map("bank account not found").code).toBe("bank_account_not_found");
  });

  it("the rule order matches Dart for overlapping phrases", () => {
    expect(map("insufficient stock; not authenticated").code).toBe("insufficient_stock");
    expect(map("pickup token has expired").code).not.toBe("expired");
    expect(map("idempotency window expired").code).toBe("idempotency_conflict");
    expect(map("account cannot be deleted: payout for order").code).toBe("payout_in_progress");
  });

  it("network failures stay raw (generic message), never a domain message", () => {
    for (const message of ["TypeError: Failed to fetch", "NetworkError when attempting to fetch resource.", "Load failed"]) {
      const error = mapPostgrestError({ message });
      expect(error).toBeInstanceOf(RawBackendError);
      expect(error).not.toBeInstanceOf(BackendException);
    }
  });
});

describe("paymentException (Dart `_paymentException`)", () => {
  it.each([
    ["", "", 401, "not_authenticated", "Sesi berakhir. Silakan masuk kembali."],
    ["unauthorized", "User not authenticated", 400, "not_authenticated", "Sesi berakhir. Silakan masuk kembali."],
    [
      "merchant_cancellation_pending",
      "",
      409,
      "merchant_cancellation_pending",
      "Konfirmasi pembatalan dari Midtrans masih diproses. Coba lagi sebentar.",
    ],
    [
      "merchant_cancellation_requires_review",
      "",
      409,
      "merchant_cancellation_requires_review",
      "Pembatalan ditahan untuk pemeriksaan operator. Pesanan tidak dapat diproses sementara.",
    ],
    ["invalid_order_status", "", 409, "invalid_order_status", "Status pesanan sudah berubah dan tidak dapat dibatalkan."],
    ["cancellation_claim_failed", "Klaim gagal.", 409, "cancellation_claim_failed", "Klaim gagal."],
    ["cancellation_claim_failed", "  ", 409, "cancellation_claim_failed", "Pembatalan belum dapat diproses. Coba lagi."],
    ["payment_state_not_persisted", "", 500, "payment_state_not_persisted", "Pembatalan belum dapat diproses. Coba lagi."],
    ["", "Midtrans server key is not configured", 500, "payment_not_configured", "Layanan pembayaran sedang tidak tersedia. Coba lagi nanti."],
    ["", "Midtrans credential rejected", 500, "payment_not_configured", "Layanan pembayaran sedang tidak tersedia. Coba lagi nanti."],
    ["", "insufficient stock", 409, "insufficient_stock", "Stok bag sudah berubah. Silakan cek kembali."],
    ["", "idempotency conflict", 409, "idempotency_conflict", "Permintaan pembayaran sudah diproses dengan data berbeda."],
    ["", "transaction expired", 410, "payment_expired", "Waktu pembayaran sudah berakhir. Silakan buat pesanan baru."],
    ["expire", "", 410, "payment_expired", "Waktu pembayaran sudah berakhir. Silakan buat pesanan baru."],
    ["", "payment was cancelled", 409, "payment_cancelled", "Pembayaran dibatalkan atau ditolak oleh penyedia pembayaran."],
    ["deny", "", 409, "payment_cancelled", "Pembayaran dibatalkan atau ditolak oleh penyedia pembayaran."],
    ["", "Order not found", 404, "order_not_found", "Pesanan tidak ditemukan."],
    ["bag_unavailable", "boom", 500, "bag_unavailable", "Pembayaran belum dapat diproses. Coba lagi."],
    ["", "boom", 500, "payment_failed", "Pembayaran belum dapat diproses. Coba lagi."],
  ])("code=%j message=%j status=%d → %s", (code, message, status, expectedCode, text) => {
    const error = paymentException(code, message, status);
    expect(error).toBeInstanceOf(BackendException);
    expect(error.code).toBe(expectedCode);
    expect(error.message).toBe(text);
  });

  it("a Midtrans message without a credential hint is not a configuration problem", () => {
    expect(paymentException("", "Midtrans timeout", 502).code).toBe("payment_failed");
  });
});
