export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    }

    // ── 1차: 나노바나나 (Gemini) ──
    if (API_KEY) {
      for (const model of ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"]) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts, role: "user" }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }) }
          );
          if (res.status === 429) continue;
          if (!res.ok) continue;
          const data = await res.json();
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) return jsonRes({ ok: true, image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, model });
          }
        } catch (e) { /* next */ }
      }
    }

    // ── 2차: Cloudflare FLUX ──
    if (context.env.AI) {
      try {
        const stream = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
          prompt: userPrompt,
        });

        // stream을 Response로 감싸서 arrayBuffer로 변환
        const response = new Response(stream);
        const buffer = await response.arrayBuffer();
        const bytes = new Uint8Array(buffer);

        if (bytes.length > 1000) {
          // chunk 단위로 base64 변환 (큰 배열 스택오버플로 방지)
          const CHUNK = 8192;
          let binary = "";
          for (let i = 0; i < bytes.length; i += CHUNK) {
            const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
            binary += String.fromCharCode.apply(null, slice);
          }
          const base64 = btoa(binary);
          return jsonRes({ ok: true, image: `data:image/png;base64,${base64}`, model: "flux-schnell" });
        }
      } catch (e) {
        console.log("[Imagine] FLUX error:", e.message);
        return jsonRes({ error: "FLUX error", detail: e.message }, 500);
      }
    }

    return jsonRes({ error: "Image generation failed", detail: "나노바나나 쿼터 소진 + FLUX 실패" }, 500);
  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
