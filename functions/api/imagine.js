export async function onRequestPost(context) {
  const API_KEY = context.env.GOOGLE_API_KEY;
  if (!API_KEY) {
    return jsonRes({ error: "API key not set" }, 500);
  }

  try {
    const { roomImage, sofaName, prompt } = await context.request.json();
    const userPrompt = prompt || `A photorealistic modern Korean apartment living room with a premium ${sofaName || "sofa"} placed naturally. Magazine-style interior photography with natural lighting.`;

    const parts = [{ text: userPrompt }];
    if (roomImage) {
      parts.push({ inline_data: { mime_type: "image/jpeg", data: roomImage.replace(/^data:image\/\w+;base64,/, "") } });
    }

    const errors = [];

    // 1) gemini-2.5-flash-image (Nano Banana - confirmed REST API)
    const r1 = await tryModel("gemini-2.5-flash-image", parts, API_KEY);
    if (r1.image) return jsonRes({ ok:true, ...r1 });
    errors.push("gemini-2.5-flash-image: " + r1.error);

    // 2) gemini-3.1-flash-image-preview (Nano Banana 2)
    const r2 = await tryModel("gemini-3.1-flash-image-preview", parts, API_KEY);
    if (r2.image) return jsonRes({ ok:true, ...r2 });
    errors.push("gemini-3.1-flash-image-preview: " + r2.error);

    // 3) gemini-2.5-flash with IMAGE modality
    const r3 = await tryModel("gemini-2.5-flash", parts, API_KEY);
    if (r3.image) return jsonRes({ ok:true, ...r3 });
    errors.push("gemini-2.5-flash: " + r3.error);

    // 4) Imagen 4
    const r4 = await tryImagen(userPrompt, API_KEY);
    if (r4.image) return jsonRes({ ok:true, ...r4 });
    errors.push("imagen-4: " + r4.error);

    return jsonRes({ error: "All models failed", detail: errors.join(" | ") }, 500);

  } catch (err) {
    return jsonRes({ error: err.message }, 500);
  }
}

async function tryModel(model, parts, key) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    console.log("[Imagine] Try:", model);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts, role: "user" }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.log("[Imagine]", model, res.status, t.slice(0, 150));
      return { error: `${res.status}: ${t.slice(0, 80)}` };
    }
    const data = await res.json();
    let image = null, text = "";
    for (const p of (data.candidates?.[0]?.content?.parts || [])) {
      if (p.inlineData) image = `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`;
      if (p.text) text += p.text;
    }
    if (image) { console.log("[Imagine] OK:", model); return { image, text, model }; }
    return { error: "no image returned" };
  } catch (e) {
    return { error: e.message };
  }
}

async function tryImagen(prompt, key) {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`;
    console.log("[Imagine] Try: imagen-4");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instances: [{ prompt }], parameters: { sampleCount: 1 } }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.log("[Imagine] imagen-4", res.status, t.slice(0, 150));
      return { error: `${res.status}: ${t.slice(0, 80)}` };
    }
    const data = await res.json();
    if (data.predictions?.[0]?.bytesBase64Encoded) {
      console.log("[Imagine] OK: imagen-4");
      return { image: `data:image/png;base64,${data.predictions[0].bytesBase64Encoded}`, text: "", model: "imagen-4" };
    }
    return { error: "no image" };
  } catch (e) {
    return { error: e.message };
  }
}

function jsonRes(data, status = 200) {
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
