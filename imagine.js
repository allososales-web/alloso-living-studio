// ════════════════════════════════════════════════════════════════════
// /functions/api/imagine.js  ·  v2
// ALMA · Image API · Manifest-driven (R2 catalog + variant rules)
// ════════════════════════════════════════════════════════════════════
// Modes:
//   'direct'  → R2 실사 사진 URL 각도별 (정면·측면·부감)
//   'fusion'  → R2 실사 시드 + Nanobanana 인테리어 합성 (테이블 페어링)
//   'resolve' → 사용자 입력(유사어 포함) → 정규 시리즈명 + 카테고리 + 단종 여부
//
// Catalog: /manifest-series.json on R2 (cached at edge for 1 hour)
// ════════════════════════════════════════════════════════════════════

const MANIFEST_URL = 'https://pub-e6e05583aaab430fa1f84b922d9f7da7.r2.dev/manifest-series.json';
const ANGLES = ['정면', '측면', '부감'];
const CACHE_TTL = 3600; // 1시간
const CACHE_KEY = 'https://internal.alma/manifest-series-v2';

// ────────────────────────────────────────────────────────────────────
// Manifest Loader (with edge cache)
// ────────────────────────────────────────────────────────────────────
async function loadManifest() {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_KEY);
  const cached = await cache.match(cacheKey);
  if (cached) return await cached.json();

  const res = await fetch(MANIFEST_URL);
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const manifest = await res.json();

  await cache.put(cacheKey, new Response(JSON.stringify(manifest), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': `public, max-age=${CACHE_TTL}`,
    },
  }));
  return manifest;
}

