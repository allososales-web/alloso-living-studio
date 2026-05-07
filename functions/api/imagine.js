// GET: 진단 테스트 — 브라우저에서 /api/imagine 접속하면 모델별 상태 확인
export async function onRequestGet(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;
  const results = { timestamp: new Date().toISOString(), models: {}, flux: null };

  // Test each Gemini model
  for (const model of ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"]) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "Generate a simple photo of a modern white sofa in a minimalist room. Generate image." }], role: "user" }],
            generationConfig: { responseModalities: ["TEXT", "IMAGE"] }
          })
        }
      );
      const text = await res.text();
      const hasImage = text.includes("inlineData");
      results.models[model] = { status: res.status, hasImage, preview: text.slice(0, 200) };
    } catch (e) {
      results.models[model] = { status: "error", message: e.message };
    }
  }

  // Test FLUX
  if (context.env.AI) {
    try {
      const r = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: "a white sofa" });
      const type = r?.constructor?.name || typeof r;
      const size = r?.byteLength || r?.length || 'unknown';
      results.flux = { status: "ok", type, size };
    } catch (e) {
      results.flux = { status: "error", message: e.message };
    }
  } else {
    results.flux = { status: "no binding" };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

// POST: 실제 이미지 생성
export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    }

    // 1차: 나노바나나
    if (API_KEY) {
      for (const model of ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"]) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts, role: "user" }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }) }
          );
          if (res.status === 429) { console.log("[Imagine]", model, "429"); continue; }
          if (!res.ok) { console.log("[Imagine]", model, res.status); continue; }
          const data = await res.json();
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) {
              console.log("[Imagine] OK:", model);
              return jsonRes({ ok: true, image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, model });
            }
          }
        } catch (e) { console.log("[Imagine]", model, e.message); }
      }
    }

    // 2차: Cloudflare FLUX
    if (context.env.AI) {
      try {
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: userPrompt });
        let bytes;
        if (result instanceof Uint8Array) bytes = result;
        else if (result instanceof ArrayBuffer) bytes = new Uint8Array(result);
        else bytes = new Uint8Array(await new Response(result).arrayBuffer());

        if (bytes && bytes.length > 100) {
          let bin = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
          }
          return jsonRes({ ok: true, image: `data:image/png;base64,${btoa(bin)}`, model: "flux" });
        }
      } catch (e) { console.log("[Imagine] FLUX:", e.message); }
    }

    return jsonRes({ error: "unavailable" }, 500);
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
