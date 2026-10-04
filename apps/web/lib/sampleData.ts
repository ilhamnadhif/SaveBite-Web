/**
 * Demo (mock) data, ported from the Flutter app's `lib/data/sample_data.dart`.
 * Follows the copy and numbers of the design, enriched to ~9 bags from 8
 * merchants across categories so filters, the map, and search feel alive.
 *
 * Only the demo backend (and a few screens, exactly like the Flutter app)
 * read it. Image paths stay Flutter asset paths; `assetUrl` maps them to
 * `/images/…`. Dart's `static List<X> get` lists are getters returning a fresh
 * array, so a caller can never mutate the shared sample.
 */
import { C } from "../ui/theme";
import {
  incomingOrder,
  merchantBag,
  orderRecord,
  type AppNotification,
  type Bag,
  type FavoriteStore,
  type IncomingOrder,
  type Merchant,
  type MerchantBag,
  type OrderRecord,
  type TxRecord,
} from "./models";

const img1: string = "assets/images/food1.jpg";
const img2: string = "assets/images/food2.jpg";
const img3: string = "assets/images/food3.jpg";
const img4: string = "assets/images/food4.jpg";
const img5: string = "assets/images/food5.jpg";
const img6: string = "assets/images/food6.jpg";
const img7: string = "assets/images/food7.jpg";
const img8: string = "assets/images/food8.jpg";
const img9: string = "assets/images/food9.jpg";
const img10: string = "assets/images/food10.jpg";

/** The Dart `Bag` constructor defaults. */
function bag(
  fields: Omit<Bag, "contents" | "soldOut" | "availableOn" | "pickupStartsAt" | "pickupEndsAt"> & Partial<Bag>,
): Bag {
  return Object.freeze({
    contents: [],
    soldOut: false,
    availableOn: null,
    pickupStartsAt: null,
    pickupEndsAt: null,
    ...fields,
  });
}

/** The Dart `AppNotification` constructor defaults. */
function notification(
  fields: Pick<AppNotification, "id" | "title" | "body" | "time" | "type" | "group"> & Partial<AppNotification>,
): AppNotification {
  return { unread: false, route: null, createdAt: null, ...fields };
}

/** The Dart `TxRecord` constructor defaults. */
function tx(fields: Pick<TxRecord, "id" | "title" | "subtitle" | "amount" | "kind"> & Partial<TxRecord>): TxRecord {
  return { createdAt: null, status: "completed", ...fields };
}

// ───────────── Merchant ─────────────
const rotiNyaman: Merchant = Object.freeze({
  id: "m1",
  name: "Roti Nyaman Bakery",
  initial: "R",
  avatarColor: C.amberAvatar,
  category: "Bakery",
  rating: 4.8,
  reviewCount: 212,
  distance: "0,4 km",
  address: "Jl. Margonda Raya No. 88, Depok",
  hours: "08.00–21.00",
  coverImage: img2,
  bagsSaved: 184,
  latitude: -6.3718,
  longitude: 106.8318,
});

const kopiSenja: Merchant = Object.freeze({
  id: "m2",
  name: "Kopi Senja",
  initial: "K",
  avatarColor: C.greenBright,
  category: "Kafe",
  rating: 4.6,
  reviewCount: 98,
  distance: "0,9 km",
  address: "Jl. Kemang Raya No. 12, Depok",
  hours: "10.00–22.00",
  coverImage: img8,
  bagsSaved: 76,
  latitude: -6.3762,
  longitude: 106.8392,
});

const donatManis: Merchant = Object.freeze({
  id: "m3",
  name: "Donat Manis Margonda",
  initial: "D",
  avatarColor: C.terracotta,
  category: "Bakery",
  rating: 4.7,
  reviewCount: 64,
  distance: "1,2 km",
  address: "Jl. Akses UI No. 5, Depok",
  hours: "08.00–20.00",
  coverImage: img7,
  bagsSaved: 41,
  latitude: -6.3654,
  longitude: 106.8408,
});

const tokoSehat: Merchant = Object.freeze({
  id: "m4",
  name: "Toko Sehat Depok",
  initial: "T",
  avatarColor: C.greenAccent,
  category: "Sehat",
  rating: 4.5,
  reviewCount: 33,
  distance: "1,8 km",
  address: "Jl. Juanda No. 21, Depok",
  hours: "09.00–21.00",
  coverImage: img3,
  bagsSaved: 22,
  latitude: -6.3825,
  longitude: 106.8251,
});

