import { createElement, type CSSProperties } from "react";
import { ICONS, type IconName } from "./icons.generated";

export type { IconName };

type IconProps = {
  /** Flutter `Icons.*` name, e.g. `"home_outlined"`, `"check_rounded"`. */
  name: IconName;
  /** Flutter `size` (logical px). Defaults to 24 like Flutter. */
  size?: number;
  color?: string;
  style?: CSSProperties;
  className?: string;
  /** Accessible label. Without it the icon is decorative (aria-hidden). */
  label?: string;
};

/** Material icon, the `Icon(Icons.x, size:, color:)` of the Flutter app. */
export function Icon({ name, size = 24, color = "currentColor", style, className, label }: IconProps) {
  const nodes = ICONS[name];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      className={className}
      style={{ flex: "none", display: "block", ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {nodes.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))}
    </svg>
  );
}
