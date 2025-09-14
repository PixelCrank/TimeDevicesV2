/* ===================== Config & helpers ===================== */
const DATA_CSV = 'data/items.csv';
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
const show = el => { if (el){ el.classList.remove('hide'); el.hidden = false; } };
const hide = el => { if (el){ el.classList.add('hide'); el.hidden = true; } };

function slugify(s){
  return (s||'').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function splitTags(s){ return (s || '').split(/[;,\|]/).map(x=>x.trim()).filter(Boolean); }
function dedupe(arr){ return Array.from(new Set((arr||[]).filter(Boolean))); }

/* Use your placeholder set so hero never breaks */
function nodeImageURL(d){
  let p = (d.image || d.thumb || '').trim();
  if (!p) {
    const cat = (d.category || '').toLowerCase();
    if (cat === 'person') p = 'images/placeholders/person_hero.png';
    else if (cat === 'story') p = 'images/placeholders/story_hero.png';
    else p = 'images/placeholders/device_hero.png';
  }
  if (/^https?:\/\//i.test(p)) return p;
  if (!p.startsWith('images/')) p = 'images/' + p;
  return p;
}

/* ===================== CSV loader ===================== */
async function loadCSV(path){
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`CSV load failed: ${res.status} @ ${path}`);
  const txt = (await res.text()).replace(/^\uFEFF/, '').replace(/\r/g,'');
  const lines = txt.split('\n').filter(x => x.trim().length);

  function split(line){
    const out=[]; let cur='', q=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (ch === '"'){
        if (q && line[i+1] === '"'){ cur+='"'; i++; }
        else q=!q;
      } else if (ch===',' && !q){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur);
    return out;
  }

  const headers = split(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
  return lines.slice(1).map(line=>{
    const cols = split(line); const o={};
    headers.forEach((h,i)=> o[h] = (cols[i] ?? '').trim());
    return o;
  });
}

/* ===================== normalization ===================== */
function normalizeItem(d){
  const out = { ...d };
  out.id    = d.id || '';
  out.title = d.title || d.name || '';
  out.caption = d.abstract || d.caption || d.description || '';

  out.year     = d.year || '';
  out.year_end = d.year_end || '';
  out.years    = d.years || '';

  out.lat = parseFloat(String(d.lat||'').replace(',','.'));
  out.lon = parseFloat(String(d.lon||'').replace(',','.'));
  out.origin_location = d.origin_location || d.location || '';

  let cat = (d.category || '').toLowerCase();
  if (/device/.test(cat)) cat = 'device';
  else if (/person/.test(cat)) cat = 'person';
  else if (/story/.test(cat)) cat = 'story';
  out.category = cat;

  const base = (d.slug || d.id || out.title || '').toString();
  out.slug = slugify(base);

  out.content_path = d.content_path || '';
  out.image = d.image || d.hero || '';
  out.thumb = d.thumb || '';

  out.links  = splitTags(d.links || d.url);
  out.images = dedupe([out.image, out.thumb].flatMap(x => splitTags(x)));

  return out;
}

function fmtRange(d){
  const a=d.year, b=d.year_end, yrs=d.years;
  if (a && b) return `${a}–${b}`;
  if (a && !b) return a;
  if (!a && b) return `–${b}`;
  return yrs || '';
}

/* ===================== markdown ===================== */
async function fetchTextSafe(url){
  try { const r = await fetch(encodeURI(url), { cache: 'no-store' }); return r.ok ? await r.text() : ''; }
  catch { return ''; }
}
function parseFrontMatter(md){
  const m = md.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta:{}, body: md };
  const meta = {};
  m[1].split('\n').forEach(line=>{
    const i = line.indexOf(':');
    if (i>0){ meta[line.slice(0,i).trim()] = line.slice(i+1).trim(); }
  });
  return { meta, body: md.slice(m[0].length) };
}
function mdToHTML(s=''){
  let h = s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.split(/\n{2,}/).map(p=>`<p>${p}</p>`).join('\n');
  return h;
}
function splitH2Sections(mdBody){
  const out = {};
  const re = /^##\s*([^\n#]+?)\s*[\r\n]+([\s\S]*?)(?=^##\s*[^\n#]+?\s*|$)/gmi;
  let m;
  while ((m = re.exec(mdBody)) !== null){
    let raw = m[1].trim().toLowerCase();
    const val = (m[2]||'').trim();
    let key = '';
    if (/^bio$/.test(raw)) key = 'BIO';
    else if (/^what$/.test(raw)) key = 'WHAT';
    else if (/^why$/.test(raw)) key = 'WHY';
    else if (/^story\+?$/.test(raw)) key = 'STORY+';
    else if (/^description$/.test(raw)) key = 'DESCRIPTION';
    else if (/function|fonction/.test(raw)) key = 'FUNCTION';
    else if (/perspective\s*historique/.test(raw)) key = 'PERSPECTIVE';
    else if (/innovation/.test(raw)) key = 'INNOVATION';
    else if (/^sources?$/.test(raw)) key = 'SOURCES'; // <-- Add this line
    if (key) out[key] = val;
  }
  return out;
}
function buildMdCandidates(item){
  const s = item.slug || slugify(item.title);
  const tries = [];
  if (item.content_path) tries.push(item.content_path);
  if (item.category === 'person'){
    tries.push(`content/people/${s}.en.md`, `content/people/${s}.md`);
  } else if (item.category === 'story'){
    tries.push(`content/story/${s}.en.md`, `content/story/${s}.md`);
    tries.push(`content/stories/${s}.en.md`, `content/stories/${s}.md`);
  } else {
    tries.push(`content/devices/${s}.en.md`, `content/devices/${s}.md`);
  }
  return Array.from(new Set(tries));
}
async function loadMarkdownForItem(item){
  const candidates = buildMdCandidates(item);
  for (const path of candidates){
    const txt = await fetchTextSafe(path);
    if (txt) return { path, md: txt, tried: candidates };
  }
  return { path:'', md:'', tried: candidates };
}

/* ===================== mini-map (real projection) ===================== */
const NS = 'http://www.w3.org/2000/svg';
const LON_MIN = -180, LON_MAX = 180;
const LAT_MIN = -95,  LAT_MAX = 85;
const MAP_ASPECT = 2/1;   // match the world svg aspect
const MAP_PAD = 8;

function computeMapFrame(svg){
  // Use real on-screen size for accurate projection
  const rect = svg.getBoundingClientRect();
  const w = Math.max(0, rect.width);
  const h = Math.max(0, rect.height);

  const innerW = Math.max(0, w - MAP_PAD*2);
  const innerH = Math.max(0, h - MAP_PAD*2);
  const targetW_byH = innerH * MAP_ASPECT;

  let fw, fh, fx, fy;
  if (targetW_byH <= innerW){
    fh = innerH; fw = targetW_byH; fx = MAP_PAD + (innerW - fw)/2; fy = MAP_PAD;
  } else {
    fw = innerW; fh = fw / MAP_ASPECT; fx = MAP_PAD; fy = MAP_PAD + (innerH - fh)/2;
  }
  return { x: fx, y: fy, w: fw, h: fh };
}
function projEquirect(lon, lat, svg){
  const f = computeMapFrame(svg);
  const x = f.x + ((+lon - LON_MIN) / (LON_MAX - LON_MIN)) * f.w;
  const y = f.y + ((LAT_MAX - (+lat)) / (LAT_MAX - LAT_MIN)) * f.h;
  return [x, y, f];
}
function ensureBaseMap(svg){
  // draw (or update) a world backdrop image sized to the frame
  let img = svg.querySelector('#miniWorld');
  if (!img){
    img = document.createElementNS(NS,'image');
    img.id = 'miniWorld';
    img.setAttribute('preserveAspectRatio','none');
    img.setAttributeNS('http://www.w3.org/1999/xlink','href','assets/world_light.svg');
    img.setAttribute('href','assets/world_light.svg');
    img.setAttribute('opacity','0.22');
    svg.appendChild(img);
  }
  const f = computeMapFrame(svg);
  img.setAttribute('x', f.x); img.setAttribute('y', f.y);
  img.setAttribute('width', f.w); img.setAttribute('height', f.h);
}

/* ===================== render ===================== */
function renderHeaderAndMeta(d){
  document.title = `${d.title} • Time Stories`;
  $('#docTitle').textContent = `${d.title} • Time Stories`;

  $('#title').textContent = d.title || '';
  $('#subtitle').textContent = [fmtRange(d), d.origin_location].filter(Boolean).join(' • ');

  const hero = $('#heroImg');
  const url = nodeImageURL(d);
  if (url){
    hero.src = url;
    hero.alt = d.title || '';
    hero.style.display = 'block';
    hero.style.maxHeight = '320px'; // or up to 800px if you want for large screens
    hero.onerror = () => {
      const cat = (d.category||'').toLowerCase();
      hero.src =
        cat==='person' ? 'images/placeholders/person_hero.png' :
        cat==='story'  ? 'images/placeholders/story_hero.png'  :
                         'images/placeholders/device_hero.png';
    };
  }

  const catLabel = d.category === 'person' ? 'Key People' : (d.category === 'story' ? 'Stories' : 'Time Devices');
  $('#crumbCategory').textContent = catLabel;

  const viewOnMapBtn = document.getElementById('viewOnMap');
  if (viewOnMapBtn && d.slug) {
    viewOnMapBtn.href = `index.html#focus=${encodeURIComponent(d.slug)}&zoom=2`;
  }

  const backBtns = document.querySelectorAll('.btn.secondary, .muted[href="index.html"]');
  backBtns.forEach(btn => {
    btn.onclick = (e) => {
      e.preventDefault();
      // Use a special hash to indicate restore
      window.location.href = 'index.html#restore';
    };
  });

  const meta = [];
  if (fmtRange(d)) meta.push(['Years', fmtRange(d)]);
  if (d.origin_location) meta.push(['Location', d.origin_location]);
  if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) meta.push(['Coordinates', `${d.lat.toFixed(3)}, ${d.lon.toFixed(3)}`]);
  $('#metaList').innerHTML = meta.map(([k,v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function renderMiniMap(item) {
  const svg = document.getElementById('detailsMapSvg');
  if (!svg) return;
  svg.innerHTML = '';

  // Responsive sizing: use the actual SVG size
  const rect = svg.getBoundingClientRect();
  const W = rect.width || 320;
  const H = rect.height || 160;
  const aspect = 2 / 1;
  // Maintain aspect ratio
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Draw world map background (stretched to fit)
  let img = document.createElementNS(NS, 'image');
  img.setAttributeNS('http://www.w3.org/1999/xlink', 'href', 'assets/world_light.svg');
  img.setAttribute('href', 'assets/world_light.svg');
  img.setAttribute('x', 0);
  img.setAttribute('y', 0);
  img.setAttribute('width', W);
  img.setAttribute('height', H);
  img.setAttribute('opacity', '0.22');
  svg.appendChild(img);

  // Project lon/lat to SVG coordinates
  function proj(lon, lat) {
    // Equirectangular projection
    const LON_MIN = -180, LON_MAX = 180;
    const LAT_MIN = -95, LAT_MAX = 85;
    const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
    const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
    return [x, y];
  }

  let lat = Number.isFinite(item.lat) ? item.lat : null;
  let lon = Number.isFinite(item.lon) ? item.lon : null;

  // If lat/lon missing, try to geocode from location string
  if ((lat === null || lon === null) && item.origin_location) {
    const coords = geocodePlace(item.origin_location);
    if (coords) {
      lat = coords[0];
      lon = coords[1];
    }
  }

  if (lat !== null && lon !== null) {
    const [x, y] = proj(Number(lon), Number(lat));
    const marker = document.createElementNS(NS, 'circle');
    marker.setAttribute('cx', x);
    marker.setAttribute('cy', y);
    marker.setAttribute('r', Math.max(10, Math.min(W, H) * 0.06));
    marker.setAttribute('fill', '#7C3AED');
    marker.setAttribute('stroke', '#fff');
    marker.setAttribute('stroke-width', 4);
    marker.setAttribute('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))');
    svg.appendChild(marker);
  } else {
    // If still no coordinates, show a faded world map and a message
    const text = document.createElementNS(NS, 'text');
    text.setAttribute('x', W/2);
    text.setAttribute('y', H/2 + 8);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '18');
    text.setAttribute('fill', '#bbb');
    text.textContent = 'No coordinates';
    svg.appendChild(text);
  }
}

function fillSectionsFromMarkdown(item, md){
  const { body } = parseFrontMatter(md);
  const sections = splitH2Sections(body);

  // Hide all by default
  hide($('#peopleSections'));
  hide($('#deviceSections'));
  hide($('#storySections'));

  let order = [];
  if (item.category === 'device') {
    show($('#deviceSections'));
    order = ['DESCRIPTION','FUNCTION','PERSPECTIVE','INNOVATION'];
  } else if (item.category === 'person') {
    show($('#peopleSections'));
    order = ['BIO','WHAT','WHY'];
  } else if (item.category === 'story') {
    show($('#storySections'));
    order = ['DESCRIPTION', 'FUNCTION', 'PERSPECTIVE', 'INNOVATION', 'STORY+'];
  }

  let filled = 0;
  for (const key of order){
    const val = sections[key] || '';
    const el = document.querySelector(`[data-key="${key}"]`);
    if (!el) continue;
    el.innerHTML = val ? mdToHTML(val) : '';
    if (val) filled++;
  }

  // Render Sources section if present
  const sourcesSection = sections['SOURCES'];
  const sourcesEl = document.getElementById('sourcesSection');
  if (sourcesEl) {
    if (sourcesSection) {
      sourcesEl.innerHTML = `<h3>Sources</h3>${mdToHTML(sourcesSection)}`;
      show(sourcesEl);
    } else {
      sourcesEl.innerHTML = '';
      hide(sourcesEl);
    }
  }

  return filled;
}

function renderMediaGallery(item) {
  const gallery = document.getElementById('mediaGallery');
  if (!gallery) return;

  // Gather all media URLs (images/videos)
  let media = [];
  if (item.media) media = item.media.split(/[;,|]/).map(x=>x.trim()).filter(Boolean);
  else media = [];
  // Always include hero image and thumb if not already in media
  if (item.image && !media.includes(item.image)) media.unshift(item.image);
  if (item.thumb && item.thumb !== item.image && !media.includes(item.thumb)) media.push(item.thumb);

  // Remove duplicates
  media = Array.from(new Set(media)).filter(Boolean);

  // If no media, show placeholder
  if (!media.length) {
    gallery.innerHTML = '<span class="muted">No media available.</span>';
    return;
  }

  // Render thumbnails
  gallery.innerHTML = '';
  media.forEach((url, idx) => {
    let el;
    if (/\.(mp4|webm|ogg)$/i.test(url)) {
      el = document.createElement('video');
      el.src = url;
      el.muted = true;
      el.loop = true;
      el.playsInline = true;
      el.autoplay = true;
      el.title = `Media ${idx+1}`;
    } else {
      el = document.createElement('img');
      el.src = url;
      el.alt = `Media ${idx+1}`;
    }
    el.tabIndex = 0;
    el.classList.toggle('active', idx === 0);
    el.addEventListener('click', () => setHeroMedia(url, media));
    gallery.appendChild(el);
  });

  // Set initial hero image/video
  setHeroMedia(media[0], media);
}

function setHeroMedia(url, media) {
  const hero = document.getElementById('heroImg');
  if (!hero) return;

  // Replace hero image with video if needed
  if (/\.(mp4|webm|ogg)$/i.test(url)) {
    // Replace <img> with <video>
    const video = document.createElement('video');
    video.src = url;
    video.controls = true;
    video.autoplay = true;
    video.style.maxWidth = '100%';
    video.style.borderRadius = '10px';
    video.style.display = 'block';
    video.style.marginBottom = '10px';
    hero.replaceWith(video);
    video.id = 'heroImg';
  } else {
    // Replace <video> with <img> if needed
    if (hero.tagName.toLowerCase() !== 'img') {
      const img = document.createElement('img');
      img.id = 'heroImg';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '10px';
      img.style.display = 'block';
      img.style.marginBottom = '10px';
      hero.replaceWith(img);
      hero = img;
    }
    hero.src = url;
    hero.style.display = 'block';
  }

  // Highlight active thumbnail
  const gallery = document.getElementById('mediaGallery');
  if (gallery) {
    Array.from(gallery.children).forEach((thumb, i) => {
      thumb.classList.toggle('active', media[i] === url);
    });
  }

  // Enable cycling with arrow keys
  document.onkeydown = (e) => {
    if (!['ArrowLeft','ArrowRight'].includes(e.key)) return;
    const idx = media.indexOf(url);
    if (e.key === 'ArrowLeft' && idx > 0) setHeroMedia(media[idx-1], media);
    if (e.key === 'ArrowRight' && idx < media.length-1) setHeroMedia(media[idx+1], media);
  };
}

/* ===================== bootstrap ===================== */
function findItemByAnyId(items, q){
  if (!q) return null;
  const idQ   = decodeURIComponent(q).trim();
  const slugQ = slugify(idQ);
  return items.find(d => d.slug === idQ || d.slug === slugQ || (d.id||'').toLowerCase() === idQ.toLowerCase()) || null;
}

async function main(){
  if (location.protocol === 'file:'){
    show($('#mdError'));
    $('#mdError').innerHTML = 'You are opening this page via <code>file://</code>. Please run a local server so fetch() can load CSV/Markdown.';
  }

  const rows = await loadCSV(DATA_CSV);
  const items = rows.map(normalizeItem);

  const id = new URL(location.href).searchParams.get('id') || '';
  const item = findItemByAnyId(items, id);

  if (!item){ hide($('#itemRoot')); show($('#emptyState')); return; }

  show($('#itemRoot')); hide($('#emptyState'));
  renderHeaderAndMeta(item);
  renderMiniMap(item);
  renderMediaGallery(item);

// re-render the mini map when its box resizes (fonts/layout/side panels)
const mm = document.getElementById('detailsMapSvg');
if ('ResizeObserver' in window && mm) {
  const ro = new ResizeObserver(() => renderMiniMap(item));
  ro.observe(mm);
}

  const { md, tried } = await loadMarkdownForItem(item);
  if (md){
    const filled = fillSectionsFromMarkdown(item, md);
    if (!filled){
      hide($('#peopleSections')); hide($('#deviceSections'));
      show($('#desc'));
      $('#desc').innerHTML = mdToHTML(parseFrontMatter(md).body);
    }
  } else {
    hide($('#peopleSections')); hide($('#deviceSections'));
    show($('#desc'));
    if (item.caption){
      $('#desc').innerHTML = `<p>${item.caption}</p>`;
    } else {
      $('#desc').innerHTML = `<div class="muted">No detailed content found for this item.</div>`;
    }
    show($('#mdError'));
    $('#mdError').innerHTML = `
      <div><strong>Could not find Markdown for this item.</strong></div>
      <div style="margin-top:6px">I tried the following paths:</div>
      <div style="margin-top:6px;font-family:ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; line-height:1.35">
        ${tried.map(t => `<div>${t}</div>`).join('')}
      </div>`;
  }
}

document.addEventListener('DOMContentLoaded', main);

/* ===================== Geo Lookup ===================== */
const GEO_LOOKUP = {
  // ——— Cities / regions
  'kaifeng':[34.797,114.307], 'athens':[37.984,23.727], 'paris':[48.857,2.352],
  'geneva':[46.204,6.143], 'la chaux-de-fonds':[47.099,6.825], 'le brassus':[46.611,6.321],
  'neuchâtel':[46.992,6.931], 'neuchatel':[46.992,6.931], 'padua':[45.407,11.875],
  'the hague':[52.080,4.311], 'yorkshire':[53.991,-1.541], 'london':[51.507,-0.127],
  'greenwich':[51.482,0.000], 'washington d.c.':[38.907,-77.037], 'washington dc':[38.907,-77.037],
  'bern':[46.948,7.447], 'prague':[50.075,14.437], 'florence':[43.769,11.255],
  'milan':[45.464,9.190], 'montreal':[45.501,-73.567], 'new york':[40.712,-74.006],
  'cairo':[30.044,31.236], 'basra':[30.509,47.783], 'baghdad':[33.315,44.366],
  'damascus':[33.513,36.292], 'alexandria':[31.200,29.918], 'istanbul':[41.009,28.966],
  'nuremberg':[49.454,11.077], 'vienna':[48.208,16.373], 'prague':[50.075,14.437],
  'venice':[45.440,12.315], 'pisa':[43.717,10.401], 'oxford':[51.752,-1.258],
  'leiden':[52.160,4.497], 'rotterdam':[51.924,4.479], 'zurich':[47.376,8.541],
  'basel':[47.559,7.588], 'lyon':[45.764,4.835], 'besançon':[47.238,6.024],
  'besancon':[47.238,6.024], 'birmingham':[52.486,-1.890], 'bristol':[51.454,-2.587],
  'lisbon':[38.722,-9.139], 'madrid':[40.416,-3.703], 'cordoba':[37.888,-4.779],
  'toledo':[39.862,-4.027], 'seville':[37.389,-5.984], 'kyoto':[35.011,135.768],
  'edo':[35.689,139.692], 'tokyo':[35.689,139.692], 'nagoya':[35.181,136.906],
  'nagaski':[32.750,129.877], 'nagasaki':[32.750,129.877],

  // ——— Countries / broad regions
  'china':[35.861,104.195], 'switzerland':[46.818,8.227], 'france':[46.227,2.213],
  'england':[52.355,-1.174], 'uk':[54.0,-2.0], 'united kingdom':[54.0,-2.0],
  'italy':[41.871,12.567], 'netherlands':[52.132,5.291], 'denmark':[56.263,9.501],
  'poland':[51.919,19.145], 'usa':[39.828,-98.579], 'united states':[39.828,-98.579],
  'japan':[36.204,138.253], 'mediterranean':[35.0,18.0], 'spain':[40.463,-3.749],
  'portugal':[39.399,-8.224], 'germany':[51.166,10.452], 'austria':[47.516,14.550],
  'turkey':[38.964,35.243], 'egypt':[26.820,30.802], 'iraq':[33.223,43.679],
  'syria':[34.802,38.996], 'greece':[39.074,21.824], 'morocco':[31.792,-7.093]
};

function geocodePlace(place) {
  if (!place) return null;
  const key = place.trim().toLowerCase();
  // Try exact match
  if (GEO_LOOKUP[key]) return GEO_LOOKUP[key];
  // Try first word (for "Fes, Morocco" etc)
  const first = key.split(/[ ,/]/)[0];
  if (GEO_LOOKUP[first]) return GEO_LOOKUP[first];
  return null;
}

/* ===================== Geo JSON ===================== */
const _VISIBLE = [];
const _HIDDEN = [];

function updateVisibleItems() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // Filter items that are not in the visible range
  _VISIBLE.length = 0;
  _HIDDEN.length = 0;
  for (const item of window._ALL_ITEMS) {
    // Skip if no coordinates
    if (!item.lat || !item.lon) continue;

    // Check if the item's time range is within the last 24 hours
    const itemDate = new Date(item.year, 0, 1).getTime();
    if (now - itemDate <= oneHour) {
      _VISIBLE.push(item);
    } else {
      _HIDDEN.push(item);
    }
  }

  // Update the UI or map with the new visible items
  renderVisibleItems();
}

function renderVisibleItems() {
  const features = _VISIBLE.map(d => ({
    type: "Feature",
    properties: { ...d },
    geometry: { type: "Point", coordinates: [d.lon, d.lat] }
  }));

  // Here you would typically update a map layer with the new features
  // For example, if using Mapbox GL JS:
  // map.getSource('your-source-id').setData({
  //   type: 'FeatureCollection',
  //   features: features
  // });
}

/* ===================== Debugging ===================== */
function debugVisibleItems() {
  const list = document.getElementById('visibleItemsList');
  if (!list) return;

  list.innerHTML = '';
  _VISIBLE.forEach(item => {
    const li = document.createElement('li');
    li.textContent = `${item.title} (${item.year}) - ${item.lat}, ${item.lon}`;
    list.appendChild(li);
  });
}