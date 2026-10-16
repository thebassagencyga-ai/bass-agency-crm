import { create } from "qrcode/lib/core/qrcode";

/**
 * The intake link as a QR code: the grid size and one SVG path drawing every dark square.
 * Rendered as ordinary JSX (no HTML strings), so nothing is injected into the page.
 */
export function qrPath(url: string): { size: number; d: string } {
  const { size, data } = create(url, { errorCorrectionLevel: "M" }).modules;
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (data[y * size + x]) d += `M${x} ${y}h1v1h-1z`;
  }
  return { size, d };
}
