// Converts on-screen text into TTS-safe narration text.
// On-screen text stays visually clean (₹76,000 Cr); narration gets the
// fully spelled-out, pause-corrected version so the voice engine doesn't
// mangle symbols, abbreviations, or compound handles.

const NUMBER_WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
];

function threeDigitToWords(n) {
  const ones = [
    "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
    "seventeen", "eighteen", "nineteen",
  ];
  const tens = [
    "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety",
  ];
  let out = "";
  const hundred = Math.floor(n / 100);
  const rest = n % 100;
  if (hundred) out += `${ones[hundred]} hundred `;
  if (rest) {
    if (rest < 20) out += ones[rest];
    else out += `${tens[Math.floor(rest / 10)]}${rest % 10 ? " " + ones[rest % 10] : ""}`;
  }
  return out.trim();
}

// Indian numbering: thousand / lakh / crore
function numberToIndianWords(num) {
  if (num === 0) return "zero";
  let n = Math.round(num);
  const parts = [];
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;
  const rest = n;

  if (crore) parts.push(`${threeDigitToWords(crore)} crore`);
  if (lakh) parts.push(`${threeDigitToWords(lakh)} lakh`);
  if (thousand) parts.push(`${threeDigitToWords(thousand)} thousand`);
  if (rest) parts.push(threeDigitToWords(rest));
  return parts.join(" ");
}

// Acronyms respelled phonetically per-letter (plain "A. I." style spacing
// reads inconsistently, especially on the male voice) — spelled as the
// actual letter names run together with hyphens instead.
const ACRONYM_RESPELL = {
  AI: "ay-eye",
  GDP: "jee-dee-pee",
  GNI: "jee-en-eye",
  CEA: "see-ee-ay",
  EV: "ee-vee",
  CSR: "see-es-ar",
  NITI: "nee-tee",
  UPSC: "you-pee-es-see",
};

// Domain terms and brand words the neural voice mispronounces or runs
// together. Order matters: brand/handle fixes must run before the plain
// "Bharat" respell below, since they fully replace those spans.
const TERM_FIXES = [
  [/\bfabs\b/gi, "fab plants"],
  [/\bCr\b/g, "crore rupees"],
  // "lakh crore" is a real, common Indian financial unit (1 lakh crore =
  // 1,00,00,000 * 1,00,000 = 10^12) - the old version of this regex
  // matched the "lakh" group but silently discarded it, so "₹1.64 lakh
  // crore" (a real ~$196B figure) was narrated as if it said "₹1.64
  // crore" (~$196K), off by a factor of 100,000. Found 2026-09-17 while
  // reviewing the SEMICON India video's narration.
  [/₹\s?([\d,]+(?:\.\d+)?)\s?lakh\s?crore/gi, (_, num) => {
    const n = parseFloat(num.replace(/,/g, "")) * 100000;
    return `${numberToIndianWords(n)} crore rupees`;
  }],
  [/₹\s?([\d,]+(?:\.\d+)?)\s?crore/gi, (_, num) => {
    const n = parseFloat(num.replace(/,/g, ""));
    return `${numberToIndianWords(n)} crore rupees`;
  }],
  [/₹\s?([\d,]+(?:\.\d+)?)/g, (_, num) => {
    const n = parseFloat(num.replace(/,/g, ""));
    return `${numberToIndianWords(n)} rupees`;
  }],
  [/(\d+)%/g, (_, n) => `${numberToIndianWords(parseFloat(n))} percent`],
  [/\bFeb\s?1\b/gi, "February first"],
  [/\bApr\s?1\b/gi, "April first"],
  [/@bharatat100/gi, "Bhaarat, at, one hundred"],
  [/\bbharatat100\b/gi, "Bhaarat, at, one hundred"],
  [/\bbilingual\b/gi, "by-lingual"],
  [/\bcrosses\b/gi, "crawses"],
  [/\s*—\s*/g, ", "],
];

export function normalizeForSpeech(text) {
  let out = text;
  for (const [pattern, replacement] of TERM_FIXES) {
    out = out.replace(pattern, replacement);
  }
  for (const [acr, respelling] of Object.entries(ACRONYM_RESPELL)) {
    out = out.replace(new RegExp(`\\b${acr}\\b`, "g"), respelling);
  }
  // Plain "Bharat" (not already caught by the handle fix above) gets the
  // long-vowel respell so every voice says "Bhaa-rat", not "Buh-rat".
  out = out.replace(/\bBharat\b/g, "Bhaarat");
  // collapse accidental double spaces/punctuation from replacements
  out = out.replace(/\s{2,}/g, " ").replace(/\.\s*\./g, ".").trim();
  return out;
}
