# 🔍 AI Content Scanner — Chrome Extension

A Chrome extension that scans any webpage and flags AI-generated content (images, videos, and text) by checking metadata fingerprints, provenance standards, and heuristic patterns.

## What It Detects

### Images & Video
| Method | What it checks | Covers |
|---|---|---|
| **C2PA / JUMBF** | Cryptographic provenance metadata embedded in file binary | OpenAI (DALL-E, GPT-image-1), Adobe Firefly, Microsoft Designer, Google Imagen, Leica/Nikon/Sony cameras |
| **EXIF / XMP software tags** | `Software`, `Creator`, `ImageDescription` fields | Any tool that writes its name into EXIF (DALL-E, Midjourney exports, Stable Diffusion with metadata enabled, etc.) |
| **IPTC DigitalSourceType** | Checks for `trainedAlgorithmicMedia` tag | C2PA-compliant tools |
| **SynthID markers** | Text references to Google's watermark system | Google Imagen, Veo, Gemini-generated images |
| **URL pattern matching** | Recognizes AI service hostnames in image URLs | OpenAI CDN, Replicate, fal.ai, Stability AI, Leonardo, etc. |
| **Alt text / captions** | Checks for "AI generated", tool names in `alt`/`title` attributes | Any properly-labeled content |

### Text
| Method | What it checks |
|---|---|
| **LLM phrase detection** | Flags overuse of phrases like "delve into", "it's worth noting", "tapestry of", etc. |
| **Sentence uniformity** | Measures coefficient of variation in sentence lengths (LLMs produce very uniform lengths) |
| **Paragraph uniformity** | Same analysis at paragraph level |
| **Transition word density** | Flags unusually high density of "however", "furthermore", "moreover", etc. |
| **Formality analysis** | Detects lack of colloquialisms/emoji in long-form text combined with other signals |

### Verdict Scale
- 🔴 **AI Detected** — Hard evidence found (C2PA, EXIF tool name, IPTC tag)
- 🟡 **Likely AI** — Strong circumstantial evidence (URL patterns + text heuristics)
- 🟣 **Uncertain** — Some signals present but inconclusive
- 🟢 **Likely Real** — No AI signals detected
- ⚫ **No Metadata** — Could not read metadata (CORS blocked, stripped, etc.)

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **"Load unpacked"**
4. Select the `ai-content-scanner` folder
5. The extension icon (🔍) appears in your toolbar

## Usage

1. Navigate to any webpage
2. Click the extension icon in the toolbar
3. Click **"Scan Page"**
4. Results appear in the popup + badges overlay on the page itself

Hover over any badge on the page to see detailed detection reasons.

## Architecture

```
ai-content-scanner/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker — CORS proxy for image fetches, badge updates
├── content.js          # Content script — core scanning logic injected into pages
├── content.css         # Overlay badge and tooltip styles
├── popup.html          # Extension popup UI
├── popup.js            # Popup interaction logic
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

### How scanning works

```
┌─────────────┐     ┌──────────────────────────────────────────┐
│   Popup UI  │────▶│           Content Script                 │
│  (popup.js) │     │                                          │
└─────────────┘     │  1. Enumerate all <img>, <video>, <p>    │
                    │  2. For each image:                      │
                    │     a. Fetch binary (CORS or via bg.js)  │
                    │     b. Scan for JUMBF/C2PA markers       │
                    │     c. Parse EXIF/XMP for AI signatures  │
                    │     d. Check URL patterns                │
                    │     e. Check alt text                    │
                    │  3. For each video: check URL + context  │
                    │  4. For each text block:                 │
                    │     a. Run LLM phrase detection          │
                    │     b. Measure sentence uniformity       │
                    │     c. Check transition word density     │
                    │  5. Attach overlay badges to DOM         │
                    │  6. Send results to popup                │
                    └──────────────────────────────────────────┘
                          │
                          ▼
                    ┌──────────────┐
                    │  Background  │  Fetches images blocked by CORS
                    │  (bg.js)     │  Updates extension badge count
                    └──────────────┘
```

## Limitations

- **Metadata can be stripped** — Screenshots, re-uploads, and some social platforms remove EXIF/C2PA data. The extension can't detect AI content when all metadata is gone.
- **SynthID invisible watermarks** require Google's proprietary detector — this extension checks for SynthID *text references* in metadata but cannot decode the actual pixel-level watermark.
- **Text heuristics are probabilistic** — They flag patterns *common* in LLM output, not proof of AI generation. Academic writing can trigger false positives.
- **CORS restrictions** — Some CDNs block cross-origin image access. The extension tries to fetch via the background script, but some images may be unreadable.
- **Video analysis is limited** — Binary analysis of video files from the content script is not practical; detection relies on URL patterns and surrounding context.

## Extending

### Adding an external AI detection API

You can integrate a classifier API (like Hive Moderation, Illuminarty, or AI or Not) by adding a fetch call in `content.js`'s `scanImage` function:

```typescript
// Example: calling an external detection API
async function callDetectionAPI(imageUrl: string): Promise<{ isAI: boolean; confidence: number }> {
  const response = await fetch("https://your-api.com/detect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer YOUR_API_KEY"
    },
    body: JSON.stringify({ url: imageUrl })
  });
  return response.json();
}
```

### Converting to TypeScript

The codebase is vanilla JS for zero-build simplicity, but to convert to TS:

```bash
npm init -y
npm install -D typescript @anthropic-ai/sdk @anthropic-ai/tool-use-package
npx tsc --init
# Rename .js → .ts, add types, compile with tsc
```

## Verification Resources

- **C2PA Verify**: [contentcredentials.org/verify](https://contentcredentials.org/verify)
- **Google SynthID Detector**: Available via Gemini app and Google Cloud
- **Google "About this image"**: Available in Google Images, Lens, and Circle to Search
- **Hive AI Detection**: [hivemoderation.com](https://hivemoderation.com)
- **AI or Not**: [aiornot.com](https://aiornot.com)
- **Illuminarty**: [illuminarty.ai](https://illuminarty.ai)
