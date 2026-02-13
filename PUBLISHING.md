# Publishing to Chrome Web Store

Step-by-step guide to publish the AI Content Scanner extension.

## Prerequisites

- A Google account
- The extension source code (this repository)
- Screenshots of the extension in action (1280x800 or 640x400)

## 1. Create the ZIP package

Only include extension files — exclude the website, docs, and git files:

```bash
cd ai-content-scanner

zip -r ai-content-scanner.zip \
  manifest.json \
  background.js \
  content.js \
  content.css \
  popup.html \
  popup.js \
  icons/
```

Verify the ZIP contains the right files:

```bash
unzip -l ai-content-scanner.zip
```

You should see:

```
manifest.json
background.js
content.js
content.css
popup.html
popup.js
icons/icon16.png
icons/icon48.png
icons/icon128.png
```

Do **not** include: `web/`, `README.md`, `PUBLISHING.md`, `.git/`, or any `node_modules/`.

## 2. Register as a Chrome Web Store developer

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Sign in with your Google account
3. Pay the **one-time $5 USD registration fee**
4. Accept the developer agreement

## 3. Upload the extension

1. In the Developer Dashboard, click **"New Item"**
2. Upload `ai-content-scanner.zip`
3. You'll be taken to the listing editor

## 4. Fill in the store listing

### Basic info

| Field | Value |
|---|---|
| **Name** | AI Content Scanner |
| **Summary** (132 chars max) | Detect AI-generated images, videos & text on any webpage. Checks C2PA, EXIF, XMP, IPTC, SynthID & URL patterns. |
| **Description** | See suggested text below |
| **Category** | Tools |
| **Language** | English |

### Suggested description

```
AI Content Scanner detects AI-generated content on any webpage by analyzing metadata fingerprints and provenance standards.

WHAT IT DETECTS
- Images: C2PA/JUMBF provenance, EXIF/XMP AI signatures, IPTC DigitalSourceType, SynthID markers, AI service URL patterns
- Videos: URL patterns from AI video platforms (Runway, Pika, Sora, Kling, etc.)
- Text: LLM phrase patterns, sentence uniformity, transition word density

FEATURES
- Auto-scans when you click the icon — no extra clicks needed
- Confidence scoring (0-100%) for every detection
- Source identification — shows which AI tool generated the content (DALL-E, Midjourney, Stable Diffusion, Firefly, etc.)
- Full metadata extraction — EXIF, XMP (17+ fields), C2PA, IPTC
- URL checker — paste any image/video URL to scan it directly
- Page overlay badges with hover tooltips
- Expandable detail panels showing fingerprint data, metadata tables, and detection reasons

VERDICT SCALE
- AI Detected — Hard evidence (C2PA, EXIF tool name, IPTC tag)
- Likely AI — Strong circumstantial evidence
- Uncertain — Some signals present
- Likely Real — No AI signals found
- No Metadata — Could not read metadata

PRIVACY
All analysis runs locally in your browser. No data is sent to any server. No accounts, no API keys, no tracking.

Open source: https://github.com/gauravkrp/ai-content-scanner
```

### Screenshots

Upload 1-5 screenshots (1280x800 recommended). Capture these:

1. **Popup with scan results** — Show multiple results with different verdicts, confidence scores visible
2. **Expanded detail panel** — Click a result to show the confidence bar, source, fingerprint table, EXIF data
3. **URL check feature** — Show the URL input with a result
4. **Page overlay badges** — Show badges overlaid on images on a real webpage
5. **Text detection** — Show text blocks flagged with the left-border highlight

To capture screenshots on macOS:
- Extension popup: `Cmd + Shift + 4`, then draw a selection around the popup
- Full page with overlays: `Cmd + Shift + 4`, capture the browser tab area

### Promotional images (optional but recommended)

| Size | Purpose |
|---|---|
| 440x280 | Small promotional tile (shown in search results) |
| 1400x560 | Marquee banner (shown on featured pages) |

### Icon

The 128x128 icon is already in `icons/icon128.png` and will be pulled from the ZIP automatically.

## 5. Privacy practices

The Chrome Web Store requires you to declare data handling practices.

### Permission justifications

| Permission | Justification |
|---|---|
| `activeTab` | Required to access the current tab's page content for scanning images, videos, and text |
| `scripting` | Required to inject the content script that performs the scanning analysis |
| `storage` | Used to cache the latest scan results for displaying the badge count on the extension icon |
| `<all_urls>` (host permissions) | Required to fetch image binaries cross-origin for binary metadata analysis (C2PA, EXIF parsing). Images on CDNs with CORS restrictions cannot be analyzed without this. |

### Data use declarations

- **Does this extension collect user data?** No
- **Does this extension transmit data to remote servers?** No
- **Does this extension use remote code?** No
- **Single purpose description**: "Detect AI-generated content on webpages by analyzing metadata"

## 6. Submit for review

1. Complete all required fields (listing, privacy, screenshots)
2. Click **"Submit for Review"**
3. Review typically takes **1-3 business days** (can take up to a week for first-time developers)
4. You'll receive an email when approved or if changes are requested

### Common rejection reasons and fixes

| Reason | Fix |
|---|---|
| **Broad host permissions** | Add a detailed justification explaining CORS-bypassed image fetching for binary analysis |
| **Missing privacy policy** | Add a simple privacy policy (can be a GitHub page stating no data collection) |
| **Unclear single purpose** | Be specific: "Detect AI-generated content by checking metadata" |
| **Poor screenshots** | Use high-quality screenshots showing the extension in action on real pages |

## 7. After publishing

### Your store URL

Once approved, your extension gets a URL:
```
https://chrome.google.com/webstore/detail/ai-content-scanner/<extension-id>
```

### Update the website

Replace the sideload instructions on the landing page (`web/index.html`) with a direct "Install from Chrome Web Store" link:

```html
<a href="https://chrome.google.com/webstore/detail/ai-content-scanner/YOUR_EXTENSION_ID" target="_blank">
  Install from Chrome Web Store
</a>
```

### Pushing updates

1. Bump `version` in `manifest.json` (e.g., `"2.0.0"` → `"2.1.0"`)
2. Create a new ZIP with the same command from Step 1
3. Go to Developer Dashboard → your extension → **"Package"** tab
4. Click **"Upload new package"**
5. Upload the new ZIP
6. Click **"Submit for Review"**

Updates are typically reviewed faster than initial submissions.

### Version numbering

Follow semver:
- **Major** (3.0.0) — Breaking changes, major redesign
- **Minor** (2.1.0) — New features, detection methods
- **Patch** (2.0.1) — Bug fixes, minor tweaks

## Optional: Privacy policy page

If Google requests a privacy policy, create a simple one. You can host it on GitHub Pages:

Create `web/privacy.html` or add to your README:

```
Privacy Policy — AI Content Scanner

This extension does not collect, store, or transmit any user data.
All content analysis is performed locally in your browser.
No information is sent to external servers.
No accounts or API keys are required.
No cookies or tracking mechanisms are used.

Contact: https://github.com/gauravkrp/ai-content-scanner/issues
Last updated: 2025
```
