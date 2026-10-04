import { C, display } from "./theme";

/** Official SaveBite mark (`assets/images/savebite_mark.png`). */
export function AppLogo({ size = 40 }: { size?: number }) {
  return (
    <img
      src="/images/savebite_mark.webp"
      alt="Logo SaveBite"
      width={size}
      height={size}
      decoding="async"
      style={{ width: size, height: size, borderRadius: size * 0.22, objectFit: "cover", flex: "none" }}
    />
  );
}

/** Logo + "SaveBite" wordmark side by side. */
export function AppLogoWordmark({
  logoSize = 30,
  textSize = 19,
  textColor = C.green,
}: {
  logoSize?: number;
  textSize?: number;
  textColor?: string;
}) {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: logoSize * 0.3 }}>
      <AppLogo size={logoSize} />
      <span style={display(textSize, { weight: 800, color: textColor, letterSpacing: -0.5 })}>SaveBite</span>
    </div>
  );
}
