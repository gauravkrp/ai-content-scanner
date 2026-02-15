// ============================================================
// AI Content Scanner — Popup Logic
// ============================================================

const scanBtn = document.getElementById("scanBtn");
const scanBtnText = document.getElementById("scanBtnText");
const summaryEl = document.getElementById("summary");
const legendEl = document.getElementById("legend");
const resultsEl = document.getElementById("results");
const emptyStateEl = document.getElementById("emptyState");
const aiCountEl = document.getElementById("aiCount");
const suspectCountEl = document.getElementById("suspectCount");
const cleanCountEl = document.getElementById("cleanCount");
const urlInput = document.getElementById("urlInput");
const checkBtn = document.getElementById("checkBtn");
const urlResultEl = document.getElementById("urlResult");
const autoScanToggle = document.getElementById("autoScanToggle");

const VERDICT_CONFIG = {
  ai_detected: { label: "AI Detected", dotClass: "dot-red", priority: 0, color: "#ef4444" },
  likely_ai: { label: "Likely AI", dotClass: "dot-amber", priority: 1, color: "#f59e0b" },
  uncertain: { label: "Uncertain", dotClass: "dot-indigo", priority: 2, color: "#818cf8" },
  likely_real: { label: "Likely Real", dotClass: "dot-green", priority: 3, color: "#34d399" },
  no_metadata: { label: "No Metadata", dotClass: "dot-gray", priority: 4, color: "#6b7280" },
};

// ── Auto-scan on tab change: load saved setting and bind toggle ──
(async function initAutoScanSetting() {
  const { autoScanOnTabChange = true } = await chrome.storage.local.get("autoScanOnTabChange");
  autoScanToggle.setAttribute("aria-pressed", String(autoScanOnTabChange));
  autoScanToggle.addEventListener("click", async () => {
    const next = autoScanToggle.getAttribute("aria-pressed") !== "true";
    autoScanToggle.setAttribute("aria-pressed", String(next));
    await chrome.storage.local.set({ autoScanOnTabChange: next });
  });
})();

// ── Auto-scan on popup open ──
(async function autoScan() {
  await triggerScan();
})();

// ── Manual scan button ──
scanBtn.addEventListener("click", () => triggerScan());

async function triggerScan() {
  scanBtn.classList.add("scanning");
  scanBtnText.textContent = "Scanning\u2026";
  emptyStateEl.style.display = "none";
  resultsEl.textContent = "";
  summaryEl.style.display = "none";
  legendEl.style.display = "none";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    // Inject content script if not already present
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ["content.css"],
      });
    } catch {
      // Already injected — that's fine
    }

    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
    renderResults(response);
  } catch (err) {
    console.error("[Popup] Scan error:", err);
    resultsEl.textContent = "";
    const errState = document.createElement("div");
    errState.className = "empty-state";
    const errIcon = document.createElement("div");
    errIcon.className = "empty-icon";
    errIcon.textContent = "\u26A0\uFE0F";
    const errTitle = document.createElement("div");
    errTitle.className = "empty-title";
    errTitle.textContent = "Scan failed";
    const errDesc = document.createElement("div");
    errDesc.className = "empty-desc";
    errDesc.textContent = err.message + " — Make sure you're on a regular webpage (not a browser internal page).";
    errState.appendChild(errIcon);
    errState.appendChild(errTitle);
    errState.appendChild(errDesc);
    resultsEl.appendChild(errState);
  } finally {
    scanBtn.classList.remove("scanning");
    scanBtnText.textContent = "Re-scan";
  }
}

// ── URL Check ──
checkBtn.addEventListener("click", () => checkUrl());
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkUrl();
});

