# AI Content Scanner — Chrome Extension

A Chrome extension that scans any webpage and flags AI-generated content (images, videos, and text) by checking metadata fingerprints, provenance standards, and heuristic patterns. Shows confidence scores, identifies the AI source, and surfaces full metadata details.

**Website**: [ai-content-scanner](https://gauravkrp.github.io/ai-content-scanner/web/)
**Author**: [gauravkrp](https://gauravkrp.com) · [GitHub](https://github.com/gauravkrp/ai-content-scanner)

## Features

- **Auto-scan** — Scans the page automatically when you click the extension icon
- **Confidence scoring** — 0-100% confidence level for every detection, calculated from weighted signal combination
- **Source identification** — Identifies the AI tool (DALL-E, Midjourney, Stable Diffusion, Firefly, etc.)
- **Fingerprint data** — C2PA provenance, IPTC tags, SynthID markers
- **Full metadata** — EXIF, XMP (17+ fields), embedded document/instance IDs
- **URL scanning** — Paste any image or video URL directly in the popup to check it
- **Page overlays** — Badges on detected content with hover tooltips showing details
- **Text analysis** — Heuristic detection of LLM-generated text blocks

## What It Detects

### Images & Video

| Method | What it checks | Covers |
|---|---|---|
| **C2PA / JUMBF** | Cryptographic provenance metadata embedded in file binary | OpenAI (DALL-E, GPT-image-1), Adobe Firefly, Microsoft Designer, Google Imagen, Leica/Nikon/Sony cameras |
| **EXIF / XMP software tags** | `Software`, `CreatorTool`, `ImageDescription`, `DocumentID`, `InstanceID` and 17+ XMP fields | Any tool that writes its name into EXIF/XMP |
| **IPTC DigitalSourceType** | Checks for `trainedAlgorithmicMedia` tag | C2PA-compliant tools |
| **SynthID markers** | Text references to Google's watermark system | Google Imagen, Veo, Gemini-generated images |
| **URL pattern matching** | Recognizes AI service hostnames in image/video URLs | OpenAI CDN, Replicate, fal.ai, Stability AI, Leonardo, RunwayML, Pika, etc. |
| **Alt text / captions** | Checks for "AI generated", tool names in `alt`/`title` attributes | Any properly-labeled content |

### Text

| Method | What it checks |
|---|---|
| **LLM phrase detection** | Flags overuse of phrases like "delve into", "it's worth noting", "tapestry of", etc. |
| **Sentence uniformity** | Measures coefficient of variation in sentence lengths (LLMs produce very uniform lengths) |
| **Paragraph uniformity** | Same analysis at paragraph level |
| **Transition word density** | Flags unusually high density of "however", "furthermore", "moreover", etc. |
| **Formality analysis** | Detects lack of colloquialisms/emoji in long-form text combined with other signals |

### Confidence Calculation

Confidence is calculated by combining independent signal weights using: `1 - (1-w1)(1-w2)...(1-wn)`, capped at 99%.

| Signal | Weight |
|---|---|
| C2PA markers found | 95% |
| IPTC DigitalSourceType | 92% |
| EXIF AI signature | 90% |
| SynthID detected | 90% |
| URL pattern match | 65% |
| Alt text mention | 55% |
| No signals | 5% |

### Verdict Scale

- **AI Detected** — Hard evidence found (C2PA, EXIF tool name, IPTC tag). Confidence typically 85-99%.
- **Likely AI** — Strong circumstantial evidence (URL patterns + text heuristics). Confidence 50-85%.
- **Uncertain** — Some signals present but inconclusive. Confidence 30-50%.
- **Likely Real** — No AI signals detected. Confidence below 30%.
- **No Metadata** — Could not read metadata (CORS blocked, stripped, etc.).

### Source Identification

When an AI tool signature is found in metadata, the extension normalizes it to a display name. Supported tools include:

DALL-E, Midjourney, Stable Diffusion, Adobe Firefly, Google Imagen, Runway, Pika, Kling, Sora, Leonardo AI, Ideogram, Flux, ComfyUI, Automatic1111, InvokeAI, Copilot Designer, Meta AI, Canva AI, and more (40+ signatures).

## Installation

### Developer mode (for development/testing)

1. Clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **"Load unpacked"**
5. Select the `ai-content-scanner` folder
6. The extension icon appears in your toolbar

### Chrome Web Store

See [PUBLISHING.md](PUBLISHING.md) for instructions on publishing to the Chrome Web Store.

## Usage

### Page scanning

1. Navigate to any webpage
2. Click the extension icon — the page is scanned automatically
3. Results appear in the popup with confidence scores, sources, and fingerprints
4. Click any result to expand the detail panel (confidence bar, source, fingerprint, EXIF/metadata, reasons)
5. Click **"Re-scan"** to scan again after page changes
6. Badges overlay on detected content on the page — hover for tooltips

### URL scanning

1. Click the extension icon to open the popup
2. Paste an image or video URL into the input field
3. Click **"Check"** (or press Enter)
4. The result appears inline with full detection details

## Architecture

```
ai-content-scanner/
├── manifest.json       # Extension manifest (MV3)
├── background.js       # Service worker — CORS proxy, badge updates, URL fetch
├── content.js          # Content script — core scanning & analysis engine
├── content.css         # Overlay badge, tooltip, and text highlight styles
├── popup.html          # Extension popup UI (400px, dark theme)
├── popup.js            # Popup logic — auto-scan, URL check, result rendering
├── icons/
│   ├── icon16.png      # Toolbar icon
│   ├── icon48.png      # Extension management page
│   └── icon128.png     # Chrome Web Store / install dialog
├── web/
│   └── index.html      # Landing page website with live scanner
├── README.md
└── PUBLISHING.md       # Chrome Web Store publishing guide
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
                    │     d. Extract full EXIF tags + XMP      │
                    │     e. Check IPTC DigitalSourceType      │
                    │     f. Check SynthID markers             │
                    │     g. Check URL patterns                │
                    │     h. Check alt text                    │
                    │     i. Identify AI source                │
                    │     j. Calculate confidence score        │
                    │     k. Build fingerprint object          │
                    │  3. For each video: check URL + context  │
                    │  4. For each text block:                 │
                    │     a. Run LLM phrase detection          │
                    │     b. Measure sentence uniformity       │
                    │     c. Check transition word density     │
                    │     d. Calculate confidence score        │
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

### Result object structure

Each scanned item returns:

```json
{
  "verdict": "ai_detected",
  "confidence": 95,
  "source": "DALL-E 3",
  "reasons": ["C2PA provenance metadata found", "EXIF Software: DALL-E 3"],
  "fingerprint": {
    "c2pa": "JUMBF superbox found",
    "iptc": "trainedAlgorithmicMedia",
    "synthid": null
  },
  "exif": {
    "Software": "DALL-E 3",
    "Creator": "OpenAI",
    "CreatorTool": "DALL-E 3",
    "DocumentID": "xmp.did:...",
    "InstanceID": "xmp.iid:..."
  },
  "metadata": {
    "src": "https://...",
    "fileSize": "245 KB"
  }
}
```

## Website

The `/web` folder contains a single-page landing site with:

- Animated stats counters (downloads, scans, media analyzed)
- **Live scanner tool** — upload a file (drag & drop) or paste a URL to scan client-side
- Feature grid, verdict scale explanation, installation steps
- Runs entirely client-side with the same detection logic as the extension

## Limitations

- **Metadata can be stripped** — Screenshots, re-uploads, and some social platforms remove EXIF/C2PA data. The extension can't detect AI content when all metadata is gone.
- **SynthID invisible watermarks** require Google's proprietary detector — this extension checks for SynthID *text references* in metadata but cannot decode the actual pixel-level watermark.
- **Text heuristics are probabilistic** — They flag patterns *common* in LLM output, not proof of AI generation. Academic writing can trigger false positives.
- **CORS restrictions** — Some CDNs block cross-origin image access. The extension tries to fetch via the background script, but some images may be unreadable.
- **Video analysis is limited** — Binary analysis of video files from the content script is not practical; detection relies on URL patterns and surrounding context.
- **Confidence is signal-based** — It reflects how many metadata signals were found, not a pixel-level AI classifier score. An image with stripped metadata will show low confidence even if it's AI-generated.

## Extending

### Adding an external AI detection API

You can integrate a classifier API (like Hive Moderation, Illuminarty, or AI or Not) by adding a fetch call in `content.js`'s `scanImageUrl` function:

```js
async function callDetectionAPI(imageUrl) {
  const response = await fetch("https://your-api.com/detect", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer YOUR_API_KEY"
    },
    body: JSON.stringify({ url: imageUrl })
  });
  return response.json(); // { isAI: boolean, confidence: number }
}
```

### Adding new AI tool signatures

Add entries to the `AI_SOURCE_NAMES` map in `content.js`:

```js
const AI_SOURCE_NAMES = {
  // ... existing entries
  "your-tool": "Your Tool Name",
};
```

And add URL patterns to `AI_IMAGE_URL_PATTERNS` / `AI_VIDEO_URL_PATTERNS` arrays.

## Verification Resources

- **C2PA Verify**: [contentcredentials.org/verify](https://contentcredentials.org/verify)
- **Google SynthID Detector**: Available via Gemini app and Google Cloud
- **Google "About this image"**: Available in Google Images, Lens, and Circle to Search
- **Hive AI Detection**: [hivemoderation.com](https://hivemoderation.com)
- **AI or Not**: [aiornot.com](https://aiornot.com)
- **Illuminarty**: [illuminarty.ai](https://illuminarty.ai)

## License

MIT
