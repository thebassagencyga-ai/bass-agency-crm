// Minimal types for the two pure-JS parts of the `qrcode` package used by src/lib/intake/qr.ts.
// (The package's main entry also loads PNG and file-system code that the Worker does not need.)
declare module "qrcode/lib/core/qrcode" {
  export function create(text: string, options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" }): unknown;
}
declare module "qrcode/lib/renderer/svg-tag" {
  export function render(qrData: unknown, options?: { margin?: number; color?: { dark?: string; light?: string } }): string;
}
