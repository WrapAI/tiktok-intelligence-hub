/** Default packaging/container knowledge for UK TikTok Shop scripts. */

export const PACKAGING_KNOWLEDGE = `# Product packaging language (UK TikTok scripts)

When writing scripts, use the correct container nouns when referring to the physical product:

| Category | Typical containers | Script phrases |
|----------|-------------------|----------------|
| Electrolytes / pre-workout powder | tub, tub, scoop | "grab the tub", "one scoop from the tub" |
| Protein powder | tub, pouch | "this massive tub", "resealable pouch" |
| Hair vitamins / supplements | bottle, tub, jar | "these bottles", "one tub lasts a month" |
| Skincare (serum, moisturiser) | bottle, pump bottle, jar, tube | "pump from the bottle", "pea-sized from the tube" |
| Energy drinks / RTD | can, bottle | "crack open a can", "grab a cold bottle" |
| Snacks / coffee / tea bags | bag, pouch, box | "this bag of…", "single-serve sachets" |
| Gummies / vitamins chewable | bottle, jar, pouch | "the bottle on my desk" |
| Shampoo / conditioner | bottle, tube | "pump from the bottle" |
| Eye patches / sheet masks | pack, sachet, jar | "one pack", "pull a sachet" |
| Apparel / accessories | box, bag (delivery) | usually no container — say "the package landed" |

Rules:
- Never say "tub" for a liquid in a bottle, or "bottle" for powder in a tub.
- Use product research notes in /hub/products.md when available.
- Say "container" only when unsure — prefer researched packaging_type.
`;

const HEURISTICS: Array<{ pattern: RegExp; packaging: string; nouns: string[] }> = [
  { pattern: /electrolyte|hydra|pre.?workout|creatine|collagen powder|protein powder/i, packaging: "tub", nouns: ["tub", "scoop"] },
  { pattern: /vitamin|supplement|capsule|tablet|gummy/i, packaging: "bottle", nouns: ["bottle", "jar"] },
  { pattern: /shampoo|conditioner|serum|moistur|cleanser|toner/i, packaging: "bottle", nouns: ["bottle", "pump", "tube"] },
  { pattern: /energy drink|rtd|sparkling/i, packaging: "can", nouns: ["can", "bottle"] },
  { pattern: /coffee|tea bag|snack|chips|granola/i, packaging: "bag", nouns: ["bag", "pouch"] },
  { pattern: /patch|mask|sachet/i, packaging: "pack", nouns: ["pack", "sachet"] },
];

export function guessPackagingFromName(name: string, description = ""): {
  packaging_type: string;
  container_nouns: string[];
  source: "heuristic";
} {
  const text = `${name} ${description}`.toLowerCase();
  for (const row of HEURISTICS) {
    if (row.pattern.test(text)) {
      return { packaging_type: row.packaging, container_nouns: row.nouns, source: "heuristic" };
    }
  }
  return { packaging_type: "container", container_nouns: ["product", "packaging"], source: "heuristic" };
}

export function formatProductPackagingForPrompt(product: Record<string, unknown>): string {
  const packagingType = String(product.packaging_type || "").trim();
  const nouns = product.container_nouns;
  const notes = String(product.research_notes || "").trim();
  const guess = guessPackagingFromName(String(product.name || ""), String(product.description || ""));

  const type = packagingType || guess.packaging_type;
  const containerList = Array.isArray(nouns)
    ? (nouns as string[]).join(", ")
    : guess.container_nouns.join(", ");

  return `Packaging: ${type} (use: ${containerList})${notes ? `\nResearch: ${notes.slice(0, 400)}` : ""}`;
}
