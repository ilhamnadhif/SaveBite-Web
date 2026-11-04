/**
 * The Admin workspace and consumer complaints: routing, row mapping, the
 * complaint eligibility rule, error messages, and the AppState use cases over
 * the demo backend. The role itself is enforced by the database RPCs.
 */
import { afterEach, describe, expect, it } from "vitest";
import { AppState } from "../lib/appState";
import { FakeBackend } from "../lib/backend/fake";
import type { BackendException } from "../lib/backend/types";
import { mapPostgrestError } from "../lib/backend/supabase";
import {
  adminComplaintFromMap,
  adminMerchantFromMap,
  adminStatsFromMap,
  adminUserFromMap,
  complaintFromMap,
  storeFromMap,
  transactionReportFromMap,
} from "../lib/mappers";
import { canComplain, type Complaint, type OrderRecord } from "../lib/models";
import { ADMIN_TAB_PATHS, isPublicPath, matchRoute, paths, routeSpace } from "../lib/routes";
import { SampleData } from "../lib/sampleData";
import { flush, resetSession, useBackend } from "./support/harness";

afterEach(flush);

const paidOrder = (fields: Partial<OrderRecord> = {}): OrderRecord => ({ ...SampleData.orderHistory[0], ...fields });

const complaint: Complaint = {
  id: "c-1",
  orderId: "order-2",
  category: "product",
  description: "Makanan tidak sesuai.",
  status: "open",
  adminNote: null,
  createdAt: null,
};

describe("routes", () => {
  it("every admin tab belongs to the admin space and needs a session", () => {
    ADMIN_TAB_PATHS.forEach((path, tab) => {
      expect(paths.adminTab(tab)).toBe(path);
      const match = matchRoute(path);
      expect(match).toEqual({ name: "adminTab", tab });
      if (match) expect(routeSpace(match)).toBe("admin");
      expect(isPublicPath(path)).toBe(false);
    });
  });

  it("an unknown admin path is a 404 and an out-of-range tab falls back home", () => {
    expect(matchRoute("/admin/secret")).toBeNull();
    expect(paths.adminTab(99)).toBe("/admin");
  });

  it("a complaint is a consumer screen", () => {
    const match = matchRoute(paths.complaint("order-1"));
    expect(match).not.toBeNull();
    if (match) expect(routeSpace(match)).toBe("consumer");
  });
});

describe("canComplain", () => {
  it("allows a paid order once", () => {
    expect(canComplain(paidOrder(), null)).toBe(true);
    expect(canComplain(paidOrder(), complaint)).toBe(false);
  });

  it("allows refunded and disputed payments, which still took money", () => {
    expect(canComplain(paidOrder({ paymentState: "refunded" }), null)).toBe(true);
    expect(canComplain(paidOrder({ paymentState: "disputed" }), null)).toBe(true);
  });

  it("rejects orders that were never paid", () => {
    expect(canComplain(paidOrder({ paymentState: "failed" }), null)).toBe(false);
    expect(canComplain(paidOrder({ paymentState: "pending" }), null)).toBe(false);
    expect(canComplain(paidOrder({ paymentState: "cancelled" }), null)).toBe(false);
    expect(canComplain(paidOrder({ id: "" }), null)).toBe(false);
  });
});

