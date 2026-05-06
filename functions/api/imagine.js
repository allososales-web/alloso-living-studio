export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;
  if (!API_KEY) {
    return new Response(JSON.stringify({ error: "Google API key not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  try {
    const { roomImage, sofaImage, sofaName, prompt } = await context.request.json();

    if (!roomImage) {
      return new Response(JSON.stringify({ error: "Room image required" }), {
        status: 400,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const userPrompt = prompt || `이 거실 사진에 ${sofaName || "소파"}를 자연스럽게 배치해주세요. 조명, 원근감, 그림자를 맞춰주세요.`;

    const parts = [{ text: userPrompt }];

    const roomBase64 = roomImage.replace(/^data:image\/\w+;base64,/, "");
    parts.push({ inline_data: { mime_type: "image/jpeg", data: roomBase64 } });

    if (sofaImage) {
      parts.push({ text: "위 거실에 아래 소파를 자연스럽게 배치해주세요." });
      const sofaBase64 = sofaImage.replace(/^data:image\/\w+;base64,/, "");
      parts.push({ inline_data: { mime_type: "image/jpeg", data: sofaBase64 } });
    }

    // Try models in order
    const models = [
      "gemini-2.0-flash-exp-image-generation",
      "gemini-2.5-flash-preview-04-17",
      "gemini-2.0-flash-exp",
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
            contents: [{ parts }],
            generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
          }),
        });

        if (!res.ok) {
          const err = await res.text();
          console.error("[Imagine]", model, "error:", res.status, err.slice(0, 200));
          lastError = `${model}: ${res.status}`;
          continue;
        }

        const result = await res.json();
        let image = null, text = "";

        if (result.candidates?.[0]?.content?.parts) {
          for (const p of result.candidates[0].content.parts) {
            if (p.inlineData) image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            if (p.text) text += p.text;
          }
        }

        if (image) {
          console.log("[Imagine] OK:", model);
          return new Response(JSON.stringify({ ok: true, image, text, model }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        lastError = `${model}: no image`;
      } catch (e) {
        lastError = `${model}: ${e.message}`;
      }
    }

    return new Response(JSON.stringify({ error: "Image generation failed", detail: lastError }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  } catch (err) {
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