const warungIbu: Merchant = Object.freeze({
  id: "m5",
  name: "Warung Nasi Ibu",
  initial: "W",
  avatarColor: C.brown,
  category: "Resto",
  rating: 4.4,
  reviewCount: 120,
  distance: "1,1 km",
  address: "Jl. Nusantara No. 3, Depok",
  hours: "07.00–21.00",
  coverImage: img6,
  bagsSaved: 95,
  latitude: -6.3686,
  longitude: 106.8234,
});

const sayurMart: Merchant = Object.freeze({
  id: "m6",
  name: "Sayur Segar Mart",
  initial: "S",
  avatarColor: C.bca,
  category: "Supermarket",
  rating: 4.3,
  reviewCount: 45,
  distance: "2,0 km",
  address: "Jl. Tole Iskandar No. 17, Depok",
  hours: "08.00–22.00",
  coverImage: img10,
  bagsSaved: 58,
  latitude: -6.3898,
  longitude: 106.8441,
});

const pizzaSudut: Merchant = Object.freeze({
  id: "m7",
  name: "Pizza Sudut",
  initial: "P",
  avatarColor: C.ovo,
  category: "Resto",
  rating: 4.6,
  reviewCount: 88,
  distance: "1,5 km",
  address: "Jl. Siliwangi No. 9, Depok",
  hours: "11.00–23.00",
  coverImage: img9,
  bagsSaved: 67,
  latitude: -6.3796,
  longitude: 106.8189,
});

const saladHijau: Merchant = Object.freeze({
  id: "m8",
  name: "Salad Hijau",
  initial: "H",
  avatarColor: C.greenAccent,
  category: "Sehat",
  rating: 4.7,
  reviewCount: 52,
  distance: "0,7 km",
  address: "Jl. Margonda Raya No. 210, Depok",
  hours: "09.00–20.00",
  coverImage: img4,
  bagsSaved: 39,
  latitude: -6.374,
  longitude: 106.8354,
});

const merchants: readonly Merchant[] = Object.freeze([
  rotiNyaman,
  kopiSenja,
  donatManis,
  tokoSehat,
  warungIbu,
  sayurMart,
  pizzaSudut,
  saladHijau,
]);

// ───────────── Bag ─────────────
const bagRoti = bag({
  id: "b1",
  merchant: rotiNyaman,
  title: "Surprise Bag Roti & Pastry",
  description:
    "Campuran roti manis, pastry, dan donat hari ini yang masih fresh. Isi kejutan senilai minimal Rp45.000.",
  originalPrice: 45000,
  salePrice: 15000,
  quantityLeft: 3,
  quantityTotal: 8,
  pickupWindow: "20.00–21.00",
  image: img1,
  contents: Object.freeze(["Roti manis", "Croissant", "Donat", "Roti tawar"]),
});

const bagKopi = bag({
  id: "b2",
  merchant: kopiSenja,
  title: "Surprise Bag Pastry & Kopi",
  description: "Pastry pilihan dan kopi hari ini yang belum sempat terjual. Cocok untuk teman sore.",
  originalPrice: 50000,
  salePrice: 20000,
  quantityLeft: 6,
  quantityTotal: 10,
  pickupWindow: "19.30–20.30",
  image: img8,
  contents: Object.freeze(["Croissant", "Muffin", "Kopi susu", "Cookies"]),
});

const bagDonat = bag({
  id: "b3",
  merchant: donatManis,
  title: "Surprise Bag Donat",
  description: "Aneka donat manis hari ini yang masih lembut.",
  originalPrice: 40000,
  salePrice: 16000,
  quantityLeft: 0,
  quantityTotal: 6,
  pickupWindow: "18.00–19.00",
  image: img7,
  contents: Object.freeze(["Donat cokelat", "Donat gula", "Donat keju"]),
  soldOut: true,
});

const bagSehat = bag({
  id: "b4",
  merchant: tokoSehat,
  title: "Surprise Bag Buah Potong",
  description: "Aneka buah potong segar siap santap yang harus habis hari ini.",
  originalPrice: 38000,
  salePrice: 18000,
  quantityLeft: 4,
  quantityTotal: 8,
  pickupWindow: "17.00–18.00",
  image: img3,
  contents: Object.freeze(["Semangka", "Melon", "Pepaya", "Nanas"]),
});

const bagNasi = bag({
  id: "b5",
  merchant: warungIbu,
  title: "Surprise Bag Nasi & Lauk",
  description: "Nasi hangat plus aneka lauk rumahan sisa porsi hari ini.",
  originalPrice: 35000,
  salePrice: 14000,
  quantityLeft: 5,
  quantityTotal: 12,
  pickupWindow: "20.30–21.30",
  image: img6,
  contents: Object.freeze(["Nasi", "Ayam", "Tempe", "Sayur"]),
});

