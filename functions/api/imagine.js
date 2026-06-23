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

const SCENE_LIBRARY = {
  minimal: "Sophisticated Korean modern minimalist apartment with high ceiling featuring subtle recessed cove lighting strip, large floor-to-ceiling windows with sheer linen curtains diffusing soft overcast natural daylight from outside, polished concrete or warm beige limestone floor section meeting a plush warm beige wool low-pile carpet, ONE single low minimalist white cube coffee table with a small ceramic mushroom-shaped table lamp and one round ceramic object on top, a small open hardcover art book casually placed on the carpet edge, single tall vertical thin black-framed art piece or sculptural lamp on white wall, dramatic tonal contrast between dark charcoal furniture and light warm architectural backdrop, atmosphere of quiet sophistication and lived-in editorial calm, very moody but bright",
  natural: "Sun-drenched living room with herringbone oak floor, warm cream walls, vintage wooden ladder draped with linen throw, large fiddle leaf fig in unglazed terracotta pot, mid-afternoon golden light through tall windows, small ceramic vessels on low wood console",
  luxe_dark: "Moody European loft with deep charcoal walls, dark walnut wide-plank floor, dramatic glass-block window admitting cool blue-hour light, single tall brass arc floor lamp, framed black-and-white photography, one warm focal spot illuminating the furniture",
  family: "Warm Korean modern family living room, wide oak floor with handwoven natural fiber rug, soft late-afternoon sun, low pale-wood coffee table with stacked art books and ceramic tea cups, layered cushions and chunky knit throw casually placed, single trailing pothos plant, hanji paper lamp casting warm light",
  scandi: "Copenhagen apartment with white-washed wide plank floor, warm white painted walls, sheer linen curtains diffusing soft overcast Nordic daylight, single mid-century Danish three-legged wooden stool, tall ceramic floor vase holding a dried pampas branch, monochrome line-drawing art print leaning against wall",
  classic: "Italian Liberty-era apartment with herringbone parquet floor and one section painted in deep terracotta orange, white walls with subtle crown molding, full-height grid windows, vintage Italian glass coffee table on chrome legs, warm golden hour light from west-facing windows, oversized abstract art print leaning against wall, single sculptural ceramic object",
  hotel_lounge: "luxurious double-height hotel lobby lounge with ceiling clearly visible at 4+ meters, floor-to-ceiling glass curtain walls revealing sophisticated city skyline through reflective tower facades, polished Carrara marble floor with subtle elevated marble platform sections, geometric color-blocked carpet rug in muted earth tones (terracotta, cream, charcoal-brown), single sculptural wooden art installation as focal point, sophisticated mix of marble + dark walnut paneling + cream and tan leather upholstery, Aalto-style designer floor lamp with white perforated shade, ambient indirect lighting from architectural coves, late-afternoon natural daylight streaming through the glass walls, professional yet warm five-star hospitality atmosphere — feels expansive, never cramped",
  cafe: "modern Korean specialty cafe interior with high ceilings (3.5+ meters), warm wide-plank oak floors, large floor-to-ceiling windows admitting natural daylight, exposed concrete ceiling, mix of lounge seating and bar counter visible, ceramic pottery accents on shelves, single statement pendant light suspended from ceiling, contemporary minimalist hospitality styling",
  office_lounge: "executive office reception lounge with double-height ceiling (4+ meters), full-height glass partitions, polished concrete floor with geometric area rug, abstract art piece on feature wall, large window with cityscape view, professional yet warm corporate atmosphere, custom millwork wood paneling, ambient cove lighting, contemporary elegance",
  gallery: "contemporary white-box gallery space with high white walls, polished concrete floor, dramatic 4-meter ceiling with track lighting, large abstract canvas on feature wall, minimalist furniture arrangement positioned almost as if part of an art installation, soft north-facing daylight, sculptural curated atmosphere",
  natural_wood: "Editorial mid-century modern interior moodboard composition. Setting: a sophisticated curated interior space with dominant warm cherry mahogany wood vertical wall paneling on multiple walls — rich tonal warmth as the hero material. Accent feature wall of pastel sea-green frosted glass block partition (signature visual element, soft translucent green). Polished dark slate or warm travertine tile floor with subtle grid pattern. Lighting: warm late-afternoon natural sunlight streaming in at low golden angle through wood-frame grid window, complemented by ONE statement mid-century mushroom-shaped white pendant or table lamp (Aldo van Den Nieuwelaar Lampada 250 style) and warm globe-shaped wall sconces casting soft pools of light. Objet styling: a small white marble bust or curved bentwood sculpture on a low wood console, single green plant in dark ceramic vase. Color palette: terracotta, ochre, deep cherry brown, warm cream, sea-green accent. Composition: editorial magazine photography quality (Wallpaper, Cabana, Vogue Living, Apartamento), sophisticated tonal warmth, intentional curated negative space, art-directed Pinterest moodboard aesthetic with mid-century modern objects placed deliberately around the alloso furniture as the heroes. The alloso pieces are the focal point, not lost in the styling.",
  _wide: "spacious editorial Korean apartment, white walls, wide pale oak plank floor, full-height grid windows admitting soft natural daylight, ceramic objects, single statement plant in terracotta pot, generous negative space, magazine-quality composition",
  _narrow: "intimate Korean modern living room, wide oak plank floor, white walls with subtle warmth, soft natural daylight from side window, ceramic vase with a few stems, art book stack on floor, refined editorial styling",
};

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
      return { resolved: name, category: 'discontinued', message: `${name}은 단종된 제품입니다. 다른 시리즈를 추천드릴 수 있어요.` };
    }
  }
  for (const [name, info] of Object.entries(series)) {
    if (name.startsWith('_')) continue;
    const candidates = [name, info.ko, info.en, ...(info.synonyms || [])].filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return { resolved: name, info, category: info.category, parent: info.parent || null, variants: info.variants || [], folder: info.folder };
    }
  }
  for (const [name, info] of Object.entries(series)) {
    if (!info.is_brand_group) continue;
    const candidates = [info.ko, info.en, ...(info.synonyms || [])].filter(Boolean).map(normalize);
    if (candidates.includes(norm)) {
      return { resolved: info.ko, is_brand_group: true, members: info.members, message: `${info.ko}은 ${info.members.join(' / ')} 두 종류가 있어요. 어느 쪽으로 보여드릴까요?` };
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
    return { resolved: input, discontinued: true, message: `${input}은 단종된 컬러예요. 비슷한 톤의 다른 컬러를 안내드릴 수 있어요.` };
  }
  for (const [name, info] of Object.entries(colors)) {
    const candidates = [name, info.en, ...(info.synonyms || [])].filter(Boolean).map(normalize);
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
  return { variants: existing, message: `${seriesName}를 보여드릴게요. ${existing.join(', ')}도 있어요.` };
}

async function listFolder(env, folder) {
  if (!env.PRODUCTS) return [];
  const prefix = `products/${folder}/`;
  const allObjects = [];
  let cursor = undefined;
  let safety = 0;
  while (safety < 10) {
    const opts = { prefix, limit: 1000 };
    if (cursor) opts.cursor = cursor;
    const result = await env.PRODUCTS.list(opts);
    if (result.objects) allObjects.push(...result.objects);
    if (result.truncated && result.cursor) { cursor = result.cursor; safety++; }
    else break;
  }
  return allObjects.filter(o => /\.(png|jpe?g|webp)$/i.test(o.key));
}

function scoreFile(name, { preferredColor, preferredAngle = '측면', preferredMaterial, preferredSize }) {
  let score = 0;
  const normName = name.replace(/_/g, ' ');
  if (normName.includes(preferredAngle)) score += 50;
  else if (normName.includes('측면')) score += 30;
  else if (normName.includes('정면')) score += 20;
  else if (normName.includes('부감')) score += 10;
  if (preferredColor && normName.includes(preferredColor)) score += 100;
  if (preferredSize) {
    const tokens = preferredSize.split(/\s+/).filter(Boolean);
    if (tokens.length > 0 && tokens.every(t => normName.includes(t))) {
      score += 200;
    } else {
      const otherSizes = ['1인', '2인', '2.5인', '3인', '3.5인', '4인', '5인', '6인'];
      const requestedSeats = preferredSize.match(/(\d+(?:\.\d+)?)인/)?.[0];
      for (const o of otherSizes) {
        if (o !== requestedSeats && normName.includes(o)) { score -= 150; break; }
      }
    }
  }
  if (preferredMaterial && normName.includes(preferredMaterial)) score += 40;
  return score;
}

function resolveSize(requestedSize, seriesInfo) {
  if (!requestedSize) return seriesInfo?.default_size || null;
  if (seriesInfo?.available_sizes?.includes(requestedSize)) return requestedSize;
  const aliases = seriesInfo?.size_aliases || {};
  if (aliases[requestedSize]) return aliases[requestedSize];
  const sizes = seriesInfo?.available_sizes || [];
  for (const s of sizes) {
    if (requestedSize.includes(s) || s.includes(requestedSize)) return s;
  }
  return requestedSize;
}

async function findBestReference(env, folder, opts = {}) {
  const files = await listFolder(env, folder);
  if (files.length === 0) return null;
  const scored = files.map(f => ({ key: f.key, name: f.key.split('/').pop(), size: f.size || 0, score: scoreFile(f.key, opts) }));
  scored.sort((a, b) => b.score - a.score);
  const sizeCounts = {};
  const matchingSize = [];
  if (opts.preferredSize) {
    const tokens = opts.preferredSize.split(/\s+/).filter(Boolean);
    for (const s of scored) {
      const norm = s.name.replace(/_/g, ' ');
      const sizeMatches = norm.match(/(\d+(?:\.\d+)?)인/g) || [];
      for (const sm of sizeMatches) sizeCounts[sm] = (sizeCounts[sm] || 0) + 1;
      if (tokens.every(t => norm.includes(t))) matchingSize.push({ name: s.name, score: s.score });
    }
  }
  scored[0]._debug = {
    total_files: files.length,
    top5: scored.slice(0, 5).map(s => ({ name: s.name, score: s.score })),
    size_counts: sizeCounts,
    matching_size_count: matchingSize.length,
    matching_size_sample: matchingSize.slice(0, 3),
    opts: { ...opts },
  };
  return scored[0];
}

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

// base64 데이터의 매직 바이트로 실제 이미지 포맷 감지
// JPEG(FF D8), PNG(89 50 4E 47), WebP(52 49 46 46 = RIFF)
function detectMimeFromBase64(b64) {
  try {
    const prefix = atob(b64.slice(0, 16));
    const c = (i) => prefix.charCodeAt(i);
    if (c(0) === 0xFF && c(1) === 0xD8) return 'image/jpeg';
    if (c(0) === 0x89 && c(1) === 0x50 && c(2) === 0x4E && c(3) === 0x47) return 'image/png';
    if (c(0) === 0x52 && c(1) === 0x49 && c(2) === 0x46 && c(3) === 0x46) return 'image/webp';
  } catch {}
  return 'image/jpeg';
}

async function callGemini(env, imageBase64s, prompt) {
  const apiKey = env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_API_KEY not set');

  // 환경변수 GEMINI_IMAGE_MODEL로 모델 교체 가능 (Cloudflare Pages 환경변수에서 설정)
  // gemini-2.5-flash-image       — 기존
  // gemini-2.5-flash-image-preview — 개선된 미리보기 버전 (기본값)
  // gemini-2.0-flash-exp-image-generation — 실험판
const model = env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-exp-image-generation';

  const parts = [];
  for (const b64 of imageBase64s.filter(Boolean)) {
    parts.push({ inline_data: { mime_type: detectMimeFromBase64(b64), data: b64 } });
  }
  parts.push({ text: prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini(${model}) ${res.status}: ${errText.slice(0, 200)}`);
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
    if (mode === 'swap_material') {
      stage = 'swap_validate';
      const sourceImage = body.sourceImage;
      const instruction = (body.instruction || '').trim();
      if (!sourceImage) return json({ error: 'sourceImage (base64 data URL) required' }, 400);
      if (!instruction) return json({ error: 'instruction (변환 목표) required' }, 400);

      const base64 = sourceImage.replace(/^data:image\/[a-z0-9+]+;base64,/i, '');
      if (base64.length > 14 * 1024 * 1024) {
        return json({ error: '이미지가 너무 큽니다 (10MB 이하 권장)' }, 400);
      }

      stage = 'swap_enrich';
      let enrichment = '';
      const matchedColors = [];
      const colorLookup = {};
      const normalize = (s) => (s || '').toLowerCase().replace(/[\s\-_]/g, '');
      for (const [colorKo, colorData] of Object.entries(manifest.colors || {})) {
        if (!colorData || typeof colorData !== 'object') continue;
        const desc = colorData.desc_en;
        if (!desc) continue;
        const en = colorData.en || '';
        colorLookup[normalize(colorKo)] = { originalKo: colorKo, desc_en: desc, en };
        if (en) colorLookup[normalize(en)] = { originalKo: colorKo, desc_en: desc, en };
        for (const syn of (colorData.synonyms || [])) {
          colorLookup[normalize(syn)] = { originalKo: colorKo, desc_en: desc, en };
        }
      }
      const normInstruction = normalize(instruction);
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

      stage = 'swap_series_detect';
      let targetSeries = null;
      let targetSeriesFolder = null;
      let targetSeriesData = null;
      const seriesEntries = Object.entries(manifest.series || {});
      seriesEntries.sort((a, b) => b[0].length - a[0].length);
      for (const [seriesKo, seriesData] of seriesEntries) {
        if (!seriesData || typeof seriesData !== 'object') continue;
        const cands = [seriesKo, seriesKo.replace(/\s/g, ''), seriesData.en || ''];
        for (const cand of cands) {
          if (cand && cand.length >= 2 && instruction.includes(cand)) {
            targetSeries = seriesKo; targetSeriesFolder = seriesData.folder; targetSeriesData = seriesData; break;
          }
        }
        if (targetSeries) break;
      }

      let targetSize = null;
      if (targetSeriesData) {
        const sizePool = [];
        for (const s of (targetSeriesData.available_sizes || [])) sizePool.push({ key: s, val: s });
        for (const [alias, real] of Object.entries(targetSeriesData.size_aliases || {})) sizePool.push({ key: alias, val: real });
        sizePool.sort((a, b) => b.key.length - a.key.length);
        for (const { key, val } of sizePool) {
          if (key.length >= 2 && instruction.includes(key)) { targetSize = val; break; }
        }
        if (!targetSize && targetSeriesData.default_size) targetSize = targetSeriesData.default_size;
      }

      const placementKeywords = {
        right: ['우측', '오른쪽', '오른편', '우편'],
        left: ['좌측', '왼쪽', '왼편', '좌편'],
        center: ['가운데', '중앙'],
        back: ['뒤쪽', '뒤편', '뒷벽', '뒷쪽'],
        front: ['앞쪽', '앞편', '앞에'],
        window: ['창가', '창문', '창쪽', '베란다'],
        wall: ['벽쪽', '벽면', '벽에', '벽 옆'],
        corner: ['모서리', '구석', '코너', 'L자'],
      };
      const matchedPlacements = [];
      for (const [type, words] of Object.entries(placementKeywords)) {
        for (const w of words) {
          if (instruction.includes(w)) { matchedPlacements.push({ type, word: w }); break; }
        }
      }
      const orientationHints = [];
      if (/등(판)?이?\s*(우측|오른쪽).*벽/.test(instruction) || /등.*우측벽/.test(instruction)) orientationHints.push('backrest against the right wall');
      if (/등(판)?이?\s*(좌측|왼쪽).*벽/.test(instruction) || /등.*좌측벽/.test(instruction)) orientationHints.push('backrest against the left wall');
      if (/등(판)?이?.*뒷벽/.test(instruction) || /등.*뒷벽/.test(instruction)) orientationHints.push('backrest against the back wall');
      if (/창(가|문|쪽).*향/.test(instruction)) orientationHints.push('facing the window');

      const placeVerbs = ['배치', '넣어', '놓아', '놓고', '두어', '두고', '두면', '놓으면', '넣으면'];
      const hasPlaceVerb = placeVerbs.some(v => instruction.includes(v));
      const usePlaceMode = matchedPlacements.length > 0 || orientationHints.length > 0 || (hasPlaceVerb && targetSeries);

      if (targetSeries && targetSeriesFolder && env.PRODUCTS) {
        stage = 'swap_series_fetch';
        const refColor = matchedColors[0] || null;
        const seriesPick = await findBestReference(env, targetSeriesFolder, {
          preferredColor: refColor, preferredAngle: '측면', preferredSize: targetSize,
          preferredMaterial: targetSeriesData?.default_material || null,
        });
        if (!seriesPick) {
          return json({ error: `타겟 시리즈 "${targetSeries}" 폴더에서 누끼를 찾을 수 없어요`, folder: `products/${targetSeriesFolder}/`, stage }, 404);
        }

        let sizeMatchOk = true;
        let sizeMatchNote = null;
        if (targetSize) {
          const tokens = targetSize.split(/\s+/).filter(Boolean);
          const normPickName = seriesPick.name.replace(/_/g, ' ');
          if (!tokens.every(t => normPickName.includes(t))) {
            sizeMatchOk = false;
            sizeMatchNote = `요청 사이즈: "${targetSize}" — R2에 정확히 매칭되는 누끼가 없어서 가장 가까운 "${seriesPick.name}" 사용`;
          }
        }

        stage = 'swap_series_b64';
        const seriesBase64 = await fetchR2AsBase64(env, seriesPick.key);
        if (!seriesBase64) return json({ error: 'R2 fetch 실패', key: seriesPick.key, stage }, 500);

        const colorInstruction = matchedColors.length > 0
          ? `Color: ${matchedColors.join(', ')}.`
          : `Keep the original upholstery color from IMAGE 2's existing sofa.`;

        stage = 'swap_series_gemini';
        let sizeExpansionClause = '';
        if (!sizeMatchOk && targetSize) {
          const targetSeats = targetSize.match(/(\d+(?:\.\d+)?)인/)?.[1];
          const refSeats = seriesPick.name.match(/(\d+(?:\.\d+)?)인/)?.[1];
          if (targetSeats && refSeats && parseFloat(targetSeats) > parseFloat(refSeats)) {
            const refIsModular = ['사티', '케렌시아', '밀로', '보눔 풀베이스', '보눔 오픈베이스', '비하르', '스탠', '카포네 그랑'].includes(targetSeries);
            if (refIsModular) {
              sizeExpansionClause = ` IMPORTANT: IMAGE 2 shows the ${refSeats}-seat version, but the FINAL result must be the ${targetSeats}-seat configuration. Extend it by REPEATING/TILING the same module/cushion shown in IMAGE 2 horizontally to form ${targetSeats} identical seat modules in a row. Keep the cushion proportions, material, color, and frame identical — just replicate the module ${targetSeats} times side-by-side as a modular sofa. ${targetSize.includes('라운지') ? `Add a lounge/chaise extension on one end.` : ''}${targetSize.includes('코너') || targetSize.includes('L자') ? `Arrange in an L-shape corner.` : ''}`;
            }
          }
        }

        let seriesSwapPrompt;
        let modeLabel = 'swap_series';

        if (usePlaceMode) {
          modeLabel = 'place_product';
          const placementText = [];
          for (const p of matchedPlacements) {
            if (p.type === 'right') placementText.push('on the right side of the room');
            else if (p.type === 'left') placementText.push('on the left side of the room');
            else if (p.type === 'center') placementText.push('at the center of the room');
            else if (p.type === 'back') placementText.push('against the back wall');
            else if (p.type === 'front') placementText.push('in the front area');
            else if (p.type === 'window') placementText.push('near the window');
            else if (p.type === 'wall') placementText.push('against the wall');
            else if (p.type === 'corner') placementText.push('in the corner');
          }
          const placementClause = placementText.length > 0 ? placementText.join(', ') : 'in a natural, suitable position';
          const orientationClause = orientationHints.length > 0 ? ` Orientation: ${orientationHints.join(', ')}.` : '';
          const colorClauseForPlace = matchedColors.length > 0 ? `Color: ${matchedColors.join(', ')}.` : '';
          seriesSwapPrompt = [
            `Place the sofa from IMAGE 1 (Alloso ${targetSeries}${targetSize ? ' ' + targetSize : ''}) into the room shown in IMAGE 2.`,
            `Position: ${placementClause}.${orientationClause}`,
            `Match the perspective, lighting, and scale of IMAGE 2's room so the sofa looks naturally photographed in that space.`,
            `Keep everything else in IMAGE 2 unchanged (walls, floor, ceiling, windows, lighting, decor, camera angle).`,
            `The sofa silhouette, module count, and proportions must match IMAGE 1 exactly.`,
            colorClauseForPlace,
            `Photorealistic editorial interior photograph.`,
          ].filter(Boolean).join(' ');
        } else {
          seriesSwapPrompt = [
            `IMAGE 1 = Alloso ${targetSeries}${targetSize ? ' ' + targetSize : ''} (product cutout — this is the sofa to render).`,
            `IMAGE 2 = a room photograph showing the target environment.`,
            `Generate the room from IMAGE 2 with the existing sofa removed and replaced by the Alloso ${targetSeries} from IMAGE 1.`,
            `The output sofa must be the ${targetSeries} shown in IMAGE 1 — same silhouette, same module count, same modular boxy form, same proportions, same details. Do not draw a generic sofa.`,
            `Keep everything else from IMAGE 2 unchanged: walls, floor, ceiling, lighting, decor, camera angle, perspective.`,
            colorInstruction,
            `Do not add cushions, pillows, books, or new objects.`,
            `Photorealistic editorial interior photograph.`,
          ].filter(Boolean).join(' ');
        }

        let resultBase64;
        try {
          resultBase64 = await callGemini(env, [seriesBase64, base64], seriesSwapPrompt);
          if (!resultBase64) throw new Error('Gemini returned no image data');
        } catch (e) {
          return json({ error: 'Series swap failed', detail: e.message, stage }, 500);
        }

        const sourceLen = base64.length;
        const resultLen = resultBase64.length;
        const passthroughSuspect = Math.abs(sourceLen - resultLen) < 100;

        return json({
          mode: modeLabel, target_series: targetSeries, target_size: targetSize,
          size_match_ok: sizeMatchOk, size_match_note: sizeMatchNote,
          target_color: matchedColors.length > 0 ? matchedColors : 'preserved from IMAGE 1',
          placement: matchedPlacements.map(p => p.word), orientation: orientationHints,
          ref_used: seriesPick.key, ref_filename: seriesPick.name, ref_debug: seriesPick._debug || null,
          gemini_debug: {
            model: env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image-preview',
            prompt_length: seriesSwapPrompt.length,
            source_image_b64_len: base64.length, ref_image_b64_len: seriesBase64.length,
            result_b64_len: resultBase64.length, passthrough_suspect: passthroughSuspect,
          },
          provider: 'gemini',
          image: `data:image/png;base64,${resultBase64}`,
        });
      }

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
            if (chipBase64) { chipMeta = { code, article, colorKo: matchedColorKo, key: chipAttemptedKey }; }
            else { chipFetchError = `R2 키 없음: ${chipAttemptedKey}`; }
          } catch (e) { chipFetchError = `R2 에러: ${e.message.slice(0, 80)}`; }
        } else { chipFetchError = 'PRODUCTS binding 미설정'; }
      } else if (matchedColorKo) {
        chipFetchError = `${matchedColorKo}에 code 없음 (manifest 갱신 필요)`;
      } else {
        chipFetchError = '컬러 매칭 안 됨';
      }

      stage = 'swap_gemini';
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
        mode: 'swap_material', target: instruction, enrichment: enrichment.trim() || null,
        chip: chipMeta, chip_attempted_key: chipAttemptedKey, chip_fetched: !!chipBase64,
        chip_error: chipFetchError, matched_colors: matchedColors, provider: 'gemini',
        image: `data:image/png;base64,${resultBase64}`,
      });
    }

    // ── BUNDLE MODE ─────────────────────────────────────────────
    if (mode === 'bundle') {
      stage = 'bundle_validate';
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length === 0) return json({ error: 'items array required for bundle mode' }, 400);
      if (items.length > 5) return json({ error: 'max 5 items per bundle', count: items.length }, 400);

      const spaceSize = body.spaceSize || 'wide';
      const moodKey = body.mood;
      const customScene = body.scenePrompt;

      stage = 'bundle_fetch_refs';
      const refs = [];
      const warnings = [];

      for (const item of items) {
        if (!item?.series) { warnings.push('item without series skipped'); continue; }
        const itemResolved = resolveSeries(item.series, manifest);
        if (!itemResolved || itemResolved.category === 'discontinued' || itemResolved.is_brand_group) {
          warnings.push(`${item.series}: 해석 실패 또는 단종/브랜드 그룹`); continue;
        }
        const resolvedSize = resolveSize(item.size, itemResolved.info);
        const sizeSubstituted = item.size && resolvedSize !== item.size;
        const pick = await findBestReference(env, itemResolved.folder, {
          preferredColor: item.color || itemResolved.info?.default_color,
          preferredAngle: '측면',
          preferredMaterial: item.material || itemResolved.info?.default_material,
          preferredSize: resolvedSize,
        });
        if (!pick) { warnings.push(`${item.series}: 레퍼런스 파일 없음 (folder=${itemResolved.folder})`); continue; }
        const obj = await env.PRODUCTS.get(pick.key);
        if (!obj) { warnings.push(`${item.series}: R2 객체 가져오기 실패`); continue; }
        const sizeObj = obj.size || 0;
        if (sizeObj > 10 * 1024 * 1024) { warnings.push(`${item.series}: 이미지 너무 큼 (${(sizeObj / 1024 / 1024).toFixed(1)}MB)`); continue; }
        const buf = await obj.arrayBuffer();
        const base64 = bytesToBase64(new Uint8Array(buf));
        refs.push({
          base64, seriesKo: itemResolved.info.ko, seriesEn: itemResolved.info.en,
          colorKo: item.color || itemResolved.info?.default_color || '',
          sizeKo: resolvedSize || '', requestedSizeKo: item.size || '', sizeSubstituted,
          materialKo: item.material || itemResolved.info?.default_material || '',
          category: itemResolved.info?.category || 'sofa', features: itemResolved.info?.features || [],
          code: itemResolved.info?.code || '', categoryNo: itemResolved.info?.category_no || null,
          filename: pick.name, thumbnailUrl: keyToPublicUrl(manifest, pick.key),
        });
      }

      if (refs.length === 0) return json({ error: 'No valid references could be loaded', warnings, stage }, 500);

      stage = 'bundle_compose_prompt';
      const sofas = refs.filter(r => r.category === 'sofa');
      const chairs = refs.filter(r => r.category === 'lounge_chair' || r.category === 'chair');
      const poufs = refs.filter(r => r.category === 'pouf' || r.category === 'stool');
      const tables = refs.filter(r => r.category === 'table');
      const daybeds = refs.filter(r => r.category === 'daybed');

      const scene = customScene || (moodKey && SCENE_LIBRARY[moodKey]) || SCENE_LIBRARY[spaceSize === 'wide' ? '_wide' : '_narrow'];

      const termFor = (cat, size) => {
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

      const sizeVisualHint = (sizeKo, category) => {
        if (!sizeKo) return '';
        const seatMatch = sizeKo.match(/(\d+(?:\.\d+)?)인/);
        const seats = seatMatch ? seatMatch[1] : null;
        let hint = '';
        if (seats && (category === 'sofa' || !category)) {
          hint += ` with exactly ${seats} cushion modules / seats in a row`;
          if (sizeKo.includes('라운지')) hint += ` and an extended lounge/chaise section on one side`;
          if (sizeKo.includes('코너') || sizeKo.includes('L자')) hint += ` arranged in an L-shape corner configuration`;
        }
        if (sizeKo.includes('와이드')) hint += ` (wider seat depth than standard)`;
        if (sizeKo.includes('하이백')) hint += ` (with a tall high backrest)`;
        return hint;
      };

      const scaleGuard = (cat, sizeKo) => {
        switch (cat) {
          case 'pouf': case 'stool': return 'maximum 45cm tall, roughly cube-shaped, knee-high or lower — NEVER as large as a sofa or armchair';
          case 'table':
            if (sizeKo && (sizeKo.includes('사이드') || sizeKo.includes('side'))) return 'narrow side table, knee to thigh height (~50-60cm), placed at the end of a sofa';
            return 'low coffee table (~30-40cm tall), positioned in front of the main sofa';
          case 'lounge_chair': case 'chair': return 'single one-person lounge chair, smaller than the main sofa, distinctly armchair-scale';
          case 'daybed': return 'long, low daybed with one armrest or backrest, sofa-length but narrower';
          default:
            const seats = sizeKo?.match(/(\d+(?:\.\d+)?)인/)?.[1];
            if (seats === '1' || sizeKo === '1인' || sizeKo === '단일') return 'single-seat armchair scale — smaller than a multi-seat sofa';
            if (seats) return `multi-seat sofa with ${seats}-seater width`;
            return 'main multi-seat sofa anchor';
        }
      };

      const productList = refs.map((r, i) => {
        const sizeText = r.sizeKo ? `${r.sizeKo} ` : '';
        const visualHint = sizeVisualHint(r.sizeKo, r.category);
        const scale = scaleGuard(r.category, r.sizeKo);
        return `(reference image ${i + 1}) the alloso ${r.seriesKo} ${sizeText}${termFor(r.category, r.sizeKo)} in ${r.colorKo} color${visualHint} — scale: ${scale}`;
      }).join('; ');

      const singleSeats = refs.filter(r => r.sizeKo && ['1인', '단일', '하이백 1인', '1인 와이드', '1인 라운지'].includes(r.sizeKo));
      const mainSofas = sofas.filter(r => !singleSeats.includes(r));
      const placement = [];
      if (mainSofas.length) placement.push(`anchor the largest multi-seat sofa as the primary visual element at the center or rear of the space`);
      if (chairs.length) placement.push(`angle the lounge chair as an accent piece at one side, facing the main sofa — clearly armchair-scale (smaller than the sofa)`);
      if (singleSeats.length) placement.push(`place the single armchair (one-seater, NOT a sofa) as an accent piece adjacent to the main sofa — keep it visually distinct as a one-seater chair`);
      if (poufs.length) placement.push(`place the small leather pouf on the floor near the sofa as additional informal seating — STRICTLY keep it as a low cube under 45cm tall, NEVER scale it up to sofa size, NEVER make it into a chair or sofa`);
      if (tables.length) placement.push(`place the coffee table in front of the main sofa as the central piece, low (~30-40cm tall), proportional to the sofa width`);
      if (daybeds.length) placement.push(`place the daybed against a wall or in a window alcove`);
      const placementText = placement.length > 0 ? placement.join('; ') : 'arrange the pieces naturally to form a curated grouping';

      const bundlePrompt = [
        `Create a single photorealistic editorial interior photograph showing ${refs.length} distinct alloso furniture pieces composed together as ONE curated grouping in ONE room.`,
        `Products to include in this order from reference images: ${productList}.`,
        `Setting: ${scene}.`,
        `Layout guidance: ${placementText}.`,
        `═══ CRITICAL — STRUCTURAL FIDELITY ═══`,
        `Each piece MUST replicate its reference image's exact silhouette, geometry, module count, seat count, cushion arrangement, frame structure, leg/base design, and proportions. Do NOT substitute generic furniture from your training data; the reference images ARE the products. If reference image shows a modular box-shaped sofa with N separate cushion modules, the result MUST show exactly N cushion modules in that same box shape — not a generic sofa with rolled arms.`,
        `═══ CATEGORY/SCALE RULES (DO NOT VIOLATE) ═══`,
        `- If a reference is a pouf/ottoman: render as a SMALL floor cube (max 45cm), NEVER as a sofa or chair, NEVER scaled up to seat-back height.`,
        `- If a reference is a table: render as the actual table type (coffee table ~35cm tall, side table ~55cm tall), proportional to the sofa, NEVER as a seat or block.`,
        `- If a reference is a chair/armchair: render as a single one-seater, distinctly SMALLER than the main multi-seat sofa.`,
        `- The main multi-seat sofa is the largest element; all accents (pouf, side table, armchair) are visibly smaller.`,
        `Each reference number (1, 2, 3...) maps to the piece in the order listed above. Do NOT drop, merge, or omit any reference.`,
        `The composition should look like a deliberately curated alloso showroom or hospitality grouping — a complete furniture set/bundle. All ${refs.length} pieces must be clearly visible, identifiable, and positioned naturally as if a professional designer staged them together with correct real-world scale relationships.`,
        PHOTOREAL_DIRECTIVE,
      ].join(' ');

      stage = 'bundle_gemini';
      let resultBase64;
      try {
        resultBase64 = await callGemini(env, refs.map(r => r.base64), bundlePrompt);
        if (!resultBase64) throw new Error('Gemini returned no image data');
      } catch (e) {
        return json({ error: 'Bundle generation failed', detail: e.message, warnings, stage }, 500);
      }

      return json({
        mode: 'bundle', spaceSize, mood: moodKey || null, itemsCount: refs.length,
        items: refs.map(r => {
          const placement = (function(cat, idx, total){
            const presets = { sofa: { x: 42, y: 58 }, lounge_chair: { x: 76, y: 62 }, chair: { x: 76, y: 62 }, pouf: { x: 62, y: 82 }, stool: { x: 62, y: 82 }, table: { x: 48, y: 72 }, daybed: { x: 28, y: 55 } };
            const base = presets[cat] || { x: 50 + (idx-total/2)*15, y: 65 };
            return { x: base.x + '%', y: base.y + '%' };
          })(r.category, refs.indexOf(r), refs.length);
          return {
            series: r.seriesKo, seriesEn: r.seriesEn, color: r.colorKo, size: r.sizeKo,
            requestedSize: r.requestedSizeKo, sizeSubstituted: r.sizeSubstituted || false,
            material: r.materialKo, category: r.category, features: r.features.slice(0, 2),
            code: r.code, filename: r.filename, thumbnailUrl: r.thumbnailUrl,
            productPageUrl: r.categoryNo
              ? `https://www.alloso.co.kr/collection/detail?categoryNo=${r.categoryNo}`
              : `https://www.alloso.co.kr/collection/list`,
            placement,
          };
        }),
        warnings, provider: 'gemini',
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

    if (resolved.category === 'discontinued') return json({ mode, discontinued: true, message: resolved.message });
    if (resolved.is_brand_group) return json({ mode, is_brand_group: true, message: resolved.message, members: resolved.members });

    const colorResolved = color ? resolveColor(color, manifest) : null;
    if (colorResolved?.discontinued) return json({ mode, discontinued_color: true, message: colorResolved.message });
    const finalColor = colorResolved?.resolved || color || null;
    const seriesPreferredColor = finalColor || resolved.info?.default_color || null;
    const variantMention = getVariantMention(manifest, resolved.resolved);

    if (!env.PRODUCTS) return json({ error: 'R2 binding PRODUCTS not configured' }, 500);

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
      return json({ mode, series: resolved.resolved, color: finalColor, folder, totalFilesInFolder: files.length, matchingColorCount: matching.length, urls, found: Object.keys(urls).length, variantMention: variantMention?.message || null });
    }

    // ── FUSION MODE ──────────────────────────────────────────────
    if (mode === 'fusion') {
      const seriesKo = resolved.info.ko;
      const folder = resolved.folder;
      const spaceSize = body.spaceSize || 'narrow';
      const tableColorInput = body.tableColor || null;
      const tableSeriesInput = body.tableSeries || null;

      stage = 'list_sofa_folder';
      const sofaPick = await findBestReference(env, folder, {
        preferredColor: seriesPreferredColor, preferredAngle: '측면',
        preferredMaterial: body.material || resolved.info?.default_material || null,
        preferredSize: body.size || resolved.info?.default_size || null,
      });
      let sofaBase64 = null, sofaRef = null, resolvedColor = finalColor, colorAutoSelected = false;

      if (sofaPick) {
        stage = 'fetch_sofa_bytes';
        sofaBase64 = await fetchR2AsBase64(env, sofaPick.key);
        sofaRef = keyToPublicUrl(manifest, sofaPick.key);
        if (!finalColor && manifest.colors) {
          for (const cName of Object.keys(manifest.colors)) {
            if (sofaPick.name.includes(cName)) { resolvedColor = cName; colorAutoSelected = true; break; }
          }
        }
      }

      const workingColorDescEn = (resolvedColor && manifest.colors?.[resolvedColor]?.desc_en) || resolvedColor || 'natural';

      stage = 'select_table';
      let pairedTable = null, tableMeta = null, tableSeriesResolved = null;
      if (includeTable) {
        if (tableSeriesInput) {
          tableSeriesResolved = resolveSeries(tableSeriesInput, manifest);
          if (tableSeriesResolved && !tableSeriesResolved.is_brand_group && tableSeriesResolved.category !== 'discontinued') {
            pairedTable = tableSeriesResolved.info;
            tableMeta = { table: pairedTable, name: tableSeriesResolved.resolved, reason: 'user_specified', placement: 'beside the sofa as a complementary set' };
          }
        }
        if (!pairedTable) { tableMeta = selectPairedTable(manifest, resolved, spaceSize); if (tableMeta) pairedTable = tableMeta.table; }
      }

      let tableBase64 = null, tableRef = null, tableSize = 0;
      if (pairedTable && pairedTable.folder) {
        stage = 'list_table_folder';
        const tablePick = await findBestReference(env, pairedTable.folder, { preferredAngle: '측면', preferredColor: tableColorInput });
        if (tablePick) {
          if (tablePick.size && tablePick.size > 10 * 1024 * 1024) { tableSize = tablePick.size; }
          else { stage = 'fetch_table_bytes'; tableBase64 = await fetchR2AsBase64(env, tablePick.key); tableRef = keyToPublicUrl(manifest, tablePick.key); tableSize = tablePick.size || 0; }
        }
      }

      stage = 'build_prompt';
      const scene = scenePrompt || (mood && SCENE_LIBRARY[mood]) || SCENE_LIBRARY[spaceSize === 'wide' ? '_wide' : '_narrow'];

      const categoryTerm = (function(cat){
        switch (cat) {
          case 'lounge_chair': return 'lounge chair';
          case 'chair': return 'armchair';
          case 'pouf': case 'stool': return 'leather pouf (a small cube-shaped ottoman, NOT a sofa)';
          case 'daybed': return 'daybed';
          case 'table': return 'table';
          default: return 'sofa';
        }
      })(resolved.info?.category);
      const isAnchor = !['table'].includes(resolved.info?.category);

      const tableColorDescEn = tableColorInput ? (manifest.colors?.[tableColorInput]?.desc_en || tableColorInput) : null;

      let tableText = '';
      if (pairedTable) {
        const placement = tableMeta?.placement || (tableMeta?.reason === 'explicit_pair' ? 'integrated with the modules' : `beside the ${categoryTerm}`);
        const colorPart = tableColorDescEn ? ` in ${tableColorDescEn} tone` : '';
        if (tableBase64) { tableText = ` Place the ${pairedTable.ko} table${colorPart} ${placement} as a complementary set, matching the second reference image.`; }
        else { tableText = ` Include an alloso ${pairedTable.ko} ${pairedTable.en} side/coffee table${colorPart} ${placement} to complete the set.`; }
      }

      const sofaSizeKo = body.size || resolved.info?.default_size || '';
      const sofaSeatMatch = sofaSizeKo.match(/(\d+(?:\.\d+)?)인/);
      const sofaSeats = sofaSeatMatch ? sofaSeatMatch[1] : null;
      let sofaSizeHint = '';
      if (sofaSeats && (resolved.info?.category === 'sofa' || !resolved.info?.category)) {
        sofaSizeHint = ` configured with exactly ${sofaSeats} cushion modules / seats in a row`;
        if (sofaSizeKo.includes('라운지')) sofaSizeHint += ` plus an extended lounge/chaise extension on one side`;
        if (sofaSizeKo.includes('코너') || sofaSizeKo.includes('L자')) sofaSizeHint += ` arranged in an L-shape corner configuration`;
      }
      if (sofaSizeKo.includes('와이드')) sofaSizeHint += ` (wider seat depth than standard)`;
      if (sofaSizeKo.includes('하이백')) sofaSizeHint += ` (with a tall high backrest)`;

      const fusionPrompt = [
        `Place this exact ${seriesKo} ${categoryTerm}${sofaSizeHint} from the reference image into ${scene}.`,
        `═══ CRITICAL — STRUCTURAL FIDELITY ═══`,
        `Replicate the EXACT silhouette, geometry, module count, cushion arrangement, frame design, and proportions shown in the reference image. Do NOT substitute a generic sofa from your training data — the reference image IS the product. If the reference shows a modular box-shaped sofa with separate cushion modules, the result MUST show that exact modular box form (not a generic sofa with rolled arms or curved frame).`,
        sofaSeats ? `The sofa must have EXACTLY ${sofaSeats} seat modules. Count them in the reference. Do not add or remove modules.` : '',
        `If the reference is a chair, keep it a chair. If the reference is a pouf/ottoman, keep it a small floor cube (max 45cm tall, NEVER scaled up). If the reference is a sofa, keep its exact module/seat count.`,
        `The upholstery color must remain ${workingColorDescEn} as in the reference.`,
        tableText,
        PHOTOREAL_DIRECTIVE,
        isAnchor ? `The ${categoryTerm} must be a clear focal point and its form must be IDENTICAL to the reference image.` : `The composition must preserve the reference exactly.`,
      ].filter(Boolean).join(' ');

      let resultBase64 = null, provider = null, warning = null;

      if (sofaBase64) {
        try {
          stage = 'call_gemini';
          const refs = [sofaBase64];
          if (tableBase64) refs.push(tableBase64);
          resultBase64 = await callGemini(env, refs, fusionPrompt);
          if (resultBase64) provider = 'gemini';
        } catch (e) { warning = `Gemini failed: ${e.message.slice(0, 80)}`; }
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
        mode, series: resolved.resolved, color: resolvedColor, colorAutoSelected, spaceSize, mood: mood || null,
        tableColor: tableColorInput, tableSeriesInput, tableSeriesResolved: tableSeriesResolved?.resolved || null,
        sofaSelectedSize: body.size || resolved.info?.default_size || null,
        sofaSelectedMaterial: body.material || resolved.info?.default_material || null,
        provider, warning, sofaReferenceUsed: sofaRef, sofaPickedFilename: sofaPick?.name || null,
        sofaSize: sofaPick?.size || 0, tablePaired: tableMeta?.name || null, tableReferenceUsed: tableRef,
        tablePickedFilename: tableBase64 ? (tableRef?.split('/').pop() || null) : null,
        tableSelectionReason: tableMeta?.reason || null, tableSize,
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
