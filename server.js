const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ========== 会话管理 ==========
// 获取所有会话
app.get('/sessions', async (req, res) => {
  const { data, error } = await supabase.from('sessions').select('*').order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 创建新会话
app.post('/sessions', async (req, res) => {
  const { name } = req.body;
  const { data, error } = await supabase.from('sessions').insert({ name: name || '新对话' }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 重命名会话
app.put('/sessions/:id', async (req, res) => {
  const { name } = req.body;
  const { data, error } = await supabase.from('sessions').update({ name, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// 删除会话
app.delete('/sessions/:id', async (req, res) => {
  const { error } = await supabase.from('sessions').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ========== 消息 ==========
// 获取会话消息
app.get('/messages/:sessionId', async (req, res) => {
  const { data, error } = await supabase.from('messages').select('*').eq('session_id', req.params.sessionId).eq('visible', true).order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ========== 设置 ==========
app.get('/settings', async (req, res) => {
  const { data, error } = await supabase.from('settings').select('*').eq('session_id', 0).single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.put('/settings', async (req, res) => {
  const updates = { ...req.body, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('settings').update(updates).eq('session_id', 0).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ========== 记忆 ==========
app.get('/memories', async (req, res) => {
  const { data, error } = await supabase.from('memories').select('*').order('timestamp', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ========== 核心对话 ==========
app.post('/chat', async (req, res) => {
  try {
    const { session_id, message, model } = req.body;

    // 1. 存用户消息
    await supabase.from('messages').insert({ session_id, role: 'user', content: message });
    // 更新会话时间
    await supabase.from('sessions').update({ updated_at: new Date().toISOString() }).eq('id', session_id);

    // 2. 加载设置
    const { data: settings } = await supabase.from('settings').select('*').eq('session_id', 0).single();
    const systemPrompt = settings?.system_prompt || '';
    const maxRounds = settings?.max_context_rounds || 20;
    const temperature = settings?.temperature || 0.7;
    const maxReplyTokens = settings?.max_reply_tokens || 4096;

    // 3. 加载历史消息
    const { data: history } = await supabase.from('messages').select('*').eq('session_id', session_id).eq('visible', true).order('created_at', { ascending: true });

    // 取最近N轮
    const recentMessages = [];
    let rounds = 0;
    for (let i = history.length - 1; i >= 0 && rounds < maxRounds; i--) {
      recentMessages.unshift(history[i]);
      if (history[i].role === 'user') rounds++;
    }

    // 4. 加载记忆摘要
    const { data: memories } = await supabase.from('memories').select('summary').order('timestamp', { ascending: false }).limit(5);
    let memoryText = '';
    if (memories && memories.length > 0) {
      memoryText = '\n\n【记忆摘要】\n' + memories.map(m => m.summary).join('\n---\n');
    }

    // 5. 组装上下文
    const fullSystem = systemPrompt + memoryText;
    const apiMessages = recentMessages.map(m => ({ role: m.role, content: m.content }));

    // 6. 判断模型是否支持extended thinking
    const useThinking = model && (model.includes('opus') || model === 'claude-sonnet-4-5-20250514');
    
    const requestBody = {
      model: model || 'claude-sonnet-4-5-20250514',
      max_tokens: maxReplyTokens,
      system: fullSystem,
      messages: apiMessages,
    };

    if (useThinking) {
      requestBody.temperature = 1; // thinking模式必须为1
      requestBody.thinking = { type: 'enabled', budget_tokens: 10000 };
    } else {
      requestBody.temperature = temperature;
    }

    // 7. 调用Anthropic API
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
      return res.status(response.status).json({ error: data });
    }

    // 8. 提取回复和思考内容
    let replyText = '';
    let thinkingText = '';
    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'thinking') thinkingText += block.thinking;
        if (block.type === 'text') replyText += block.text;
      }
    }

    // 9. 存AI回复
    await supabase.from('messages').insert({
      session_id,
      role: 'assistant',
      content: replyText,
      reasoning_content: thinkingText || null,
    });

    // 10. 返回
    res.json({
      reply: replyText,
      thinking: thinkingText || null,
      usage: data.usage,
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ========== 记忆压缩 ==========
app.post('/compress', async (req, res) => {
  try {
    const { session_id } = req.body;

    // 加载设置
    const { data: settings } = await supabase.from('settings').select('*').eq('session_id', 0).single();
    const keepRounds = settings?.compress_keep_rounds || 6;

    // 加载所有可见消息
    const { data: allMessages } = await supabase.from('messages').select('*').eq('session_id', session_id).eq('visible', true).order('created_at', { ascending: true });

    if (!allMessages || allMessages.length < 10) {
      return res.json({ message: '消息太少，不需要压缩' });
    }

    // 保留最近几轮，其余压缩
    const toKeep = [];
    let rounds = 0;
    for (let i = allMessages.length - 1; i >= 0 && rounds < keepRounds; i--) {
      toKeep.unshift(allMessages[i]);
      if (allMessages[i].role === 'user') rounds++;
    }
    const toCompress = allMessages.filter(m => !toKeep.includes(m));

    if (toCompress.length === 0) {
      return res.json({ message: '没有需要压缩的消息' });
    }

    // 用Haiku压缩
    const compressText = toCompress.map(m => `${m.role}: ${m.content}`).join('\n');
    const compressResponse = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 1000,
        temperature: 0,
        system: '你是记忆压缩助手。将以下对话压缩成200字以内的摘要，保留关键信息、情感要点和重要决定。用中文。',
        messages: [{ role: 'user', content: compressText }],
      }),
    });

    const compressData = await compressResponse.json();
    const summary = compressData.content?.[0]?.text || '';

    // 存入记忆
    await supabase.from('memories').insert({
      session_id: 0,
      summary,
      conversation_id: `session_${session_id}`,
    });

    // 标记旧消息为不可见
    const idsToHide = toCompress.map(m => m.id);
    await supabase.from('messages').update({ visible: false }).in('id', idsToHide);

    res.json({ message: '压缩完成', summary, compressed_count: idsToHide.length });
  } catch (err) {
    console.error('Compress error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
