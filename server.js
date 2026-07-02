const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// 健康检查
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// ====== 只保留最核心 chat（去掉数据库）======
app.post('/chat', async (req, res) => {
  try {
    console.log("REQ BODY:", req.body);

    const { message } = req.body;

    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250514',
        max_tokens: 500,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();

    console.log("CLAUDE RAW:", data);

    let reply = '';

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') reply += block.text;
      }
    }

    res.json({ reply });

  } catch (e) {
    console.log(e);
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("running"));
