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

    // Build prompt
    const userPrompt = prompt || `이 거실 사진에 ${sofaName || "소파"}를 자연스럽게 배치해주세요. 조명, 원근감, 그림자를 거실 환경에 맞게 조정하고, 기존 가구와 어울리도록 배치해주세요. 소파의 크기와 비율은 공간에 적절하게 조정해주세요.`;

    // Build parts array
    const parts = [
      { text: userPrompt },
      {
        inline_data: {
          mime_type: "image/jpeg",
          data: roomImage.replace(/^data:image\/\w+;base64,/, ""),
        },
      },
    ];

    // If sofa product image is provided, add it
    if (sofaImage) {
      parts.push({
        text: "위 거실에 아래 소파 제품을 배치해주세요. 소파의 디자인과 색상을 최대한 유지하면서 자연스럽게 합성해주세요.",
      });
      parts.push({
        inline_data: {
          mime_type: "image/jpeg",
          data: sofaImage.replace(/^data:image\/\w+;base64,/, ""),
        },
      });
    }

    // Call Gemini API with image generation
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp-image-generation:generateContent?key=${API_KEY}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseModalities: ["IMAGE", "TEXT"],
          temperature: 0.4,
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("[Imagine] Gemini API error:", geminiRes.status, errText);
      return new Response(JSON.stringify({ error: "Image generation failed", detail: errText }), {
        status: geminiRes.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    const result = await geminiRes.json();

    // Extract generated image and text from response
    let generatedImage = null;
    let generatedText = "";

    if (result.candidates && result.candidates[0]) {
      const parts = result.candidates[0].content?.parts || [];
      for (const part of parts) {
        if (part.inlineData) {
          generatedImage = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
        if (part.text) {
          generatedText += part.text;
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        image: generatedImage,
        text: generatedText,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err) {
    console.error("[Imagine] Error:", err);
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
