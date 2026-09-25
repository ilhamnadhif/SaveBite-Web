import type { Metadata } from "next";
import "@savebite/web-shared/styles.css";
import "leaflet/dist/leaflet.css";
import "./app.css";
import "./merchant.css";
import "./roles.css";
import { ReactNode } from "react";
import SaveBiteFrame from "../components/SaveBiteFrame";
export const metadata: Metadata = { title: "SaveBite — Selamatkan makanan enak", description: "Temukan surplus food, kelola toko, dan selamatkan makanan bersama SaveBite." };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="id"><body><SaveBiteFrame>{children}</SaveBiteFrame></body></html>;
}
