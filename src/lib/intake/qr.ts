import "server-only";
import { create } from "qrcode/lib/core/qrcode";
import { render } from "qrcode/lib/renderer/svg-tag";

/** The intake link as an SVG QR code (rendered on the server; no script, no image request). */
export function qrSvg(url: string): string {
  return render(create(url, { errorCorrectionLevel: "M" }), { margin: 2, color: { dark: "#000000ff", light: "#ffffffff" } });
}
