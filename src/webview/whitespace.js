// Pure notable-whitespace / control-char classifier. Zero DOM/vscode
// dependencies, importable by the webview bundle and by node-based unit
// tests, exactly like align.js and charDiff.js.
//
// Why this exists: some code points are visually indistinguishable from an
// ordinary space or from nothing at all (zero-width characters), so a diff
// that differs only in one of these is otherwise invisible to the eye even
// though charDiff.js correctly marks it as a changed character. This module
// maps those code points to a visible glyph + human-readable name so
// render.mjs can surface them as `.ws-marker` spans with a tooltip.
//
// The set below is the "ambiguous/invisible space and control character"
// list from https://blog.matatu.org/whitespace. Plain space (U+0020) and
// line feed (U+000A) are deliberately NOT included — they are the ordinary,
// expected whitespace of the row structure itself, and marking them would
// make every line noisy instead of just the ambiguous ones.

/**
 * @typedef {{ glyph: string, name: string }} NotableInfo
 */

/**
 * Code point -> { glyph, name }. `glyph` is a single visible character
 * standing in for the invisible/ambiguous one; `name` is the Unicode
 * character name used in the marker's tooltip.
 *
 * Two families of glyph:
 *   - True control characters (TAB, VT, FF, CR, NEL) get their own
 *     Unicode "Control Pictures" (U+2400 block) glyph, or the closest
 *     familiar equivalent (TAB -> "→", matching how most editors already
 *     render a tab arrow).
 *   - Every Zs-category space variant (NBSP through IDEOGRAPHIC SPACE) and
 *     the two zero-width characters share the same "visible space" glyph,
 *     U+2423 OPEN BOX ("␣") — the point isn't to distinguish which
 *     space-like character it is by eye (that's what the tooltip is for),
 *     it's to make an otherwise-invisible/ambiguous character visible at
 *     all.
 *
 * @type {Record<number, NotableInfo>}
 */
export const NOTABLE = {
  0x0009: { glyph: "→", name: "TAB" }, // →
  0x000b: { glyph: "␋", name: "LINE TABULATION" }, // ␋
  0x000c: { glyph: "␌", name: "FORM FEED" }, // ␌
  0x000d: { glyph: "␍", name: "CARRIAGE RETURN" }, // ␍
  0x0085: { glyph: "␤", name: "NEXT LINE" }, // ␤
  0x00a0: { glyph: "␣", name: "NO-BREAK SPACE" }, // ␣
  0x1680: { glyph: "␣", name: "OGHAM SPACE MARK" },
  0x2000: { glyph: "␣", name: "EN QUAD" },
  0x2001: { glyph: "␣", name: "EM QUAD" },
  0x2002: { glyph: "␣", name: "EN SPACE" },
  0x2003: { glyph: "␣", name: "EM SPACE" },
  0x2004: { glyph: "␣", name: "THREE-PER-EM SPACE" },
  0x2005: { glyph: "␣", name: "FOUR-PER-EM SPACE" },
  0x2006: { glyph: "␣", name: "SIX-PER-EM SPACE" },
  0x2007: { glyph: "␣", name: "FIGURE SPACE" },
  0x2008: { glyph: "␣", name: "PUNCTUATION SPACE" },
  0x2009: { glyph: "␣", name: "THIN SPACE" },
  0x200a: { glyph: "␣", name: "HAIR SPACE" },
  0x200b: { glyph: "␣", name: "ZERO WIDTH SPACE" },
  0x200d: { glyph: "␣", name: "ZERO WIDTH JOINER" },
  0x2028: { glyph: "␣", name: "LINE SEPARATOR" },
  0x2029: { glyph: "␣", name: "PARAGRAPH SEPARATOR" },
  0x202f: { glyph: "␣", name: "NARROW NO-BREAK SPACE" },
  0x205f: { glyph: "␣", name: "MEDIUM MATHEMATICAL SPACE" },
  0x3000: { glyph: "␣", name: "IDEOGRAPHIC SPACE" },
};

