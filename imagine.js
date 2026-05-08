// ════════════════════════════════════════════════════════════════════
// /functions/api/imagine.js
// ALMA · Image API · Direct Display + Scene Fusion (Hybrid)
// ════════════════════════════════════════════════════════════════════
// Modes:
//   'direct' → R2 실사 사진 URL을 각도별로 반환 (AI 호출 X)
//   'fusion' → R2 실사 사진을 시드로 Nanobanana에 인테리어 합성 요청
//
// Filename convention (R2 products/ 폴더):
//   [alloso] {series}_{size}_{material}_{color}_{angle}.png
// ════════════════════════════════════════════════════════════════════

const R2_BASE = 'https://pub-e6e05583aaab430fa1f84b922d9f7da7.r2.dev/products/';
const ANGLES = ['정면', '측면', '부감'];

// 컬러 영문 묘사 (인테리어 합성용 프롬프트에 사용)
// 전체 55개는 index.html의 COLOR_DESC_MAP 사용. 여기는 클라이언트 미전달 시 폴백.
const COLOR_DESC_FALLBACK = {
  '모빅': 'glossy black leather with subtle sheen',
  '클라우드': 'cream white soft leather',
  '노체': 'rich dark walnut brown leather',
  '버번': 'warm caramel bourbon leather',
  '사하라': 'sandy desert beige leather',
  '세이지': 'muted sage green leather',
  '셔우드텐': 'deep forest green tan leather',
  '오비드': 'warm taupe leather',
  '오키드': 'soft pink orchid leather',
  '온드': 'warm honey ondé leather',
  '아이리쉬': 'irish cream leather',
  '뮤트블랙': 'muted matte black leather',
  '모트': 'mottled neutral leather',
};

// ────────────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────────────
function buildFilename({ series, size = '1인', material = '가죽', color, angle }) {
  return `[alloso] ${series}_${size}_${material}_${color}_${angle}.png`;
}

function buildUrl(opts) {
  return R2_BASE + encodeURIComponent(buildFilename(opts));
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch (e) {
    return false;
  }
}

async function fetchImageBase64(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  // Cloudflare Workers btoa 호환
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ────────────────────────────────────────────────────────────────────
// Direct mode: R2 URL only (no AI)
// ────────────────────────────────────────────────────────────────────
async function getDirectUrls({ series, color, size, material }) {
  const urls = {};
  await Promise.all(ANGLES.map(async (angle) => {
    const url = buildUrl({ series, color, size, material, angle });
    if (await urlExists(url)) urls[angle] = url;
  }));
  return urls;
}

// ────────────────────────────────────────────────────────────────────
// Gemini (Nanobanana) call
// ────────────────────────────────────────────────────────────────────
async function callGemini(env, imageBase64, prompt) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  const body = {
    contents: [{
      parts: [
        { inline_data: { mime_type: 'image/png', data: imageBase64 } },
        { text: prompt },
      ],
    }],
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of parts) {
    const inline = p.inline_data || p.inlineData;
    if (inline?.data) return inline.data;
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Cloudflare FLUX fallback (text-only)
// ────────────────────────────────────────────────────────────────────
async function callFlux(env, prompt) {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not set');
  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt });
  return result.image; // base64 string
}

// ────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const {
      mode = 'direct',
      series,
      color,
      size = '1인',
      material = '가죽',
      scenePrompt,
      colorDesc,
    } = body;

    if (!series || !color) {
      return json({ error: 'series and color are required' }, 400);
    }

    // ── DIRECT MODE ─────────────────────────────────────────────
    if (mode === 'direct') {
      const urls = await getDirectUrls({ series, color, size, material });
      const found = Object.keys(urls).length;
      return json({
        mode,
        series, color, size, material,
        urls,
        found,
        message: found === 0
          ? `해당 조합의 제품 사진을 찾지 못했어요 (${series}/${size}/${material}/${color})`
          : null,
      });
    }

    // ── FUSION MODE ─────────────────────────────────────────────
    if (mode === 'fusion') {
      // 측면을 시드로 우선 사용 (가장 형태감 좋음)
      let referenceUrl = buildUrl({ series, color, size, material, angle: '측면' });
      let sofaBase64 = await fetchImageBase64(referenceUrl);

      // 측면 없으면 정면 → 부감 순으로 폴백
      if (!sofaBase64) {
        for (const fallbackAngle of ['정면', '부감']) {
          referenceUrl = buildUrl({ series, color, size, material, angle: fallbackAngle });
          sofaBase64 = await fetchImageBase64(referenceUrl);
          if (sofaBase64) break;
        }
      }

      const finalColorDesc = colorDesc || COLOR_DESC_FALLBACK[color] || color;
      const scene = scenePrompt || 'a tasteful Korean modern living room with soft natural light, warm wood floor, minimalist styling';

      const fusionPrompt = [
        `Place this exact ${series} sofa in ${scene}.`,
        `Preserve the sofa's exact form, proportions, and ${finalColorDesc} upholstery color.`,
        `Photorealistic editorial photography, magazine-quality, soft natural daylight, shallow depth of field.`,
        `The sofa must remain the visual anchor of the composition.`,
      ].join(' ');

      let resultBase64 = null;
      let provider = null;
      let warning = null;

      // 1차: Gemini (이미지+텍스트)
      if (sofaBase64) {
        try {
          resultBase64 = await callGemini(env, sofaBase64, fusionPrompt);
          if (resultBase64) provider = 'gemini';
        } catch (e) {
          console.log('[imagine] Gemini error:', e.message);
          warning = `Gemini failed (${e.message.slice(0, 80)}). Falling back to FLUX.`;
        }
      } else {
        warning = 'Reference image not found in R2. Using text-only generation.';
      }

      // 2차: FLUX (텍스트만)
      if (!resultBase64) {
        try {
          const fluxPrompt = `A ${series} sofa with ${finalColorDesc}, in ${scene}. Editorial interior photography, photorealistic.`;
          resultBase64 = await callFlux(env, fluxPrompt);
          if (resultBase64) provider = 'flux';
        } catch (e) {
          return json({
            error: 'All image providers failed',
            detail: e.message,
            warning,
          }, 500);
        }
      }

      return json({
        mode,
        series, color, size, material,
        provider,
        warning,
        referenceUsed: sofaBase64 ? referenceUrl : null,
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

    return json({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}

// ────────────────────────────────────────────────────────────────────
// CORS preflight
// ────────────────────────────────────────────────────────────────────
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
