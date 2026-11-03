// Writes a whole review sheet for Malayalam or Kannada: sections 1 to 6 from the pathway (its templates, word lists and report words), then
// section 7, the panel's words. Reviewers fill the last column of each row; run this with `> file` and keep any notes they made.
//   node bundle/panel/review-sheet.ts ml > pathways/bookings/REVIEW-ml.md
import { pathToFileURL } from "node:url";
import { reviewSheet } from "../../pathways/bookings/scripts/review-sheet.ts";
import { panelReviewSection } from "./review.ts";
import type { ReviewLanguage } from "./review.ts";

export const wholeSheet = (language: ReviewLanguage): string => `${reviewSheet(language).trimEnd()}\n\n${panelReviewSection(language)}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const language = process.argv[2];
  if (language !== "ml" && language !== "kn") { console.error("Say which language: node bundle/panel/review-sheet.ts ml   (or kn)"); process.exitCode = 1; }
  else console.log(wholeSheet(language));
}
