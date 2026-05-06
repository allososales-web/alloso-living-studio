export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: "Google API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();

    const userPrompt = prompt || `모던한 한국 아파트 거실에 ${sofaName || "소파"}가 배치된 인테리어 사진을 생성해주세요.`;

    const parts = [{ text: userPrompt }];

    if (roomImage) {
      const roomBase64 = roomImage.replace(/^data:image\/\w+;base64,/, "");
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomBase64 } });
    }

    // Current working model names for image generation (2026)
    const models = [
      "gemini-2.5-flash-image",
      "gemini-3.1-flash-image-preview",
    ];

    let lastError = null;

    for (const model of models) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
        console.log("[Imagine] Trying:", model);

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts, role: "user" }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
            },
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error("[Imagine]", model, "error:", res.status, errText.slice(0, 300));
          lastError = `${model}: ${res.status} - ${errText.slice(0, 100)}`;
          continue;
        }

        const result = await res.json();
        let image = null, text = "";

        if (result.candidates?.[0]?.content?.parts) {
          for (const p of result.candidates[0].content.parts) {
            if (p.inlineData) {
              image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            }
            if (p.text) text += p.text;
          }
        }

        if (image) {
          console.log("[Imagine] Success with:", model);
          return new Response(JSON.stringify({ ok: true, image, text, model }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        console.log("[Imagine]", model, "- no image in response, text:", text.slice(0, 100));
        lastError = `${model}: no image returned`;
      } catch (e) {
        console.error("[Imagine]", model, "exception:", e.message);
        lastError = `${model}: ${e.message}`;
      }
    }

    return new Response(JSON.stringify({ error: "All models failed", detail: lastError }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
    console.error("[Imagine] Error:", err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
