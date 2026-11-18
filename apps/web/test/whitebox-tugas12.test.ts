/**
 * Tugas 12 RPL: white-box test of three functions in lib/models.ts.
 * Every test name starts with its test case ID from the report.
 */
import { describe, expect, it } from "vitest";
import { bagContentsValidationError, canComplain, formatRupiah, type Complaint, type OrderRecord } from "../lib/models";
import { SampleData } from "../lib/sampleData";

const order = (fields: Partial<OrderRecord> = {}): OrderRecord => ({ ...SampleData.orderHistory[0], paymentState: "paid", ...fields });

const existingComplaint: Complaint = {
  id: "c-1",
  orderId: "order-1",
  category: "product",
  description: "Isi bag tidak sesuai deskripsi.",
  status: "open",
  adminNote: null,
  createdAt: null,
};

describe("WB-1 formatRupiah(value)", () => {
  it("WB-1.1 nilai bukan angka (NaN) -> dianggap 0", () => {
    expect(formatRupiah(Number.NaN)).toBe("Rp0");
  });
  it("WB-1.2 satu digit, perulangan berjalan 1 kali tanpa titik", () => {
    expect(formatRupiah(5)).toBe("Rp5");
  });
  it("WB-1.3 tiga digit, perulangan 3 kali tanpa titik", () => {
    expect(formatRupiah(500)).toBe("Rp500");
  });
  it("WB-1.4 empat digit, titik pemisah ribuan muncul", () => {
    expect(formatRupiah(1000)).toBe("Rp1.000");
  });
  it("WB-1.5 tujuh digit, titik muncul dua kali", () => {
    expect(formatRupiah(1250000)).toBe("Rp1.250.000");
  });
  it("WB-1.6 nilai negatif mendapat tanda minus", () => {
    expect(formatRupiah(-15000)).toBe("-Rp15.000");
  });
  it("WB-1.7 nilai pecahan dibulatkan ke bawah", () => {
    expect(formatRupiah(15999.9)).toBe("Rp15.999");
  });
});

describe("WB-2 bagContentsValidationError(values)", () => {
  it("WB-2.1 daftar kosong, perulangan tidak berjalan -> valid", () => {
    expect(bagContentsValidationError([])).toBeNull();
  });
  it("WB-2.2 satu item -> valid", () => {
    expect(bagContentsValidationError(["Roti tawar"])).toBeNull();
  });
  it("WB-2.3 item kosong dan spasi dilewati -> valid", () => {
    expect(bagContentsValidationError(["", "   ", "Donat"])).toBeNull();
  });
  it("WB-2.4 item duplikat (beda huruf besar/kecil) dihitung sekali", () => {
    const items = Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`);
    expect(bagContentsValidationError([...items, "ITEM 1"])).toBeNull();
  });
  it("WB-2.5 tepat 20 item (batas atas) -> valid", () => {
    expect(bagContentsValidationError(Array.from({ length: 20 }, (_, i) => `Item ${i + 1}`))).toBeNull();
  });
  it("WB-2.6 21 item (lewat batas) -> 'Maksimal 20 item'", () => {
    expect(bagContentsValidationError(Array.from({ length: 21 }, (_, i) => `Item ${i + 1}`))).toBe("Maksimal 20 item");
  });
  it("WB-2.7 satu item tepat 80 karakter (batas atas) -> valid", () => {
    expect(bagContentsValidationError(["a".repeat(80)])).toBeNull();
  });
  it("WB-2.8 satu item 81 karakter -> 'Setiap item maksimal 80 karakter'", () => {
    expect(bagContentsValidationError(["Roti", "a".repeat(81)])).toBe("Setiap item maksimal 80 karakter");
  });
});

describe("WB-3 canComplain(order, complaint)", () => {
  it("WB-3.1 id pesanan kosong -> tidak boleh mengadu", () => {
    expect(canComplain(order({ id: "" }), null)).toBe(false);
  });
  it("WB-3.2 pesanan sudah punya pengaduan -> tidak boleh mengadu lagi", () => {
    expect(canComplain(order(), existingComplaint)).toBe(false);
  });
  it("WB-3.3 pembayaran lunas (paid) -> boleh mengadu", () => {
    expect(canComplain(order({ paymentState: "paid" }), null)).toBe(true);
  });
  it("WB-3.4 pembayaran dikembalikan (refunded) -> boleh mengadu", () => {
    expect(canComplain(order({ paymentState: "refunded" }), undefined)).toBe(true);
  });
  it("WB-3.5 pembayaran disengketakan (disputed) -> boleh mengadu", () => {
    expect(canComplain(order({ paymentState: "disputed" }), null)).toBe(true);
  });
  it("WB-3.6 pembayaran belum lunas (pending) -> tidak boleh mengadu", () => {
    expect(canComplain(order({ paymentState: "pending" }), null)).toBe(false);
  });
});
