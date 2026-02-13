// ============================================================
// AI Content Scanner — Background Service Worker
// Handles CORS-bypassed image fetching and scan state
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

// Set badge text when scan completes
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "SCAN_COMPLETE" && msg.summary) {
    const { images, videos, text } = msg.summary;
    const aiCount = [...images, ...videos, ...text].filter(
      (r) => r.verdict === "ai_detected" || r.verdict === "likely_ai"
    ).length;

    if (aiCount > 0) {
      chrome.action.setBadgeText({ text: String(aiCount) });
      chrome.action.setBadgeBackgroundColor({ color: "#ef4444" });
    } else {
      chrome.action.setBadgeText({ text: "" });
    }
  }
});