describe("mappers", () => {
  it("reads a store's verification, and treats a missing value as public", () => {
    expect(storeFromMap({ verification_status: "rejected", verification_note: "Foto buram" })).toMatchObject({
      verificationStatus: "rejected",
      verificationNote: "Foto buram",
    });
    expect(storeFromMap({ verification_status: "pending" }).verificationStatus).toBe("pending");
    expect(storeFromMap({}).verificationStatus).toBe("verified");
  });

  it("falls back on unknown complaint values", () => {
    expect(complaintFromMap({ category: "baru", status: "baru" })).toMatchObject({ category: "other", status: "open" });
  });

  it("maps the admin rows", () => {
    expect(
      adminComplaintFromMap({ id: "c", order_reference: "SB-1", total_amount: "21000", store_name: "Toko", consumer_email: "a@b.c" }),
    ).toMatchObject({ orderReference: "SB-1", totalAmount: 21000, storeName: "Toko", consumerName: "Pengguna", consumerEmail: "a@b.c" });
    expect(adminMerchantFromMap({ id: "m", store_name: "Toko", bag_count: 3 })).toMatchObject({ storeName: "Toko", bagCount: 3, ownerName: "Pengguna" });
    expect(adminUserFromMap({ id: "u", is_admin: true, order_count: "4" })).toMatchObject({ isAdmin: true, orderCount: 4, storeName: null, suspendedAt: null });
    expect(adminStatsFromMap({ pending_merchants: 2, gross_30d: "1000" })).toMatchObject({ pendingMerchants: 2, gross30d: 1000, openComplaints: 0 });
  });

  it("maps the report", () => {
    const report = transactionReportFromMap({
      summary: { settled_orders: 2, gross_amount: 42000, platform_revenue: 6000 },
      daily: [{ day: "2026-11-04", orders: 2, gross_amount: 42000 }],
      top_merchants: [{ id: "m", store_name: "Toko", orders: 2, gross_amount: 42000 }],
    });
    expect(report).toMatchObject({ settledOrders: 2, grossAmount: 42000, platformRevenue: 6000, unsettledOrders: 0 });
    expect(report.daily[0]).toEqual({ day: "2026-11-04", orders: 2, grossAmount: 42000 });
    expect(report.topMerchants[0].storeName).toBe("Toko");
    expect(transactionReportFromMap({}).daily).toEqual([]);
  });
});

describe("error messages", () => {
  const code = (message: string) => (mapPostgrestError({ message }) as BackendException).code;

  it("does not confuse an unverified store with an unverified bank account", () => {
    expect(code("merchant is not verified")).toBe("merchant_not_verified");
    expect(code("bank account is not verified")).toBe("bank_not_verified");
  });

  it("names the admin and complaint failures", () => {
    expect(code("admin access required")).toBe("admin_required");
    expect(code("account is suspended")).toBe("account_suspended");
    expect(code("complaint already submitted")).toBe("complaint_exists");
    expect(code("order is not eligible for a complaint")).toBe("complaint_not_allowed");
    expect(code("complaint is already closed")).toBe("complaint_closed");
    expect(code("verification note is required")).toBe("note_required");
    expect(code("admin accounts cannot be suspended")).toBe("admin_suspend");
  });
});

describe("seller verification", () => {
  it("keeps a new store hidden until an admin approves it", async () => {
    const backend = useBackend(new FakeBackend());
    await backend.upsertStore({ name: "Toko Uji", category: "Bakery", address: "Depok", open: "08.00", close: "21.00" });
    expect((await backend.myStore())?.verificationStatus).toBe("pending");
    const state = new AppState();
    await state.loadAdminData();
    expect(state.adminMerchants[0]).toMatchObject({ storeName: "Toko Uji", verificationStatus: "pending" });

    await state.setMerchantVerification("store-me", "rejected", "Alamat kurang lengkap");
    expect(await backend.myStore()).toMatchObject({ verificationStatus: "rejected", verificationNote: "Alamat kurang lengkap" });
    expect(state.adminMerchants[0].verificationStatus).toBe("rejected");

    await backend.upsertStore({ name: "Toko Uji", category: "Bakery", address: "Depok Baru", open: "08.00", close: "21.00" });
    expect(await backend.myStore()).toMatchObject({ verificationStatus: "pending", verificationNote: null });

    await state.setMerchantVerification("store-me", "verified");
    expect((await backend.myStore())?.verificationStatus).toBe("verified");
  });
});

