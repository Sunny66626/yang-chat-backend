const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ================= HEALTH =================
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ================= CHAT =================
app.post('/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 800,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();

    // 🔥 关键：如果Claude报错，直接返回给你看
    if (!response.ok) {
      return res.status(500).json({
        error: data
      });
    }

    // 🔥 正确解析Claude回复
    let reply = '';

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          reply += block.text;
        }
      }
    }

    // 🔥 如果还是空，给提示
    if (!reply) {
      reply = "（Claude没有返回内容，可能API key或模型有问题）";
    }

    res.json({ reply });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
