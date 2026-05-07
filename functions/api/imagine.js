export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt, productImage, colorDesc } = await context.request.json();

    const colorNote = colorDesc ? ` The sofa upholstery must be ${colorDesc}.` : '';
    const parts = [];

    if (productImage) {
      // 3D 렌더링 이미지가 있음 → 제품 형태 참조
      if (roomImage) {
        parts.push({ text: `First image is a 3D rendering of the sofa. Place this exact sofa design into the room shown in the second image.${colorNote} Keep the sofa shape accurate. Match lighting and shadows. Generate a photorealistic image.` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: productImage.replace(/^data:image\/\w+;base64,/, "") } });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
      } else {
        parts.push({ text: `This is a 3D rendering of a sofa. Generate a photorealistic interior photo of a modern Korean apartment living room with this exact sofa placed naturally.${colorNote} Keep the sofa design and shape accurate. Magazine-style photography, natural lighting, warm atmosphere. Generate an image.` });
        parts.push({ inline_data: { mime_type: "image/jpeg", data: productImage.replace(/^data:image\/\w+;base64,/, "") } });
      }
    } else {
      // 텍스트만
      parts.push({ text: (prompt || `Modern Korean apartment with ${sofaName} sofa. Generate image.`) + colorNote });
      if (roomImage) parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
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
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: (prompt || `${sofaName} sofa interior`) + (colorNote || '') });
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
