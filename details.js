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
    hero.src = url; hero.alt = d.title || ''; hero.style.display = 'block';
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
  svg.innerHTML = '';  const mdPath = item.markdown;

  // Use consistent world bounds
  const W = 600, H = 300;
  const LON_MIN = -180, LON_MAX = 180;
  const LAT_MIN = -95,  LAT_MAX = 85;

  // Draw world map background
  ensureBaseMap(svg);

  // Project lon/lat to SVG coordinates
  function proj(lon, lat) {
    const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * W;
    const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * H;
    return [x, y];
  }

  // Draw marker if coordinates exist
  if (Number.isFinite(item.lon) && Number.isFinite(item.lat)) {
    const [x, y] = projEquirect(Number(item.lon), Number(item.lat), svg);
    const marker = document.createElementNS(NS, 'circle');
    marker.setAttribute('cx', x);
    marker.setAttribute('cy', y);
    marker.setAttribute('r', 12);
    marker.setAttribute('fill', '#7C3AED');
    marker.setAttribute('stroke', '#fff');
    marker.setAttribute('stroke-width', 4);
    marker.setAttribute('filter', 'drop-shadow(0 2px 6px rgba(0,0,0,0.18))');
    svg.appendChild(marker);
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
    order = ['STORY+'];
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