describe("user management", () => {
  it("suspends and reactivates a user but never an admin", async () => {
    useBackend(new FakeBackend());
    const state = new AppState();
    await state.loadAdminUsers();
    const target = state.adminUsers.find((user) => !user.isAdmin && user.suspendedAt === null);
    const admin = state.adminUsers.find((user) => user.isAdmin);
    if (!target || !admin) throw new Error("sample users missing");

    await state.setUserSuspended(target.id, true, "Melanggar ketentuan");
    expect(state.adminUsers.find((user) => user.id === target.id)).toMatchObject({ suspendedReason: "Melanggar ketentuan" });
    await state.setUserSuspended(target.id, false);
    expect(state.adminUsers.find((user) => user.id === target.id)?.suspendedAt).toBeNull();

    await expect(state.setUserSuspended(admin.id, true, "Coba tangguhkan")).rejects.toMatchObject({ code: "admin_suspend" });
  });

  it("searches by name or email", async () => {
    useBackend(new FakeBackend());
    const state = new AppState();
    await state.loadAdminUsers("dimas@");
    expect(state.adminUsers.map((user) => user.name)).toEqual(["Dimas Arya"]);
  });
});

describe("complaints", () => {
  it("goes from the consumer to the admin and back", async () => {
    const state = resetSession();
    const order = paidOrder();
    await state.submitComplaint(order, "quantity", "Isi bag kurang satu roti.");
    expect(state.complaintFor(order.id)?.status).toBe("open");
    await expect(state.submitComplaint(order, "other", "Pengaduan yang kedua.")).rejects.toMatchObject({ code: "complaint_exists" });

    await state.loadAdminData();
    const received = state.adminComplaints.find((item) => item.orderId === order.id);
    if (!received) throw new Error("complaint missing");
    await state.updateComplaint(received.id, "resolved", "Penjual mengganti 1 roti");

    await state.loadOrders();
    expect(state.complaintFor(order.id)).toMatchObject({ status: "resolved", adminNote: "Penjual mengganti 1 roti" });
    await expect(state.updateComplaint(received.id, "rejected", "Sudah ditutup")).rejects.toMatchObject({ code: "complaint_closed" });
  });

  it("rejects a description that is too short", async () => {
    const state = resetSession();
    await expect(state.submitComplaint(paidOrder(), "other", "pendek")).rejects.toMatchObject({ code: "invalid_complaint" });
  });
});

describe("startup", () => {
  it("a failed role check leaves the account as a normal user", async () => {
    class NoAdminRpc extends FakeBackend {
      override async isAdmin(): Promise<boolean> {
        throw new Error("function does not exist");
      }
    }
    useBackend(new NoAdminRpc());
    const state = new AppState();
    await state.bootstrap();
    expect(state.isAdmin).toBe(false);
    await state.clearSessionState();
  });

  it("carries the suspension into the state and clears it on logout", async () => {
    class Suspended extends FakeBackend {
      override async currentProfile() {
        const profile = await super.currentProfile();
        return profile && { ...profile, suspendedAt: new Date(), suspendedReason: "Melanggar ketentuan" };
      }
    }
    useBackend(new Suspended());
    const state = new AppState();
    await state.bootstrap();
    expect(state).toMatchObject({ accountSuspended: true, suspendedReason: "Melanggar ketentuan" });
    await state.clearSessionState();
    expect(state).toMatchObject({ accountSuspended: false, suspendedReason: null, isAdmin: false });
  });
});

describe("report", () => {
  it("returns one row per day and rejects a reversed period", async () => {
    useBackend(new FakeBackend());
    const state = new AppState();
    await state.loadReport("2026-11-01", "2026-11-07");
    expect(state.report?.daily).toHaveLength(7);
    expect(state.report?.daily[0].day).toBe("2026-11-01");
    await state.loadReport("2026-11-07", "2026-11-01");
    expect(state.transactionReportError).toBe("Periode laporan tidak valid.");
  });
});
