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
const CACHE_KEY = 'https://internal.alma/manifest-series-v8';

// ─── Scene Library — 6 무드 + 공간 타입별 추가 scene ───
// 알로소 Pinterest 보드 + 매장 시공 레퍼런스 시각 언어 기반
const SCENE_LIBRARY = {
  // ── 거주 공간용 6 무드 ──
  minimal: "Sophisticated Korean modern minimalist apartment with high ceiling featuring subtle recessed cove lighting strip, large floor-to-ceiling windows with sheer linen curtains diffusing soft overcast natural daylight from outside, polished concrete or warm beige limestone floor section meeting a plush warm beige wool low-pile carpet, ONE single low minimalist white cube coffee table with a small ceramic mushroom-shaped table lamp and one round ceramic object on top, a small open hardcover art book casually placed on the carpet edge, single tall vertical thin black-framed art piece or sculptural lamp on white wall, dramatic tonal contrast between dark charcoal furniture and light warm architectural backdrop, atmosphere of quiet sophistication and lived-in editorial calm, very moody but bright",
  natural: "Sun-drenched living room with herringbone oak floor, warm cream walls, vintage wooden ladder draped with linen throw, large fiddle leaf fig in unglazed terracotta pot, mid-afternoon golden light through tall windows, small ceramic vessels on low wood console",
  luxe_dark: "Moody European loft with deep charcoal walls, dark walnut wide-plank floor, dramatic glass-block window admitting cool blue-hour light, single tall brass arc floor lamp, framed black-and-white photography, one warm focal spot illuminating the furniture",
  family: "Warm Korean modern family living room, wide oak floor with handwoven natural fiber rug, soft late-afternoon sun, low pale-wood coffee table with stacked art books and ceramic tea cups, layered cushions and chunky knit throw casually placed, single trailing pothos plant, hanji paper lamp casting warm light",
  scandi: "Copenhagen apartment with white-washed wide plank floor, warm white painted walls, sheer linen curtains diffusing soft overcast Nordic daylight, single mid-century Danish three-legged wooden stool, tall ceramic floor vase holding a dried pampas branch, monochrome line-drawing art print leaning against wall",
  classic: "Italian Liberty-era apartment with herringbone parquet floor and one section painted in deep terracotta orange, white walls with subtle crown molding, full-height grid windows, vintage Italian glass coffee table on chrome legs, warm golden hour light from west-facing windows, oversized abstract art print leaning against wall, single sculptural ceramic object",

  // ── 상업·호스피탈리티 공간 (B2B context) ──
  hotel_lounge: "luxurious double-height hotel lobby lounge with ceiling clearly visible at 4+ meters, floor-to-ceiling glass curtain walls revealing sophisticated city skyline through reflective tower facades, polished Carrara marble floor with subtle elevated marble platform sections, geometric color-blocked carpet rug in muted earth tones (terracotta, cream, charcoal-brown), single sculptural wooden art installation as focal point, sophisticated mix of marble + dark walnut paneling + cream and tan leather upholstery, Aalto-style designer floor lamp with white perforated shade, ambient indirect lighting from architectural coves, late-afternoon natural daylight streaming through the glass walls, professional yet warm five-star hospitality atmosphere — feels expansive, never cramped",
  cafe: "modern Korean specialty cafe interior with high ceilings (3.5+ meters), warm wide-plank oak floors, large floor-to-ceiling windows admitting natural daylight, exposed concrete ceiling, mix of lounge seating and bar counter visible, ceramic pottery accents on shelves, single statement pendant light suspended from ceiling, contemporary minimalist hospitality styling",
  office_lounge: "executive office reception lounge with double-height ceiling (4+ meters), full-height glass partitions, polished concrete floor with geometric area rug, abstract art piece on feature wall, large window with cityscape view, professional yet warm corporate atmosphere, custom millwork wood paneling, ambient cove lighting, contemporary elegance",
  gallery: "contemporary white-box gallery space with high white walls, polished concrete floor, dramatic 4-meter ceiling with track lighting, large abstract canvas on feature wall, minimalist furniture arrangement positioned almost as if part of an art installation, soft north-facing daylight, sculptural curated atmosphere",

  // ── 영구 무드보드 큐레이션 (반영구, R2 저장용 — Wallpaper/Cabana 매거진 톤) ──
  natural_wood: "Editorial mid-century modern interior moodboard composition. Setting: a sophisticated curated interior space with dominant warm cherry mahogany wood vertical wall paneling on multiple walls — rich tonal warmth as the hero material. Accent feature wall of pastel sea-green frosted glass block partition (signature visual element, soft translucent green). Polished dark slate or warm travertine tile floor with subtle grid pattern. Lighting: warm late-afternoon natural sunlight streaming in at low golden angle through wood-frame grid window, complemented by ONE statement mid-century mushroom-shaped white pendant or table lamp (Aldo van Den Nieuwelaar Lampada 250 style) and warm globe-shaped wall sconces casting soft pools of light. Objet styling: a small white marble bust or curved bentwood sculpture on a low wood console, single green plant in dark ceramic vase. Color palette: terracotta, ochre, deep cherry brown, warm cream, sea-green accent. Composition: editorial magazine photography quality (Wallpaper, Cabana, Vogue Living, Apartamento), sophisticated tonal warmth, intentional curated negative space, art-directed Pinterest moodboard aesthetic with mid-century modern objects placed deliberately around the alloso furniture as the heroes. The alloso pieces are the focal point, not lost in the styling.",

  // ── 폴백 (무드 미지정 시 공간 크기로 분기) ──
  _wide: "spacious editorial Korean apartment, white walls, wide pale oak plank floor, full-height grid windows admitting soft natural daylight, ceramic objects, single statement plant in terracotta pot, generous negative space, magazine-quality composition",
  _narrow: "intimate Korean modern living room, wide oak plank floor, white walls with subtle warmth, soft natural daylight from side window, ceramic vase with a few stems, art book stack on floor, refined editorial styling",
};