const bagSayur = bag({
  id: "b6",
  merchant: sayurMart,
  title: "Surprise Bag Sayur & Buah",
  description: "Paket sayur dan buah mendekati best-before, masih segar & layak.",
  originalPrice: 60000,
  salePrice: 25000,
  quantityLeft: 8,
  quantityTotal: 15,
  pickupWindow: "18.00–20.00",
  image: img10,
  contents: Object.freeze(["Sayur hijau", "Wortel", "Tomat", "Buah"]),
});

const bagPizza = bag({
  id: "b7",
  merchant: pizzaSudut,
  title: "Surprise Bag Pizza Slice",
  description: "Aneka potongan pizza akhir hari yang masih nikmat dihangatkan.",
  originalPrice: 70000,
  salePrice: 28000,
  quantityLeft: 2,
  quantityTotal: 6,
  pickupWindow: "21.00–22.00",
  image: img9,
  contents: Object.freeze(["Pizza keju", "Pizza daging", "Garlic bread"]),
});

const bagSalad = bag({
  id: "b8",
  merchant: saladHijau,
  title: "Surprise Bag Salad Sehat",
  description: "Salad segar dan healthy bowl yang belum terjual sore ini.",
  originalPrice: 45000,
  salePrice: 19000,
  quantityLeft: 7,
  quantityTotal: 10,
  pickupWindow: "16.30–18.00",
  image: img4,
  contents: Object.freeze(["Garden salad", "Healthy bowl", "Smoothie"]),
});

const bagPastrySore = bag({
  id: "b9",
  merchant: kopiSenja,
  title: "Surprise Bag Pastry Sore",
  description: "Sisa pastry sore: croissant, danish, dan roti isi.",
  originalPrice: 30000,
  salePrice: 12000,
  quantityLeft: 0,
  quantityTotal: 8,
  pickupWindow: "17.30–18.30",
  image: img5,
  contents: Object.freeze(["Croissant", "Danish", "Roti isi"]),
  soldOut: true,
});

/** Every bag (available first, then the sold-out ones). */
const allBags: readonly Bag[] = Object.freeze([
  bagRoti,
  bagKopi,
  bagSalad,
  bagSehat,
  bagNasi,
  bagSayur,
  bagPizza,
  bagDonat,
  bagPastrySore,
]);

const categories: readonly string[] = Object.freeze(["Semua", "Bakery", "Kafe", "Resto", "Supermarket", "Sehat"]);

const merchantBalance: number = 1245000;

