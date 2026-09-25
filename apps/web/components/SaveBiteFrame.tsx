"use client";
import { AuthProvider, AppFrame } from "@savebite/web-shared";
import { Compass, Heart, Map, PackageCheck, UserRound, Bell, LayoutDashboard, Package, ClipboardList, ScanLine, Wallet, Star, Store } from "lucide-react";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
const consumerNav = [
  { href: "/", label: "Jelajahi", icon: Compass },
  { href: "/map", label: "Peta", icon: Map },
  { href: "/favorites", label: "Favorit", icon: Heart },
  { href: "/orders", label: "Pesanan", icon: PackageCheck },
  { href: "/notifications", label: "Notifikasi", icon: Bell },
  { href: "/profile", label: "Profil", icon: UserRound }
];
const merchantNav = [
  { href: "/merchant", label: "Ringkasan", icon: LayoutDashboard },
  { href: "/merchant/bags", label: "Surprise bag", icon: Package },
  { href: "/merchant/orders", label: "Pesanan", icon: ClipboardList },
  { href: "/merchant/redeem", label: "Redeem pickup", icon: ScanLine },
  { href: "/merchant/balance", label: "Saldo & rekening", icon: Wallet },
  { href: "/merchant/reviews", label: "Ulasan", icon: Star },
  { href: "/merchant/profile", label: "Profil toko", icon: Store }
];
function RoutedFrame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const merchant = path === "/merchant" || path.startsWith("/merchant/");
  return <AppFrame appName={merchant ? "SaveBite Merchant" : "SaveBite"} kicker={merchant ? "MERCHANT STUDIO" : "GOOD FOOD, LESS WASTE"} nav={merchant ? merchantNav : consumerNav} merchant={merchant}>{children}</AppFrame>;
}
export default function ConsumerFrame({children}:{children:ReactNode}) { return <AuthProvider><RoutedFrame>{children}</RoutedFrame></AuthProvider>; }
