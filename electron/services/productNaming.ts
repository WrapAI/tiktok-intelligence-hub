/**
 * Turn TikTok Shop SEO titles into short names you'd say in a script.
 */
export type ProductNameParts = {
  shortName: string;
  brand: string;
  fullName: string;
};

const KNOWN_BRANDS = [
  "Beauty of Joseon",
  "Dr. Melaxin",
  "Dr Melaxin",
  "The Ordinary",
  "L'Oreal",
  "L'Oreal Paris",
  "Maybelline",
  "Medicube",
  "EHPlabs",
  "Curl Jelly",
  "Skin1004",
  "SKIN1004",
  "TIRTIR",
  "ANUA",
  "COSRX",
  "Numbuzin",
  "DENSE",
  "Goli",
  "Bloom Nutrition",
  "Olaplex",
  "K18",
  "Color Wow",
  "Bondi Boost",
  "Micro Ingredients",
  "Physician's Choice",
  "Physicians Choice",
  "Ghost Lifestyle",
  "Optimum Nutrition",
  "MyProtein",
  "CeraVe",
  "La Roche-Posay",
  "La Roche Posay",
  "Laneige",
  "The Inkey List",
  "Inkey List",
  "Sol de Janeiro",
  "Drunk Elephant",
  "Charlotte Tilbury",
  "Rare Beauty",
  "Rhode",
  "Summer Fridays",
  "Revolution Beauty",
  "Wonderskin",
  "Careleaf",
  "Ninja",
  "CutXtreme",
];

const GENERIC_WORDS = new Set([
  "sports",
  "hydration",
  "electrolyte",
  "formula",
  "powder",
  "supplement",
  "healthcare",
  "muscle",
  "trainer",
  "with",
  "for",
  "and",
  "the",
  "styling",
  "hair",
  "kits",
  "kit",
  "vitamins",
  "energy",
  "drink",
  "sugar",
  "free",
  "vegan",
  "new",
  "portable",
  "premium",
  "organic",
  "natural",
  "packs",
  "pack",
  "available",
  "ml",
  "drink",
  "sport",
]);

const NOT_BRAND_WORDS = new Set([
  "pelvic",
  "led",
  "new",
  "organic",
  "natural",
  "premium",
  "portable",
  "professional",
  "electric",
  "wireless",
  "rechargeable",
  "adjustable",
  "waterproof",
  "2025new",
]);

function cleanToken(word: string): string {
  return word.replace(/[^\w.'-]/g, "").trim();
}

function cleanShortName(name: string): string {
  return name
    .replace(/\s+[&\-–—|,/]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSeoTail(text: string): string {
  let s = text.trim();
  s = s.replace(/^20\d{2}\s*new\s*/i, "").replace(/^new\s+/i, "");
  if (s.includes("|")) s = s.split("|")[0].trim();
  if (s.includes(",")) {
    const head = s.split(",")[0].trim();
    if (head.length >= 6 && head.length < s.length - 4) s = head;
  }
  if (/\s+-\s+/.test(s)) {
    const [head, tail] = s.split(/\s+-\s+/, 2);
    if (head.length >= 4 && (tail.length > 35 || tail.split(/\s+/).length > 6)) {
      s = head.trim();
    }
  }
  const withSplit = s.split(/\s+with\s+/i)[0]?.trim();
  if (withSplit && withSplit.length >= 8 && withSplit.split(/\s+/).length <= 6) {
    s = withSplit;
  }
  return s.replace(/\s+(Healthcare|Supplement|Supplements|Vitamins & Supplements)$/i, "").trim();
}

function detectBrand(full: string, working: string): string {
  const hay = `${full} ${working}`.toLowerCase();
  for (const brand of [...KNOWN_BRANDS].sort((a, b) => b.length - a.length)) {
    if (hay.includes(brand.toLowerCase())) return brand;
  }

  const first = cleanToken(working.split(/\s+/)[0] || "");
  if (!first || NOT_BRAND_WORDS.has(first.toLowerCase()) || /^\d/.test(first)) return "";
  if (/^[A-Z0-9]{2,}$/.test(first)) return first;
  if (/^[A-Z][a-z]+$/.test(first) && first.length >= 4 && first.length <= 14) return first;
  return "";
}

function shortNameFromBrand(brand: string, working: string): string {
  const idx = working.toLowerCase().indexOf(brand.toLowerCase());
  const after =
    idx >= 0
      ? working.slice(idx + brand.length).trim()
      : working.replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, "i"), "").trim();

  const productTypes = new Set([
    "gummies",
    "serum",
    "cream",
    "shampoo",
    "conditioner",
    "sprayer",
    "fan",
    "vitamins",
    "mask",
    "balm",
  ]);

  const parts: string[] = [];
  for (const word of after.split(/\s+/)) {
    const token = cleanToken(word);
    if (!token || token === "&" || /^\d+(\.\d+)?(ml|l|w|kw|in|cm|mm)?$/i.test(token)) continue;
    if (GENERIC_WORDS.has(token.toLowerCase())) continue;
    parts.push(token);
    if (productTypes.has(token.toLowerCase()) || parts.length >= 3) break;
  }

  if (!parts.length) return brand;
  return cleanShortName(`${brand} ${parts.join(" ")}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function genericShortName(working: string): string {
  let base = working.replace(/\s+\d+(\.\d+)?\s?(in|cm|mm|w|kw|ml|l)\b/gi, "").trim();
  if (base.length <= 42) return base;

  const words = base.split(/\s+/);
  let short = "";
  for (const word of words) {
    if (/^\d+(\.\d+)?(in|w|kw|ml)?$/i.test(word)) continue;
    const next = (short ? `${short} ${word}` : word).trim();
    if (next.length > 42) break;
    short = next;
    if (short.split(/\s+/).length >= 4) break;
  }

  return short || base.slice(0, 42).trim();
}

export function shortenProductName(fullName: string): ProductNameParts {
  const full = fullName.trim();
  if (!full) return { shortName: "", brand: "", fullName: full };

  const working = stripSeoTail(full);
  const brand = detectBrand(full, working);

  if (
    working.length <= 40 &&
    working.split(/\s+/).length <= 4 &&
    !full.includes("|") &&
    !full.includes(",")
  ) {
    return { shortName: cleanShortName(working), brand, fullName: full };
  }

  if (brand.includes(" ") && working.toLowerCase().startsWith(brand.toLowerCase())) {
    return { shortName: brand, brand, fullName: full };
  }

  let shortName = brand ? shortNameFromBrand(brand, working) : genericShortName(working);
  shortName = cleanShortName(shortName);
  if (shortName.length > 48) shortName = shortName.slice(0, 45).trim() + "…";

  return {
    shortName: shortName || cleanShortName(working.slice(0, 42)),
    brand,
    fullName: full,
  };
}
