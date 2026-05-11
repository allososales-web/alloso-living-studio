// ════════════════════════════════════════════════════════════════════
// /functions/api/chat.js  ·  Non-streaming version
// Returns: { reply: "텍스트", usage: {...}, stop_reason: "..." }
// ════════════════════════════════════════════════════════════════════

export async function onRequestPost(context) {
  const API_KEY = context.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return json({ error: "API key not configured" }, 500);
  }

  try {
    const { messages, system } = await context.request.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return json({ error: "messages array is required" }, 400);
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: system || "",
        messages: messages.slice(-10),
        // stream: false (default)
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic API error:", response.status, errText);
      return json({
        error: "API request failed",
        status: response.status,
        detail: errText.slice(0, 300),
      }, response.status);
    }

    const data = await response.json();

    // content[]에서 type='text'인 블록의 text를 합쳐 reply 생성
    const reply = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('');

    return json({
      reply,
      usage: data.usage,
      stop_reason: data.stop_reason,
      model: data.model,
    });

  } catch (err) {
    console.error("Function error:", err);
    return json({ error: err.message, stack: (err.stack || '').slice(0, 300) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
