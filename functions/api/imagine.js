// GET: 진단
export async function onRequestGet(context) {
  const results = { timestamp: new Date().toISOString(), flux: null };

  if (context.env.AI) {
    try {
      const r = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: "a modern white sofa in minimalist room" });
      // Inspect the result deeply
      const type = r?.constructor?.name || typeof r;
      const keys = r ? Object.keys(r) : [];
      const proto = Object.getPrototypeOf(r)?.constructor?.name;
      let imageSize = 0;

      // Check if it has an image property
      if (r?.image) {
        imageSize = r.image.byteLength || r.image.length || 0;
      }

      // Try to read as response
      let respSize = 0;
      try {
        const resp = new Response(r);
        const buf = await resp.arrayBuffer();
        respSize = buf.byteLength;
      } catch(e) {}

      results.flux = { 
        status: "ok", type, proto, keys: keys.join(','), 
        imageSize, respSize,
        isUint8: r instanceof Uint8Array,
        isAB: r instanceof ArrayBuffer,
        isRS: r instanceof ReadableStream,
        sample: typeof r === 'object' ? JSON.stringify(r).slice(0, 100) : String(r).slice(0, 100)
      };
    } catch (e) {
      results.flux = { status: "error", message: e.message };
    }
  } else {
    results.flux = { status: "no AI binding" };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
  });
}

// POST: 이미지 생성
export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
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

    // 2차: FLUX — 응답 형식 자동 감지
    if (context.env.AI) {
      try {
        const result = await context.env.AI.run("@cf/black-forest-labs/flux-1-schnell", { prompt: userPrompt });
        
        let bytes;
        
        // Case 1: result.image (some CF AI versions return {image: Uint8Array})
        if (result?.image) {
          if (result.image instanceof Uint8Array) bytes = result.image;
          else if (result.image instanceof ArrayBuffer) bytes = new Uint8Array(result.image);
          else bytes = new Uint8Array(await new Response(result.image).arrayBuffer());
        }
        // Case 2: result is Uint8Array directly
        else if (result instanceof Uint8Array) { bytes = result; }
        // Case 3: result is ArrayBuffer
        else if (result instanceof ArrayBuffer) { bytes = new Uint8Array(result); }
        // Case 4: result is ReadableStream
        else if (result instanceof ReadableStream) { bytes = new Uint8Array(await new Response(result).arrayBuffer()); }
        // Case 5: result is Response-like
        else if (typeof result?.arrayBuffer === 'function') { bytes = new Uint8Array(await result.arrayBuffer()); }
        // Case 6: try wrapping in Response
        else { try { bytes = new Uint8Array(await new Response(result).arrayBuffer()); } catch(e){} }

        if (bytes && bytes.length > 100) {
          let bin = '';
          for (let i = 0; i < bytes.length; i += 8192) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
          }
          return jsonRes({ ok: true, image: `data:image/png;base64,${btoa(bin)}`, model: "flux" });
        }
      } catch (e) {
        console.log("[Imagine] FLUX error:", e.message);
      }
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
  return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
}
