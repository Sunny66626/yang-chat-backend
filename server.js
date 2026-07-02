const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "10mb" }));

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

app.post("/chat", async (req, res) => {
  try {
    const message = req.body && req.body.message ? req.body.message : "";

    if (!message) {
      return res.status(400).json({
        error: "没有收到 message"
      });
    }

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "Render 里没有读到 ANTHROPIC_API_KEY"
      });
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: message
          }
        ]
      })
    });

    const rawText = await response.text();

    let data;
    try {
      data = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({
        error: "Claude 返回的不是 JSON",
        raw: rawText
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: data
      });
    }

    let reply = "";

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === "text" && block.text) {
          reply += block.text;
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
      reply: reply
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
