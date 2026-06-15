/**
 * Library analyses describe competitor videos. Creators copy STYLE only —
 * hook structure, pacing, visual technique — applied to their own product.
 */

export const INSPIRATION_RULES_BLOCK = `## CRITICAL: How to use library analyses
Analysed videos are COMPETITOR content for inspiration only.

COPY (adapt to the creator's product):
- Hook structure, tone, and pacing
- Visual technique (camera angle, movement, cuts, on-screen text style)
- Funnel approach (awareness vs demo vs hard sell)
- Why the hook worked (psychology / mechanism)

NEVER tell the creator to:
- Use or show products from the analysed video (they sell THEIR product instead)
- Recreate a specific background, room, or set from the analysed video
- Include assets, props, branding, or packaging they do not own
- Copy competitor scripts word-for-word

When reference notes mention a competitor product, translate to the TECHNIQUE only and apply it to the creator's product.`;

const PRODUCT_NOUNS =
  /\b(patches?|tubs?|tubes?|bottles?|jars?|gummies?|capsules?|serums?|creams?|shampoos?|conditioners?|supplements?|powders?|stick packs?|sachets?|wipes?|masks?|drops?|tablets?|pills?|bars?|kits?|bundles?|units?|boxes?|packs?|patches|electrolytes?|vitamins?|moisturisers?|moisturizers?)\b/i;

const BACKGROUND_PATTERNS = [
  /\b(?:in (?:a|the|her|his|their|my) )?(?:kitchen|bedroom|bathroom|living room|studio|office|vanity|garage|garden|balcony|hallway)\b/gi,
  /\b(?:marble|wooden|white|aesthetic|minimalist|cottagecore|dark moody|pink|beige)(?:\s+\w+){0,2}\s+(?:counter|background|backdrop|wall|room|setup|desk|vanity|scene)\b/gi,
  /\b(?:same|identical|matching|specific) (?:setup|background|room|aesthetic|backdrop|set)\b/gi,
  /\b(?:film|shot|record)(?:ed|ing)? (?:in|at|on) (?:a|the|her|his|their) .{0,45}/gi,
  /\bbackground\b/gi,
];

const FOREIGN_ASSET_PATTERNS = [
  /\b(?:their|competitor'?s?|creator'?s?|original|reference) (?:logo|brand(?:ing)?|packaging|asset|prop|merch|product|label)\b/gi,
  /\b(?:use|show|hold|display|include|feature|grab|pick up) (?:the )?(?:same|identical|both|two|three|2|3|\d+) .{0,70}/gi,
  /\beye patches?\b/gi,
  /\b(?:competitor|reference|analysed|analyzed) (?:video|product|item|brand)\b/gi,
];

