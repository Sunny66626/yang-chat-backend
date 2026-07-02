const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({ origin: "*" }));
app.use(express.json());

// 🔑 你的 Claude Key（从 Render 环境变量读）
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// ===== 健康检查 =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ===== 聊天接口 =====
app.post('/chat', async (req, res) => {
  try {
    const message = req.body.message;

    if (!message) {
      return res.status(400).json({ error: "no message" });
    }

    // ❗关键：如果key没加载，直接报出来
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

    // ❗Claude失败直接返回错误
    if (!response.ok) {
      return res.status(500).json({
        error: data
      });
    }

    // 提取回复
    let reply = '';

    if (data.content && Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          reply += block.text;
        }
      }
    }

    if (!reply) reply = "（空回复，模型未返回内容）";

    res.json({ reply });

  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

// ===== 启动 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on", PORT);
});
