"use client";

import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { C } from "./theme";

/**
 * Real QR code in brand colours, like the Flutter `QrBox` (qr_flutter):
 * square finder eyes and circular data modules, gapless, drawn inside
 * qr_flutter's default 10 px padding.
 */
export function QrBox({ data, size = 190, label }: { data: string; size?: number; label?: string }) {
  const modules = useMemo(() => {
    // Type 0 picks the smallest version that fits; "L" is qr_flutter's default.
    const qr = qrcode(0, "L");
    qr.addData(data);
    qr.make();
    const count = qr.getModuleCount();
    const cells: boolean[][] = [];
    for (let row = 0; row < count; row++) {
      const line: boolean[] = [];
      for (let col = 0; col < count; col++) line.push(qr.isDark(row, col));
      cells.push(line);
    }
    return cells;
  }, [data]);

  const count = modules.length;
  const inEye = (row: number, col: number) =>
    (row < 7 && col < 7) || (row < 7 && col >= count - 7) || (row >= count - 7 && col < 7);

  const dots: string[] = [];
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (!modules[row][col] || inEye(row, col)) continue;
      // A circle of radius 0.5 drawn as two arcs.
      dots.push(`M${col},${row + 0.5}a0.5,0.5 0 1,0 1,0a0.5,0.5 0 1,0 -1,0`);
    }
  }

  const eye = (x: number, y: number) =>
    `M${x},${y}h7v7h-7z M${x + 1},${y + 1}v5h5v-5z M${x + 2},${y + 2}h3v3h-3z`;

  const padding = 10;
  return (
    <svg
      width={size - padding * 2}
      height={size - padding * 2}
      viewBox={`0 0 ${count} ${count}`}
      role="img"
      aria-label={label ?? "Kode QR"}
      shapeRendering="geometricPrecision"
      style={{ display: "block", boxSizing: "content-box", padding, background: C.white }}
    >
      <path d={[eye(0, 0), eye(count - 7, 0), eye(0, count - 7)].join(" ")} fill={C.ink} fillRule="evenodd" />
      <path d={dots.join("")} fill={C.ink} />
    </svg>
  );
}
