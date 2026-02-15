# Chrome Web Store — Privacy practices (copy-paste)

Use the text below on the **Privacy practices** tab of your Chrome Web Store item edit page. Save Draft when done.

---

## 1. Justification for **activeTab**

**activeTab** is required so the extension can access the currently active browser tab when the user clicks the extension icon. We use it to: (1) get the active tab’s ID and URL so we know which page to scan; (2) inject the content script into that tab to analyze images, videos, and text on the page; and (3) receive scan results from the page. Access is only used when the user explicitly triggers a scan (e.g. by opening the popup or clicking Scan). We do not access tabs in the background without user action.

---

## 2. Justification for **host permission** use

**Host permissions (&lt;all_urls&gt;)** are required to fetch image and video binaries from arbitrary origins (e.g. CDNs, social sites, news sites) so the extension can read embedded metadata (C2PA, EXIF, XMP, IPTC) for AI-detection. Many image URLs are on domains that do not send CORS headers, so the content script cannot fetch them. The background script uses the extension’s host permission to perform a single, non-cached fetch of each image/video URL requested by the user (for the current page or for a pasted URL). Only the binary data is fetched; no HTML or scripts are loaded. No data is sent to any remote server; all analysis is done locally in the browser.

---

## 3. Justification for **remote code** use

The extension **does not use remote code**. It does not load, download, or execute any code from remote servers. The only network requests are **fetch** calls to image and video URLs to retrieve **binary data** (e.g. JPEG/PNG/WebP/MP4). That data is used only to read metadata (C2PA, EXIF, XMP, IPTC) locally; it is never interpreted as executable code. All extension logic is bundled in the extension package (content script, background script, popup). If the store asks for a “justification for remote code use,” you can state: “This extension does not use remote code. It only fetches image and video binaries to read metadata locally; no code from remote servers is loaded or executed.”

---

## 4. Justification for **scripting**

**scripting** is required to inject the extension’s own content script and CSS into the active tab when the user runs a scan. We use `chrome.scripting.executeScript` to inject `content.js` (which finds images/videos/text on the page and extracts metadata) and `chrome.scripting.insertCSS` to inject `content.css` (which adds overlay badges and highlights). Only the extension’s packaged files are injected; no code from the web page or from any remote server is executed. This is the standard way for a “scan this page” extension to run analysis on the current page.

---

## 5. Justification for **storage**

**storage** is used for two purposes only: (1) **Session storage**: we store the latest scan result summary (e.g. counts of AI / likely AI / uncertain items) so we can show a badge on the extension icon and so the popup can show the last scan when reopened. This is cleared when the browser session ends. (2) **Local storage**: we store one user preference, “auto-scan on tab change” (on/off), so the extension remembers the user’s choice. No personal data, no browsing history, and no content from pages are stored. Data never leaves the user’s device.

---

## 6. Single purpose description (required)

**Single purpose description** (use in the single-purpose field):

**Detect AI-generated content on webpages by analyzing metadata and patterns.** The extension scans the current page (or a pasted image/video URL) for AI-generated images, videos, and text. It checks C2PA, EXIF, XMP, IPTC, SynthID, URL patterns, and text heuristics, and shows confidence scores and source identification. All analysis runs locally; no data is sent to any server.

(Short variant if there’s a character limit: **Detect AI-generated images, video, and text on webpages by analyzing metadata (C2PA, EXIF, XMP, IPTC, SynthID) and patterns locally.**)

---

## 7. Data usage compliance certification

**Certify that your data usage complies with the Developer Program Policies:**

- This extension **does not collect** any personal or sensitive user data.
- It **does not transmit** any data to remote servers; all scanning and analysis is performed locally in the user’s browser.
- The only data stored is: (1) the latest scan summary in session storage (for the badge and popup), and (2) one local preference (“auto-scan on tab change”). No browsing history, no page content, and no identifiers are stored or sent.
- No remote code is used; only image/video binaries are fetched to read metadata locally.
- We do not use the extension for tracking, ads, or any purpose other than the single purpose described above.

By submitting, I certify that the extension’s data usage complies with the Chrome Web Store Developer Program Policies.