// ──── PHOTOREAL DIRECTIVE — Gemini 출력을 CGI/렌더 → 실사 매거진 사진 톤으로 강제 ────
// 모든 BUNDLE/IMAGINE 프롬프트에 일관 적용
const PHOTOREAL_DIRECTIVE = [
  '═══ PHOTOGRAPHIC STYLE (CRITICAL) ═══',
  'This must look like a REAL photograph, NOT a 3D render, NOT CGI, NOT AI art.',
  'Captured on Hasselblad H6D medium format camera with 80mm lens. Natural daylight photography only — no studio lighting setup.',
  'Editorial photography aesthetic of Apartamento, Cereal, Kinfolk, Cabana, or Vogue Living magazines — Korean lifestyle shoot.',
  'Subtle Portra 400 / Ektar 100 film stock characteristics: gentle film grain texture, slightly desaturated muted earthy tones, film-like color depth with warm shadow rendition.',
  'Shallow depth of field with creamy bokeh on background elements, sharp focus on hero furniture and foreground objects.',
  'LIVED-IN STYLING (essential for realism): a single casually placed magazine or open hardcover book on the table or floor, ONE slightly creased throw pillow showing use, ONE ceramic or sculptural object with visible artisan imperfection, soft asymmetry in object placement, NOT perfectly staged or showroom-polished.',
  'IMPERFECT NATURAL LIGHTING: window light with gentle directional falloff, soft warm shadows in corners, light pools and dim areas — never flat or evenly studio-lit. Visible light gradient across the floor.',
  'REAL-WORLD DETAILS: faint dust motes catching in light beam, gentle natural wear on materials, organic textile creases, possibly a single trailing plant tendril or stem, slight floor reflections.',
  'COLOR GRADE: muted earthy palette, slight film-like desaturation, warm shadow tones, NOT oversaturated. Photographic color rendition, not digital pop.',
  'STRICTLY AVOID: 3D-rendered appearance, perfect CGI cleanliness, symmetric staging, oversaturated colors, plastic-looking surfaces, illustrative quality, AI-art smoothness, evenly lit showroom flat look.',
  'AIM FOR: a believable lifestyle magazine photograph that could be from a real Korean apartment editorial shoot — quietly sophisticated, intentionally imperfect, atmospheric, slightly moody.',
].join(' ');

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
  // R2 파일명은 필드 구분이 _, 사이즈 내부는 공백 가능. 일관 비교 위해 _를 공백으로 정규화
  const normName = name.replace(/_/g, ' ');
  if (normName.includes(preferredAngle)) score += 50;
  else if (normName.includes('측면')) score += 30;
  else if (normName.includes('정면')) score += 20;
  else if (normName.includes('부감')) score += 10;
  if (preferredColor && normName.includes(preferredColor)) score += 100;
  if (preferredSize) {
    // 사이즈는 토큰 분리해서 모든 토큰이 파일명에 있어야 매칭 인정
    const tokens = preferredSize.split(/\s+/).filter(Boolean);
    if (tokens.length > 0 && tokens.every(t => normName.includes(t))) score += 80;
  }
  if (preferredMaterial && normName.includes(preferredMaterial)) score += 40;
  return score;
}

