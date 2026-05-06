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

    // --- Method 1: Gemini 2.5 Flash (multimodal - supports room photo input) ---
    try {
      const parts = [{ text: userPrompt }];
      if (roomImage) {
        const roomBase64 = roomImage.replace(/^data:image\/\w+;base64,/, "");
        parts.push({ inline_data: { mime_type: "image/jpeg", data: roomBase64 } });
      }

      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
      console.log("[Imagine] Trying gemini-2.5-flash");

      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts, role: "user" }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });

      if (geminiRes.ok) {
        const result = await geminiRes.json();
        let image = null, text = "";
        if (result.candidates?.[0]?.content?.parts) {
          for (const p of result.candidates[0].content.parts) {
            if (p.inlineData) image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
            if (p.text) text += p.text;
          }
        }
        if (image) {
          console.log("[Imagine] Success with gemini-2.5-flash");
          return jsonResponse({ ok: true, image, text, model: "gemini-2.5-flash" });
        }
        console.log("[Imagine] gemini-2.5-flash returned no image, trying Imagen...");
      } else {
        const err = await geminiRes.text();
        console.log("[Imagine] gemini-2.5-flash error:", geminiRes.status, err.slice(0, 200));
      }
    } catch (e) {
      console.log("[Imagine] gemini-2.5-flash exception:", e.message);
    }

    // --- Method 2: Imagen 4 Fast (text-to-image only, no room photo) ---
    try {
      const imagenUrl = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${API_KEY}`;
      console.log("[Imagine] Trying imagen-4.0-fast");

      const imagenRes = await fetch(imagenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instances: [{ prompt: userPrompt }],
          parameters: { sampleCount: 1 },
        }),
      });

      if (imagenRes.ok) {
        const result = await imagenRes.json();
        if (result.predictions?.[0]?.bytesBase64Encoded) {
          const imgData = result.predictions[0].bytesBase64Encoded;
          console.log("[Imagine] Success with imagen-4.0-fast");
          return jsonResponse({ ok: true, image: `data:image/png;base64,${imgData}`, text: "", model: "imagen-4.0-fast" });
        }
        console.log("[Imagine] Imagen returned no image");
      } else {
        const err = await imagenRes.text();
        console.log("[Imagine] Imagen error:", imagenRes.status, err.slice(0, 200));
      }
    } catch (e) {
      console.log("[Imagine] Imagen exception:", e.message);
    }

    return jsonResponse({ error: "Image generation failed", detail: "All models failed. Please try again later." }, 500);

  } catch (err) {
    console.error("[Imagine] Error:", err.message);
    return jsonResponse({ error: err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
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
