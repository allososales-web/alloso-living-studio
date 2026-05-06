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

    // Room image (optional)
    if (roomImage) {
      const roomBase64 = roomImage.replace(/^data:image\/\w+;base64,/, "");
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomBase64 } });
    }

    // REST API direct call — confirmed working model name
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    console.log("[Imagine] Calling Gemini API, prompt length:", userPrompt.length, "hasRoom:", !!roomImage);

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
      console.error("[Imagine] API error:", res.status, errText.slice(0, 500));
      return new Response(JSON.stringify({ 
        error: "Gemini API error", 
        status: res.status,
        detail: errText.slice(0, 200) 
      }), {
        status: res.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
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
      console.log("[Imagine] Success! Image generated.");
      return new Response(JSON.stringify({ ok: true, image, text }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    // No image returned
    console.log("[Imagine] No image in response:", JSON.stringify(result).slice(0, 300));
    return new Response(JSON.stringify({ 
      error: "No image generated", 
      detail: text || "Model returned text only",
      raw: JSON.stringify(result).slice(0, 200)
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });

  } catch (err) {
    console.error("[Imagine] Exception:", err.message);
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
