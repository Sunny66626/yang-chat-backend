const express = require('express');
const cors = require('cors');

const fetch = global.fetch || require('node-fetch');

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// health
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// chat
app.post('/chat', async (req, res) => {
  try {
    const message = req.body.message;

    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: "Missing ANTHROPIC_API_KEY in Render env"
      });
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

    // ❗关键：把Claude真实错误吐出来
    if (!response.ok) {
      return res.status(500).json({
        error: data
      });
    }

    let reply = '';

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          reply += block.text;
        }
      }
    }

    res.json({ reply });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("running"));
