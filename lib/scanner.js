// ============================================================
// AI Content Scanner — Shared Scanning Module
// Pure functions for detecting AI-generated content in binary
// image data and text. No DOM dependencies — works in Node.js.
// ============================================================

"use strict";

// ── Known AI tool signatures found in EXIF / XMP / IPTC metadata ──
const AI_SOFTWARE_SIGNATURES = [
  // Image generators
  "dall-e", "dall·e", "openai", "chatgpt",
  "midjourney",
  "stable diffusion", "stability ai", "stabilityai", "stablediffusion",
  "adobe firefly", "firefly",
  "imagen", "google deepmind", "deepmind",
  "leonardo ai", "leonardo.ai",
  "ideogram", "playground ai",
  "flux", "black forest labs",
  "bing image creator", "microsoft designer",
  "canva ai", "canva magic",
  "nightcafe", "artbreeder",
  "copilot designer",
  "grok", "xai",
  "gemini",
  // Video generators
  "sora", "runway", "runwayml", "pika", "kling", "veo", "luma",
  "haiper", "minimax", "hailuo",
];

// ── Normalized display names for AI tools ──
const AI_SOURCE_NAMES = {
  "dall-e": "DALL-E", "dall·e": "DALL-E", "openai": "OpenAI", "chatgpt": "ChatGPT",
  "midjourney": "Midjourney",
  "stable diffusion": "Stable Diffusion", "stability ai": "Stability AI",
  "stabilityai": "Stability AI", "stablediffusion": "Stable Diffusion",
  "adobe firefly": "Adobe Firefly", "firefly": "Adobe Firefly",
  "imagen": "Google Imagen", "google deepmind": "Google DeepMind", "deepmind": "Google DeepMind",
  "leonardo ai": "Leonardo AI", "leonardo.ai": "Leonardo AI",
  "ideogram": "Ideogram", "playground ai": "Playground AI",
  "flux": "FLUX (Black Forest Labs)", "black forest labs": "Black Forest Labs",
  "bing image creator": "Bing Image Creator", "microsoft designer": "Microsoft Designer",
  "canva ai": "Canva AI", "canva magic": "Canva Magic",
  "nightcafe": "NightCafe", "artbreeder": "Artbreeder",
  "copilot designer": "Copilot Designer",
  "grok": "Grok (xAI)", "xai": "xAI",
  "gemini": "Google Gemini",
  "sora": "Sora (OpenAI)", "runway": "Runway", "runwayml": "Runway",
  "pika": "Pika", "kling": "Kling", "veo": "Veo (Google)", "luma": "Luma Dream Machine",
  "haiper": "Haiper", "minimax": "Minimax", "hailuo": "Hailuo AI",
  // URL-based sources
  "oaidalleapi": "DALL-E (OpenAI)", "dalle": "DALL-E",
  "mj-gallery": "Midjourney",
  "replicate.delivery": "Replicate", "replicate.com": "Replicate",
  "pika.art": "Pika", "fal.ai": "FAL.ai", "together.xyz": "Together AI",
};

// ── C2PA claim_generator: camera/capture (not AI) vs AI tools ──
const C2PA_CLAIM_CAMERA = [
  "leica", "sony", "canon", "nikon", "om system", "fujifilm",
  "iphone", "pixel", "phase one", "capture one", "camera",
  "pentax", "panasonic", "lumix", "olympus",
];
const C2PA_CLAIM_AI = [
  "dall-e", "dall·e", "firefly", "midjourney", "openai", "stability",
  "imagen", "leonardo", "ideogram", "flux", "microsoft designer",
  "bing", "canva", "runway", "sora", "veo", "luma", "pika", "kling",
  "gemini", "replicate", "fal.ai", "playground",
];

// ── AI service URL patterns ──
const AI_HOST_PATTERNS = [
  "oaidalleapi", "dalle", "openai",
  "midjourney", "mj-gallery",
  "replicate.delivery", "replicate.com",
  "stability.ai", "stablediffusion",
  "leonardo.ai", "firefly",
  "flux", "fal.ai", "together.xyz",
];

// ====================================================================
//  BINARY HELPERS
// ====================================================================

