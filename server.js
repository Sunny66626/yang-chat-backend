const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();

app.use(cors({
  origin: "*"
}));

app.use(express.json({ limit: '10mb' }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ================= CHAT =================
app.post('/chat', async (req, res) => {
  try {
    const { session_id, message, model } = req.body;

    // 1. 存用户消息
    await supabase.from('messages').insert({
      session_id,
      role: 'user',
      content: message
    });

    // 2. 调 Claude
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-5-20250514',
        max_tokens: 1000,
        messages: [
          { role: 'user', content: message }
        ]
      })
    });

    const data = await response.json();

    let reply = '';
    if (data.content && data.content[0]) {
      reply = data.content[0].text;
    }

    // 3. 存AI回复
    await supabase.from('messages').insert({
      session_id,
      role: 'assistant',
      content: reply
    });

    // 4. 返回前端
    res.json({ reply });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