/**
 * Code points that are whitespace/invisible but deliberately NOT marked —
 * the ordinary, expected characters of the row structure itself. Marking
 * these would make every line noisy.
 *   - U+0020 SPACE: the normal space.
 *   - U+000A LINE FEED: the line separator the diff already splits on.
 */
const NEVER_MARKED = new Set([0x0020, 0x000a]);

/**
 * Detects "notable" code points by Unicode *property* rather than an
 * enumerated list, so a character the curated {@link NOTABLE} map has never
 * heard of — an obscure space variant, or one Unicode adds in the future —
 * is still marked. The four properties between them cover every
 * invisible/ambiguous character:
 *   - White_Space: spaces, tabs, and line breaks (NBSP, en/em spaces, …).
 *   - Cc (control): C0/C1 control characters (CR, VT, FF, NUL, …).
 *   - Cf (format): invisible formatting (ZWSP, ZWJ, soft hyphen, BOM, bidi).
 *   - Default_Ignorable_Code_Point: other intentionally-invisible points.
 * (Caveat: this resolves against the JS runtime's Unicode version, so a
 * brand-new code point is recognized only once VS Code's Electron/V8 updates
 * its Unicode tables — but that arrives as an automatic upgrade, with no
 * change to this file.)
 */
const NOTABLE_PROPS = /[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;

/** A generic, category-based name for a notable char the curated map doesn't cover. */
function fallbackName(cp) {
  const ch = String.fromCodePoint(cp);
  if (/\p{Cc}/u.test(ch)) {
    return "CONTROL CHARACTER";
  }
  if (/[\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(ch)) {
    return "INVISIBLE FORMAT CHARACTER";
  }
  return "SPACE CHARACTER"; // remaining White_Space (Zs / Zl / Zp)
}

/** A visible stand-in glyph for a notable char the curated map doesn't cover. */
function fallbackGlyph(cp) {
  if (cp < 0x20) {
    return String.fromCodePoint(0x2400 + cp); // Control Pictures block (␀…␟)
  }
  if (cp === 0x7f) {
    return "␡"; // ␡ SYMBOL FOR DELETE
  }
  return "␣"; // ␣ OPEN BOX — same "visible space" glyph the curated spaces use
}

/**
 * Classifies a code point as a notable whitespace/invisible character.
 * Curated code points ({@link NOTABLE}) keep their exact Unicode name and
 * glyph; any other character that Unicode *classifies* as
 * whitespace/control/format/ignorable (and isn't a {@link NEVER_MARKED} one)
 * gets a category-based name and a generic glyph, so detection is not limited
 * to the hardcoded list. Ordinary visible characters return `undefined`.
 *
 * @param {number} cp
 * @returns {NotableInfo | undefined}
 */
export function classifyChar(cp) {
  if (cp === undefined || NEVER_MARKED.has(cp)) {
    return undefined;
  }
  const curated = NOTABLE[cp];
  if (curated) {
    return curated;
  }
  if (!NOTABLE_PROPS.test(String.fromCodePoint(cp))) {
    return undefined;
  }
  return { glyph: fallbackGlyph(cp), name: fallbackName(cp) };
}

/**
 * @typedef {{ text: string }} PlainPart
 * @typedef {{ marker: { glyph: string, name: string, cp: number } }} MarkerPart
 */

/**
 * Slices `text` into an ordered list of plain runs and notable-character
 * markers. Each notable character becomes its own marker entry (never
 * merged with a neighbor, even a run of the same notable character) so a
 * tooltip is always describing exactly one character.
 *
 * @param {string} text
 * @returns {Array<PlainPart | MarkerPart>}
 */
export function splitForMarkers(text) {
  /** @type {Array<PlainPart | MarkerPart>} */
  const result = [];
  let buffer = "";

  for (const ch of text) {
    const cp = ch.codePointAt(0);
    const info = cp === undefined ? undefined : classifyChar(cp);
    if (info) {
      if (buffer !== "") {
        result.push({ text: buffer });
        buffer = "";
      }
      result.push({ marker: { glyph: info.glyph, name: info.name, cp: /** @type {number} */ (cp) } });
    } else {
      buffer += ch;
    }
  }

  if (buffer !== "") {
    result.push({ text: buffer });
  }

  return result;
}