export const SampleData = Object.freeze({
  img1,
  img2,
  img3,
  img4,
  img5,
  img6,
  img7,
  img8,
  img9,
  img10,

  // ───────────── Merchant ─────────────
  rotiNyaman,
  kopiSenja,
  donatManis,
  tokoSehat,
  warungIbu,
  sayurMart,
  pizzaSudut,
  saladHijau,
  merchants,

  // ───────────── Bag ─────────────
  bagRoti,
  bagKopi,
  bagDonat,
  bagSehat,
  bagNasi,
  bagSayur,
  bagPizza,
  bagSalad,
  bagPastrySore,
  allBags,

  get nearbyBags(): Bag[] {
    return allBags.filter((item) => !item.soldOut);
  },

  categories,

  get favorites(): FavoriteStore[] {
    return [
      { merchant: rotiNyaman, availability: "3 bag tersedia", soldOut: false },
      { merchant: kopiSenja, availability: "6 bag tersedia", soldOut: false },
      { merchant: saladHijau, availability: "7 bag tersedia", soldOut: false },
      { merchant: donatManis, availability: "Habis hari ini", soldOut: true },
    ];
  },

  get activeOrders(): OrderRecord[] {
    return [
      orderRecord({
        id: "order-1",
        bag: bagRoti,
        code: "SB-7K2Q9",
        dateLabel: "Hari ini",
        amount: 16000,
        status: "ready",
        quantity: 1,
        subtotalAmount: 15000,
        serviceFee: 1000,
        merchantNetAmount: 13500,
      }),
    ];
  },

  get orderHistory(): OrderRecord[] {
    return [
      orderRecord({
        id: "order-2",
        bag: bagKopi,
        code: "SB-5P1A8",
        dateLabel: "14 Jun",
        amount: 21000,
        status: "done",
        canRate: true,
        subtotalAmount: 20000,
        serviceFee: 1000,
        merchantNetAmount: 18000,
      }),
      orderRecord({
        id: "order-3",
        bag: bagRoti,
        code: "SB-2H7C4",
        dateLabel: "11 Jun",
        amount: 16000,
        status: "done",
        reviewed: true,
        subtotalAmount: 15000,
        serviceFee: 1000,
        merchantNetAmount: 13500,
      }),
      orderRecord({
        id: "order-4",
        bag: bagSehat,
        code: "SB-9X3D2",
        dateLabel: "8 Jun",
        amount: 22000,
        status: "expired",
        subtotalAmount: 22000,
        serviceFee: 0,
      }),
    ];
  },

  get notifications(): AppNotification[] {
    return [
      notification({
        id: "notification-1",
        title: "Pesananmu siap diambil",
        body: "Roti Nyaman Bakery menunggu sampai 21.00. Tunjukkan QR-mu.",
        time: "5 menit lalu",
        type: "ready",
        group: "Hari ini",
        unread: true,
        route: "orders",
      }),
      notification({
        id: "notification-2",
        title: "Bag baru di dekatmu",
        body: "Kopi Senja baru rilis 6 Surprise Bag, mulai Rp20.000.",
        time: "1 jam lalu",
        type: "newBag",
        group: "Hari ini",
      }),
      notification({
        id: "notification-3",
        title: "Sudah ambil bag-nya? Beri rating",
        body: "Bantu pembeli lain dengan ulasanmu untuk Kopi Senja.",
        time: "Kemarin · 20.40",
        type: "rating",
        group: "Kemarin",
        route: "orders",
      }),
      notification({
        id: "notification-4",
        title: "Pembayaran berhasil",
        body: "Order SB-7K2Q9 · Rp16.000 lunas.",
        time: "Kemarin · 18.42",
        type: "payment",
        group: "Kemarin",
      }),
    ];
  },

  // ───────────── Merchant ─────────────
  get merchantActiveBags(): MerchantBag[] {
    return [
      merchantBag({
        id: "mb1",
        title: "Surprise Bag Roti & Pastry",
        salePrice: 15000,
        pickupWindow: "20.00–21.00",
        sold: 5,
        total: 8,
        image: img1,
        active: true,
        contents: ["Roti manis", "Croissant", "Donat", "Roti tawar"],
      }),
      merchantBag({
        id: "mb3",
        title: "Surprise Bag Donat",
        salePrice: 16000,
        pickupWindow: "18.00–19.00",
        sold: 2,
        total: 6,
        image: img7,
        active: true,
        contents: ["Donat cokelat", "Donat gula", "Donat keju"],
      }),
    ];
  },

  get merchantInactiveBags(): MerchantBag[] {
    return [
      merchantBag({
        id: "mb2",
        title: "Surprise Bag Pastry Sore",
        salePrice: 18000,
        pickupWindow: "—",
        sold: 8,
        total: 8,
        image: img5,
        active: false,
        statusNote: "Habis terjual kemarin",
        contents: ["Croissant", "Danish", "Roti isi"],
      }),
    ];
  },

  get incomingOrders(): IncomingOrder[] {
    return [
      incomingOrder({
        id: "order-1",
        customer: "Rani Anggraini",
        initial: "RA",
        time: "18.42",
        bags: 1,
        code: "SB-7K2Q9",
        status: "ready",
        needsAction: false,
        bagTitle: "Surprise Bag Roti & Pastry",
        bagImage: img1,
        pickupWindow: "20.00–21.00",
        unitPrice: 15000,
        subtotalAmount: 15000,
        serviceFee: 1000,
        merchantNetAmount: 13500,
      }),
      incomingOrder({
        id: "order-5",
        customer: "Budi Santoso",
        initial: "BS",
        time: "18.20",
        bags: 2,
        code: "SB-3M8X1",
        status: "paid",
        bagTitle: "Surprise Bag Roti & Pastry",
        bagImage: img1,
        pickupWindow: "20.00–21.00",
        unitPrice: 15000,
        subtotalAmount: 30000,
        serviceFee: 1000,
        merchantNetAmount: 27000,
      }),
    ];
  },

  merchantBalance,

  get transactions(): TxRecord[] {
    return [
      tx({ id: "tx-1", title: "Order SB-7K2Q9", subtitle: "17 Jun · komisi Rp1.500", amount: 13500, kind: "income" }),
      tx({ id: "tx-2", title: "Order SB-3M8X1", subtitle: "17 Jun · komisi Rp2.000", amount: 18000, kind: "income" }),
      tx({ id: "tx-3", title: "Penarikan ke BCA", subtitle: "15 Jun · ••6789", amount: 1500000, kind: "withdrawal" }),
    ];
  },
});
