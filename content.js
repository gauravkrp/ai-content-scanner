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

  // ── C2PA / JUMBF magic bytes ──
  // C2PA embeds provenance in JUMBF boxes inside JPEG/PNG/WebP.
  // JUMBF UUID for C2PA: 64(hex) in the jp2c box
  const C2PA_JUMBF_MARKER = "c2pa"; // simplified text marker in binary
  const C2PA_MANIFEST_MARKER = new Uint8Array([
    0x6a, 0x75, 0x6d, 0x62, // "jumb"
  ]);

  // ── Result store ──
  /** @type {Map<HTMLElement, ScanResult>} */
  const scannedElements = new Map();

  /** @type {{ images: ScanResult[], videos: ScanResult[], text: ScanResult[] }} */
  let scanSummary = { images: [], videos: [], text: [] };

  // ── Interfaces ──
  /**
   * @typedef {Object} ScanResult
   * @property {HTMLElement} element
   * @property {"image"|"video"|"text"} type
   * @property {"ai_detected"|"likely_ai"|"uncertain"|"likely_real"|"no_metadata"} verdict
   * @property {string[]} reasons
   * @property {Record<string, string>} metadata
   */

  // ====================================================================
  //  BINARY HELPERS
  // ====================================================================

  /** Fetch an image as ArrayBuffer (same-origin or CORS) */
  async function fetchImageBytes(url) {
    try {
      const resp = await fetch(url, { mode: "cors", cache: "force-cache" });
      if (!resp.ok) return null;
      return await resp.arrayBuffer();
    } catch {
      // CORS blocked — try via background script
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

  /** Extract ASCII strings from binary that match AI tool names */
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

  /** Check binary for known C2PA / JUMBF markers */
  function hasC2PAMarkers(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.length;

    // Search for "jumb" box type (JUMBF superbox)
    for (let i = 0; i < len - 8; i++) {
      if (
        bytes[i] === 0x6a &&
        bytes[i + 1] === 0x75 &&
        bytes[i + 2] === 0x6d &&
        bytes[i + 3] === 0x62
      ) {
        return true;
      }
    }

    // Search for "c2pa" or "c2cl" text markers in XMP/metadata
    const text = new TextDecoder("ascii", { fatal: false }).decode(
      bytes.subarray(0, Math.min(len, 200_000))
    );
    if (/c2pa|c2cl|contentcredentials|content.credentials/i.test(text)) {
      return true;
    }

    return false;
  }

  /** Parse EXIF APP1 to find Software / ImageDescription fields */
  function parseExifSoftware(buffer) {
    const bytes = new Uint8Array(buffer);
    const results = { software: "", description: "", artist: "", xmp: "" };

    // Quick scan for EXIF marker (0xFFE1) in JPEG
    for (let i = 0; i < Math.min(bytes.length, 100); i++) {
      if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) {
        // Found APP1 — extract strings from this segment
        const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
        const segment = buffer.slice(i + 4, i + 4 + segLen);
        const strings = extractAsciiStrings(segment);
        const joined = strings.join(" ");

        for (const sig of AI_SOFTWARE_SIGNATURES) {
          if (joined.toLowerCase().includes(sig)) {
            results.software = sig;
            break;
          }
        }
        break;
      }
    }

    // Also search XMP block (often starts with "<?xpacket" or "<x:xmpmeta")
    const fullText = new TextDecoder("ascii", { fatal: false }).decode(
      bytes.subarray(0, Math.min(bytes.length, 300_000))
    );

    const xmpMatch = fullText.match(
      /<x:xmpmeta[\s\S]{0,50000}<\/x:xmpmeta>/i
    );
    if (xmpMatch) {
      results.xmp = xmpMatch[0];
      const xmpLower = results.xmp.toLowerCase();
      for (const sig of AI_SOFTWARE_SIGNATURES) {
        if (xmpLower.includes(sig)) {
          results.software = results.software || sig;
          break;
        }
      }
      // Check for DigitalSourceType (C2PA / IPTC standard for AI)
      if (/digitalsourcetype.*trainedAlgorithmicMedia/i.test(results.xmp)) {
        results.description = "IPTC:trainedAlgorithmicMedia";
      }
      if (/digitalsourcetype.*compositeWithTrainedAlgorithmicMedia/i.test(results.xmp)) {
        results.description = "IPTC:compositeWithTrainedAlgorithmicMedia";
      }
    }

    // Broad text scan for AI signatures
    if (!results.software) {
      const lowerFull = fullText.toLowerCase();
      for (const sig of AI_SOFTWARE_SIGNATURES) {
        if (lowerFull.includes(sig)) {
          results.software = sig;
          break;
        }
      }
    }

    return results;
  }

  // ====================================================================
  //  IMAGE SCANNING
  // ====================================================================

  async function scanImage(img) {
    const src = img.currentSrc || img.src;
    if (!src || src.startsWith("data:") || src.startsWith("blob:")) {
      return null;
    }

    // Skip tiny images (icons, tracking pixels, etc.)
    if (img.naturalWidth < 80 || img.naturalHeight < 80) return null;

    /** @type {ScanResult} */
    const result = {
      element: img,
      type: "image",
      verdict: "no_metadata",
      reasons: [],
      metadata: { src },
    };

    const buffer = await fetchImageBytes(src);
    if (!buffer) {
      result.reasons.push("Could not fetch image data (CORS blocked).");
      return result;
    }

    // 1) Check for C2PA / JUMBF
    if (hasC2PAMarkers(buffer)) {
      result.verdict = "ai_detected";
      result.reasons.push("C2PA Content Credentials found — provenance metadata embedded by an AI tool.");
      result.metadata.c2pa = "present";
    }

    // 2) Check EXIF / XMP for AI tool signatures
    const exif = parseExifSoftware(buffer);
    if (exif.software) {
      result.verdict = "ai_detected";
      result.reasons.push(
        `AI tool signature found in metadata: "${exif.software}".`
      );
      result.metadata.software = exif.software;
    }
    if (exif.description) {
      result.verdict = "ai_detected";
      result.reasons.push(`IPTC DigitalSourceType: ${exif.description}`);
      result.metadata.iptc = exif.description;
    }

    // 3) Check for SynthID text marker (Google embeds "synthid" references in some metadata)
    const textScan = new TextDecoder("ascii", { fatal: false }).decode(
      new Uint8Array(buffer).subarray(0, Math.min(buffer.byteLength, 200_000))
    );
    if (/synthid/i.test(textScan)) {
      result.verdict = "ai_detected";
      result.reasons.push("Google SynthID marker reference found in metadata.");
      result.metadata.synthid = "present";
    }

    // 4) Check for common AI hosting patterns in URL
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
        if (result.verdict === "no_metadata") result.verdict = "likely_ai";
        result.reasons.push(`Image URL contains AI service pattern: "${pattern}".`);
        result.metadata.urlPattern = pattern;
        break;
      }
    }

    // 5) Check alt text / title for AI mentions
    const altText = (img.alt + " " + img.title).toLowerCase();
    const aiAltPatterns = [
      "ai generated", "ai-generated", "generated by ai",
      "made with ai", "created with ai", "dall-e", "midjourney",
      "stable diffusion", "ai image", "ai art",
    ];
    for (const pattern of aiAltPatterns) {
      if (altText.includes(pattern)) {
        if (result.verdict === "no_metadata") result.verdict = "likely_ai";
        result.reasons.push(`Alt/title text mentions AI: "${pattern}".`);
        break;
      }
    }

    return result;
  }

  // ====================================================================
  //  VIDEO SCANNING
  // ====================================================================

  async function scanVideo(video) {
    const src = video.currentSrc || video.src;
    const sourceEl = video.querySelector("source");
    const videoSrc = src || sourceEl?.src;

    /** @type {ScanResult} */
    const result = {
      element: video,
      type: "video",
      verdict: "no_metadata",
      reasons: [],
      metadata: { src: videoSrc || "unknown" },
    };

    // Check URL patterns for known AI video generators
    const urlLower = (videoSrc || "").toLowerCase();
    const aiVideoPatterns = [
      "sora", "runway", "runwayml", "pika.art", "pika",
      "kling", "luma", "haiper", "minimax", "hailuo",
      "replicate", "fal.ai",
    ];
    for (const pattern of aiVideoPatterns) {
      if (urlLower.includes(pattern)) {
        result.verdict = "likely_ai";
        result.reasons.push(`Video URL matches AI video tool: "${pattern}".`);
        result.metadata.urlPattern = pattern;
        break;
      }
    }

    // Check surrounding context
    const parent = video.closest("figure, div, article, section");
    if (parent) {
      const parentText = parent.textContent?.toLowerCase() || "";
      const aiMentions = [
        "ai generated", "ai-generated", "sora", "runway",
        "pika", "kling", "generated video", "synthetic video",
      ];
      for (const mention of aiMentions) {
        if (parentText.includes(mention)) {
          if (result.verdict === "no_metadata") result.verdict = "likely_ai";
          result.reasons.push(`Surrounding text mentions: "${mention}".`);
          break;
        }
      }
    }

    return result;
  }

  // ====================================================================
  //  TEXT SCANNING (heuristic — statistical patterns)
  // ====================================================================

  /**
   * Lightweight AI text detection heuristics.
   * NOT a replacement for a proper classifier — flags suspicious patterns.
   */
  function scanTextBlock(text) {
    if (text.length < 300) return null; // too short to analyze

    const signals = [];
    let score = 0;

    // 1) Overuse of hedging / filler phrases common in LLM output
    const llmPhrases = [
      "it's worth noting that",
      "it's important to note",
      "it is worth mentioning",
      "in today's world",
      "in the rapidly evolving",
      "dive into", "dive deep",
      "let's delve",
      "delve into",
      "the landscape of",
      "navigating the",
      "harness the power",
      "leverage the",
      "at the end of the day",
      "in conclusion,",
      "to summarize,",
      "overall,",
      "in summary,",
      "furthermore,",
      "moreover,",
      "additionally,",
      "it's crucial to",
      "plays a crucial role",
      "a testament to",
      "tapestry of",
      "multifaceted",
      "comprehensive guide",
      "step-by-step guide",
      "unlock the",
      "game-changer",
      "paradigm shift",
      "holistic approach",
      "foster a sense of",
      "embark on",
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
      signals.push(`Contains ${phraseHits} common LLM phrases (${hitPhrases.slice(0, 3).join(", ")}…)`);
    } else if (phraseHits >= 1) {
      score += 10;
    }

    // 2) Sentence length uniformity (LLMs tend toward consistent length)
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    if (sentences.length >= 5) {
      const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
      const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
      const variance =
        lengths.reduce((a, b) => a + (b - avg) ** 2, 0) / lengths.length;
      const cv = Math.sqrt(variance) / avg; // coefficient of variation

      if (cv < 0.25 && avg > 12) {
        score += 20;
        signals.push(
          `Very uniform sentence length (CV=${cv.toFixed(2)}, avg ${avg.toFixed(0)} words) — typical of LLM output.`
        );
      }
    }

    // 3) Paragraph structure uniformity
    const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 50);
    if (paragraphs.length >= 3) {
      const pLens = paragraphs.map((p) => p.length);
      const pAvg = pLens.reduce((a, b) => a + b, 0) / pLens.length;
      const pVariance =
        pLens.reduce((a, b) => a + (b - pAvg) ** 2, 0) / pLens.length;
      const pCv = Math.sqrt(pVariance) / pAvg;

      if (pCv < 0.3) {
        score += 15;
        signals.push(
          `Very uniform paragraph lengths (CV=${pCv.toFixed(2)}) — may indicate AI generation.`
        );
      }
    }

    // 4) Excessive use of transitional words
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
        `High transition word density (${transitions} in ${wordCount} words) — common in AI text.`
      );
    }

    // 5) Emoji-free, perfectly punctuated long-form (combined signal)
    const hasEmojis = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}]/u.test(text);
    const hasSlang = /\b(lol|lmao|tbh|imo|idk|gonna|wanna|gotta|ya'll|y'all|ngl|fr|bruh)\b/i.test(text);

    if (!hasEmojis && !hasSlang && wordCount > 200 && phraseHits >= 1) {
      score += 10;
      signals.push("Formal tone with no colloquialisms in long-form text.");
    }

    // Determine verdict
    let verdict = "likely_real";
    if (score >= 50) verdict = "likely_ai";
    else if (score >= 30) verdict = "uncertain";

    if (verdict === "likely_real" && signals.length === 0) return null;

    return {
      type: "text",
      verdict,
      score,
      reasons: signals.length > 0 ? signals : ["No strong AI signals detected."],
      metadata: {
        wordCount: String(wordCount),
        sentenceCount: String(sentences.length),
      },
    };
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

    badge.innerHTML = `
      <div class="acs-badge-dot" style="background:${bg}"></div>
      <span class="acs-badge-label">${label}</span>
    `;

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.className = "acs-tooltip";
    tooltip.innerHTML = `
      <div class="acs-tooltip-header">${label}</div>
      <ul class="acs-tooltip-reasons">
        ${result.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
      </ul>
      ${
        Object.keys(result.metadata).length > 0
          ? `<div class="acs-tooltip-meta">
              ${Object.entries(result.metadata)
                .filter(([k]) => k !== "src")
                .map(([k, v]) => `<span><b>${k}:</b> ${escapeHtml(String(v).slice(0, 60))}</span>`)
                .join("")}
            </div>`
          : ""
      }
    `;

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
    // Ensure parent is positioned
    const parent = element.parentElement;
    if (parent && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }

    const wrapper = document.createElement("div");
    wrapper.className = "acs-badge-wrapper";

    if (result.type === "text") {
      // For text, add a subtle left-border highlight
      element.classList.add("acs-text-highlight");
      const verdictClass = `acs-text-${result.verdict.replace(/_/g, "-")}`;
      element.classList.add(verdictClass);
      element.prepend(createBadge(result));
    } else {
      // For images/videos, position overlay
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
    // Clear previous
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

    // ── Scan images ──
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

    // ── Scan videos ──
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

    // ── Scan text blocks ──
    const textContainers = [
      ...document.querySelectorAll("article, .post-content, .entry-content, .article-body, main p, .content p"),
    ];

    // Fallback: grab large <p> blocks if no semantic containers found
    if (textContainers.length === 0) {
      const allP = [...document.querySelectorAll("p")];
      const bigP = allP.filter((p) => p.textContent.trim().length > 300);
      textContainers.push(...bigP);
    }

    // Deduplicate (don't scan children of already-scanned containers)
    const seen = new Set();
    const uniqueContainers = textContainers.filter((el) => {
      if (seen.has(el)) return false;
      seen.add(el);
      // Skip if ancestor already in set
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

    // Notify popup with results
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

  /** Remove the DOM element ref before sending over message port */
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
      return true; // async
    }

    if (msg.type === "GET_RESULTS") {
      sendResponse({
        images: scanSummary.images.map(stripElement),
        videos: scanSummary.videos.map(stripElement),
        text: scanSummary.text.map(stripElement),
      });
    }
  });
})();