function extractAsciiStrings(buffer) {
  const bytes = new Uint8Array(buffer);
  const strings = [];
  let current = "";

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) {
      current += String.fromCharCode(b);
    } else {
      if (current.length >= 4) strings.push(current);
      current = "";
    }
  }
  if (current.length >= 4) strings.push(current);
  return strings;
}

// ====================================================================
//  C2PA / JUMBF DETECTION
// ====================================================================

function detectC2PA(buffer) {
  const bytes = new Uint8Array(buffer);
  const len = bytes.length;
  const info = { found: false, signer: null, claimGenerator: null, decodedText: null };

  const text = new TextDecoder("ascii", { fatal: false }).decode(
    bytes.subarray(0, Math.min(len, 200_000))
  );

  for (let i = 0; i < len - 8; i++) {
    if (
      bytes[i] === 0x6a &&
      bytes[i + 1] === 0x75 &&
      bytes[i + 2] === 0x6d &&
      bytes[i + 3] === 0x62
    ) {
      info.found = true;
      break;
    }
  }
  if (/c2pa|c2cl|contentcredentials|content.credentials/i.test(text)) {
    info.found = true;
  }

  if (info.found) {
    info.decodedText = text;
    const signerMatch = text.match(/claim_generator["\s:=]+([^"<\x00]{4,80})/i);
    if (signerMatch) info.claimGenerator = signerMatch[1].trim();

    const certMatch = text.match(/(?:signer|issuer|CN=)([^"<,\x00]{4,80})/i);
    if (certMatch) info.signer = certMatch[1].trim();
  }

  return info;
}

// ====================================================================
//  EXIF / XMP / IPTC PARSER
// ====================================================================

function parseMetadata(buffer) {
  const bytes = new Uint8Array(buffer);
  const result = {
    software: "",
    iptcDigitalSource: "",
    aiSignature: "",
    exifFields: {},
  };

  // ── EXIF APP1 segment (JPEG) ──
  for (let i = 0; i < Math.min(bytes.length, 100); i++) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) {
      const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
      const segment = buffer.slice(i + 4, i + 4 + segLen);
      const strings = extractAsciiStrings(segment);
      const joined = strings.join(" ");

      for (const sig of AI_SOFTWARE_SIGNATURES) {
        if (joined.toLowerCase().includes(sig)) {
          result.aiSignature = sig;
          break;
        }
      }

      extractExifTagsFromStrings(strings, result.exifFields);
      break;
    }
  }

  // ── XMP block ──
  const fullText = new TextDecoder("ascii", { fatal: false }).decode(
    bytes.subarray(0, Math.min(bytes.length, 300_000))
  );

  const xmpMatch = fullText.match(
    /<x:xmpmeta[\s\S]{0,50000}<\/x:xmpmeta>/i
  );
  if (xmpMatch) {
    const xmp = xmpMatch[0];
    const xmpLower = xmp.toLowerCase();

    if (!result.aiSignature) {
      for (const sig of AI_SOFTWARE_SIGNATURES) {
        if (xmpLower.includes(sig)) {
          result.aiSignature = sig;
          break;
        }
      }
    }

    if (/digitalsourcetype.*trainedAlgorithmicMedia/i.test(xmp)) {
      result.iptcDigitalSource = "trainedAlgorithmicMedia";
    }
    if (/digitalsourcetype.*compositeWithTrainedAlgorithmicMedia/i.test(xmp)) {
      result.iptcDigitalSource = "compositeWithTrainedAlgorithmicMedia";
    }

    extractXmpFields(xmp, result.exifFields);
  }

  // ── Broad text scan for AI signatures ──
  if (!result.aiSignature) {
    const lowerFull = fullText.toLowerCase();
    for (const sig of AI_SOFTWARE_SIGNATURES) {
      if (lowerFull.includes(sig)) {
        result.aiSignature = sig;
        break;
      }
    }
  }

  if (result.aiSignature) {
    result.software = result.aiSignature;
  }

  return result;
}

