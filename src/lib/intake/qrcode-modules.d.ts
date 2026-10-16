// Minimal types for the pure-JS QR encoder in the `qrcode` package, used by src/lib/intake/qr.ts.
// (The package's main entry also loads PNG and file-system code that the Worker does not need.)
declare module "qrcode/lib/core/qrcode" {
  export function create(
    text: string,
    options?: { errorCorrectionLevel?: "L" | "M" | "Q" | "H" },
  ): { modules: { size: number; data: ArrayLike<number | boolean> } };
}
