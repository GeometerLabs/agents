// The shop's signboard paint (17 Nov 2026): the colour of the strip at the top of its chat, chosen in the panel's Character step from the five paints Streetlist's own shops
// wear (streetlist/src/styles/site.css .shop-glow, .shop-vidya, .shop-raju, .shop-lakshmi, .shop-mandi; docs/Explanation.md section 1, "Signboard paints"): pink, blue, green,
// marigold and brick red, as real shop boards are painted. Each paint comes with the one text colour that reads on it, written down here and checked by a test at WCAG AA
// (4.5 to 1), so no paint is ever drawn with a guess of "light or dark". A shop that chose none keeps the head's own green tint.
//
// The id is what is saved (settings.assistant.character.paint) and carried in the shop's pages file; the colours live only here, so a paint can be tuned in one place.
export const PAINTS = {
  pink: { hex: "#c4386f", ink: "#ffffff" },
  blue: { hex: "#3459b8", ink: "#fff6c8" },
  green: { hex: "#177a5e", ink: "#ffffff" },
  marigold: { hex: "#f2a516", ink: "#3d1708" },
  brick: { hex: "#b4401f", ink: "#ffffff" },
} as const;

export type PaintId = keyof typeof PAINTS;
export const PAINT_IDS = Object.keys(PAINTS) as PaintId[];
export const isPaint = (v: unknown): v is PaintId => typeof v === "string" && Object.prototype.hasOwnProperty.call(PAINTS, v);

/** The contrast ratio of two #rrggbb colours (WCAG 2: relative luminance), 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
