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

const VERDICT_CONFIG = {
  ai_detected: { label: "AI Detected", dotClass: "dot-red", priority: 0 },
  likely_ai: { label: "Likely AI", dotClass: "dot-amber", priority: 1 },
  uncertain: { label: "Uncertain", dotClass: "dot-indigo", priority: 2 },
  likely_real: { label: "Likely Real", dotClass: "dot-green", priority: 3 },
  no_metadata: { label: "No Metadata", dotClass: "dot-gray", priority: 4 },
};

scanBtn.addEventListener("click", async () => {
  scanBtn.classList.add("scanning");
  scanBtnText.textContent = "Scanning…";
  emptyStateEl.style.display = "none";
  resultsEl.innerHTML = "";
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
      // Already injected via manifest — that's fine
    }

    // Send scan message
    const response = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_PAGE" });
    renderResults(response);
  } catch (err) {
    console.error("[Popup] Scan error:", err);
    resultsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <div class="empty-title">Scan failed</div>
        <div class="empty-desc">${escapeHtml(err.message)}<br><br>Make sure you're on a regular webpage (not a browser internal page).</div>
      </div>
    `;
  } finally {
    scanBtn.classList.remove("scanning");
    scanBtnText.textContent = "Re-scan";
  }
});

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

  // Sort: AI detected first, then likely_ai, etc.
  all.sort(
    (a, b) =>
      (VERDICT_CONFIG[a.verdict]?.priority ?? 5) -
      (VERDICT_CONFIG[b.verdict]?.priority ?? 5)
  );

  // Counts
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
    resultsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">✅</div>
        <div class="empty-title">Nothing found</div>
        <div class="empty-desc">No scannable images, videos, or text blocks were detected on this page.</div>
      </div>
    `;
    return;
  }

  // Group by content type
  const groups = { image: [], video: [], text: [] };
  for (const item of all) {
    groups[item.contentType]?.push(item);
  }

  let html = "";

  for (const [type, items] of Object.entries(groups)) {
    if (items.length === 0) continue;

    const typeLabel = { image: "Images", video: "Videos", text: "Text Blocks" }[type];
    html += `<div class="section-header">${typeLabel} (${items.length})</div>`;

    for (const item of items) {
      const config = VERDICT_CONFIG[item.verdict] || VERDICT_CONFIG.no_metadata;
      const reasonsHtml = item.reasons
        .slice(0, 3)
        .map((r) => escapeHtml(r))
        .join("<br>");

      const metaStr = item.metadata?.src
        ? truncateUrl(item.metadata.src, 55)
        : item.metadata?.wordCount
          ? `${item.metadata.wordCount} words`
          : "";

      html += `
        <div class="result-item">
          <div class="result-dot ${config.dotClass}"></div>
          <div class="result-content">
            <div class="result-verdict">${config.label}</div>
            <div class="result-reason">${reasonsHtml}</div>
            ${metaStr ? `<div class="result-meta">${escapeHtml(metaStr)}</div>` : ""}
          </div>
          <div class="result-type-tag">${type}</div>
        </div>
      `;
    }
  }

  resultsEl.innerHTML = html;
}

function truncateUrl(url, max) {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + "…" : u.pathname;
    const str = u.hostname + path;
    return str.length > max ? str.slice(0, max) + "…" : str;
  } catch {
    return url.length > max ? url.slice(0, max) + "…" : url;
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
