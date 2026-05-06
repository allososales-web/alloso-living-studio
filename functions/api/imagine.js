export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    }

    // ── 1차: 나노바나나 (Gemini 이미지 생성) ──
    if (API_KEY) {
      const models = ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"];
      for (const model of models) {
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
          if (res.status === 429) {
            console.log("[Imagine]", model, "quota exceeded, trying next...");
            continue;
          }
          if (!res.ok) {
            console.log("[Imagine]", model, res.status);
            continue;
          }
          const data = await res.json();
          let image = null, text = "";
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            if (p.text) text += p.text;
          }
          if (image) {
            console.log("[Imagine] OK:", model);
            return jsonRes({ ok: true, image, text, model });
          }
        } catch (e) {
          console.log("[Imagine]", model, "error:", e.message);
        }
      }
      console.log("[Imagine] All Gemini models failed, trying Cloudflare AI...");
    }

    // ── 2차: Cloudflare AI (FLUX Schnell) 폴백 ──
    if (context.env.AI) {
      try {
        console.log("[Imagine] Try: Cloudflare FLUX");
        const aiRes = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", {
          prompt: userPrompt,
        });

        // Response is raw image bytes → convert to base64
        const arrayBuf = await new Response(aiRes).arrayBuffer();
        const bytes = new Uint8Array(arrayBuf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);

        if (base64.length > 1000) {
          console.log("[Imagine] OK: Cloudflare FLUX");
          return jsonRes({ ok: true, image: `data:image/png;base64,${base64}`, text: "", model: "flux-schnell" });
        }
      } catch (e) {
        console.log("[Imagine] Cloudflare AI error:", e.message);
      }
    } else {
      console.log("[Imagine] AI binding not available");
    }

    return jsonRes({ error: "Image generation failed", detail: "나노바나나 쿼터 소진 + Cloudflare AI 미연결. 잠시 후 다시 시도하거나 AI 바인딩을 설정해주세요." }, 500);

  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
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
