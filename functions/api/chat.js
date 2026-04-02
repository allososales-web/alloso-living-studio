export async function onRequestPost(context) {
  const API_KEY = context.env.ANTHROPIC_API_KEY;
  if (!API_KEY) {
    return Response.json({ error: "API key not configured" }, { status: 500 });
  }

  try {
    const { messages, system } = await context.request.json();
    const sysPrompt = typeof system === 'string' ? system.slice(0, 12000) : '';

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
        system: sysPrompt,
        messages: (messages || []).slice(-10),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return Response.json({
        error: "API request failed",
        status: response.status,
        detail: data
      }, {
        status: response.status,
        headers: { "Access-Control-Allow-Origin": "*" }
      });
    }

    const text = data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return Response.json({ reply: text }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });
  } catch (err) {
    return Response.json({ error: err.message, stack: err.stack }, {
      status: 500,
      headers: { "Access-Control-Allow-Origin": "*" }
    });
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
