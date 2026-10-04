import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import { SaveBiteApp } from "../screens/SaveBiteApp";

/** Bricolage Grotesque (titles) and Plus Jakarta Sans (UI), as in the app. */
const displayFont = localFont({
  src: "./fonts/BricolageGrotesque.woff2",
  variable: "--font-display",
  weight: "200 800",
  display: "swap",
});

const uiFont = localFont({
  src: "./fonts/PlusJakartaSans.woff2",
  variable: "--font-ui",
  weight: "200 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SaveBite — Every Bite Matters",
  description: "SaveBite — selamatkan makanan surplus lewat Surprise Bag dari merchant terdekat.",
  applicationName: "SaveBite",
  appleWebApp: { capable: true, title: "SaveBite", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0F3D2C",
};

/**
 * The whole app is the client-side `SaveBiteApp` (navigator + overlays).
 * Pages render nothing: every screen is driven by the app's own navigator so
 * the web behaves exactly like the mobile app.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="id" className={`${displayFont.variable} ${uiFont.variable}`}>
      <body>
        <SaveBiteApp />
        {children}
      </body>
    </html>
  );
}
