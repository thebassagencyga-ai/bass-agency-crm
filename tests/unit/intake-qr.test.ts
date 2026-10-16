import { describe, expect, it } from "vitest";
import { qrPath } from "@/lib/intake/qr";

describe("qrPath", () => {
  it("draws a square QR grid with the three finder patterns", () => {
    const { size, d } = qrPath(`https://bass-agency-crm.example.workers.dev/quote/${"a".repeat(32)}`);
    expect(size).toBeGreaterThanOrEqual(21);
    expect((size - 17) % 4).toBe(0); // QR versions are 21, 25, 29, … modules wide
    // Finder patterns: the top-left, top-right and bottom-left corners are dark.
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1]]) expect(d).toContain(`M${x} ${y}h1v1h-1z`);
    expect(/^(M\d+ \d+h1v1h-1z)+$/.test(d)).toBe(true);
  });
});