function normalizeProductKey(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export function userProductMatches(text: string, userProduct: string): boolean {
  const keys = normalizeProductKey(userProduct);
  const hay = text.toLowerCase();
  const distinctive = keys.filter((k) => k.length >= 4);
  if (distinctive.some((k) => hay.includes(k))) return true;
  return keys.length >= 2 && keys.filter((k) => hay.includes(k)).length >= 2;
}

function mentionsForeignProducts(text: string, userProduct: string): boolean {
  if (!text.trim()) return false;
  if (userProductMatches(text, userProduct)) return false;

  if (/\beye patches?\b/i.test(text)) return true;

  if (
    /\b(?:two|three|2|3|both|pair of|multiple|several|stack of|couple of)\b.{0,35}\b(?:tubs?|bottles?|patches?|products?|items?|units?|jars?|gummies?)\b/i.test(
      text
    )
  ) {
    return true;
  }

  PRODUCT_NOUNS.lastIndex = 0;
  if (PRODUCT_NOUNS.test(text)) return true;

  return false;
}

export function stripBackgroundAndAssets(text: string): string {
  let s = text;
  for (const pattern of BACKGROUND_PATTERNS) s = s.replace(pattern, "");
  for (const pattern of FOREIGN_ASSET_PATTERNS) s = s.replace(pattern, "");
  return s.replace(/\s{2,}/g, " ").replace(/^[,.\-–—]+\s*/, "").trim();
}

function inferVisualTechnique(visualHook: string): string {
  const t = visualHook.toLowerCase();
  if (/\bunbox/i.test(t)) return "Unbox or reveal your product on camera";
  if (/\bbefore.?after|split screen|transition/i.test(t))
    return "Before/after or quick transformation cut with your product";
  if (/\btext on screen|on-?screen|caption|overlay/i.test(t))
    return "Bold on-screen text hook, then cut to your product";
  if (/\btalking head|face to camera|direct to camera/i.test(t))
    return "Direct-to-camera opener, then show your product";
  if (/\bslam|drop|throw|smack|slap/i.test(t))
    return "Pattern interrupt — fast dramatic reveal of your product";
  if (/\bhold|show|display|reveal|close.?up|zoom/i.test(t))
    return "Tight close-up — bring your product into frame with the same energy";
  if (/\bdemo|apply|application|use|using|drink|mix|pour|shake/i.test(t))
    return "Hands-on demo showing your product working";
  if (/\bstack|multiple|bundle|two|2|three|3|both/i.test(t))
    return "Stack or group shot of YOUR product units (same visual idea, your stock only)";
  if (/\bpoint|gesture|cart|orange cart/i.test(t))
    return "Point to the shop link while holding your product";
  return "Match the reference video's camera energy and opening framing — film YOUR product only";
}

function inferSpeakingTechnique(note: string): string {
  const t = note.toLowerCase();
  if (/urgency|scarcity|sold out|limited/i.test(t)) return "Create urgency or scarcity in your delivery";
  if (/social proof|reviews|testimonial|everyone|rating/i.test(t))
    return "Lean on social proof or your personal results";
  if (/problem|pain|struggle|issue/i.test(t)) return "Lead with the problem, then introduce your solution";
  if (/value|save|deal|discount|bundle|offer/i.test(t)) return "Stack value before the CTA";
  if (/curiosity|wait until|you won't believe|secret/i.test(t)) return "Open with curiosity, then pay it off with your product";
  return "Mirror the persuasion flow from the reference";
}

export function adaptVisualHookForProduct(visualHook: string, userProduct: string): string {
  const cleaned = stripBackgroundAndAssets(visualHook);
  if (!cleaned) return `Close-up of ${userProduct} — grab attention fast`;

  if (userProductMatches(cleaned, userProduct) && !mentionsForeignProducts(cleaned, userProduct)) {
    return cleaned.slice(0, 200);
  }

  const technique = inferVisualTechnique(visualHook);
  return `${technique} — featuring ${userProduct} (style only, not the reference product)`;
}

export function adaptHookTextForProduct(
  hookText: string,
  userProduct: string,
  hookType?: string
): string {
  const cleaned = stripBackgroundAndAssets(hookText);
  if (!cleaned) {
    return hookType
      ? `Open with a ${hookType}-style line about ${userProduct}.`
      : `Stop scrolling — here's why ${userProduct} is worth a look.`;
  }

  if (userProductMatches(cleaned, userProduct) && !mentionsForeignProducts(cleaned, userProduct)) {
    return cleaned.slice(0, 160);
  }

  const typeHint = hookType ? ` (${hookType} style)` : "";
  return `Use the same hook structure${typeHint} as the reference — talk about ${userProduct}, not products from the analysed video.`;
}

export function adaptInspiredNote(note: string, userProduct: string): string {
  const foreign = mentionsForeignProducts(note, userProduct);
  const cleaned = stripBackgroundAndAssets(note);
  if (!cleaned) {
    if (foreign) {
      return `Apply the reference video's style to ${userProduct} — do not copy their products, backgrounds, or props.`.slice(
        0,
        200
      );
    }
    return "";
  }

  if (foreign) {
    const technique = inferVisualTechnique(cleaned) || inferSpeakingTechnique(cleaned);
    return `${technique}. Apply to ${userProduct} — do not use items from the reference video.`.slice(0, 200);
  }

  if (!userProductMatches(cleaned, userProduct)) {
    return `${cleaned.slice(0, 140)} (apply this to ${userProduct})`;
  }

  return cleaned.slice(0, 200);
}

export function adaptVisualTactic(tactic: string, userProduct: string): string {
  const adapted = adaptInspiredNote(tactic, userProduct);
  return adapted.slice(0, 80) || `On-screen text supporting ${userProduct}`;
}

export function formatInspirationRules(): string {
  return INSPIRATION_RULES_BLOCK;
}
