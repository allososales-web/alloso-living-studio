// ════════════════════════════════════════════════════════════════════
// /functions/api/imagine.js  ·  v3
// ALMA · Image API · R2 Auto-Discovery (no more manual filename config)
// ════════════════════════════════════════════════════════════════════
// Bindings required (Cloudflare Pages Settings → Functions → Bindings):
//   PRODUCTS  → R2 bucket: alloso-assets
//   AI        → Workers AI
//
// Env vars:
//   GOOGLE_API_KEY (Gemini)
//
// Modes:
//   'resolve' → 시리즈 입력 정규화 (유사어·단종 안내·브랜드 그룹 분기)
//   'direct'  → R2 폴더에서 정면·측면·부감 URL 자동 탐색
//   'fusion'  → R2 시드 (소파+테이블) + Nanobanana 인테리어 합성
// ════════════════════════════════════════════════════════════════════

const MANIFEST_URL = 'https://pub-e6e05583aaab430fa1f84b922d9f7da7.r2.dev/manifest-series.json';
const ANGLES = ['정면', '측면', '부감'];
const CACHE_TTL = 3600;
const CACHE_KEY = 'https://internal.alma/manifest-series-v3';

// ────────────────────────────────────────────────────────────────────
// Manifest loader (edge cached)
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
// Normalization + Resolvers
// ────────────────────────────────────────────────────────────────────
function normalize(s) {
  return (s || '').replace(/\s+/g, '').toLowerCase();
}

