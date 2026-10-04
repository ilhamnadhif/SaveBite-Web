/**
 * The demo data (`lib/sampleData.ts`) keeps the Flutter `sample_data.dart`
 * contract: brand colours from the theme, Flutter asset paths, and lists a
 * caller cannot mutate.
 */
import { describe, expect, it } from "vitest";
import { assetUrl, discountPercent } from "../lib/models";
import { SampleData } from "../lib/sampleData";
import { C } from "../ui/theme";

describe("SampleData", () => {
  it("merchant avatar colours are hex tokens of the theme", () => {
    const palette = new Set<string>(Object.values(C));
    for (const merchant of SampleData.merchants) {
      expect(merchant.avatarColor).toMatch(/^#[0-9A-F]{6}$/);
      expect(palette.has(merchant.avatarColor)).toBe(true);
    }
    expect(SampleData.merchants.map((merchant) => merchant.avatarColor)).toEqual([
      C.amberAvatar,
      C.greenBright,
      C.terracotta,
      C.greenAccent,
      C.brown,
      C.bca,
      C.ovo,
      C.greenAccent,
    ]);
  });

  it("images stay Flutter asset paths that map to /images", () => {
    const images = [
      ...SampleData.merchants.map((merchant) => merchant.coverImage),
      ...SampleData.allBags.map((bag) => bag.image),
      ...SampleData.merchantActiveBags.map((bag) => bag.image),
      ...SampleData.incomingOrders.map((order) => order.bagImage),
    ];
    for (const image of images) {
      expect(image).toMatch(/^assets\/images\/food([1-9]|10)\.jpg$/);
      expect(assetUrl(image)).toMatch(/^\/images\/food([1-9]|10)\.jpg$/);
    }
    expect(SampleData.img10).toBe("assets/images/food10.jpg");
  });

  it("nearby bags are the available ones, in the design's order", () => {
    expect(SampleData.allBags).toHaveLength(9);
    expect(SampleData.nearbyBags.map((bag) => bag.id)).toEqual(["b1", "b2", "b8", "b4", "b5", "b6", "b7"]);
    expect(SampleData.allBags.filter((bag) => bag.soldOut).map((bag) => bag.id)).toEqual(["b3", "b9"]);
    expect(discountPercent(SampleData.bagRoti)).toBe(67);
  });

  it("copy and numbers match the design", () => {
    expect(SampleData.categories).toEqual(["Semua", "Bakery", "Kafe", "Resto", "Supermarket", "Sehat"]);
    expect(SampleData.merchantBalance).toBe(1245000);
    expect(SampleData.rotiNyaman).toMatchObject({ name: "Roti Nyaman Bakery", distance: "0,4 km", hours: "08.00–21.00" });
    expect(SampleData.activeOrders[0]).toMatchObject({ id: "order-1", code: "SB-7K2Q9", status: "ready", paymentState: "paid" });
    expect(SampleData.notifications.filter((notification) => notification.unread)).toHaveLength(1);
    expect(SampleData.merchantInactiveBags[0]).toMatchObject({ statusNote: "Habis terjual kemarin", quantityLeft: 0 });
    expect(SampleData.transactions.map((tx) => tx.status)).toEqual(["completed", "completed", "completed"]);
    expect(SampleData.favorites.map((store) => store.soldOut)).toEqual([false, false, false, true]);
  });

  it("list getters return fresh arrays; the shared constants are frozen", () => {
    const orders = SampleData.activeOrders;
    orders.pop();
    expect(SampleData.activeOrders).toHaveLength(1);
    expect(Object.isFrozen(SampleData)).toBe(true);
    expect(Object.isFrozen(SampleData.merchants)).toBe(true);
    expect(Object.isFrozen(SampleData.allBags)).toBe(true);
    expect(Object.isFrozen(SampleData.bagRoti)).toBe(true);
    expect(Object.isFrozen(SampleData.bagRoti.contents)).toBe(true);
  });
});
