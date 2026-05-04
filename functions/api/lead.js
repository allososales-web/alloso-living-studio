export async function onRequestPost(context) {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };

  try {
    const { name, contact, series, msgCount, summary, ts } = await context.request.json();

    if (!contact) {
      return new Response(JSON.stringify({ error: "Contact required" }), {
        status: 400,
        headers,
      });
    }

    const leadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const lead = {
      id: leadId,
      name: name || "미입력",
      contact,
      series: series || "",
      msgCount: msgCount || 0,
      summary: summary || "",
      createdAt: ts || new Date().toISOString(),
    };

    // KV 바인딩이 있으면 KV에 저장
    if (context.env.LEADS_KV) {
      await context.env.LEADS_KV.put(leadId, JSON.stringify(lead), {
        // 90일 후 자동 삭제
        expirationTtl: 90 * 24 * 60 * 60,
      });
      console.log("[Lead] Saved to KV:", leadId);
    } else {
      // KV 바인딩 없으면 로그만 (나중에 설정 가능)
      console.log("[Lead] KV not bound, logging only:", JSON.stringify(lead));
    }

    return new Response(JSON.stringify({ ok: true, id: leadId }), { headers });
  } catch (err) {
    console.error("[Lead] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers,
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