// ────────────────────────────────────────────────────────────────────
// Series Resolver — 사용자 입력 → 정규 시리즈
// 유사어 / 띄어쓰기 변형 / 단종 / 변종 처리
// ────────────────────────────────────────────────────────────────────
function normalize(s) {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

function resolveSeries(input, manifest) {
  if (!input) return null;
  const norm = normalize(input);
  const series = manifest.series || {};
  const discontinued = manifest.discontinued?.products || {};

  // 1. 단종 제품 매칭
  for (const [name, info] of Object.entries(discontinued)) {
    const candidates = [name, info.en].filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return {
        resolved: name,
        category: 'discontinued',
        message: `${name}은 단종된 제품입니다. 다른 시리즈를 추천드릴 수 있어요.`,
      };
    }
  }

  // 2. 정확한 시리즈명 매칭 (한글 또는 영문)
  for (const [name, info] of Object.entries(series)) {
    if (name.startsWith('_')) continue; // skip _brand_보눔 같은 그룹
    const candidates = [name, info.ko, info.en, ...(info.synonyms || [])]
      .filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return {
        resolved: name,
        info,
        category: info.category,
        parent: info.parent || null,
        variants: info.variants || [],
        folder: info.folder,
      };
    }
  }

  // 3. 브랜드 그룹 매칭 (예: "보눔" → _brand_보눔 → 풀베이스·오픈베이스)
  for (const [name, info] of Object.entries(series)) {
    if (!info.is_brand_group) continue;
    const candidates = [info.ko, info.en, ...(info.synonyms || [])]
      .filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return {
        resolved: info.ko,
        is_brand_group: true,
        members: info.members,
        message: `${info.ko}은 ${info.members.join(' / ')} 두 종류가 있어요. 어느 쪽으로 보여드릴까요?`,
      };
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// Color Resolver
// ────────────────────────────────────────────────────────────────────
function resolveColor(input, manifest) {
  if (!input) return null;
  const norm = normalize(input);
  const colors = manifest.colors || {};
  const discontinued = manifest.discontinued?.colors || [];

  // 단종 컬러
  if (discontinued.map(normalize).includes(norm)) {
    return {
      resolved: input,
      discontinued: true,
      message: `${input}은 단종된 컬러예요. 비슷한 톤의 다른 컬러를 안내드릴 수 있어요.`,
    };
  }

  // 정확 매칭
  for (const [name, info] of Object.entries(colors)) {
    const candidates = [name, info.en, ...(info.synonyms || [])]
      .filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return {
        resolved: name,
        en: info.en,
        desc_en: info.desc_en || null,
      };
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────────────────
// URL builder for R2 product images
// ────────────────────────────────────────────────────────────────────
function buildUrl(manifest, folder, filename) {
  return manifest.r2_base + encodeURIComponent(folder) + '/' + encodeURIComponent(filename);
}

function buildFilename({ series, size = '1인', material = '가죽', color, angle }) {
  return `[alloso] ${series}_${size}_${material}_${color}_${angle}.png`;
}

async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.ok;
  } catch { return false; }
}

async function fetchImageBase64(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// ────────────────────────────────────────────────────────────────────
// Direct mode — 시리즈의 컬러별 실사 URL 찾기
// ────────────────────────────────────────────────────────────────────
async function getDirectUrls(manifest, resolved, { color, size = '1인', material = '가죽' }) {
  const folder = resolved.folder;
  const seriesKo = resolved.info.ko;

  const urls = {};
  await Promise.all(ANGLES.map(async (angle) => {
    const filename = buildFilename({ series: seriesKo, size, material, color, angle });
    const url = buildUrl(manifest, folder, filename);
    if (await urlExists(url)) urls[angle] = url;
  }));
  return urls;
}

// ────────────────────────────────────────────────────────────────────
// Table pairing — 소파에 어울리는 테이블 찾기
// ────────────────────────────────────────────────────────────────────
function findPairedTable(manifest, sofaName) {
  const series = manifest.series || {};
  const sofa = series[sofaName];
  if (!sofa) return null;

  // 명시적 페어 (e.g. 케렌시아 → 케렌시아 테이블)
  if (sofa.paired_table) {
    return series[sofa.paired_table] || null;
  }

  // 같은 시리즈 prefix를 가진 테이블 검색
  for (const [name, info] of Object.entries(series)) {
    if (info.category === 'table' && name.startsWith(sofaName)) {
      return info;
    }
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Variant mention helper
// ────────────────────────────────────────────────────────────────────
function getVariantMention(manifest, seriesName) {
  const rules = manifest.variant_rules?.primary_to_variants || {};
  const variants = rules[seriesName];
  if (!variants || !variants.length) return null;

  const existing = variants.filter(v => manifest.series?.[v]);
  if (!existing.length) return null;

  return {
    variants: existing,
    message: `${seriesName}를 보여드릴게요. ${existing.join(', ')}도 있어요.`,
  };
}

// ────────────────────────────────────────────────────────────────────
// Gemini call
// ────────────────────────────────────────────────────────────────────
async function callGemini(env, imageBase64s, prompt) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  const parts = [];
  for (const b64 of imageBase64s.filter(Boolean)) {
    parts.push({ inline_data: { mime_type: 'image/png', data: b64 } });
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }] }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = await res.json();
  const responseParts = data?.candidates?.[0]?.content?.parts || [];
  for (const p of responseParts) {
    const inline = p.inline_data || p.inlineData;
    if (inline?.data) return inline.data;
  }
  return null;
}

async function callFlux(env, prompt) {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not set');
  const result = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt });
  return result.image;
}