function extractExifTagsFromStrings(strings, fields) {
  for (let i = 0; i < strings.length; i++) {
    const s = strings[i];
    const lower = s.toLowerCase();

    if (lower.includes("adobe") || lower.includes("photoshop") ||
        lower.includes("gimp") || lower.includes("lightroom")) {
      fields["Software"] = fields["Software"] || s.trim();
    }

    const dateMatch = s.match(/(\d{4}:\d{2}:\d{2} \d{2}:\d{2}:\d{2})/);
    if (dateMatch && !fields["DateTime"]) {
      fields["DateTime"] = dateMatch[1];
    }

    if (i > 0 && strings[i - 1]?.toLowerCase()?.includes("model")) {
      fields["Camera Model"] = fields["Camera Model"] || s.trim();
    }
  }
}

function extractXmpFields(xmp, fields) {
  const extractors = [
    { key: "Creator Tool", regex: /xmp:CreatorTool[>"]*>?\s*([^<]+)/i },
    { key: "Creator", regex: /dc:creator[^<]*<[^>]*>([^<]+)/i },
    { key: "Description", regex: /dc:description[^<]*<[^>]*>([^<]+)/i },
    { key: "Rights", regex: /dc:rights[^<]*<[^>]*>([^<]+)/i },
    { key: "Title", regex: /dc:title[^<]*<[^>]*>([^<]+)/i },
    { key: "Credit", regex: /photoshop:Credit[>"]*>?\s*([^<]+)/i },
    { key: "Document ID", regex: /xmpMM:DocumentID[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "Instance ID", regex: /xmpMM:InstanceID[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "Original Document ID", regex: /xmpMM:OriginalDocumentID[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "XMP Toolkit", regex: /x:xmptk[="]*["=]\s*["']?([^"'<>]+)/i },
    { key: "Digital Source Type", regex: /DigitalSourceType[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "Create Date", regex: /xmp:CreateDate[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "Modify Date", regex: /xmp:ModifyDate[>"]*>?\s*["']?([^"'<]+)/i },
    { key: "Format", regex: /dc:format[>"]*>?\s*([^<]+)/i },
    { key: "Color Space", regex: /exif:ColorSpace[>"]*>?\s*([^<]+)/i },
    { key: "Pixel X Dimension", regex: /exif:PixelXDimension[>"]*>?\s*([^<]+)/i },
    { key: "Pixel Y Dimension", regex: /exif:PixelYDimension[>"]*>?\s*([^<]+)/i },
  ];

  for (const { key, regex } of extractors) {
    const m = xmp.match(regex);
    if (m && m[1]?.trim()) {
      fields[key] = m[1].trim();
    }
  }

  const aboutMatch = xmp.match(/rdf:about\s*=\s*["']([^"']+)/i);
  if (aboutMatch && aboutMatch[1]) {
    fields["RDF About"] = aboutMatch[1];
  }
}

// ====================================================================
//  CONFIDENCE CALCULATION
// ====================================================================

function calculateImageConfidence(signals) {
  const weights = [];
  if (signals.c2pa) weights.push(0.95);
  if (signals.exifSignature) weights.push(0.90);
  if (signals.iptc) weights.push(0.92);
  if (signals.synthid) weights.push(0.90);
  if (signals.urlPattern) weights.push(0.65);
  if (signals.altText) weights.push(0.55);

  if (weights.length === 0) return 5;
  const combined = 1 - weights.reduce((acc, w) => acc * (1 - w), 1);
  return Math.min(99, Math.round(combined * 100));
}

function calculateTextConfidence(score) {
  if (score >= 70) return 90;
  if (score >= 50) return 65 + Math.round((score - 50) * 1.25);
  if (score >= 30) return 40 + Math.round((score - 30) * 1.25);
  return Math.max(5, Math.round(score * 1.3));
}

function getSourceName(signature) {
  if (!signature) return null;
  return AI_SOURCE_NAMES[signature.toLowerCase()] || signature;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

// ====================================================================
//  IMAGE / BINARY SCANNING
// ====================================================================

function scanBuffer(buffer, url) {
  const signals = { c2pa: false, exifSignature: false, iptc: false, synthid: false, urlPattern: false };
  const result = {
    verdict: "no_metadata",
    confidence: 0,
    source: null,
    reasons: [],
    fingerprint: {},
    exif: {},
    fileSize: formatBytes(buffer.byteLength),
  };

  // 1) C2PA / JUMBF — only flag as AI when claim_generator indicates an AI tool
  const c2pa = detectC2PA(buffer);
  if (c2pa.found) {
    result.fingerprint.c2pa = "JUMBF superbox detected";
    let c2paClassified = false;
    if (c2pa.claimGenerator) {
      result.fingerprint.claimGenerator = c2pa.claimGenerator;
      const genLower = c2pa.claimGenerator.toLowerCase();
      const isCamera = C2PA_CLAIM_CAMERA.some((s) => genLower.includes(s));
      const isAi = C2PA_CLAIM_AI.some((s) => genLower.includes(s));
      if (isAi) {
        signals.c2pa = true;
        result.verdict = "ai_detected";
        result.reasons.push("C2PA Content Credentials found — provenance from an AI tool.");
        result.source = result.source || c2pa.claimGenerator;
        c2paClassified = true;
      } else if (isCamera) {
        result.reasons.push("C2PA Content Credentials from capture device (camera/phone) — not AI-generated.");
        result.verdict = "likely_real";
        result.source = result.source || c2pa.claimGenerator;
        c2paClassified = true;
      }
    }
    if (!c2paClassified && c2pa.decodedText) {
      const blobLower = c2pa.decodedText.toLowerCase();
      for (const ai of C2PA_CLAIM_AI) {
        if (blobLower.includes(ai)) {
          signals.c2pa = true;
          result.verdict = "ai_detected";
          result.reasons.push("C2PA Content Credentials found — AI tool name in manifest.");
          result.source = result.source || ai;
          c2paClassified = true;
          break;
        }
      }
    }
    if (!c2paClassified) {
      result.reasons.push(
        c2pa.claimGenerator
          ? "C2PA Content Credentials present; source unknown (not classified as AI)."
          : "C2PA Content Credentials present; no claim generator (not classified as AI)."
      );
      result.verdict = "uncertain";
      if (c2pa.claimGenerator) result.source = result.source || c2pa.claimGenerator;
    }
    if (c2pa.signer) result.fingerprint.signer = c2pa.signer;
  }

  // 2) EXIF / XMP + full metadata extraction
  const meta = parseMetadata(buffer);
  result.exif = { ...meta.exifFields };

  if (meta.software) {
    signals.exifSignature = true;
    result.verdict = "ai_detected";
    const displayName = getSourceName(meta.software);
    result.reasons.push("AI tool signature in metadata: \"" + displayName + "\".");
    result.fingerprint.software = meta.software;
    result.source = result.source || displayName;
    result.exif["AI Software"] = displayName;
  }

  if (meta.iptcDigitalSource) {
    signals.iptc = true;
    result.verdict = "ai_detected";
    result.reasons.push("IPTC DigitalSourceType: " + meta.iptcDigitalSource);
    result.fingerprint.iptcDigitalSource = meta.iptcDigitalSource;
  }

  // 3) SynthID
  const textScan = new TextDecoder("ascii", { fatal: false }).decode(
    new Uint8Array(buffer).subarray(0, Math.min(buffer.byteLength, 200_000))
  );
  if (/synthid/i.test(textScan)) {
    signals.synthid = true;
    result.verdict = "ai_detected";
    result.reasons.push("Google SynthID marker reference found in metadata.");
    result.fingerprint.synthid = "SynthID reference detected";
    result.source = result.source || "Google (SynthID)";
  }

  // 4) URL patterns
  if (url) {
    const urlLower = url.toLowerCase();
    for (const pattern of AI_HOST_PATTERNS) {
      if (urlLower.includes(pattern)) {
        signals.urlPattern = true;
        if (result.verdict === "no_metadata") result.verdict = "likely_ai";
        result.reasons.push("Image URL contains AI service pattern: \"" + pattern + "\".");
        result.fingerprint.urlPattern = pattern;
        result.source = result.source || getSourceName(pattern);
        break;
      }
    }
  }

  // 5) Confidence
  result.confidence = calculateImageConfidence(signals);

  if (result.reasons.length === 0) {
    result.reasons.push("No AI signals detected in metadata.");
  }

  return result;
}

// ====================================================================
//  TEXT SCANNING (heuristic)
// ====================================================================

function scanTextBlock(text) {
  if (text.length < 300) return null;

  const signals = [];
  let score = 0;

  const llmPhrases = [
    "it's worth noting that", "it's important to note", "it is worth mentioning",
    "in today's world", "in the rapidly evolving",
    "dive into", "dive deep", "let's delve", "delve into",
    "the landscape of", "navigating the",
    "harness the power", "leverage the",
    "at the end of the day", "in conclusion,", "to summarize,",
    "overall,", "in summary,", "furthermore,", "moreover,", "additionally,",
    "it's crucial to", "plays a crucial role",
    "a testament to", "tapestry of", "multifaceted",
    "comprehensive guide", "step-by-step guide",
    "unlock the", "game-changer", "paradigm shift",
    "holistic approach", "foster a sense of", "embark on",
  ];

  const lowerText = text.toLowerCase();
  let phraseHits = 0;
  const hitPhrases = [];
  for (const phrase of llmPhrases) {
    const count = lowerText.split(phrase).length - 1;
    if (count > 0) {
      phraseHits += count;
      hitPhrases.push(phrase);
    }
  }

  if (phraseHits >= 3) {
    score += 25;
    signals.push("Contains " + phraseHits + " common LLM phrases (" + hitPhrases.slice(0, 3).join(", ") + "...)");
  } else if (phraseHits >= 1) {
    score += 10;
  }

  const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
  if (sentences.length >= 5) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length;
    const cv = Math.sqrt(variance) / avg;

    if (cv < 0.25 && avg > 12) {
      score += 20;
      signals.push(
        "Very uniform sentence length (CV=" + cv.toFixed(2) + ", avg " + avg.toFixed(0) + " words) — typical of LLM output."
      );
    }
  }

  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 50);
  if (paragraphs.length >= 3) {
    const pLens = paragraphs.map((p) => p.length);
    const pAvg = pLens.reduce((a, b) => a + b, 0) / pLens.length;
    const pVariance = pLens.reduce((a, b) => a + (b - pAvg) ** 2, 0) / pLens.length;
    const pCv = Math.sqrt(pVariance) / pAvg;

    if (pCv < 0.3) {
      score += 15;
      signals.push(
        "Very uniform paragraph lengths (CV=" + pCv.toFixed(2) + ") — may indicate AI generation."
      );
    }
  }

  const transitions = (
    lowerText.match(
      /\b(however|therefore|furthermore|moreover|additionally|consequently|nevertheless|nonetheless|in addition|as a result|on the other hand)\b/g
    ) || []
  ).length;
  const wordCount = text.split(/\s+/).length;
  const transitionDensity = transitions / wordCount;

  if (transitionDensity > 0.015 && transitions >= 4) {
    score += 15;
    signals.push(
      "High transition word density (" + transitions + " in " + wordCount + " words) — common in AI text."
    );
  }

  const hasEmojis = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u.test(text);
  const hasSlang = /\b(lol|lmao|tbh|imo|idk|gonna|wanna|gotta|ya'll|y'all|ngl|fr|bruh)\b/i.test(text);

  if (!hasEmojis && !hasSlang && wordCount > 200 && phraseHits >= 1) {
    score += 10;
    signals.push("Formal tone with no colloquialisms in long-form text.");
  }

  let verdict = "likely_real";
  if (score >= 50) verdict = "likely_ai";
  else if (score >= 30) verdict = "uncertain";

  if (verdict === "likely_real" && signals.length === 0) return null;

  const confidence = calculateTextConfidence(score);

  return {
    verdict,
    confidence,
    source: verdict !== "likely_real" ? "LLM (heuristic)" : null,
    score,
    reasons: signals.length > 0 ? signals : ["No strong AI signals detected."],
    metadata: {
      wordCount: String(wordCount),
      sentenceCount: String(sentences.length),
    },
    fingerprint: {
      method: "Statistical heuristics",
      heuristicScore: score + "/85",
    },
  };
}

// ====================================================================
//  EXPORTS
// ====================================================================

module.exports = {
  scanBuffer,
  scanTextBlock,
  detectC2PA,
  parseMetadata,
  extractXmpFields,
  extractAsciiStrings,
  calculateImageConfidence,
  calculateTextConfidence,
  getSourceName,
  formatBytes,
  AI_SOFTWARE_SIGNATURES,
  AI_SOURCE_NAMES,
  AI_HOST_PATTERNS,
};