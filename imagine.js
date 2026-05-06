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

    // gemini-3.1-flash-image-preview is the confirmed working model (Nano Banana)
    const model = "gemini-3.1-flash-image-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;
    
    const body = JSON.stringify({
      contents: [{ parts, role: "user" }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });

    // Try up to 3 times with delay for 429 (rate limit)
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(`[Imagine] Retry ${attempt}/2, waiting ${attempt * 5}s...`);
        await new Promise(r => setTimeout(r, attempt * 5000));
      }

      try {
        console.log(`[Imagine] Attempt ${attempt + 1}, model: ${model}`);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });

        if (res.status === 429) {
          const errText = await res.text();
          console.log("[Imagine] Rate limited (429), will retry...", errText.slice(0, 100));
          lastError = "요청이 많아 잠시 대기 중이에요. 곧 다시 시도합니다...";
          continue;
        }

        if (!res.ok) {
          const errText = await res.text();
          console.error("[Imagine] API error:", res.status, errText.slice(0, 300));
          lastError = `${model}: ${res.status} - ${errText.slice(0, 100)}`;
          break; // Non-retryable error
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
          console.log("[Imagine] Success!");
          return new Response(JSON.stringify({ ok: true, image, text, model }), {
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
          });
        }

        console.log("[Imagine] No image in response, text:", text.slice(0, 100));
        lastError = "이미지가 생성되지 않았어요. 다른 표현으로 다시 시도해주세요.";
        break;

      } catch (e) {
        console.error("[Imagine] Exception:", e.message);
        lastError = e.message;
        break;
      }
    }

    return new Response(JSON.stringify({ error: "Image generation failed", detail: lastError }), {
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
