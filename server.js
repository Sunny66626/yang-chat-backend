const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

const MODEL_MAP = {
  "claude-opus-4-6": "claude-opus-4-6",
  "claude-opus-4-8": "claude-opus-4-8",
  "claude-sonnet-5": "claude-sonnet-5",
  "claude-sonnet-4-6": "claude-sonnet-4-6",
  "claude-haiku-4-5": "claude-haiku-4-5",

  "Opus 4.6": "claude-opus-4-6",
  "Opus 4.8": "claude-opus-4-8",
  "Sonnet 5": "claude-sonnet-5",
  "Sonnet 4.6": "claude-sonnet-4-6",
  "Haiku 4.5": "claude-haiku-4-5"
};

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

app.post("/chat", async (req, res) => {
  try {
    const bodyIn = req.body || {};

    const message = bodyIn.message ? String(bodyIn.message) : "";
    const requestedModel = bodyIn.model ? String(bodyIn.model) : "claude-opus-4-6";
    const model = MODEL_MAP[requestedModel] || requestedModel;

    const system = bodyIn.system ? String(bodyIn.system) : "";

    const temperatureRaw = Number(bodyIn.temperature);
    const temperature = Number.isFinite(temperatureRaw) ? temperatureRaw : 1;

    const maxTokensRaw =
      bodyIn.max_tokens ||
      bodyIn.max_reply_tokens ||
      bodyIn.maxReplyTokens ||
      4096;

    let max_tokens = Number(maxTokensRaw);
    if (!Number.isFinite(max_tokens)) max_tokens = 4096;
    max_tokens = Math.max(500, Math.min(32000, max_tokens));

    const thinkingRaw =
      bodyIn.thinking_budget ||
      bodyIn.thinkingBudget ||
      bodyIn.thinking ||
      bodyIn.reasoning_budget ||
      0;

    let thinkingBudget = Number(thinkingRaw);
    if (!Number.isFinite(thinkingBudget)) thinkingBudget = 0;
    thinkingBudget = Math.max(0, Math.min(25000, thinkingBudget));

    if (!message && !Array.isArray(bodyIn.messages)) {
      return res.status(400).json({
        error: "没有收到 message"
      });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "Render 里没有读到 ANTHROPIC_API_KEY"
      });
    }

    let messages = [];

    if (Array.isArray(bodyIn.messages)) {
      messages = bodyIn.messages
        .filter(m =>
          m &&
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim()
        )
        .slice(-120)
        .map(m => ({
          role: m.role,
          content: m.content
        }));
    }

    if (messages.length === 0 && message) {
      messages = [
        {
          role: "user",
          content: message
        }
      ];
    }

    const requestBody = {
      model,
      max_tokens,
      messages
    };

    if (system.trim()) {
      requestBody.system = system.trim();
    }

    if (thinkingBudget > 0) {
      requestBody.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget
      };

      if (requestBody.max_tokens <= thinkingBudget) {
        requestBody.max_tokens = Math.min(32000, thinkingBudget + 1200);
      }

      requestBody.temperature = 1;
    } else {
      requestBody.temperature = temperature;
    }

    async function callClaude(payload) {
      const response = await fetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const rawText = await response.text();

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        return {
          ok: false,
          status: 500,
          data: {
            error: "Claude 返回的不是 JSON",
            raw: rawText
          }
        };
      }

      return {
        ok: response.ok,
        status: response.status,
        data
      };
    }

    let result = await callClaude(requestBody);

    if (!result.ok && thinkingBudget > 0) {
      const retryBody = { ...requestBody };
      delete retryBody.thinking;
      retryBody.temperature = temperature;

      result = await callClaude(retryBody);

      if (result.ok) {
        result.data._thinking_fallback = true;
      }
    }

    if (!result.ok) {
      return res.status(result.status || 500).json({
        error: result.data
      });
    }

    const data = result.data;

    let reply = "";
    let thinking = "";

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          reply += block.text;
        }

        if (block.type === "thinking" && block.thinking) {
          thinking += block.thinking;
        }

        if (block.type === "redacted_thinking") {
          thinking += "[redacted thinking]\n";
        }
      }
    }

    if (!reply) {
      return res.status(500).json({
        error: "Claude 返回了空内容",
        raw: data
      });
    }

    res.json({
      reply,
      thinking: thinking || null,
      model,
      requested_model: requestedModel,
      usage: data.usage || null,
      thinking_fallback: data._thinking_fallback || false
    });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
