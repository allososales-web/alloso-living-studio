export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt, sofaImageUrl, colorDesc, chipImageUrl } = await context.request.json();

    // 제품 사진 fetch (소파 형태 참조)
    let sofaBase64 = null;
    if (sofaImageUrl) {
      try {
        const r = await fetch(sofaImageUrl);
        if (r.ok) sofaBase64 = await toBase64(await r.arrayBuffer());
      } catch (e) { console.log("[Imagine] sofa fetch:", e.message); }
    }

    // 칩 이미지 fetch (컬러/텍스처 참조)
    let chipBase64 = null;
    if (chipImageUrl) {
      try {
        const r = await fetch(chipImageUrl);
        if (r.ok) chipBase64 = await toBase64(await r.arrayBuffer());
        console.log("[Imagine] Chip image fetched:", chipImageUrl.split('/').pop());
      } catch (e) { console.log("[Imagine] chip fetch:", e.message); }
    }

    // Gemini 요청 구성
    const parts = [];
    const colorNote = colorDesc ? ` 소파의 색상과 소재를 반드시 ${colorDesc}으로 적용해주세요.` : '';

    if (sofaBase64 && chipBase64) {
      // 최적: 제품 사진 (형태) + 칩 이미지 (컬러) + 공간 합성
      parts.push({ text: `첫 번째 이미지는 소파 제품입니다. 이 소파의 디자인과 형태를 정확하게 유지해주세요. 두 번째 이미지는 소재 샘플입니다. 소파의 색상과 텍스처를 이 소재 샘플과 동일하게 적용해주세요.${roomImage ? ' 세 번째 이미지의 거실에 배치해주세요.' : ' 모던한 한국 아파트 거실에 배치한 인테리어 매거진 스타일 사진을 생성해주세요.'} 자연광, 따뜻한 분위기. 반드시 이미지를 생성해주세요.` });
      parts.push({ inline_data: { mime_type: imgMime(sofaImageUrl), data: sofaBase64 } });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: chipBase64 } });
      if (roomImage) parts.push({ inline_data: { mime_type: "image/jpeg", data: stripDataUrl(roomImage) } });

    } else if (sofaBase64) {
      // 제품 사진만 (컬러 텍스트 지시)
      parts.push({ text: `이 소파 제품을 모던한 한국 아파트 거실에 배치한 인테리어 사진을 생성해주세요. 소파의 디자인 형태를 정확하게 유지해주세요.${colorNote} 인테리어 매거진 스타일, 자연광. 반드시 이미지를 생성해주세요.` });
      parts.push({ inline_data: { mime_type: imgMime(sofaImageUrl), data: sofaBase64 } });
      if (roomImage) parts.push({ inline_data: { mime_type: "image/jpeg", data: stripDataUrl(roomImage) } });

    } else {
      // 텍스트만
      parts.push({ text: prompt || `Modern Korean apartment with ${sofaName} sofa. Generate image.` });
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

function toBase64(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(bin);
}

function stripDataUrl(dataUrl) {
  return dataUrl.replace(/^data:image\/\w+;base64,/, "");
}

function imgMime(url) {
  return (url || '').endsWith('.png') ? 'image/png' : 'image/jpeg';
}

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
}

export async function onRequestOptions() {
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
