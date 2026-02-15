// ============================================================
// AI Content Scanner — Background Service Worker
// Handles CORS-bypassed image fetching, scan state, and auto-scan
// ============================================================

// Fetch images that content scripts can't access due to CORS
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_IMAGE" && msg.url) {
    fetchAsBase64(msg.url)
      .then((buffer) => sendResponse({ buffer }))
      .catch(() => sendResponse({ buffer: null }));
    return true; // async
  }

  // Forward scan results to popup
  if (msg.type === "SCAN_COMPLETE") {
    chrome.storage.session.set({ lastScan: msg.summary });
  }

  // Fetch arbitrary URL for SCAN_URL feature
  if (msg.type === "SCAN_URL_FETCH" && msg.url) {
    fetchAsBase64(msg.url)
      .then((buffer) => sendResponse({ buffer }))
      .catch(() => sendResponse({ buffer: null }));
    return true;
  }
});

async function fetchAsBase64(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result?.split(",")[1] || null;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// Set badge text when scan completes (optionally for a specific tab)
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "SCAN_COMPLETE" && msg.summary) {
    const { images, videos, text } = msg.summary;
    const aiCount = [...images, ...videos, ...text].filter(
      (r) => r.verdict === "ai_detected" || r.verdict === "likely_ai"
    ).length;

    const tabId = sender.tab?.id;
    if (aiCount > 0) {
      if (tabId != null) {
        chrome.action.setBadgeText({ tabId, text: String(aiCount) });
        chrome.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" });
      } else {
        chrome.action.setBadgeText({ text: String(aiCount) });
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
      }
    } else {
      if (tabId != null) chrome.action.setBadgeText({ tabId, text: "" });
      else chrome.action.setBadgeText({ text: "" });
    }
  }
});

// ── Auto-scan on tab change (optional, debounced) ──
const AUTO_SCAN_DEBOUNCE_MS = 800;
let autoScanTimeout = null;

function isScannableUrl(url) {
  if (!url || typeof url !== "string") return false;
  return url.startsWith("http:") || url.startsWith("https:");
}

async function triggerAutoScan(tabId) {
  const { autoScanOnTabChange = true } = await chrome.storage.local.get("autoScanOnTabChange");
  if (!autoScanOnTabChange) return;

  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url || !isScannableUrl(tab.url)) return;

    await chrome.tabs.sendMessage(tabId, { type: "SCAN_PAGE" });
  } catch {
    // Content script not ready or restricted URL — ignore (e.g. chrome://, new tab)
  }
}

function scheduleAutoScan(tabId) {
  if (autoScanTimeout) clearTimeout(autoScanTimeout);
  autoScanTimeout = setTimeout(() => {
    autoScanTimeout = null;
    triggerAutoScan(tabId);
  }, AUTO_SCAN_DEBOUNCE_MS);
}

chrome.tabs.onActivated.addListener((activeInfo) => {
  scheduleAutoScan(activeInfo.tabId);
});
