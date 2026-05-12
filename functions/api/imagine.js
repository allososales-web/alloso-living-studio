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
const CACHE_KEY = 'https://internal.alma/manifest-series-v4';

// ─── Scene Library (B안 — 6 무드별 인테리어 톤) ───
// 알로소 Pinterest 보드 (Timeless People · Find Your Inspiration) 시각 언어 기반
const SCENE_LIBRARY = {
  minimal: "Korean editorial minimalist apartment, white walls, pale wide-plank oak floor, single full-height grid window with diffused afternoon light, one large white ceramic vase with a single dried branch, art books stacked casually on floor, gallery-like restraint emphasizing negative space",
  natural: "Sun-drenched living room with herringbone oak floor, warm cream walls, vintage wooden ladder draped with linen throw, large fiddle leaf fig in unglazed terracotta pot, mid-afternoon golden light through tall windows, small ceramic vessels on low wood console",
  luxe_dark: "Moody European loft with deep charcoal walls, dark walnut wide-plank floor, dramatic glass-block window admitting cool blue-hour light, single tall brass arc floor lamp, framed black-and-white photography, one warm focal spot illuminating the furniture",
  family: "Warm Korean modern family living room, wide oak floor with handwoven natural fiber rug, soft late-afternoon sun, low pale-wood coffee table with stacked art books and ceramic tea cups, layered cushions and chunky knit throw casually placed, single trailing pothos plant, hanji paper lamp casting warm light",
  scandi: "Copenhagen apartment with white-washed wide plank floor, warm white painted walls, sheer linen curtains diffusing soft overcast Nordic daylight, single mid-century Danish three-legged wooden stool, tall ceramic floor vase holding a dried pampas branch, monochrome line-drawing art print leaning against wall",
  classic: "Italian Liberty-era apartment with herringbone parquet floor and one section painted in deep terracotta orange, white walls with subtle crown molding, full-height grid windows, vintage Italian glass coffee table on chrome legs, warm golden hour light from west-facing windows, oversized abstract art print leaning against wall, single sculptural ceramic object",
  // 무드 미지정 시 폴백 (공간 크기로만 분기)
  _wide: "spacious editorial Korean apartment, white walls, wide pale oak plank floor, full-height grid windows admitting soft natural daylight, ceramic objects, single statement plant in terracotta pot, generous negative space, magazine-quality composition",
  _narrow: "intimate Korean modern living room, wide oak plank floor, white walls with subtle warmth, soft natural daylight from side window, ceramic vase with a few stems, art book stack on floor, refined editorial styling",
};

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
  const result = await env.PRODUCTS.list({ prefix, limit: 100 });
  const objects = result.objects || [];
  return objects.filter(o => /\.(png|jpe?g|webp)$/i.test(o.key));
}

function scoreFile(name, { preferredColor, preferredAngle = '측면', preferredMaterial, preferredSize }) {
  let score = 0;
  if (name.includes(preferredAngle)) score += 50;
  else if (name.includes('측면')) score += 30;
  else if (name.includes('정면')) score += 20;
  else if (name.includes('부감')) score += 10;
  if (preferredColor && name.includes(preferredColor)) score += 100;
  if (preferredSize && name.includes(preferredSize)) score += 80;
  if (preferredMaterial && name.includes(preferredMaterial)) score += 40;
  return score;
}

