export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt, sofaImageUrl, colorDesc } = await context.request.json();

    // 제품 사진 가져오기
    let sofaImageBase64 = null;
    if (sofaImageUrl) {
      try {
        const imgRes = await fetch(sofaImageUrl);
        if (imgRes.ok) {
          const buf = await imgRes.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
          }
          sofaImageBase64 = btoa(bin);
        }
      } catch (e) { console.log("[Imagine] CDN fetch error:", e.message); }
    }

    // 컬러 지시
    const colorInstruction = colorDesc ? ` 소파 색상/소재를 반드시 ${colorDesc}로 변경해주세요.` : '';

    // Gemini 요청 구성
    const parts = [];
    if (roomImage) {
      parts.push({ text: `이 거실 사진에 두 번째 이미지의 소파를 자연스럽게 배치해주세요. 소파의 디자인 형태를 유지하면서${colorInstruction} 조명과 그림자를 거실 환경에 맞춰주세요. 반드시 이미지를 생성해주세요.` });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    } else if (sofaImageBase64) {
      parts.push({ text: `이 소파 제품을 모던한 한국 아파트 거실에 자연스럽게 배치한 인테리어 사진을 생성해주세요. 소파의 디자인 형태를 정확하게 유지해주세요.${colorInstruction} 인테리어 매거진 스타일, 자연광. 반드시 이미지를 생성해주세요.` });
    } else {
      parts.push({ text: prompt || `Modern Korean apartment with ${sofaName} sofa. Generate image.` });
    }

    if (sofaImageBase64) {
      const mime = sofaImageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
      parts.push({ inline_data: { mime_type: mime, data: sofaImageBase64 } });
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
          if (res.status === 429) continue;
          if (!res.ok) continue;
          const data = await res.json();
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) return jsonRes({ ok: true, image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, model });
          }
        } catch (e) { /* next */ }
      }
    }

    // 2차: FLUX 폴백
    if (context.env.AI) {
      try {
        const fluxPrompt = prompt || `Modern Korean apartment with ${sofaName} sofa. Interior photography.`;
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: fluxPrompt });
        if (result?.image) return jsonRes({ ok: true, image: `data:image/jpeg;base64,${result.image}`, model: "flux" });
      } catch (e) { /* fallthrough */ }
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
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
