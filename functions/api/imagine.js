export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt, productImage, colorDesc } = await context.request.json();

    // Gemini 요청 구성
    const parts = [];
    const colorNote = colorDesc ? ` 소파의 색상과 소재는 ${colorDesc}입니다.` : '';

    if (productImage) {
      // GLB 렌더링 이미지가 있음 → 제품 형태+컬러 참조
      if (roomImage) {
        parts.push({ text: `첫 번째 이미지는 소파 3D 렌더링입니다. 이 소파의 형태와 색상을 정확하게 유지하면서 두 번째 이미지의 거실에 자연스럽게 배치해주세요.${colorNote} 조명과 그림자를 맞춰주세요. 반드시 이미지를 생성해주세요.` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: productImage.replace(/^data:image\/\w+;base64,/, "") } });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
      } else {
        parts.push({ text: `이 소파 3D 렌더링을 참고해서, 이 소파가 모던한 한국 아파트 거실에 자연스럽게 배치된 인테리어 사진을 생성해주세요. 소파의 형태와 색상을 정확하게 유지해주세요.${colorNote} 인테리어 매거진 스타일, 자연광, 따뜻한 분위기. 반드시 이미지를 생성해주세요.` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: productImage.replace(/^data:image\/\w+;base64,/, "") } });
      }
    } else {
      parts.push({ text: prompt || `Modern Korean apartment with ${sofaName} sofa. Generate image.` });
      if (roomImage) {
        parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
      }
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
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: prompt || `${sofaName} sofa interior` });
        if (result?.image) return jsonRes({ ok: true, image: `data:image/jpeg;base64,${result.image}`, model: "flux" });
      } catch (e) { /* */ }
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