async function findBestReference(env, folder, opts = {}) {
  const files = await listFolder(env, folder);
  if (files.length === 0) return null;
  const scored = files.map(f => ({
    key: f.key,
    name: f.key.split('/').pop(),
    size: f.size || 0,
    score: scoreFile(f.key, opts),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

// 청크 단위 base64 변환 (O(n) — 큰 이미지도 CPU 시간 내에 처리)
function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

async function fetchR2AsBase64(env, key) {
  const obj = await env.PRODUCTS.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  return bytesToBase64(new Uint8Array(buf));
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
  let stage = 'init';
  try {
    stage = 'parse_body';
    const body = await request.json();
    const { mode = 'direct', series, color, scenePrompt, mood, includeTable = true } = body;

    stage = 'load_manifest';
    const manifest = await loadManifest();

    // ── BUNDLE MODE ─────────────────────────────────────────────
    // 한 장면에 여러 제품을 합성. 번들/세트 제안용
    if (mode === 'bundle') {
      stage = 'bundle_validate';
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return json({ error: 'items array required for bundle mode' }, 400);
      if (items.length > 5) return json({ error: 'max 5 items per bundle', count: items.length }, 400);

      const spaceSize = body.spaceSize || 'wide';
      const moodKey = body.mood;
      const customScene = body.scenePrompt;

      // 각 아이템 레퍼런스 fetch
      stage = 'bundle_fetch_refs';
      const refs = [];
      const warnings = [];

      for (const item of items) {
        if (!item?.series) { warnings.push('item without series skipped'); continue; }
        const itemResolved = resolveSeries(item.series, manifest);
        if (!itemResolved || itemResolved.category === 'discontinued' || itemResolved.is_brand_group) {
          warnings.push(`${item.series}: 해석 실패 또는 단종/브랜드 그룹`);
          continue;
        }
        const pick = await findBestReference(env, itemResolved.folder, {
          preferredColor: item.color || itemResolved.info?.default_color,
          preferredAngle: '측면',
          preferredMaterial: item.material || itemResolved.info?.default_material,
          preferredSize: item.size || itemResolved.info?.default_size,
        });
        if (!pick) {
          warnings.push(`${item.series}: 레퍼런스 파일 없음 (folder=${itemResolved.folder})`);
          continue;
        }
        const obj = await env.PRODUCTS.get(pick.key);
        if (!obj) {
          warnings.push(`${item.series}: R2 객체 가져오기 실패`);
          continue;
        }
        const size = obj.size || 0;
        if (size > 10 * 1024 * 1024) {
          warnings.push(`${item.series}: 이미지 너무 큼 (${(size / 1024 / 1024).toFixed(1)}MB)`);
          continue;
        }
        const buf = await obj.arrayBuffer();
        const base64 = bytesToBase64(new Uint8Array(buf));
        refs.push({
          base64,
          seriesKo: itemResolved.info.ko,
          seriesEn: itemResolved.info.en,
          colorKo: item.color || itemResolved.info?.default_color || '',
          sizeKo: item.size || itemResolved.info?.default_size || '',
          category: itemResolved.info?.category || 'sofa',
          filename: pick.name,
        });
      }

      if (refs.length === 0) {
        return json({ error: 'No valid references could be loaded', warnings, stage }, 500);
      }

      // 카테고리별 분류
      stage = 'bundle_compose_prompt';
      const sofas = refs.filter(r => r.category === 'sofa');
      const chairs = refs.filter(r => r.category === 'lounge_chair' || r.category === 'chair');
      const poufs = refs.filter(r => r.category === 'pouf' || r.category === 'stool');
      const tables = refs.filter(r => r.category === 'table');
      const daybeds = refs.filter(r => r.category === 'daybed');

      // Scene 선택
      const scene = customScene
        || (moodKey && SCENE_LIBRARY[moodKey])
        || SCENE_LIBRARY[spaceSize === 'wide' ? '_wide' : '_narrow'];

      // 카테고리별 영문 용어
      const termFor = (cat) => {
        switch (cat) {
          case 'lounge_chair': return 'lounge chair';
          case 'chair': return 'armchair';
          case 'pouf': case 'stool': return 'small leather cube-shaped pouf/ottoman (NOT a sofa)';
          case 'daybed': return 'daybed';
          case 'table': return 'coffee table';
          default: return 'sofa';
        }
      };

      // 제품 리스트 (참조 이미지 순서대로)
      const productList = refs.map((r, i) => {
        const sizeText = r.sizeKo ? `${r.sizeKo} ` : '';
        return `(reference image ${i + 1}) the alloso ${r.seriesKo} ${sizeText}${termFor(r.category)} in ${r.colorKo} color`;
      }).join('; ');

      // 배치 가이드
      const placement = [];
      if (sofas.length) placement.push(`anchor the largest sofa as the primary visual element at the center or rear of the space`);
      if (chairs.length) placement.push(`angle the lounge chair as an accent piece at one side, facing the sofa to create a conversational grouping`);
      if (poufs.length) placement.push(`place the small leather pouf flexibly near the sofa as additional informal seating — keep it as a small floor cube, not a large sofa`);
      if (tables.length) placement.push(`place the coffee table in front of the main sofa as the central piece`);
      if (daybeds.length) placement.push(`place the daybed against a wall or in a window alcove`);
      const placementText = placement.length > 0 ? placement.join('; ') : 'arrange the pieces naturally to form a curated grouping';

      const bundlePrompt = [
        `Create a single photorealistic editorial interior photograph showing ${refs.length} distinct alloso furniture pieces composed together as ONE curated grouping in ONE room.`,
        `Products to include in this order from reference images: ${productList}.`,
        `Setting: ${scene}.`,
        `Layout guidance: ${placementText}.`,
        `CRITICAL preservation — each piece must remain visually IDENTICAL to its reference image: exact silhouette, structure, proportions, color, and material. Do NOT redesign, simplify, scale, or alter any piece. If a reference shows a chair, keep it a chair (NOT a sofa). If a pouf (small leather cube), keep it as a small floor cube (NOT a sofa). If a sofa, keep it a sofa with the same module count and form. Each reference number (1, 2, 3...) maps to a specific piece in the order listed above.`,
        `The composition should look like a deliberately curated alloso showroom or hospitality grouping — a complete furniture set/bundle. All ${refs.length} pieces must be clearly visible, identifiable, and positioned naturally as if a professional designer staged them together.`,
        `Style: photorealistic editorial interior photography, magazine quality, soft natural daylight, shallow depth of field, slight film grain, professional staging.`,
      ].join(' ');

      // Gemini 호출 (다중 레퍼런스)
      stage = 'bundle_gemini';
      let resultBase64;
      try {
        resultBase64 = await callGemini(env, refs.map(r => r.base64), bundlePrompt);
        if (!resultBase64) throw new Error('Gemini returned no image data');
      } catch (e) {
        return json({ error: 'Bundle generation failed', detail: e.message, warnings, stage }, 500);
      }

      return json({
        mode: 'bundle',
        spaceSize,
        mood: moodKey || null,
        itemsCount: refs.length,
        items: refs.map(r => ({
          series: r.seriesKo,
          color: r.colorKo,
          size: r.sizeKo,
          category: r.category,
          filename: r.filename,
        })),
        warnings,
        provider: 'gemini',
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

    if (!series) return json({ error: 'series is required', stage }, 400);

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
      const tableColorInput = body.tableColor || null;

      // 1. 소파 레퍼런스 자동 탐색 — manifest의 default_* 활용
      stage = 'list_sofa_folder';
      const sofaPick = await findBestReference(env, folder, {
        preferredColor: seriesPreferredColor,
        preferredAngle: '측면',
        preferredMaterial: body.material || resolved.info?.default_material || null,
        preferredSize: body.size || resolved.info?.default_size || null,
      });
      let sofaBase64 = null;
      let sofaRef = null;
      let resolvedColor = finalColor;
      let colorAutoSelected = false;

      if (sofaPick) {
        stage = 'fetch_sofa_bytes';
        sofaBase64 = await fetchR2AsBase64(env, sofaPick.key);
        sofaRef = keyToPublicUrl(manifest, sofaPick.key);
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
      stage = 'select_table';
      let pairedTable = null;
      let tableMeta = null;
      if (includeTable) {
        tableMeta = selectPairedTable(manifest, resolved, spaceSize);
        if (tableMeta) pairedTable = tableMeta.table;
      }

      // 3. 테이블 레퍼런스 자동 탐색
      let tableBase64 = null;
      let tableRef = null;
      let tableSize = 0;
      if (pairedTable && pairedTable.folder) {
        stage = 'list_table_folder';
        const tablePick = await findBestReference(env, pairedTable.folder, {
          preferredAngle: '측면',
          preferredColor: tableColorInput,
        });
        if (tablePick) {
          // 너무 큰 파일은 스킵 (CPU 시간 초과 방지) — 10MB 이상이면 텍스트 묘사로만
          if (tablePick.size && tablePick.size > 10 * 1024 * 1024) {
            tableSize = tablePick.size;
            // base64 변환 skip
          } else {
            stage = 'fetch_table_bytes';
            tableBase64 = await fetchR2AsBase64(env, tablePick.key);
            tableRef = keyToPublicUrl(manifest, tablePick.key);
            tableSize = tablePick.size || 0;
          }
        }
      }

      // 4. 프롬프트 구성
      stage = 'build_prompt';
      // Scene 선택 우선순위: 1) scenePrompt 직접 지정, 2) mood → SCENE_LIBRARY[mood], 3) spaceSize 폴백
      const scene = scenePrompt
        || (mood && SCENE_LIBRARY[mood])
        || SCENE_LIBRARY[spaceSize === 'wide' ? '_wide' : '_narrow'];

      // 카테고리 기반 가구 용어 — 시리즈가 sofa가 아닌 경우에도 정확히 묘사
      const categoryTerm = (function(cat){
        switch (cat) {
          case 'lounge_chair': return 'lounge chair';
          case 'chair': return 'armchair';
          case 'pouf':
          case 'stool': return 'leather pouf (a small cube-shaped ottoman, NOT a sofa)';
          case 'daybed': return 'daybed';
          case 'table': return 'table';
          default: return 'sofa';
        }
      })(resolved.info?.category);
      const isAnchor = !['table'].includes(resolved.info?.category);

      // 테이블 컬러 영문 설명 (있으면 프롬프트에 명시)
      const tableColorDescEn = tableColorInput
        ? (manifest.colors?.[tableColorInput]?.desc_en || tableColorInput)
        : null;

      let tableText = '';
      if (pairedTable) {
        const placement = tableMeta?.placement ||
          (tableMeta?.reason === 'explicit_pair' ? 'integrated with the modules' : `beside the ${categoryTerm}`);
        const colorPart = tableColorDescEn ? ` in ${tableColorDescEn} tone` : '';
        if (tableBase64) {
          tableText = ` Place the ${pairedTable.ko} table${colorPart} ${placement} as a complementary set, matching the second reference image.`;
        } else {
          tableText = ` Include an alloso ${pairedTable.ko} ${pairedTable.en} side/coffee table${colorPart} ${placement} to complete the set.`;
        }
      }

      const fusionPrompt = [
        `Place this exact ${seriesKo} ${categoryTerm} from the reference image into ${scene}.`,
        `CRITICAL — preserve the exact silhouette, structure, proportions, and form factor of the ${categoryTerm} from the reference image. Do NOT redesign, simplify, restyle, scale up, or modify it into a different furniture type. If the reference is a chair, keep it a chair. If the reference is a pouf/ottoman, keep it a pouf (small cube-shaped). If the reference is a sofa, keep it a sofa.`,
        `The upholstery color must remain ${workingColorDescEn} as in the reference.`,
        tableText,
        `Photorealistic editorial interior photography, magazine quality, soft natural daylight, shallow depth of field, slight film grain.`,
        isAnchor
          ? `The ${categoryTerm} must be a clear focal point and its form must be IDENTICAL to the reference image.`
          : `The composition must preserve the reference exactly.`,
      ].filter(Boolean).join(' ');

      let resultBase64 = null;
      let provider = null;
      let warning = null;

      if (sofaBase64) {
        try {
          stage = 'call_gemini';
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
          stage = 'call_flux';
          const fluxPrompt = `A ${seriesKo} sofa with ${workingColorDescEn}, in ${scene}.${tableText} Editorial interior photography, photorealistic.`;
          resultBase64 = await callFlux(env, fluxPrompt);
          if (resultBase64) provider = 'flux';
        } catch (e) {
          return json({ error: 'All image providers failed', detail: e.message, warning, stage }, 500);
        }
      }

      return json({
        mode,
        series: resolved.resolved,
        color: resolvedColor,
        colorAutoSelected,
        spaceSize,
        mood: mood || null,
        tableColor: tableColorInput,
        sofaSelectedSize: body.size || resolved.info?.default_size || null,
        sofaSelectedMaterial: body.material || resolved.info?.default_material || null,
        provider,
        warning,
        sofaReferenceUsed: sofaRef,
        sofaPickedFilename: sofaPick?.name || null,
        sofaSize: sofaPick?.size || 0,
        tablePaired: tableMeta?.name || null,
        tableReferenceUsed: tableRef,
        tablePickedFilename: tableBase64 ? (tableRef?.split('/').pop() || null) : null,
        tableSelectionReason: tableMeta?.reason || null,
        tableSize,
        tableSkippedReason: (pairedTable && !tableBase64 && tableSize > 10 * 1024 * 1024)
          ? `Image too large (${(tableSize / 1024 / 1024).toFixed(1)}MB > 10MB)` : null,
        variantMention: variantMention?.message || null,
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

    return json({ error: `unknown mode: ${mode}` }, 400);
  } catch (e) {
    return json({ error: e.message, stage, stack: (e.stack || '').slice(0, 500) }, 500);
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
