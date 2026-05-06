export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  // Debug: check what bindings are available
  const envKeys = Object.keys(context.env || {});
  console.log("[Imagine] env keys:", envKeys.join(", "));
  console.log("[Imagine] AI type:", typeof context.env.AI);

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    }

    // ── 1차: 나노바나나 ──
    if (API_KEY) {
      for (const model of ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"]) {
        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
          console.log("[Imagine] Try:", model);
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts, role: "user" }],
              generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
            }),
          });
          if (res.status === 429) { console.log("[Imagine]", model, "429 quota"); continue; }
          if (!res.ok) { console.log("[Imagine]", model, res.status); continue; }
          const data = await res.json();
          let image = null, text = "";
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            if (p.text) text += p.text;
          }
          if (image) return jsonRes({ ok: true, image, text, model });
        } catch (e) { console.log("[Imagine]", model, e.message); }
      }
    }

    // ── 2차: Cloudflare AI FLUX ──
    const ai = context.env.AI;
    if (ai) {
      try {
        console.log("[Imagine] Try: FLUX via AI binding");
        const result = await ai.run("@cf/black-forest-labs/flux-1-schnell", { prompt: userPrompt });

        // FLUX returns raw bytes
        let bytes;
        if (result instanceof ReadableStream) {
          const reader = result.getReader();
          const chunks = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
          }
          const total = chunks.reduce((s, c) => s + c.length, 0);
          bytes = new Uint8Array(total);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        } else if (result instanceof ArrayBuffer) {
          bytes = new Uint8Array(result);
        } else if (result instanceof Uint8Array) {
          bytes = result;
        } else {
          // Maybe it's already something else
          console.log("[Imagine] FLUX result type:", typeof result, result?.constructor?.name);
          bytes = new Uint8Array(await new Response(result).arrayBuffer());
        }

        if (bytes && bytes.length > 1000) {
          // Convert to base64
          let binary = "";
          const len = bytes.length;
          for (let i = 0; i < len; i++) { binary += String.fromCharCode(bytes[i]); }
          const base64 = btoa(binary);
          console.log("[Imagine] FLUX OK, size:", Math.round(base64.length / 1024), "KB");
          return jsonRes({ ok: true, image: `data:image/png;base64,${base64}`, text: "", model: "flux-schnell" });
        }
        console.log("[Imagine] FLUX returned empty/small result");
      } catch (e) {
        console.log("[Imagine] FLUX error:", e.message, e.stack?.slice(0, 200));
      }
    } else {
      console.log("[Imagine] AI binding NOT found in env. Available:", envKeys.join(", "));
    }

    return jsonRes({ error: "Image generation failed", detail: ai ? "FLUX 생성 실패" : `AI 바인딩 미연결 (env: ${envKeys.join(", ")})` }, 500);
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
