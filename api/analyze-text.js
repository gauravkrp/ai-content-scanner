// ============================================================
// POST /api/analyze-text
// Analyzes text for AI-generation heuristics (LLM phrases,
// sentence uniformity, transition density, formality).
// ============================================================

const { scanTextBlock } = require("../lib/scanner");

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
    const { text } = req.body || {};

    if (!text || typeof text !== "string") {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_INPUT", message: "JSON body must include a \"text\" string." },
      });
    }

    if (text.length < 300) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_INPUT", message: "Text must be at least 300 characters for meaningful analysis." },
      });
    }

    if (text.length > 50_000) {
      return res.status(400).json({
        ok: false,
        error: { code: "INVALID_INPUT", message: "Text must not exceed 50,000 characters." },
      });
    }

    const result = scanTextBlock(text);

    if (!result) {
      return res.status(200).json({
        ok: true,
        result: {
          verdict: "likely_real",
          confidence: 5,
          source: null,
          score: 0,
          reasons: ["No AI signals detected."],
          metadata: {
            wordCount: String(text.split(/\s+/).length),
            sentenceCount: String((text.match(/[^.!?]+[.!?]+/g) || []).length),
          },
          fingerprint: { method: "Statistical heuristics", heuristicScore: "0/85" },
        },
      });
    }

    return res.status(200).json({ ok: true, result });
  } catch (err) {
    console.error("[api/analyze-text] Error:", err);
    return res.status(500).json({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Unexpected server error." },
    });
  }
};