function resolveSeries(input, manifest) {
  if (!input) return null;
  const norm = normalize(input);
  const series = manifest.series || {};
  const discontinued = manifest.discontinued?.products || {};

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

  for (const [name, info] of Object.entries(series)) {
    if (name.startsWith('_')) continue;
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

function resolveColor(input, manifest) {
  if (!input) return null;
  const norm = normalize(input);
  const colors = manifest.colors || {};
  const discontinued = manifest.discontinued?.colors || [];

  if (discontinued.map(normalize).includes(norm)) {
    return {
      resolved: input,
      discontinued: true,
      message: `${input}은 단종된 컬러예요. 비슷한 톤의 다른 컬러를 안내드릴 수 있어요.`,
    };
  }

  for (const [name, info] of Object.entries(colors)) {
    const candidates = [name, info.en, ...(info.synonyms || [])]
      .filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return { resolved: name, en: info.en, desc_en: info.desc_en || null };
    }
  }
  return null;
}

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
// R2 Auto-Discovery — 폴더 안의 파일을 점수화해서 최적 레퍼런스 선택
// ────────────────────────────────────────────────────────────────────
async function listFolder(env, folder) {
  if (!env.PRODUCTS) return [];
  const prefix = `products/${folder}/`;
  const allObjects = [];
  let cursor;
  do {
    const result = await env.PRODUCTS.list({ prefix, cursor, limit: 1000 });
    allObjects.push(...(result.objects || []));
    cursor = result.truncated ? result.cursor : null;
  } while (cursor);
  return allObjects.filter(o => /\.(png|jpe?g|webp)$/i.test(o.key));
}

function scoreFile(name, { preferredColor, preferredAngle = '측면', preferredMaterial }) {
  let score = 0;
  if (name.includes(preferredAngle)) score += 50;
  else if (name.includes('측면')) score += 30;
  else if (name.includes('정면')) score += 20;
  else if (name.includes('부감')) score += 10;
  if (preferredColor && name.includes(preferredColor)) score += 100;
  if (preferredMaterial && name.includes(preferredMaterial)) score += 20;
  return score;
}

async function findBestReference(env, folder, opts = {}) {
  const files = await listFolder(env, folder);
  if (files.length === 0) return null;
  const scored = files.map(f => ({
    key: f.key,
    name: f.key.split('/').pop(),
    score: scoreFile(f.key, opts),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

async function fetchR2AsBase64(env, key) {
  const obj = await env.PRODUCTS.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function keyToPublicUrl(manifest, key) {
  const baseHost = manifest.r2_base.replace(/products\/$/, '');
  return baseHost + key.split('/').map(encodeURIComponent).join('/');
}

// ────────────────────────────────────────────────────────────────────
// Table pairing
// ────────────────────────────────────────────────────────────────────
function selectPairedTable(manifest, resolved, spaceSize) {
  if (resolved.info?.paired_table && manifest.series[resolved.info.paired_table]) {
    const t = manifest.series[resolved.info.paired_table];
    return { table: t, name: resolved.info.paired_table, reason: 'explicit_pair' };
  }
  const spaceConfig = manifest.tables_by_space?.[spaceSize];
  const tableNames = spaceConfig?.tables || [];
  for (const tName of tableNames) {
    const t = manifest.series[tName];
    if (t) return { table: t, name: tName, reason: `space_${spaceSize}`, placement: spaceConfig.placement };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────
// Gemini / FLUX
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
    const { mode = 'direct', series, color, scenePrompt, includeTable = true } = body;
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
    const finalColor = colorResolved?.resolved || color || null;
    const seriesPreferredColor = finalColor || resolved.info?.default_color || null;
    const variantMention = getVariantMention(manifest, resolved.resolved);

    if (!env.PRODUCTS) {
      return json({ error: 'R2 binding PRODUCTS not configured' }, 500);
    }

    // ── DIRECT MODE ──────────────────────────────────────────────
    if (mode === 'direct') {
      const folder = resolved.folder;
      const files = await listFolder(env, folder);
      const matching = finalColor ? files.filter(f => f.key.includes(finalColor)) : files;

      const urls = {};
      for (const angle of ANGLES) {
        const found = matching.find(f => f.key.includes(angle));
        if (found) urls[angle] = keyToPublicUrl(manifest, found.key);
      }

      return json({
        mode,
        series: resolved.resolved,
        color: finalColor,
        folder,
        totalFilesInFolder: files.length,
        matchingColorCount: matching.length,
        urls,
        found: Object.keys(urls).length,
        variantMention: variantMention?.message || null,
      });
    }

    // ── FUSION MODE ──────────────────────────────────────────────
    if (mode === 'fusion') {
      const seriesKo = resolved.info.ko;
      const folder = resolved.folder;
      const spaceSize = body.spaceSize || 'narrow';

      // 1. 소파 레퍼런스 자동 탐색
      const sofaPick = await findBestReference(env, folder, {
        preferredColor: seriesPreferredColor,
        preferredAngle: '측면',
      });
      let sofaBase64 = null;
      let sofaRef = null;
      let resolvedColor = finalColor;
      let colorAutoSelected = false;

      if (sofaPick) {
        sofaBase64 = await fetchR2AsBase64(env, sofaPick.key);
        sofaRef = keyToPublicUrl(manifest, sofaPick.key);
        // 자동 선택된 컬러 추출 (메타데이터용)
        if (!finalColor && manifest.colors) {
          for (const cName of Object.keys(manifest.colors)) {
            if (sofaPick.name.includes(cName)) {
              resolvedColor = cName;
              colorAutoSelected = true;
              break;
            }
          }
        }
      }

      const workingColorDescEn =
        (resolvedColor && manifest.colors?.[resolvedColor]?.desc_en) ||
        resolvedColor || 'natural';

      // 2. 테이블 페어링
      let pairedTable = null;
      let tableMeta = null;
      if (includeTable) {
        tableMeta = selectPairedTable(manifest, resolved, spaceSize);
        if (tableMeta) pairedTable = tableMeta.table;
      }

      // 3. 테이블 레퍼런스 자동 탐색
      let tableBase64 = null;
      let tableRef = null;
      if (pairedTable && pairedTable.folder) {
        const tablePick = await findBestReference(env, pairedTable.folder, {
          preferredAngle: '측면',
        });
        if (tablePick) {
          tableBase64 = await fetchR2AsBase64(env, tablePick.key);
          tableRef = keyToPublicUrl(manifest, tablePick.key);
        }
      }

      // 4. 프롬프트 구성
      const scene = scenePrompt || (spaceSize === 'wide'
        ? 'a spacious Korean modern living room with high ceilings, large windows, soft natural light, warm oak floor, minimalist styling'
        : 'a cozy Korean modern living room with soft natural light, warm wood floor, minimalist styling');

      let tableText = '';
      if (pairedTable) {
        const placement = tableMeta?.placement ||
          (tableMeta?.reason === 'explicit_pair' ? 'integrated with the sofa modules' : 'beside the sofa');
        if (tableBase64) {
          tableText = ` Place the ${pairedTable.ko} table ${placement} as a complementary set.`;
        } else {
          tableText = ` Include an alloso ${pairedTable.ko} ${pairedTable.en} side/coffee table ${placement} to complete the set.`;
        }
      }

      const fusionPrompt = [
        `Place this exact ${seriesKo} sofa in ${scene}.`,
        `Preserve the sofa's exact form, proportions, and ${workingColorDescEn} upholstery color.`,
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
        warning = 'No matching reference image found via R2 listing. Using text-only generation.';
      }

      if (!resultBase64) {
        try {
          const fluxPrompt = `A ${seriesKo} sofa with ${workingColorDescEn}, in ${scene}.${tableText} Editorial interior photography, photorealistic.`;
          resultBase64 = await callFlux(env, fluxPrompt);
          if (resultBase64) provider = 'flux';
        } catch (e) {
          return json({ error: 'All image providers failed', detail: e.message, warning }, 500);
        }
      }

      return json({
        mode,
        series: resolved.resolved,
        color: resolvedColor,
        colorAutoSelected,
        spaceSize,
        provider,
        warning,
        sofaReferenceUsed: sofaRef,
        sofaPickedFilename: sofaPick?.name || null,
        tablePaired: tableMeta?.name || null,
        tableReferenceUsed: tableRef,
        tableSelectionReason: tableMeta?.reason || null,
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
