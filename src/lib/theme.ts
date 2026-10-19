// Light / dark / follow the device (Phase 22, ADR-038). The choice is a cookie on this device
// only — nothing is stored in the database. Pure; unit tested.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_COOKIE = "producr_theme";

export const THEME_LABELS: Record<Theme, string> = {
  system: "Match this device",
  light: "Light",
  dark: "Dark",
};

export function parseTheme(value: string | null | undefined): Theme {
  return (THEMES as readonly string[]).includes(value ?? "") ? (value as Theme) : "system";
}

/** Class for <html>: none follows the device (see the dark variant in globals.css). */
export function themeClass(theme: Theme): string | undefined {
  return theme === "system" ? undefined : theme;
}

/** One year; same flags as the session cookies. Not sensitive: it only holds the theme name. */
export const THEME_COOKIE_MAX_AGE = 365 * 24 * 3600;