function resolveSize(requestedSize, seriesInfo) {
  if (!requestedSize) return seriesInfo?.default_size || null;
  // 1) 정확 매치
  if (seriesInfo?.available_sizes?.includes(requestedSize)) return requestedSize;
  // 2) alias 매치
  const aliases = seriesInfo?.size_aliases || {};
  if (aliases[requestedSize]) return aliases[requestedSize];
  // 3) 부분 매치 (포함관계)
  const sizes = seriesInfo?.available_sizes || [];
  for (const s of sizes) {
    if (requestedSize.includes(s) || s.includes(requestedSize)) return s;
  }
  // 4) 폴백
  return requestedSize;
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

    // ── SWAP_MATERIAL MODE ─────────────────────────────────────────
    // 매장 영업 도구: 업로드된 사진의 가구 소재·컬러를 자연어 지시대로 변환
    if (mode === 'swap_material') {
      stage = 'swap_validate';
      const sourceImage = body.sourceImage;
      const instruction = (body.instruction || '').trim();
      if (!sourceImage) return json({ error: 'sourceImage (base64 data URL) required' }, 400);
      if (!instruction) return json({ error: 'instruction (변환 목표) required' }, 400);

      // data URL prefix 제거
      const base64 = sourceImage.replace(/^data:image\/[a-z0-9+]+;base64,/i, '');
      if (base64.length > 14 * 1024 * 1024) {
        return json({ error: '이미지가 너무 큽니다 (10MB 이하 권장)' }, 400);
      }

      // 알로소 컬러·소재 키워드 정규화 (manifest.colors의 desc_en을 단일 소스로 사용)
      stage = 'swap_enrich';
      let enrichment = '';
      const matchedColors = [];

      // manifest.colors 에서 lookup 빌드 — 키, EN, 모든 synonyms를 normalized form으로 매핑
      const colorLookup = {}; // normalizedKey → {originalKo, desc_en, en}
      const normalize = (s) => (s || '').toLowerCase().replace(/[\s\-_]/g, '');
      for (const [colorKo, colorData] of Object.entries(manifest.colors || {})) {
        if (!colorData || typeof colorData !== 'object') continue;
        const desc = colorData.desc_en;
        if (!desc) continue;
        const en = colorData.en || '';
        // 메인 키
        colorLookup[normalize(colorKo)] = { originalKo: colorKo, desc_en: desc, en };
        // 영문명
        if (en) colorLookup[normalize(en)] = { originalKo: colorKo, desc_en: desc, en };
        // synonyms
        for (const syn of (colorData.synonyms || [])) {
          colorLookup[normalize(syn)] = { originalKo: colorKo, desc_en: desc, en };
        }
      }

      // instruction을 normalized form으로도 분석 (스페이스/하이픈 무시 매칭)
      const normInstruction = normalize(instruction);
      // 컬러 키를 길이 내림차순으로 정렬 후 매칭 (긴 키 우선 — "카도 마리노"가 "마리"보다 먼저)
      const sortedKeys = Object.keys(colorLookup).sort((a, b) => b.length - a.length);
      const seen = new Set();
      for (const normKey of sortedKeys) {
        if (normKey.length < 2) continue;
        if (normInstruction.includes(normKey)) {
          const entry = colorLookup[normKey];
          if (seen.has(entry.originalKo)) continue;
          seen.add(entry.originalKo);
          enrichment += ` (${entry.originalKo} / ${entry.en} = ${entry.desc_en})`;
          matchedColors.push(entry.originalKo);
        }
      }

      // 소재 키워드 (manifest articles 활용 + 일반 키워드)
      const matHints = {
        '부클레': 'boucle weave fabric with textured nubby looped surface',
        '가죽': 'smooth leather upholstery with subtle natural grain',
        '레더': 'smooth leather upholstery with subtle natural grain',
        '패브릭': 'woven fabric upholstery',
        '아크레': 'fine premium fabric with smooth weave (Alloso ACRE article)',
        '단테': 'rich hi-end leather (Alloso DANTE article)',
        '베지탄': 'natural vegetable-tanned leather with rich character (Alloso VEGETAN article)',
        '드리밍 헤비': 'premium full-grain leather with heavy hand (Alloso DREAMING HEAVY article)',
        '노르딕': 'Aquaclean waterproof easy-care fabric (Alloso NORDIC article)',
      };
      for (const [k, v] of Object.entries(matHints)) {
        if (instruction.includes(k)) enrichment += ` (${k} = ${v})`;
      }

      // ── 시리즈 매칭 (시리즈 swap 분기) ──
      stage = 'swap_series_detect';
      let targetSeries = null;
      let targetSeriesFolder = null;
      let targetSeriesData = null;
      const seriesEntries = Object.entries(manifest.series || {});
      // 긴 시리즈명 우선 매칭 ("사티 큐브 스위블" 먼저, "사티" 나중)
      seriesEntries.sort((a, b) => b[0].length - a[0].length);
      for (const [seriesKo, seriesData] of seriesEntries) {
        if (!seriesData || typeof seriesData !== 'object') continue;
        // 다양한 표기 가능: 공백 유무 / 영문명
        const cands = [seriesKo, seriesKo.replace(/\s/g, ''), seriesData.en || ''];
        for (const cand of cands) {
          if (cand && cand.length >= 2 && instruction.includes(cand)) {
            targetSeries = seriesKo;
            targetSeriesFolder = seriesData.folder;
            targetSeriesData = seriesData;
            break;
          }
        }
        if (targetSeries) break;
      }

      // ── 사이즈 추출 (instruction에서) ──
      // available_sizes + size_aliases 키를 길이 내림차순으로 매칭 (와이드 코너가 코너보다 먼저)
      let targetSize = null;
      if (targetSeriesData) {
        const sizePool = [];
        for (const s of (targetSeriesData.available_sizes || [])) sizePool.push({ key: s, val: s });
        for (const [alias, real] of Object.entries(targetSeriesData.size_aliases || {})) {
          sizePool.push({ key: alias, val: real });
        }
        sizePool.sort((a, b) => b.key.length - a.key.length);
        for (const { key, val } of sizePool) {
          if (key.length >= 2 && instruction.includes(key)) {
            targetSize = val;
            break;
          }
        }
        // 사이즈 못 찾으면 default_size 폴백
        if (!targetSize && targetSeriesData.default_size) targetSize = targetSeriesData.default_size;
      }

      // === 시리즈 swap 분기: 사용자 사진 + 타겟 시리즈 누끼를 Gemini로 합성 ===
      if (targetSeries && targetSeriesFolder && env.PRODUCTS) {
        stage = 'swap_series_fetch';
        const refColor = matchedColors[0] || null; // 새 컬러 명시 있으면 우선, 없으면 default
        const seriesPick = await findBestReference(env, targetSeriesFolder, {
          preferredColor: refColor,
          preferredAngle: '측면',
          preferredSize: targetSize,
          preferredMaterial: targetSeriesData?.default_material || null,
        });

        if (!seriesPick) {
          return json({
            error: `타겟 시리즈 "${targetSeries}" 폴더에서 누끼를 찾을 수 없어요`,
            folder: `products/${targetSeriesFolder}/`,
            stage,
          }, 404);
        }

        stage = 'swap_series_b64';
        const seriesBase64 = await fetchR2AsBase64(env, seriesPick.key);
        if (!seriesBase64) {
          return json({ error: 'R2 fetch 실패', key: seriesPick.key, stage }, 500);
        }

        // 컬러 명시 유무에 따라 prompt 분기
        const colorClause = matchedColors.length > 0
          ? `Change BOTH the furniture shape (to match IMAGE 2's ${targetSeries}) AND the upholstery color (to: ${matchedColors.join(', ')}${enrichment}). CRITICAL: respect the exact tone described — if the color is described as soft, muted, light, cream, pastel, or milk-tea, the result must stay in that range; do not darken or oversaturate.`
          : `Keep the EXACT original color/material of the existing furniture in IMAGE 1 (do not change the color). Only change the furniture SHAPE/STYLE to match IMAGE 2's ${targetSeries}.`;

        stage = 'swap_series_gemini';
        const sizeClause = targetSize
          ? ` (specifically the "${targetSize}" configuration/variant — match the exact module count, seat count, and form factor of IMAGE 2)`
          : '';
        const seriesSwapPrompt = [
          `═══ PRODUCT REPLACEMENT TASK — Alloso furniture swap ═══`,
          `IMAGE 1 = source photograph showing existing furniture in a room context.`,
          `IMAGE 2 = reference cutout of Alloso ${targetSeries}${sizeClause} (the target product to place into the room).`,
          `Task: COMPLETELY REPLACE the main upholstered furniture in IMAGE 1 with the Alloso ${targetSeries} shown in IMAGE 2. The original furniture must DISAPPEAR — do not keep it, do not blend it. The new furniture's silhouette, structure, module arrangement, and overall form MUST be derived from IMAGE 2, not IMAGE 1.`,
          ``,
          `MUST PRESERVE from IMAGE 1 (do not change):`,
          `- The room, walls, floor, lighting, all surrounding objects (lamps, tables, plants, decor).`,
          `- The camera angle, perspective, framing, crop, resolution.`,
          `- The natural light direction, intensity, color temperature, shadows on surrounding elements.`,
          `- The general placement zone and approximate scale where the furniture sits.`,
          ``,
          `MUST CHANGE: the furniture itself — replace it with the EXACT silhouette, shape, proportions, module count, cushion arrangement, armrest design, and leg/base structure of IMAGE 2's ${targetSeries}. If IMAGE 2 is a corner sofa, the result MUST be a corner sofa. If IMAGE 2 is a 4-seater lounge, the result MUST have that exact configuration. Do not retain ANY structural element from the original furniture in IMAGE 1.`,
          ``,
          `COLOR HANDLING: ${colorClause}.`,
          ``,
          `The new furniture must look like it actually exists in IMAGE 1's room — match the perspective, scale, and lighting of that room. The replacement should look natural and photorealistic, as if the Alloso ${targetSeries} was originally photographed in that exact room.`,
          ``,
          PHOTOREAL_DIRECTIVE,
          ``,
          `Output: a single photorealistic image showing the Alloso ${targetSeries} placed naturally in IMAGE 1's room context.`,
        ].filter(Boolean).join(' ');

        let resultBase64;
        try {
          resultBase64 = await callGemini(env, [base64, seriesBase64], seriesSwapPrompt);
          if (!resultBase64) throw new Error('Gemini returned no image data');
        } catch (e) {
          return json({ error: 'Series swap failed', detail: e.message, stage }, 500);
        }

        return json({
          mode: 'swap_series',
          target_series: targetSeries,
          target_size: targetSize,
          target_color: matchedColors.length > 0 ? matchedColors : 'preserved from IMAGE 1',
          ref_used: seriesPick.key,
          ref_filename: seriesPick.name,
          provider: 'gemini',
          image: `data:image/png;base64,${resultBase64}`,
        });
      }

      // ── 컬러 칩 이미지 자동 fetch (R2 binding 직접 호출 — 외부 URL fetch 보다 안정적) ──
      stage = 'swap_chip_fetch';
      let chipBase64 = null;
      let chipMeta = null;
      let chipAttemptedKey = null;
      let chipFetchError = null;
      const matchedColorKo = matchedColors[0];
      if (matchedColorKo && manifest.colors?.[matchedColorKo]?.code) {
        const code = manifest.colors[matchedColorKo].code;
        const article = manifest.colors[matchedColorKo].article || '';
        chipAttemptedKey = `textures/alloso-textures-512/${code}.jpg`;
        if (env.PRODUCTS) {
          try {
            chipBase64 = await fetchR2AsBase64(env, chipAttemptedKey);
            if (chipBase64) {
              chipMeta = { code, article, colorKo: matchedColorKo, key: chipAttemptedKey };
            } else {
              chipFetchError = `R2 키 없음: ${chipAttemptedKey}`;
            }
          } catch (e) {
            chipFetchError = `R2 에러: ${e.message.slice(0, 80)}`;
          }
        } else {
          chipFetchError = 'PRODUCTS binding 미설정';
        }
      } else if (matchedColorKo) {
        chipFetchError = `${matchedColorKo}에 code 없음 (manifest 갱신 필요)`;
      } else {
        chipFetchError = '컬러 매칭 안 됨';
      }

      stage = 'swap_gemini';
      // 칩 이미지 유무에 따라 프롬프트 분기
      const refImages = chipBase64 ? [base64, chipBase64] : [base64];
      const chipReference = chipBase64
        ? `IMAGE 2 (color reference swatch): This is the exact Alloso "${chipMeta.colorKo}" color swatch (${chipMeta.article} article, ERP code ${chipMeta.code}). The upholstery in IMAGE 1 must be recolored to match this swatch's color, tone, and material texture EXACTLY.`
        : '';

      const swapPrompt = [
        `═══ PHOTO RETOUCH TASK — NOT a furniture regeneration ═══`,
        chipBase64
          ? `You are performing a precise material/color recolor edit. IMAGE 1 is the source photograph. IMAGE 2 is the exact color swatch to match.`
          : `You are performing a precise color/material recolor edit on this photograph.`,
        `User's instruction: "${instruction}"${enrichment}`,
        chipReference,
        `THIS IS A SURFACE RECOLOR ONLY. Treat this as Photoshop "Replace Color" on the upholstery surface — the underlying furniture geometry must remain pixel-identical to IMAGE 1.`,
        `MUST REMAIN ABSOLUTELY IDENTICAL TO IMAGE 1 (do NOT change these even by 1 pixel):`,
        `1. The EXACT furniture silhouette, shape, geometry, dimensions, proportions, contours.`,
        `2. The EXACT number of cushions, their individual shape, their position, their arrangement, their creases and folds.`,
        `3. The EXACT armrest design, leg/base design, frame structure, stitching pattern.`,
        `4. The EXACT camera angle, perspective, framing, crop, focal length.`,
        `5. The EXACT lighting direction, intensity, color temperature, shadows, highlights, and reflections.`,
        `6. The EXACT background, walls, floor, side tables, lamps, decorative objects, plants — every other element must be untouched.`,
        `7. The EXACT image resolution and photographic quality of the original.`,
        `ONLY CHANGE: the surface color and/or material texture of the main upholstered fabric/leather areas of the furniture in IMAGE 1.`,
        chipBase64
          ? `Match IMAGE 2's color and material texture EXACTLY. Sample the swatch carefully — match its hue, saturation, value, warmth, and surface texture precisely. Do not approximate. CRITICAL: Do NOT darken, intensify, or oversaturate the swatch color. If the swatch shows a soft, muted, light, or pastel tone, the result must remain soft, muted, light, or pastel — do not push toward deep/saturated/dark variants. Color values (hue, saturation, lightness) must be sampled directly from the swatch pixels, not estimated from the color name.`
          : `Target appearance for the upholstery: ${instruction}${enrichment ? ' — refer to the color enrichment notes above for accuracy' : ''}. Match the specified Alloso color STRICTLY.`,
        `Adjust shadow tones subtly to match the new material's reflectivity, but do not change shadow shape or position.`,
        `Output a single photorealistic image that looks like a Photoshop color-replace edit of IMAGE 1 — same room, same furniture geometry, same lighting, only the upholstery surface re-colored to match the target.`,
      ].filter(Boolean).join(' ');

      let resultBase64;
      try {
        resultBase64 = await callGemini(env, refImages, swapPrompt);
        if (!resultBase64) throw new Error('Gemini returned no image data');
      } catch (e) {
        return json({ error: 'Material swap failed', detail: e.message, stage }, 500);
      }

      return json({
        mode: 'swap_material',
        target: instruction,
        enrichment: enrichment.trim() || null,
        chip: chipMeta,                  // 칩 fetch 성공 시 메타
        chip_attempted_key: chipAttemptedKey,   // 시도한 R2 키
        chip_fetched: !!chipBase64,             // 성공 여부 (true/false)
        chip_error: chipFetchError,             // 실패 사유 (있으면)
        matched_colors: matchedColors,          // instruction에서 매칭된 컬러
        provider: 'gemini',
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

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
        // 사이즈 alias 자동 해석 (예: "코너 라운지" → "와이드 코너")
        const resolvedSize = resolveSize(item.size, itemResolved.info);
        const sizeSubstituted = item.size && resolvedSize !== item.size;

        const pick = await findBestReference(env, itemResolved.folder, {
          preferredColor: item.color || itemResolved.info?.default_color,
          preferredAngle: '측면',
          preferredMaterial: item.material || itemResolved.info?.default_material,
          preferredSize: resolvedSize,
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
        const sizeObj = obj.size || 0;
        if (sizeObj > 10 * 1024 * 1024) {
          warnings.push(`${item.series}: 이미지 너무 큼 (${(sizeObj / 1024 / 1024).toFixed(1)}MB)`);
          continue;
        }
        const buf = await obj.arrayBuffer();
        const base64 = bytesToBase64(new Uint8Array(buf));
        refs.push({
          base64,
          seriesKo: itemResolved.info.ko,
          seriesEn: itemResolved.info.en,
          colorKo: item.color || itemResolved.info?.default_color || '',
          sizeKo: resolvedSize || '',
          requestedSizeKo: item.size || '',
          sizeSubstituted,
          materialKo: item.material || itemResolved.info?.default_material || '',
          category: itemResolved.info?.category || 'sofa',
          features: itemResolved.info?.features || [],
          code: itemResolved.info?.code || '',
          categoryNo: itemResolved.info?.category_no || null,
          filename: pick.name,
          thumbnailUrl: keyToPublicUrl(manifest, pick.key),
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

      // 카테고리별 영문 용어 (사이즈 인지 — 1인/단일 변형은 armchair로 처리)
      const termFor = (cat, size) => {
        // 사이즈가 단일 좌석을 명시하면 sofa로 보내지 않고 armchair
        if (size) {
          if (size === '1인' || size === '단일' || size === '하이백 1인') return 'single armchair (a one-seater lounge chair, NOT a multi-seat sofa)';
          if (size === '1인 와이드' || size === '1인 라운지') return 'wide single armchair (one-seater)';
        }
        switch (cat) {
          case 'lounge_chair': return 'lounge chair (one-seater)';
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
        return `(reference image ${i + 1}) the alloso ${r.seriesKo} ${sizeText}${termFor(r.category, r.sizeKo)} in ${r.colorKo} color`;
      }).join('; ');

      // 배치 가이드 — 1인 변형은 라운지 체어 역할로
      const singleSeats = refs.filter(r => r.sizeKo && ['1인', '단일', '하이백 1인', '1인 와이드', '1인 라운지'].includes(r.sizeKo));
      const mainSofas = sofas.filter(r => !singleSeats.includes(r));
      const placement = [];
      if (mainSofas.length) placement.push(`anchor the largest multi-seat sofa as the primary visual element at the center or rear of the space`);
      if (chairs.length) placement.push(`angle the lounge chair as an accent piece at one side, facing the main sofa`);
      if (singleSeats.length) placement.push(`place the single armchair (one-seater, NOT a sofa) as an accent piece adjacent to the main sofa — keep it visually distinct as a one-seater chair`);
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
        PHOTOREAL_DIRECTIVE,
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
        items: refs.map(r => {
          // 카테고리별 이미지 내 대략적 좌표 (호버 마커 표시용)
          const placement = (function(cat, idx, total){
            // 카테고리별 기본 좌표 (이미지 내 백분율)
            const presets = {
              sofa: { x: 42, y: 58 },
              lounge_chair: { x: 76, y: 62 },
              chair: { x: 76, y: 62 },
              pouf: { x: 62, y: 82 },
              stool: { x: 62, y: 82 },
              table: { x: 48, y: 72 },
              daybed: { x: 28, y: 55 },
            };
            const base = presets[cat] || { x: 50 + (idx-total/2)*15, y: 65 };
            return { x: base.x + '%', y: base.y + '%' };
          })(r.category, refs.indexOf(r), refs.length);
          return {
            series: r.seriesKo,
            seriesEn: r.seriesEn,
            color: r.colorKo,
            size: r.sizeKo,
            requestedSize: r.requestedSizeKo,
            sizeSubstituted: r.sizeSubstituted || false,
            material: r.materialKo,
            category: r.category,
            features: r.features.slice(0, 2),
            code: r.code,
            filename: r.filename,
            thumbnailUrl: r.thumbnailUrl,
            // 알로소 정식 컬렉션 상세 페이지 URL — manifest의 category_no 사용
            productPageUrl: r.categoryNo
              ? `https://www.alloso.co.kr/collection/detail?categoryNo=${r.categoryNo}`
              : `https://www.alloso.co.kr/collection/list`,
            placement,
          };
        }),
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
      const tableSeriesInput = body.tableSeries || null; // 사용자 명시 테이블 시리즈

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

      // 2. 테이블 페어링 — tableSeries 명시되면 그쪽 우선, 없으면 default paired_table
      stage = 'select_table';
      let pairedTable = null;
      let tableMeta = null;
      let tableSeriesResolved = null;
      if (includeTable) {
        if (tableSeriesInput) {
          // 사용자가 테이블 시리즈를 명시한 경우
          tableSeriesResolved = resolveSeries(tableSeriesInput, manifest);
          if (tableSeriesResolved && !tableSeriesResolved.is_brand_group && tableSeriesResolved.category !== 'discontinued') {
            pairedTable = tableSeriesResolved.info;
            tableMeta = {
              table: pairedTable,
              name: tableSeriesResolved.resolved,
              reason: 'user_specified',
              placement: 'beside the sofa as a complementary set',
            };
          }
        }
        // 폴백: default paired_table
        if (!pairedTable) {
          tableMeta = selectPairedTable(manifest, resolved, spaceSize);
          if (tableMeta) pairedTable = tableMeta.table;
        }
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
        PHOTOREAL_DIRECTIVE,
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
        tableSeriesInput: tableSeriesInput,
        tableSeriesResolved: tableSeriesResolved?.resolved || null,
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
