// ============================================================
// POST /api/scan
// Scans an image for AI-generation signals.
// Accepts: multipart/form-data (file) or JSON ({ url }).
// URL mode streams only the first 300KB — enough for metadata.
// ============================================================

const Busboy = require("busboy");
const { scanBuffer } = require("../lib/scanner");

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const MAX_FETCH_BYTES = 300_000;        // 300 KB (metadata lives here)
const FETCH_TIMEOUT_MS = 8_000;

// Disable Vercel's default body parser so we can stream multipart
module.exports.config = {
  api: { bodyParser: false },
};

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "Use POST." },
    });
  }

  try {
    let buffer, url;
    const contentType = req.headers["content-type"] || "";

    if (contentType.includes("multipart/form-data")) {
      const parsed = await parseMultipart(req);
      if (!parsed.fileBuffer || parsed.fileBuffer.byteLength === 0) {
        return res.status(400).json({
          ok: false,
          error: { code: "INVALID_INPUT", message: "No file provided. Upload an image as the \"file\" field." },
        });
      }
      if (parsed.fileBuffer.byteLength > MAX_FILE_SIZE) {
        return res.status(413).json({
          ok: false,
          error: { code: "FILE_TOO_LARGE", message: "File exceeds the 4 MB limit. Try using a URL instead." },
        });
      }
      buffer = toArrayBuffer(parsed.fileBuffer);
      url = null;

    } else if (contentType.includes("application/json")) {
      const body = await readBody(req);
      let parsed;
      try {
        parsed = JSON.parse(body.toString("utf-8"));
      } catch {
        return res.status(400).json({
          ok: false,
          error: { code: "INVALID_INPUT", message: "Invalid JSON body." },
        });
      }

      if (!parsed?.url) {
        return res.status(400).json({
          ok: false,
          error: { code: "INVALID_INPUT", message: "JSON body must include a \"url\" field." },
        });
      }

      url = parsed.url;
      try {
        new URL(url);
      } catch {
        return res.status(400).json({
          ok: false,
          error: { code: "INVALID_INPUT", message: "Invalid URL." },
        });
      }

      buffer = await fetchImageHead(url, MAX_FETCH_BYTES);
      if (!buffer) {
        return res.status(422).json({
          ok: false,
          error: { code: "FETCH_FAILED", message: "Could not fetch image from the provided URL." },
        });
      }

    } else {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_INPUT", message: "Use Content-Type: multipart/form-data (file upload) or application/json ({ \"url\": \"...\" })." },
      });
    }

    const result = scanBuffer(buffer, url);
    return res.status(200).json({ ok: true, result });

  } catch (err) {
    console.error("[api/scan] Error:", err);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    });
  }
};

// ── Multipart parsing with busboy (streaming, no temp files) ──

function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE + 1024, files: 1 },
    });

    const chunks = [];
    let fileName = "";
    let resolved = false;

    bb.on("file", (_fieldname, stream, info) => {
      fileName = info.filename || "upload";
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        if (!resolved) {
          resolved = true;
          resolve({ fileBuffer: Buffer.concat(chunks), fileName });
        }
      });
    });

    bb.on("error", (err) => {
      if (!resolved) { resolved = true; reject(err); }
    });

    bb.on("close", () => {
      if (!resolved) { resolved = true; resolve({ fileBuffer: null, fileName: "" }); }
    });

    req.pipe(bb);
  });
}

// ── Read raw request body (for JSON when bodyParser is disabled) ──

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ── Fetch only the first N bytes of an image URL (streaming) ──

async function fetchImageHead(url, maxBytes) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AI-Content-Scanner/2.0" },
    });
    if (!resp.ok) return null;

    const reader = resp.body.getReader();
    const chunks = [];
    let totalBytes = 0;

    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalBytes += value.byteLength;
    }

    reader.cancel();
    clearTimeout(timeout);

    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined.buffer;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

// ── Convert Node.js Buffer to ArrayBuffer ──

function toArrayBuffer(buf) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