// ────────────────────────────────────────────────────────────────────
// Main handler
// ────────────────────────────────────────────────────────────────────
export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { mode = 'direct', series, color, size = '1인', material = '가죽', scenePrompt, includeTable = true } = body;

    if (!series) return json({ error: 'series is required' }, 400);

    const manifest = await loadManifest();

    // ── RESOLVE MODE ─────────────────────────────────────────────
    if (mode === 'resolve') {
      const resolved = resolveSeries(series, manifest);
      if (!resolved) return json({ error: 'series_not_found', input: series });
      const colorResolved = color ? resolveColor(color, manifest) : null;
      const variantMention = getVariantMention(manifest, resolved.resolved);
      return json({ mode, series: resolved, color: colorResolved, variantMention });
    }

    const resolved = resolveSeries(series, manifest);
    if (!resolved) return json({ error: 'series_not_found', input: series });

    if (resolved.category === 'discontinued') {
      return json({ mode, discontinued: true, message: resolved.message });
    }

    if (resolved.is_brand_group) {
      return json({ mode, is_brand_group: true, message: resolved.message, members: resolved.members });
    }

    const colorResolved = color ? resolveColor(color, manifest) : null;
    if (colorResolved?.discontinued) {
      return json({ mode, discontinued_color: true, message: colorResolved.message });
    }
    const finalColor = colorResolved?.resolved || color;
    const colorDescEn = colorResolved?.desc_en || finalColor;

    const variantMention = getVariantMention(manifest, resolved.resolved);

    // ── DIRECT MODE ──────────────────────────────────────────────
    if (mode === 'direct') {
      if (!finalColor) return json({ error: 'color is required for direct mode' }, 400);
      const urls = await getDirectUrls(manifest, resolved, { color: finalColor, size, material });
      return json({
        mode,
        series: resolved.resolved,
        color: finalColor,
        size, material,
        urls,
        found: Object.keys(urls).length,
        variantMention: variantMention?.message || null,
      });
    }

    // ── FUSION MODE ──────────────────────────────────────────────
    if (mode === 'fusion') {
      const seriesKo = resolved.info.ko;
      const folder = resolved.folder;

      // 1. 소파 레퍼런스 (측면 우선, 정면·부감 폴백)
      let sofaBase64 = null;
      let sofaRef = null;
      for (const angle of ['측면', '정면', '부감']) {
        if (!finalColor) break;
        const filename = buildFilename({ series: seriesKo, size, material, color: finalColor, angle });
        const url = buildUrl(manifest, folder, filename);
        const b64 = await fetchImageBase64(url);
        if (b64) { sofaBase64 = b64; sofaRef = url; break; }
      }

      // 2. 테이블 페어 (선택)
      let tableBase64 = null;
      let tableRef = null;
      let pairedTable = null;
      if (includeTable) {
        pairedTable = findPairedTable(manifest, resolved.resolved);
        if (pairedTable) {
          for (const angle of ['측면', '정면']) {
            const tFilename = `[alloso] ${pairedTable.ko}_${angle}.png`;
            const url = buildUrl(manifest, pairedTable.folder, tFilename);
            const b64 = await fetchImageBase64(url);
            if (b64) { tableBase64 = b64; tableRef = url; break; }
          }
        }
      }

      const scene = scenePrompt || 'a tasteful Korean modern living room with soft natural light, warm wood floor, minimalist styling';
      const tableText = pairedTable && tableBase64
        ? ` Place the ${pairedTable.ko} table alongside the sofa as a complementary set.`
        : '';

      const fusionPrompt = [
        `Place this exact ${seriesKo} sofa in ${scene}.`,
        `Preserve the sofa's exact form, proportions, and ${colorDescEn} upholstery color.`,
        tableText,
        `Photorealistic editorial photography, magazine-quality, soft natural daylight, shallow depth of field.`,
        `The sofa must remain the visual anchor of the composition.`,
      ].filter(Boolean).join(' ');

      let resultBase64 = null;
      let provider = null;
      let warning = null;

      if (sofaBase64) {
        try {
          const refs = [sofaBase64];
          if (tableBase64) refs.push(tableBase64);
          resultBase64 = await callGemini(env, refs, fusionPrompt);
          if (resultBase64) provider = 'gemini';
        } catch (e) {
          warning = `Gemini failed: ${e.message.slice(0, 80)}`;
        }
      } else {
        warning = 'No matching reference image found. Using text-only generation.';
      }

      if (!resultBase64) {
        try {
          const fluxPrompt = `A ${seriesKo} sofa with ${colorDescEn}, in ${scene}.${tableText} Editorial interior photography, photorealistic.`;
          resultBase64 = await callFlux(env, fluxPrompt);
          if (resultBase64) provider = 'flux';
        } catch (e) {
          return json({ error: 'All image providers failed', detail: e.message, warning }, 500);
        }
      }

      return json({
        mode,
        series: resolved.resolved,
        color: finalColor,
        provider,
        warning,
        sofaReferenceUsed: sofaRef,
        tablePaired: pairedTable ? pairedTable.ko : null,
        tableReferenceUsed: tableRef,
        variantMention: variantMention?.message || null,
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

    return json({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    return json({ error: e.message, stack: e.stack }, 500);
  }
}

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
