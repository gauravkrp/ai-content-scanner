// ============================================================
// AI Content Scanner — Content Script
// Scans images, videos, and text on the current page for
// AI-generation fingerprints (C2PA, EXIF, IPTC, XMP, heuristics)
// ============================================================

(() => {
  "use strict";

  // ── Known AI tool signatures found in EXIF / XMP / IPTC metadata ──
  const AI_SOFTWARE_SIGNATURES = [
    // Image generators
    "dall-e", "dall·e", "openai", "chatgpt",
    "midjourney", "mj",
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
    "midjourney": "Midjourney", "mj": "Midjourney",
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
  // C2PA is used by both cameras (provenance) and AI tools; we only flag AI.
  const C2PA_CLAIM_CAMERA = [
    "leica", "sony", "canon", "nikon", "om system", "fujifilm",
    "iphone", "pixel", "content authenticity", "cai ", "phase one",
    "capture one", "camera", "pentax", "panasonic", "lumix", "olympus",
  ];
  const C2PA_CLAIM_AI = [
    "dall-e", "dall·e", "firefly", "midjourney", "openai", "stability",
    "imagen", "leonardo", "ideogram", "flux", "microsoft designer",
    "bing", "canva", "runway", "sora", "veo", "luma", "pika", "kling",
    "gemini", "replicate", "fal.ai", "playground",
  ];

  // ── C2PA / JUMBF magic bytes ──
  const C2PA_MANIFEST_MARKER = new Uint8Array([
    0x6a, 0x75, 0x6d, 0x62, // "jumb"
  ]);

  // ── Result store ──
  const scannedElements = new Map();
  let scanSummary = { images: [], videos: [], text: [] };

  // ====================================================================
  //  BINARY HELPERS
  // ====================================================================

  async function fetchImageBytes(url) {
    try {
      const resp = await fetch(url, { mode: "cors", cache: "force-cache" });
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch {
      try {
        const resp = await chrome.runtime.sendMessage({
          type: "FETCH_IMAGE",
          url,
        });
        if (resp?.buffer) {
          return base64ToArrayBuffer(resp.buffer);
        }
      } catch {
        // noop
      }
      return null;
    }
  }

  function base64ToArrayBuffer(base64) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  // ====================================================================
  //  EXIF / XMP / IPTC PARSER (lightweight)
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

  function detectC2PA(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;
    const info = { found: false, signer: null, claimGenerator: null };

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

    const text = new TextDecoder("ascii", { fatal: false }).decode(
      bytes.subarray(0, Math.min(len, 200_000))
    );
    if (/c2pa|c2cl|contentcredentials|content.credentials/i.test(text)) {
      info.found = true;
    }

    if (info.found) {
      const signerMatch = text.match(/claim_generator["\s:=]+([^"<\x00]{4,80})/i);
      if (signerMatch) info.claimGenerator = signerMatch[1].trim();

      const certMatch = text.match(/(?:signer|issuer|CN=)([^"<,\x00]{4,80})/i);
      if (certMatch) info.signer = certMatch[1].trim();
    }

    return info;
  }

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

  function calculateVideoConfidence(signals) {
    const weights = [];
    if (signals.urlPattern) weights.push(0.60);
    if (signals.contextMention) weights.push(0.50);
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

  // ====================================================================
  //  IMAGE SCANNING
  // ====================================================================

  async function scanImage(img) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
      return null;
    }
    if (img.naturalWidth < 80 || img.naturalHeight < 80) return null;

    return await scanImageUrl(src, img);
  }

  async function scanImageUrl(src, imgElement) {
    const signals = { c2pa: false, exifSignature: false, iptc: false, synthid: false, urlPattern: false, altText: false };

    const result = {
      element: imgElement || null,
      type: "image",
      verdict: "no_metadata",
      confidence: 0,
      source: null,
      reasons: [],
      metadata: { src },
      fingerprint: {},
      exif: {},
    };

    const buffer = await fetchImageBytes(src);
    if (!buffer) {
      result.confidence = 0;
      result.reasons.push("Could not fetch image data (CORS blocked).");
      return result;
    }

    result.metadata.fileSize = formatBytes(buffer.byteLength);

    // 1) C2PA / JUMBF — only flag as AI when claim_generator indicates an AI tool
    // Cameras and phones also embed C2PA for provenance; we treat those as non-AI.
    const c2pa = detectC2PA(buffer);
    if (c2pa.found) {
      result.fingerprint.c2pa = "JUMBF superbox detected";
      if (c2pa.claimGenerator) {
        result.fingerprint.claimGenerator = c2pa.claimGenerator;
        const genLower = c2pa.claimGenerator.toLowerCase();
        const isCamera = C2PA_CLAIM_CAMERA.some((s) => genLower.includes(s));
        const isAi = C2PA_CLAIM_AI.some((s) => genLower.includes(s));
        if (isCamera) {
          result.reasons.push("C2PA Content Credentials from capture device (camera/phone) — not AI-generated.");
          result.verdict = "likely_real";
          result.source = result.source || c2pa.claimGenerator;
        } else if (isAi) {
          signals.c2pa = true;
          result.verdict = "ai_detected";
          result.reasons.push("C2PA Content Credentials found — provenance from an AI tool.");
          result.source = result.source || c2pa.claimGenerator;
        } else {
          result.reasons.push("C2PA Content Credentials present; source unknown (not classified as AI).");
          result.verdict = "uncertain";
          result.source = result.source || c2pa.claimGenerator;
        }
      } else {
        result.reasons.push("C2PA Content Credentials present; no claim generator (not classified as AI).");
        result.verdict = "uncertain";
      }
      if (c2pa.signer) result.fingerprint.signer = c2pa.signer;
    }

    // 2) EXIF / XMP + metadata extraction
    const meta = parseMetadata(buffer);
    result.exif = { ...meta.exifFields };

    if (meta.software) {
      signals.exifSignature = true;
      result.verdict = "ai_detected";
      const displayName = getSourceName(meta.software);
      result.reasons.push("AI tool signature in metadata: \"" + escapeHtml(displayName) + "\".");
      result.fingerprint.software = meta.software;
      result.source = result.source || displayName;
      result.exif["AI Software"] = displayName;
    }

    if (meta.iptcDigitalSource) {
      signals.iptc = true;
      result.verdict = "ai_detected";
      result.reasons.push("IPTC DigitalSourceType: " + escapeHtml(meta.iptcDigitalSource));
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
    const urlLower = src.toLowerCase();
    const aiHostPatterns = [
      "oaidalleapi", "dalle", "openai",
      "midjourney", "mj-gallery",
      "replicate.delivery", "replicate.com",
      "stability.ai", "stablediffusion",
      "leonardo.ai", "firefly",
      "flux", "fal.ai", "together.xyz",
    ];
    for (const pattern of aiHostPatterns) {
      if (urlLower.includes(pattern)) {
        signals.urlPattern = true;
        if (result.verdict === "no_metadata") result.verdict = "likely_ai";
        result.reasons.push("Image URL contains AI service pattern: \"" + escapeHtml(pattern) + "\".");
        result.fingerprint.urlPattern = pattern;
        result.source = result.source || getSourceName(pattern);
        break;
      }
    }

    // 5) Alt text (DOM elements only)
    if (imgElement) {
      const altText = ((imgElement.alt || "") + " " + (imgElement.title || "")).toLowerCase();
      const aiAltPatterns = [
        "ai generated", "ai-generated", "generated by ai",
        "made with ai", "created with ai", "dall-e", "midjourney",
        "stable diffusion", "ai image", "ai art",
      ];
      for (const pattern of aiAltPatterns) {
        if (altText.includes(pattern)) {
          signals.altText = true;
          if (result.verdict === "no_metadata") result.verdict = "likely_ai";
          result.reasons.push("Alt/title text mentions AI: \"" + escapeHtml(pattern) + "\".");
          break;
        }
      }
    }

    result.confidence = calculateImageConfidence(signals);
    return result;
  }

  // ====================================================================
  //  VIDEO SCANNING
  // ====================================================================

  async function scanVideo(video) {
    const src = video.currentSrc || video.src;
    const sourceEl = video.querySelector("source");
    const videoSrc = src || sourceEl?.src;
    const signals = { urlPattern: false, contextMention: false };

    const result = {
      element: video,
      type: "video",
      verdict: "no_metadata",
      confidence: 0,
      source: null,
      reasons: [],
      metadata: { src: videoSrc || "unknown" },
      fingerprint: {},
      exif: {},
    };

    const urlLower = (videoSrc || "").toLowerCase();
    const aiVideoPatterns = [
      "sora", "runway", "runwayml", "pika.art", "pika",
      "kling", "luma", "haiper", "minimax", "hailuo",
      "replicate", "fal.ai",
    ];
    for (const pattern of aiVideoPatterns) {
      if (urlLower.includes(pattern)) {
        signals.urlPattern = true;
        result.verdict = "likely_ai";
        result.reasons.push("Video URL matches AI video tool: \"" + escapeHtml(pattern) + "\".");
        result.fingerprint.urlPattern = pattern;
        result.source = getSourceName(pattern);
        break;
      }
    }

    const parent = video.closest("figure, div, article, section");
    if (parent) {
      const parentText = parent.textContent?.toLowerCase() || "";
      const aiMentions = [
        "ai generated", "ai-generated", "sora", "runway",
        "pika", "kling", "generated video", "synthetic video",
      ];
      for (const mention of aiMentions) {
        if (parentText.includes(mention)) {
          signals.contextMention = true;
          if (result.verdict === "no_metadata") result.verdict = "likely_ai";
          result.reasons.push("Surrounding text mentions: \"" + escapeHtml(mention) + "\".");
          result.source = result.source || getSourceName(mention);
          break;
        }
      }
    }

    result.confidence = calculateVideoConfidence(signals);
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
      type: "text",
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
      exif: {},
    };
  }

  // ====================================================================
  //  URL SCANNING (standalone)
  // ====================================================================

  async function scanUrl(url) {
    const urlLower = url.toLowerCase();
    const isVideo = /\.(mp4|webm|mov|avi|mkv)(\?|$)/i.test(urlLower);

    if (isVideo) {
      const signals = { urlPattern: false, contextMention: false };
      const result = {
        type: "video",
        verdict: "no_metadata",
        confidence: 0,
        source: null,
        reasons: [],
        metadata: { src: url },
        fingerprint: {},
        exif: {},
      };

      const aiVideoPatterns = [
        "sora", "runway", "runwayml", "pika.art", "pika",
        "kling", "luma", "haiper", "minimax", "hailuo",
        "replicate", "fal.ai",
      ];
      for (const pattern of aiVideoPatterns) {
        if (urlLower.includes(pattern)) {
          signals.urlPattern = true;
          result.verdict = "likely_ai";
          result.reasons.push("Video URL matches AI video tool: \"" + escapeHtml(pattern) + "\".");
          result.fingerprint.urlPattern = pattern;
          result.source = getSourceName(pattern);
          break;
        }
      }

      result.confidence = calculateVideoConfidence(signals);
      if (result.reasons.length === 0) {
        result.reasons.push("No AI signals detected from URL analysis.");
      }
      return result;
    }

    return await scanImageUrl(url, null);
  }

  // ====================================================================
  //  HELPERS
  // ====================================================================

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // ====================================================================
  //  OVERLAY UI
  // ====================================================================

  function createBadge(result) {
    const badge = document.createElement("div");
    badge.className = "acs-badge";

    const colors = {
      ai_detected: { bg: "#ef4444", label: "AI Detected" },
      likely_ai: { bg: "#f59e0b", label: "Likely AI" },
      uncertain: { bg: "#6366f1", label: "Uncertain" },
      likely_real: { bg: "#22c55e", label: "Likely Real" },
      no_metadata: { bg: "#6b7280", label: "No Metadata" },
    };

    const { bg, label } = colors[result.verdict] || colors.no_metadata;

    // Build badge content safely
    const dot = document.createElement("div");
    dot.className = "acs-badge-dot";
    dot.style.background = bg;

    const labelSpan = document.createElement("span");
    labelSpan.className = "acs-badge-label";
    labelSpan.textContent = label;

    const confSpan = document.createElement("span");
    confSpan.className = "acs-badge-confidence";
    confSpan.style.color = bg;
    confSpan.textContent = result.confidence + "%";

    badge.appendChild(dot);
    badge.appendChild(labelSpan);
    badge.appendChild(confSpan);

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "acs-tooltip";

    const header = document.createElement("div");
    header.className = "acs-tooltip-header";
    header.textContent = label + " \u00B7 " + result.confidence + "% confidence";
    tooltip.appendChild(header);

    if (result.source) {
      const sourceDiv = document.createElement("div");
      sourceDiv.className = "acs-tooltip-source";
      sourceDiv.textContent = "Source: ";
      const sourceB = document.createElement("b");
      sourceB.textContent = result.source;
      sourceDiv.appendChild(sourceB);
      tooltip.appendChild(sourceDiv);
    }

    const reasonsUl = document.createElement("ul");
    reasonsUl.className = "acs-tooltip-reasons";
    for (const r of result.reasons) {
      const li = document.createElement("li");
      li.textContent = r;
      reasonsUl.appendChild(li);
    }
    tooltip.appendChild(reasonsUl);

    const fpEntries = Object.entries(result.fingerprint || {});
    if (fpEntries.length > 0) {
      const fpSection = document.createElement("div");
      fpSection.className = "acs-tooltip-section";
      const fpTitle = document.createElement("div");
      fpTitle.className = "acs-tooltip-section-title";
      fpTitle.textContent = "Fingerprint";
      fpSection.appendChild(fpTitle);
      for (const [k, v] of fpEntries) {
        const span = document.createElement("span");
        const b = document.createElement("b");
        b.textContent = k + ": ";
        span.appendChild(b);
        span.appendChild(document.createTextNode(String(v).slice(0, 80)));
        fpSection.appendChild(span);
      }
      tooltip.appendChild(fpSection);
    }

    const exifEntries = Object.entries(result.exif || {});
    if (exifEntries.length > 0) {
      const exifSection = document.createElement("div");
      exifSection.className = "acs-tooltip-section";
      const exifTitle = document.createElement("div");
      exifTitle.className = "acs-tooltip-section-title";
      exifTitle.textContent = "Metadata";
      exifSection.appendChild(exifTitle);
      for (const [k, v] of exifEntries.slice(0, 6)) {
        const span = document.createElement("span");
        const b = document.createElement("b");
        b.textContent = k + ": ";
        span.appendChild(b);
        span.appendChild(document.createTextNode(String(v).slice(0, 60)));
        exifSection.appendChild(span);
      }
      if (exifEntries.length > 6) {
        const more = document.createElement("span");
        more.className = "acs-tooltip-more";
        more.textContent = "+" + (exifEntries.length - 6) + " more fields";
        exifSection.appendChild(more);
      }
      tooltip.appendChild(exifSection);
    }

    badge.appendChild(tooltip);

    badge.addEventListener("mouseenter", () => {
      tooltip.style.display = "block";
    });
    badge.addEventListener("mouseleave", () => {
      tooltip.style.display = "none";
    });

    return badge;
  }

  function attachBadgeToElement(element, result) {
    const parent = element.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    const wrapper = document.createElement("div");
    wrapper.className = "acs-badge-wrapper";

    if (result.type === "text") {
      element.classList.add("acs-text-highlight");
      const verdictClass = "acs-text-" + result.verdict.replace(/_/g, "-");
      element.classList.add(verdictClass);
      element.prepend(createBadge(result));
    } else {
      if (parent) {
        wrapper.appendChild(createBadge(result));
        parent.appendChild(wrapper);
      }
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // ====================================================================
  //  MAIN SCAN ORCHESTRATOR
  // ====================================================================

  async function scanPage() {
    document.querySelectorAll(".acs-badge-wrapper, .acs-badge").forEach((el) => el.remove());
    document.querySelectorAll(".acs-text-highlight").forEach((el) => {
      el.classList.remove(
        "acs-text-highlight",
        "acs-text-ai-detected",
        "acs-text-likely-ai",
        "acs-text-uncertain"
      );
    });

    scanSummary = { images: [], videos: [], text: [] };

    const images = [...document.querySelectorAll("img")];
    const imagePromises = images.map(async (img) => {
      try {
        const result = await scanImage(img);
        if (result) {
          scannedElements.set(img, result);
          scanSummary.images.push(result);
          if (result.verdict !== "no_metadata") {
            attachBadgeToElement(img, result);
          }
        }
      } catch (e) {
        console.warn("[AI Scanner] Error scanning image:", e);
      }
    });

    const videos = [...document.querySelectorAll("video")];
    const videoPromises = videos.map(async (video) => {
      try {
        const result = await scanVideo(video);
        if (result) {
          scannedElements.set(video, result);
          scanSummary.videos.push(result);
          if (result.verdict !== "no_metadata") {
            attachBadgeToElement(video, result);
          }
        }
      } catch (e) {
        console.warn("[AI Scanner] Error scanning video:", e);
      }
    });

    const textContainers = [
      ...document.querySelectorAll("article, .post-content, .entry-content, .article-body, main p, .content p"),
    ];

    if (textContainers.length === 0) {
      const allP = [...document.querySelectorAll("p")];
      const bigP = allP.filter((p) => p.textContent.trim().length > 300);
      textContainers.push(...bigP);
    }

    const seen = new Set();
    const uniqueContainers = textContainers.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      for (const s of seen) {
        if (s !== el && s.contains(el)) return false;
      }
      return true;
    });

    for (const container of uniqueContainers) {
      const text = container.textContent?.trim() || "";
      const result = scanTextBlock(text);
      if (result) {
        result.element = container;
        scannedElements.set(container, result);
        scanSummary.text.push(result);
        if (result.verdict !== "likely_real") {
          attachBadgeToElement(container, result);
        }
      }
    }

    await Promise.allSettled([...imagePromises, ...videoPromises]);

    chrome.runtime.sendMessage({
      type: "SCAN_COMPLETE",
      summary: {
        images: scanSummary.images.map(stripElement),
        videos: scanSummary.videos.map(stripElement),
        text: scanSummary.text.map(stripElement),
      },
    });

    return scanSummary;
  }

  function stripElement(result) {
    const { element, ...rest } = result;
    return rest;
  }

  // ====================================================================
  //  MESSAGE HANDLING
  // ====================================================================

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "SCAN_PAGE") {
      scanPage().then((summary) => {
        sendResponse({
          images: summary.images.map(stripElement),
          videos: summary.videos.map(stripElement),
          text: summary.text.map(stripElement),
        });
      });
      return true;
    }

    if (msg.type === "GET_RESULTS") {
      sendResponse({
        images: scanSummary.images.map(stripElement),
        videos: scanSummary.videos.map(stripElement),
        text: scanSummary.text.map(stripElement),
      });
    }

    if (msg.type === "SCAN_URL") {
      scanUrl(msg.url).then((result) => {
        const { element, ...rest } = result;
        sendResponse(rest);
      });
      return true;
    }
  });
})();
