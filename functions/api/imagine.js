export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt, sofaImageUrl } = await context.request.json();

    // 제품 사진 가져오기 (CDN에서 fetch → base64)
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
          console.log("[Imagine] Product image fetched:", Math.round(sofaImageBase64.length / 1024), "KB");
        }
      } catch (e) {
        console.log("[Imagine] Product image fetch failed:", e.message);
      }
    }

    // Gemini 요청 구성
    const parts = [];

    if (roomImage) {
      // 모드 A: 고객 거실 사진 + 제품 사진 → 합성
      parts.push({ text: `이 거실 사진에 두 번째 이미지의 소파를 자연스럽게 배치해주세요. 소파의 디자인, 색상, 형태를 정확하게 유지하면서 거실 공간에 맞게 배치해주세요. 조명과 그림자를 거실 환경에 맞춰주세요. 반드시 이미지를 생성해주세요.` });
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    } else if (sofaImageBase64) {
      // 모드 B: 제품 사진 + 프롬프트 → 인테리어 장면 생성
      parts.push({ text: `이 소파 제품을 모던한 한국 아파트 거실에 자연스럽게 배치한 인테리어 사진을 생성해주세요. 소파의 디자인, 색상, 형태, 소재감을 정확하게 유지해주세요. ${prompt || ''} 인테리어 매거진 스타일, 자연광, 따뜻한 분위기. 반드시 이미지를 생성해주세요.` });
    } else {
      // 모드 C: 텍스트만 (제품 사진 없음)
      parts.push({ text: prompt || `A modern Korean apartment with a premium ${sofaName} sofa. Magazine-style photography. Generate an image.` });
    }

    // 제품 사진을 참조 이미지로 추가
    if (sofaImageBase64) {
      const mimeType = sofaImageUrl.endsWith('.png') ? 'image/png' : 'image/jpeg';
      parts.push({ inline_data: { mime_type: mimeType, data: sofaImageBase64 } });
    }

    // 1차: 나노바나나 (Gemini)
    if (API_KEY) {
      for (const model of ["gemini-2.5-flash-image", "gemini-3.1-flash-image-preview"]) {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
            { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts, role: "user" }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }) }
          );
          if (res.status === 429) { console.log("[Imagine]", model, "429"); continue; }
          if (!res.ok) { const t = await res.text(); console.log("[Imagine]", model, res.status, t.slice(0,100)); continue; }
          const data = await res.json();
          for (const p of (data.candidates?.[0]?.content?.parts || [])) {
            if (p.inlineData) {
              console.log("[Imagine] OK:", model);
              return jsonRes({ ok: true, image: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`, model });
            }
          }
        } catch (e) { console.log("[Imagine]", model, e.message); }
      }
    }

    // 2차: Cloudflare FLUX (텍스트만, 제품 사진 참조 불가)
    if (context.env.AI) {
      try {
        const fluxPrompt = prompt || `A modern Korean apartment with a premium ${sofaName} sofa. Interior photography.`;
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: fluxPrompt });
        if (result?.image) {
          return jsonRes({ ok: true, image: `data:image/jpeg;base64,${result.image}`, model: "flux" });
        }
      } catch (e) { console.log("[Imagine] FLUX:", e.message); }
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