async function checkUrl() {
  const url = urlInput.value.trim();
  if (!url) return;

  try {
    new URL(url); // validate
  } catch {
    showUrlError("Please enter a valid URL.");
    return;
  }

  checkBtn.classList.add("checking");
  checkBtn.textContent = "Checking\u2026";
  urlResultEl.style.display = "none";
  urlResultEl.textContent = "";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error("No active tab");

    // Ensure content script is injected
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
    } catch {
      // Already injected
    }

    const result = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_URL", url });
    if (result) {
      urlResultEl.style.display = "block";
      urlResultEl.textContent = "";
      urlResultEl.appendChild(buildResultItem(result, result.type || "image"));
    } else {
      showUrlError("No result returned. The URL may be inaccessible.");
    }
  } catch (err) {
    showUrlError("Check failed: " + err.message);
  } finally {
    checkBtn.classList.remove("checking");
    checkBtn.textContent = "Check";
  }
}

function showUrlError(msg) {
  urlResultEl.style.display = "block";
  urlResultEl.textContent = "";
  const errDiv = document.createElement("div");
  errDiv.style.cssText = "font-size:11px; color:#ef4444; padding:4px 0;";
  errDiv.textContent = msg;
  urlResultEl.appendChild(errDiv);
}

// ── Render Page Scan Results ──
function renderResults(data) {
  if (!data) {
    emptyStateEl.style.display = "block";
    return;
  }

  const all = [
    ...data.images.map((r) => ({ ...r, contentType: "image" })),
    ...data.videos.map((r) => ({ ...r, contentType: "video" })),
    ...data.text.map((r) => ({ ...r, contentType: "text" })),
  ];

  all.sort(
    (a, b) =>
      (VERDICT_CONFIG[a.verdict]?.priority ?? 5) -
      (VERDICT_CONFIG[b.verdict]?.priority ?? 5)
  );

  const aiDetected = all.filter((r) => r.verdict === "ai_detected").length;
  const suspect = all.filter(
    (r) => r.verdict === "likely_ai" || r.verdict === "uncertain"
  ).length;
  const clean = all.filter(
    (r) => r.verdict === "likely_real" || r.verdict === "no_metadata"
  ).length;

  aiCountEl.textContent = aiDetected;
  suspectCountEl.textContent = suspect;
  cleanCountEl.textContent = clean;

  summaryEl.style.display = "grid";
  legendEl.style.display = "flex";

  if (all.length === 0) {
    resultsEl.textContent = "";
    const noResults = document.createElement("div");
    noResults.className = "empty-state";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "\u2705";
    const title = document.createElement("div");
    title.className = "empty-title";
    title.textContent = "Nothing found";
    const desc = document.createElement("div");
    desc.className = "empty-desc";
    desc.textContent = "No scannable images, videos, or text blocks were detected on this page.";
    noResults.appendChild(icon);
    noResults.appendChild(title);
    noResults.appendChild(desc);
    resultsEl.appendChild(noResults);
    return;
  }

  // Group by content type
  const groups = { image: [], video: [], text: [] };
  for (const item of all) {
    groups[item.contentType]?.push(item);
  }

  resultsEl.textContent = "";

  for (const [type, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    const typeLabel = { image: "Images", video: "Videos", text: "Text Blocks" }[type];
    const sectionHeader = document.createElement("div");
    sectionHeader.className = "section-header";
    sectionHeader.textContent = typeLabel + " (" + items.length + ")";
    resultsEl.appendChild(sectionHeader);

    for (const item of items) {
      resultsEl.appendChild(buildResultItem(item, type));
    }
  }
}

// ── Build a single result item with expandable detail panel ──
function buildResultItem(item, type) {
  const config = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.no_metadata;
  const confidence = item.confidence ?? 0;

  const wrapper = document.createElement("div");
  wrapper.className = "result-item";

  // ── Header row ──
  const header = document.createElement("div");
  header.className = "result-header";

  const dot = document.createElement("div");
  dot.className = "result-dot " + config.dotClass;

  const content = document.createElement("div");
  content.className = "result-content";

  // Top row: verdict + confidence badge
  const topRow = document.createElement("div");
  topRow.className = "result-top-row";

  const verdictEl = document.createElement("div");
  verdictEl.className = "result-verdict";
  verdictEl.textContent = config.label;

  const confBadge = document.createElement("span");
  confBadge.className = "result-confidence " + getConfClass(confidence);
  confBadge.textContent = confidence + "%";

  topRow.appendChild(verdictEl);
  topRow.appendChild(confBadge);
  content.appendChild(topRow);

  // Source
  if (item.source) {
    const sourceEl = document.createElement("div");
    sourceEl.className = "result-source";
    sourceEl.textContent = "Source: " + item.source;
    content.appendChild(sourceEl);
  }

  // First reason (collapsed preview)
  if (item.reasons && item.reasons.length > 0) {
    const reasonEl = document.createElement("div");
    reasonEl.className = "result-reason";
    reasonEl.textContent = item.reasons[0];
    content.appendChild(reasonEl);
  }

  // Meta (URL or word count)
  const metaStr = item.metadata?.src
    ? truncateUrl(item.metadata.src, 55)
    : item.metadata?.wordCount
      ? item.metadata.wordCount + " words"
      : "";
  if (metaStr) {
    const metaEl = document.createElement("div");
    metaEl.className = "result-meta";
    metaEl.textContent = metaStr;
    content.appendChild(metaEl);
  }

  const typeTag = document.createElement("div");
  typeTag.className = "result-type-tag";
  typeTag.textContent = type;

  const expandIcon = document.createElement("div");
  expandIcon.className = "result-expand-icon";
  expandIcon.textContent = "\u25BC";

  header.appendChild(dot);
  header.appendChild(content);
  header.appendChild(typeTag);
  header.appendChild(expandIcon);
  wrapper.appendChild(header);

  // ── Detail panel (hidden by default) ──
  const details = document.createElement("div");
  details.className = "result-details";

  // Confidence bar
  const confSection = document.createElement("div");
  confSection.className = "detail-section";
  const confTitle = document.createElement("div");
  confTitle.className = "detail-title";
  confTitle.textContent = "Confidence";
  confSection.appendChild(confTitle);

  const confBarContainer = document.createElement("div");
  confBarContainer.className = "confidence-bar-container";
  const confBar = document.createElement("div");
  confBar.className = "confidence-bar";
  const confFill = document.createElement("div");
  confFill.className = "confidence-bar-fill";
  confFill.style.width = confidence + "%";
  confFill.style.background = config.color;
  confBar.appendChild(confFill);
  const confLabel = document.createElement("div");
  confLabel.className = "confidence-bar-label";
  confLabel.style.color = config.color;
  confLabel.textContent = confidence + "%";
  confBarContainer.appendChild(confBar);
  confBarContainer.appendChild(confLabel);
  confSection.appendChild(confBarContainer);
  details.appendChild(confSection);

  // Source section
  if (item.source) {
    const srcSection = document.createElement("div");
    srcSection.className = "detail-section";
    const srcTitle = document.createElement("div");
    srcTitle.className = "detail-title";
    srcTitle.textContent = "Source";
    srcSection.appendChild(srcTitle);
    const srcValue = document.createElement("div");
    srcValue.style.cssText = "font-size:12px; color:#3b82f6; font-weight:600;";
    srcValue.textContent = item.source;
    srcSection.appendChild(srcValue);
    details.appendChild(srcSection);
  }

  // Fingerprint section
  const fpEntries = Object.entries(item.fingerprint || {});
  if (fpEntries.length > 0) {
    const fpSection = document.createElement("div");
    fpSection.className = "detail-section";
    const fpTitle = document.createElement("div");
    fpTitle.className = "detail-title";
    fpTitle.textContent = "Fingerprint";
    fpSection.appendChild(fpTitle);
    const fpTable = document.createElement("div");
    fpTable.className = "detail-table";
    for (const [k, v] of fpEntries) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const key = document.createElement("div");
      key.className = "detail-key";
      key.textContent = k;
      const val = document.createElement("div");
      val.className = "detail-value";
      val.textContent = String(v);
      row.appendChild(key);
      row.appendChild(val);
      fpTable.appendChild(row);
    }
    fpSection.appendChild(fpTable);
    details.appendChild(fpSection);
  }

  // All reasons
  if (item.reasons && item.reasons.length > 1) {
    const reasonsSection = document.createElement("div");
    reasonsSection.className = "detail-section";
    const reasonsTitle = document.createElement("div");
    reasonsTitle.className = "detail-title";
    reasonsTitle.textContent = "Detection Reasons";
    reasonsSection.appendChild(reasonsTitle);
    for (const r of item.reasons) {
      const rDiv = document.createElement("div");
      rDiv.style.cssText = "font-size:11px; color:#8a8a8e; padding:1px 0;";
      rDiv.textContent = "\u2022 " + r;
      reasonsSection.appendChild(rDiv);
    }
    details.appendChild(reasonsSection);
  }

  // EXIF / Metadata section
  const exifEntries = Object.entries(item.exif || {});
  if (exifEntries.length > 0) {
    const exifSection = document.createElement("div");
    exifSection.className = "detail-section";
    const exifTitle = document.createElement("div");
    exifTitle.className = "detail-title";
    exifTitle.textContent = "EXIF / Metadata";
    exifSection.appendChild(exifTitle);
    const exifTable = document.createElement("div");
    exifTable.className = "detail-table";
    for (const [k, v] of exifEntries) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const key = document.createElement("div");
      key.className = "detail-key";
      key.textContent = k;
      const val = document.createElement("div");
      val.className = "detail-value";
      val.textContent = String(v);
      row.appendChild(key);
      row.appendChild(val);
      exifTable.appendChild(row);
    }
    exifSection.appendChild(exifTable);
    details.appendChild(exifSection);
  }

  // File metadata
  const metaEntries = Object.entries(item.metadata || {}).filter(
    ([k]) => k !== "src" && k !== "wordCount" && k !== "sentenceCount"
  );
  if (item.metadata?.fileSize) {
    const fsSection = document.createElement("div");
    fsSection.className = "detail-section";
    const fsTitle = document.createElement("div");
    fsTitle.className = "detail-title";
    fsTitle.textContent = "File Info";
    fsSection.appendChild(fsTitle);
    const fsTable = document.createElement("div");
    fsTable.className = "detail-table";

    if (item.metadata.fileSize) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const key = document.createElement("div");
      key.className = "detail-key";
      key.textContent = "File Size";
      const val = document.createElement("div");
      val.className = "detail-value";
      val.textContent = item.metadata.fileSize;
      row.appendChild(key);
      row.appendChild(val);
      fsTable.appendChild(row);
    }

    if (item.metadata.src) {
      const row = document.createElement("div");
      row.className = "detail-row";
      const key = document.createElement("div");
      key.className = "detail-key";
      key.textContent = "URL";
      const val = document.createElement("div");
      val.className = "detail-value";
      val.textContent = item.metadata.src;
      row.appendChild(key);
      row.appendChild(val);
      fsTable.appendChild(row);
    }

    fsSection.appendChild(fsTable);
    details.appendChild(fsSection);
  }

  wrapper.appendChild(details);

  // Toggle expand on click
  wrapper.addEventListener("click", () => {
    wrapper.classList.toggle("expanded");
  });

  return wrapper;
}

function getConfClass(confidence) {
  if (confidence >= 70) return "conf-high";
  if (confidence >= 40) return "conf-med";
  return "conf-low";
}

function truncateUrl(url, max) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + "\u2026" : u.pathname;
    const str = u.hostname + path;
    return str.length > max ? str.slice(0, max) + "\u2026" : str;
  } catch {
    return url.length > max ? url.slice(0, max) + "\u2026" : url;
  }
}
