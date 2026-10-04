"use client";

import { useEffect, useRef, useState } from "react";
import { AppNav } from "../../lib/appNav";
import { appState } from "../../lib/appState";
import { FoodImage } from "../../ui/bagCards";
import { PrimaryButton } from "../../ui/buttons";
import { safeTop } from "../../ui/common";
import { C, display, ui } from "../../ui/theme";

type Slide = { image: string; title: string; body: string };

const SLIDES: readonly Slide[] = [
  {
    image: "assets/images/food5.jpg",
    title: "Makanan enak, harga miring.",
    body: "Tiap sore, toko favoritmu mengemas stok berlebih jadi Surprise Bag dengan diskon 50–70%. Tinggal pesan, ambil sendiri, hemat banyak.",
  },
  {
    image: "assets/images/food2.jpg",
    title: "Ambil sendiri, tanpa ribet.",
    body: "Pesan & bayar di aplikasi, lalu ambil pesananmu di toko pada jam yang ditentukan. Tunjukkan QR, beres.",
  },
  {
    image: "assets/images/food7.jpg",
    title: "Kurangi makanan terbuang.",
    body: "Setiap bag yang kamu selamatkan ikut mengurangi food waste — hemat untukmu, baik untuk bumi.",
  },
];

/** A2 Onboarding: full screen with a swipeable carousel. */
export function OnboardingScreen() {
  const [page, setPage] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const pager = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = pager.current;
    if (!element) return;
    const onScroll = () => {
      const width = element.clientWidth || 1;
      setPage(Math.max(0, Math.min(SLIDES.length - 1, Math.round(element.scrollLeft / width))));
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => element.removeEventListener("scroll", onScroll);
  }, []);

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    await appState.markOnboardingSeen();
    AppNav.toForkRoot();
  };

  const next = () => {
    if (finishing) return;
    if (page < SLIDES.length - 1) {
      const element = pager.current;
      element?.scrollTo({ left: (page + 1) * element.clientWidth, behavior: "smooth" });
    } else {
      void finish();
    }
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        background: C.cream,
        paddingTop: safeTop(16),
        paddingRight: 24,
        paddingBottom: "calc(32px + var(--safe-bottom))",
        paddingLeft: 24,
      }}
    >
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="sb-tap"
          disabled={finishing}
          onClick={() => void finish()}
          style={ui(15, { weight: 600, color: C.muted })}
        >
          Lewati
        </button>
      </div>
      <div
        ref={pager}
        className="sb-hscroll"
        aria-roledescription="carousel"
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          scrollSnapType: "x mandatory",
          margin: "0 -24px",
        }}
      >
        {SLIDES.map((slide, index) => (
          <section
            key={slide.title}
            aria-roledescription="slide"
            aria-label={`${index + 1} dari ${SLIDES.length}`}
            style={{
              flex: "0 0 100%",
              scrollSnapAlign: "start",
              display: "flex",
              flexDirection: "column",
              padding: "0 24px",
              minHeight: 0,
            }}
          >
            <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: 300,
                  maxHeight: "100%",
                  borderRadius: 28,
                  overflow: "hidden",
                  background: C.chipBorder,
                  border: `1px solid ${C.inputBorder}`,
                }}
              >
                <FoodImage path={slide.image} priority={index === 0} />
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 0,
                    right: 0,
                    bottom: 0,
                    height: 90,
                    background: "linear-gradient(to top, rgba(23, 61, 44, 0.45), rgba(23, 61, 44, 0))",
                  }}
                />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "center", gap: 7, padding: "8px 0 22px" }} aria-hidden>
              {SLIDES.map((dot, dotIndex) => (
                <span
                  key={dot.title}
                  style={{
                    width: dotIndex === page ? 22 : 7,
                    height: 7,
                    borderRadius: dotIndex === page ? 4 : 50,
                    background: dotIndex === page ? C.green : C.handle,
                    transition: "width 250ms ease, background-color 250ms ease",
                  }}
                />
              ))}
            </div>
            <h1 style={display(28, { weight: 800, height: 1.12 })}>{slide.title}</h1>
            <p style={{ ...ui(15, { color: C.body, height: 1.55 }), marginTop: 10 }}>{slide.body}</p>
          </section>
        ))}
      </div>
      <div style={{ height: 22, flex: "none" }} />
      <PrimaryButton label={finishing ? "Menyiapkan…" : "Lanjut"} onTap={finishing ? null : next} />
    </div>
  );
}
