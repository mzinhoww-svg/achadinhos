/**
 * Paleta da marca "achadinhos" (hex, porque Satori não lê oklch/var()).
 * Espelha os tokens de apps/web/src/app/globals.css — hue 340 (ameixa), base branca.
 */
export const palette = {
  white: "#ffffff",
  sunken: "#f9f4f7",
  line: "#e8e0e5",
  ink: "#1c1319",
  ink2: "#574851",
  ink3: "#6c5f67",
  plum500: "#a61b86",
  plum600: "#8d1071",
  plum700: "#71115b",
  plum50: "#ffecfa",
  sun: "#f7d22a",
  sunInk: "#3d2a00",
} as const;

export const fontFamily = {
  display: "Bricolage Grotesque",
  text: "Figtree",
} as const;

export const CREATIVE_SIZE = 1080;
