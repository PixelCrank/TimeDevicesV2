// --- On customtimeline.html, always render timeline and restore slug on load ---
document.addEventListener('DOMContentLoaded', () => {
  const isCustomTimeline = window.location.pathname.endsWith('customtimeline.html');
  if (isCustomTimeline) {
    // Patch renderCustomTimeline to always call restoreTimelineFromHash after rendering
    const origRenderCustomTimeline = window.renderCustomTimeline;
    window.renderCustomTimeline = function patchedRenderCustomTimeline() {
      if (origRenderCustomTimeline) origRenderCustomTimeline.apply(this, arguments);
      setTimeout(restoreTimelineFromHash, 0);
    };
    renderCustomTimeline();
  }
});
// --- Always re-render custom timeline when My Timeline tab is clicked ---
document.addEventListener('DOMContentLoaded', () => {
  const myTimelineBtn = document.querySelector('.tab-btn[data-view="custom_timeline"]');
  if (myTimelineBtn) {
    myTimelineBtn.addEventListener('click', (e) => {
      // Always switch to the view and re-render, even if already active
      switchView('custom_timeline');
      renderCustomTimeline();
    });
  }
});
// --- Restore timeline state from hash on load (Back to Timeline) ---
function restoreTimelineFromHash() {
  if (window.location.hash && window.location.hash.startsWith('#slug=')) {
    const slug = decodeURIComponent(window.location.hash.replace('#slug=', ''));
    let attempts = 0;
    function tryActivate() {
      if (window._ALL_ITEMS && typeof activateTimelineItem === 'function') {
        const item = window._ALL_ITEMS.find(x => x.slug === slug);
        if (item) {
          activateTimelineItem(item);
          return;
        }
      }
      if (++attempts < 20) setTimeout(tryActivate, 100); // retry up to 2s
    }
    tryActivate();
  }
}

// Patch render() to call restoreTimelineFromHash after rendering
const _origRender = typeof render === 'function' ? render : null;
window.render = function patchedRender() {
  if (_origRender) _origRender.apply(this, arguments);
  restoreTimelineFromHash();
};
if (!_origRender) {
  // If render() not yet defined, patch after DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof render === 'function') {
      const orig = render;
      window.render = function patchedRender() {
        orig.apply(this, arguments);
        restoreTimelineFromHash();
      };
    }
    restoreTimelineFromHash();
  });
}
// Activate a timeline item: show card, scroll marker into view, set marker as active
function activateTimelineItem(item) {
  if (!item) return;
  renderTimelineCard(item);
  const nav = document.getElementById('timelineNav');
  if (!nav) return;
  const year = Number(item.year) || 0;
  const markerX = 40 + ((year - MAP_YEAR_MIN) * 18 * (window.timelineZoom || 1));
  nav.scrollLeft = Math.max(0, markerX - nav.clientWidth / 2);
  // Remove .active from all markers, add to this one
  $$('.timeline-marker').forEach(g => {
    g.classList.remove('active');
    // Remove expanded title from all except hovered
    if (!g.matches(':hover')) {
      const hoverBg = g.querySelector('rect.card-bg');
      if (hoverBg) hoverBg.remove();
      const hoverTitle = g.querySelector('text.card-title');
      if (hoverTitle) hoverTitle.remove();
    }
  });
  // Find the marker for this item
  const marker = $(`.timeline-marker[data-slug='${item.slug}']`, nav);
  if (marker) {
    marker.classList.add('active');
    // Show expanded title for the active marker
    marker.dispatchEvent(new Event('mouseenter'));
  }
}
// Add CSS for spider-leg-hover highlight
if (!document.getElementById('spider-leg-style')) {
  const style = document.createElement('style');
  style.id = 'spider-leg-style';
  style.textContent = `
    .spider-leg {
      stroke: #b0b8c9;
  stroke-width: 0.1;
      opacity: 0.32;
  stroke-dasharray: 0.5 .2;
      filter: drop-shadow(0px 1px 2px #fff8  );
      transition: stroke 0.2s, opacity 0.2s, stroke-width 0.2s;
    }
    .spider-leg-hover {
      stroke: #ff9800 !important;
  stroke-width: 0.3 !important;
      opacity: 0.85 !important;
      stroke-dasharray: none !important;
      filter: drop-shadow(0px 2px 4px #ff980055);
    }
  `;
  document.head.appendChild(style);
}
/* ===========================
   Time Stories — App JS (stable)
=========================== */

const NS       = 'http://www.w3.org/2000/svg';
window.DATA_CSV = 'data/items.csv';

// ------- debug -------
const DEBUG = false;
const dbg = (...a)=> DEBUG && console.log('[DBG]', ...a);

// ------- DOM helpers -------
const $  = (s, r=document)=> r.querySelector(s);
const $$ = (s, r=document)=> Array.from(r.querySelectorAll(s));
// How much bigger a node gets on hover
const HOVER_SCALE = 1.35; // tweak 1.2–1.5 to taste


// ------- Year domain & eras -------
let MAP_YEAR_MIN = -1500, MAP_YEAR_MAX = 2025;
let mapYearStart = MAP_YEAR_MIN, mapYearEnd = MAP_YEAR_MAX;




const ERAS = [
  { id:'ancient',      label:'Ancient',               start:-3000, end:  500 },
  { id:'medieval',     label:'Medieval',              start:  500, end: 1500 },
  { id:'renaissance',  label:'Renaissance',           start: 1400, end: 1600 },
  { id:'scientific',   label:'Scientific Revolution', start: 1550, end: 1700 },
  { id:'industrial',   label:'Industrial Revolution', start: 1760, end: 1914 },
  { id:'modern',       label:'Modern',                start: 1900, end: 2000 },
  { id:'contemporary', label:'Contemporary',          start: 2000, end: 2025 },
];
let _activeEra = null;

// Outline (ring) colors per category
const CAT_STROKES = {
  person: '#2C4F4F', // Key People – violet
  story:  '#4a88a4ff', // Stories    – cyan
  device: '#f3b13e72'  // Devices    – amber
};

// ------- Data stores -------
let _ALL_ITEMS = [];
let _VISIBLE   = [];

// ------- Utility -------
function slugify(s){
  return (s||'').toString().trim().toLowerCase()
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}
function dedupe(arr){ return Array.from(new Set((arr||[]).filter(Boolean))); }

// ------- CSV loader -------
async function loadCSV(path){
  const resp = await fetch(path, { cache:'no-store' });
  if (!resp.ok) throw new Error('CSV load failed: '+resp.status);
  const txt = (await resp.text()).replace(/\r/g,'');
  const lines = txt.split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];

  function split(line){
    const out=[]; let cur='', q=false;
    for (let i=0;i<line.length;i++){
      const ch=line[i];
      if (ch === '"'){ if (q && line[i+1] === '"'){ cur+='"'; i++; } else q=!q; }
      else if (ch===',' && !q){ out.push(cur); cur=''; }
      else cur+=ch;
    }
    out.push(cur); return out;
  }
  const headers = split(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g,'_'));
  const rows = lines.slice(1).map(line=>{
    const cols = split(line); const o={};
    headers.forEach((h,i)=> o[h] = (cols[i] ?? '').trim());
    return o;
  });
  dbg('CSV rows:', rows.length, 'headers:', headers);
  return rows;
}

// ------- Normalization -------
function normalizeItem(d){
  const pick = (...keys)=>{
    for (const k of keys){ if (k in d && String(d[k]).trim()!=='') return String(d[k]).trim(); }
    return '';
  };
  const num = v=>{
    if (v == null || v==='') return NaN;
    const m = String(v).match(/-?\d+(\.\d+)?/);
    return m ? +m[0] : NaN;
  };

  const out = {};

  // identity
  out.title = pick('title','name','device');
  out.id    = pick('id','slug') || slugify(out.title);
  out.slug  = out.id;

  // category
  let cat = pick('category','type','kind').toLowerCase();
  if (/dev(ic|e)/.test(cat)) cat = 'device';
  else if (/peo?ple?|person/.test(cat)) cat = 'person';
  else if (/story|hist/.test(cat)) cat = 'story';
  if (!cat) cat = 'device';
  out.category = cat;

  // abstract for cards
  out.caption = pick('abstract','caption','description');

  // years (support separate cols or a range string)
  let yStart = pick('year_start','start_year','start','from','year');
  let yEnd   = pick('year_end','end_year','end','to');
  if (!yStart && !yEnd){
    const yr = pick('years','date','date_range','year_range');
    if (yr){
      const m = yr.match(/-?\d{1,4}/g);
      if (m && m.length){ yStart = m[0]; if (m.length>1) yEnd = m[1]; }
    }
  }
  out.year     = yStart || '';
  out.year_end = yEnd   || '';

  // coords (accept many variants)
  const lat = pick('lat','latitude','lat_dd','y','lat_deg','latitude_deg');
  const lon = pick('lon','longitude','lon_dd','x','lon_deg','longitude_deg','lng');
  out.lat = num(lat);
  out.lon = num(lon);

  // location label
  out.origin_location = pick('location','place','region','origin_location');

  // images
  out.thumb = pick('thumb','thumbnail','image');
  out.image = pick('image','hero_image');

  // related_items (always include if present)
  if ('related_items' in d) {
    out.related_items = String(d.related_items).trim();
  }

  return out;
}

// ------- Geo fallback (lookup by location string) -------
// Cities & countries (lowercased keys). Add freely as you go.
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
function resolveCoordsInPlace(d){
  // already numeric?
  if (Number.isFinite(+d.lat) && Number.isFinite(+d.lon)) return true;

  // try multiple text fields
  const raw = [d.origin_location, d.location, d.place, d.region]
    .map(v => (v||'').toString().trim().toLowerCase())
    .filter(Boolean);

  if (!raw.length) return false;

  // try each full string, then split on comma and try parts
  const candidates = [];
  raw.forEach(s=>{
    candidates.push(s);
    s.split(/[;/,]/).forEach(p=>{
      const t = p.trim();
      if (t) candidates.push(t);
    });
  });

  // longest-first for city names
  candidates.sort((a,b)=> b.length - a.length);

  for (const key of candidates){
    if (GEO_LOOKUP[key]){
      const [la, lo] = GEO_LOOKUP[key];
      d.lat = la; d.lon = lo;
      return true;
    }
  }

  // last attempt: if one token matches a known country word
  const countries = Object.keys(GEO_LOOKUP).filter(k=>{
    // naive heuristic: country entries are single words or two words, and not common cities we mapped above
    return k.length >= 4 && !k.includes(' ');
  });
  for (const s of candidates){
    for (const c of countries){
      if (s.includes(c)){
        const [la, lo] = GEO_LOOKUP[c];
        d.lat = la; d.lon = lo;
        return true;
      }
    }
  }
  return false;
}

// ------- Images -------
function nodeImageURL(d){
  let p = (d.thumb || d.image || '').trim();
  if (!p){
    const cat = (d.category || '').toLowerCase();
    if (cat === 'person') p = 'images/placeholders/person_thumb.png';
    else if (cat === 'story') p = 'images/placeholders/story_thumb.png';
    else p = 'images/placeholders/device_thumb.png';
  }
  if (/^https?:\/\//i.test(p)) return p;
  if (!p.startsWith('images/')) p = 'images/' + p;
  return encodeURI(p);
}

// ------- Map frame/projection -------
const MAP_ASPECT = 2/1, MAP_PAD = 16;
const LON_MIN = -180, LON_MAX = 180, LAT_MIN = -95, LAT_MAX = 85;

function computeMapFrame(svg){
  const w=svg.clientWidth, h=svg.clientHeight;
  const innerW = Math.max(0, w - MAP_PAD*2);
  const innerH = Math.max(0, h - MAP_PAD*2);
  const targetW_byH = innerH * MAP_ASPECT;
  let fw, fh, fx, fy;
  if (targetW_byH <= innerW){ fh = innerH; fw = targetW_byH; fx = MAP_PAD + (innerW - fw)/2; fy = MAP_PAD; }
  else { fw = innerW; fh = fw / MAP_ASPECT; fx = MAP_PAD; fy = MAP_PAD + (innerH - fh)/2; }
  return { x:fx, y:fy, w:fw, h:fh };
}
function ensureBaseMap(scene){
  const svg = scene.ownerSVGElement || scene;
  let base = scene.querySelector('#worldBase');
  if (!base){
    base = document.createElementNS(NS,'image');
    base.id = 'worldBase';
    base.setAttribute('preserveAspectRatio','none');
    base.setAttribute('opacity','0.18');
    base.setAttribute('href','assets/world_light.svg');
    scene.insertBefore(base, scene.firstChild);
  }
  const f = computeMapFrame(svg);
  base.setAttribute('x', f.x); base.setAttribute('y', f.y);
  base.setAttribute('width', f.w); base.setAttribute('height', f.h);
}
function projEquirect(lon, lat, svg){
  const f = computeMapFrame(svg);
  const x = f.x + ((+lon - LON_MIN) / (LON_MAX - LON_MIN)) * f.w;
  const y = f.y + ((LAT_MAX - (+lat)) / (LAT_MAX - LAT_MIN)) * f.h;
  return [x,y];
}

function updateDebugBadge(counts){
  let badge = document.getElementById('debugBadge');
  if (!badge){
    badge = document.createElement('div');
    badge.id = 'debugBadge';
    badge.style.cssText = 'position:absolute; left:16px; bottom:16px; background:rgba(17,24,39,.85); color:#fff; padding:8px 10px; border-radius:10px; font:12px/1.3 system-ui; pointer-events:none;';
    (document.getElementById('map') || document.body).appendChild(badge);
  }
  badge.textContent = `shown: ${counts.shown}  |  no coords: ${counts.noGeo}  |  out of years: ${counts.outYear}  |  filtered: ${counts.filtered}`;
}
// ------- Overlap separation (small spiral jitter for exact same pixel) -------
function offsetOverlaps(items, svg){
  // Group nodes that are within a small pixel radius (not just exact pixel match)
  const threshold = 1; // px, only cluster nearly exact overlaps
  const points = items.map(d => {
    const [x, y] = projEquirect(+d.lon, +d.lat, svg);
    return { d, x, y, group: null };
  });

  let groupId = 0;
  for (let i = 0; i < points.length; ++i) {
    if (points[i].group !== null) continue;
    points[i].group = groupId;
    for (let j = i + 1; j < points.length; ++j) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      if (Math.sqrt(dx*dx + dy*dy) < threshold) {
        points[j].group = groupId;
      }
    }
    groupId++;
  }

  // For each group, if >1, spiral them out
  const ga = Math.PI * (3 - Math.sqrt(5)); // golden angle
  const groups = {};
  points.forEach(p => {
    if (!groups[p.group]) groups[p.group] = [];
    groups[p.group].push(p);
  });
  // Track cluster state globally
  window._CLUSTER_STATE = window._CLUSTER_STATE || {};
  Object.values(groups).forEach((list, idx) => {
    if (list.length > 1) {
      const cx = list[0].x, cy = list[0].y;
      // Stable cluster key: sorted slugs joined
      const sortedSlugs = list.map(p => p.d.slug).sort().join('__');
      const clusterId = `cluster_${sortedSlugs}`;
      const expanded = window._CLUSTER_STATE[clusterId] !== false; // default expanded
      if (expanded) {
  // Make clusters even tighter
  const r0 = 1.2, step = 1.1, maxR = 4.5;
        list.forEach((it, i) => {
          let r = r0 + step * Math.floor(i / 2);
          if (r > maxR) r = maxR;
          const a = i * ga;
          it.x = cx + Math.cos(a) * r;
          it.y = cy + Math.sin(a) * r;
          it._spider_origin = { x: cx, y: cy };
          it._cluster_id = clusterId;
          it._cluster_center = { x: cx, y: cy };
          it._cluster_size = list.length;
        });
      } else {
        // Collapsed: all nodes at center, only first node is visible
        list.forEach((it, i) => {
          it.x = cx;
          it.y = cy;
          it._spider_origin = { x: cx, y: cy };
          it._cluster_id = clusterId;
          it._cluster_center = { x: cx, y: cy };
          it._cluster_size = list.length;
          it._collapsed = true;
        });
      }
    }
  });

  return points.map(p => ({ d: p.d, x: p.x, y: p.y, _spider_origin: p._spider_origin }));
}

// ------- Zoom / pan -------
function rescaleMarkers(svg){
  const k = svg?._zoom?.k || 1;
  const scene = svg?._zoomScene;
  if (!scene) return;

  scene.querySelectorAll('.node').forEach(g=>{
    const x = +g.dataset.x || 0;
    const y = +g.dataset.y || 0;
    const hs = g._hover ? HOVER_SCALE : 1;   // hover scale
    const inv = 1 / (k) * hs;                // base inverse scale, then hover bump
    g.setAttribute('transform', `translate(${x},${y}) scale(${inv})`);

    // keep outlines consistent visually (don’t get thicker on hover)
    const ringW = 2 / (k * hs);
    const haloW = 6 / (k * hs);
    const ring  = g.querySelector('.ring');
    const halo  = g.querySelector('.ring-halo');
    if (ring) ring.setAttribute('stroke-width', ringW);
    if (halo) halo.setAttribute('stroke-width', haloW);
  });
}
function attachZoomPan(svgId, sceneId){
  const svg = document.getElementById(svgId);
  const scene = document.getElementById(sceneId);
  if (!svg || !scene) return;

  if (svg._zoomBound){ svg._zoomScene = scene; svg._applyZoomTransform(); return; }
  svg._zoomBound = true; svg._zoomScene = scene; svg._zoom = svg._zoom || { k:1, tx:0, ty:0 };

  function apply(){
    const { k, tx, ty } = svg._zoom;
    scene.setAttribute('transform', `translate(${tx},${ty}) scale(${k})`);
    rescaleMarkers(svg);
  }
  function clamp(){
    const { clientWidth:w, clientHeight:h } = svg;
    if (svg._zoom.k <= 1){ svg._zoom = { k:1, tx:0, ty:0 }; apply(); return; }
    const minTx = -(w*(svg._zoom.k-1)), maxTx = 0;
    const minTy = -(h*(svg._zoom.k-1)), maxTy = 0;
    svg._zoom.tx = Math.min(maxTx, Math.max(minTx, svg._zoom.tx));
    svg._zoom.ty = Math.min(maxTy, Math.max(minTy, svg._zoom.ty));
    apply();
  }
  function zoomAt(cx, cy, factor){
    const old = svg._zoom.k;
    const next = Math.max(1, Math.min(23.5, old * factor));
    if (next === old) return;
    const scale = next / old;
    svg._zoom.tx = cx - (cx - svg._zoom.tx) * scale;
    svg._zoom.ty = cy - (cy - svg._zoom.ty) * scale;
    svg._zoom.k  = next;
    clamp(); // Only clamp and apply transform, do not re-render
  }

  apply();

  svg.addEventListener('wheel', e=>{
    if (!e.ctrlKey && Math.abs(e.deltaY) < 40) return;
    e.preventDefault();
    zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.2 : 1/1.2);
  }, { passive:false });

  // Removed double-click to zoom: double-click is now reserved for cluster toggle only

  let tracking=false, dragging=false, pid=null, sx=0, sy=0, lx=0, ly=0;
  svg.addEventListener('pointerdown', e=>{
    if (e.button !== 0) return;
    tracking = (svg._zoom.k > 1);
    dragging = false;
    pid = e.pointerId; sx = lx = e.clientX; sy = ly = e.clientY;
  });
  svg.addEventListener('pointermove', e=>{
    if (!tracking) return;
    lx = e.clientX; ly = e.clientY;
    const dx = lx - sx, dy = ly - sy;
    const dist2 = dx*dx + dy*dy;
    if (!dragging && dist2 > 9){
      dragging = true;
      try { svg.setPointerCapture(pid); } catch {}
    }
    if (dragging){
      svg._zoom.tx += (e.movementX ?? (lx - sx));
      svg._zoom.ty += (e.movementY ?? (ly - sy));
      sx = lx; sy = ly;
      clamp();
    }
  });
  function endAny(){
    if (!tracking) return;
    if (dragging){ svg._justPanned = true; setTimeout(()=>{ svg._justPanned = false; }, 0); }
    try { svg.releasePointerCapture(pid); } catch {}
    tracking=false; dragging=false; pid=null;
  }
  svg.addEventListener('pointerup', endAny);
  svg.addEventListener('pointercancel', endAny);
  svg.addEventListener('pointerleave', endAny);

  svg._applyZoomTransform = apply;
  svg._clampZoom = clamp;

  // external buttons
  $('#zoomIn')?.addEventListener('click', ()=> zoomAt(svg.clientWidth/2, svg.clientHeight/2, 1.25));
  $('#zoomOut')?.addEventListener('click',()=> zoomAt(svg.clientWidth/2, svg.clientHeight/2, 1/1.25));
  $('#zoomReset')?.addEventListener('click',()=> { svg._zoom = {k:1,tx:0,ty:0}; apply(); });
}

// ------- Draw nodes & card -------
function drawImageNode(scene, x, y, r, d){
  const svg = scene.ownerSVGElement || scene;

  // defs/clip once per slug
  let defs = svg.querySelector('defs');
  if (!defs){ defs = document.createElementNS(NS,'defs'); svg.insertBefore(defs, svg.firstChild); }
  const clipId = `clip_${d.slug}`;
  let clip = svg.querySelector('#'+clipId);
  if (!clip){
    clip = document.createElementNS(NS,'clipPath');
    clip.setAttribute('id', clipId);
    clip.setAttribute('clipPathUnits','userSpaceOnUse');
    const cc = document.createElementNS(NS,'circle');
    cc.setAttribute('cx',0); cc.setAttribute('cy',0); cc.setAttribute('r',r);
    clip.appendChild(cc); defs.appendChild(clip);
  }

  const g = document.createElementNS(NS,'g');
  g.setAttribute('class','node');
  g.dataset.id = d.slug;
  g.dataset.x = x; g.dataset.y = y;
  g.setAttribute('transform', `translate(${x},${y})`);

  const href = nodeImageURL(d);
  const img = document.createElementNS(NS,'image');
  img.setAttribute('x', -r); img.setAttribute('y', -r);
  img.setAttribute('width', r*2); img.setAttribute('height', r*2);
  img.setAttribute('preserveAspectRatio','xMidYMid slice');
  img.setAttribute('clip-path', `url(#${clipId})`);
  img.setAttribute('href', href);
  img.onerror = () => {
    const cat = (d.category||'').toLowerCase();
    const fallback =
      cat==='person' ? 'images/placeholders/person_thumb.png' :
      cat==='story'  ? 'images/placeholders/story_thumb.png' :
                       'images/placeholders/device_thumb.png';
    img.setAttribute('href', fallback);
  };
  g.appendChild(img);

  // colored outline
  const ring = document.createElementNS(NS,'circle');
  ring.setAttribute('cx',0); ring.setAttribute('cy',0); ring.setAttribute('r',r);
  ring.setAttribute('fill','none');
  const stroke = CAT_STROKES[(d.category || '').toLowerCase()] || '#111827';
  ring.setAttribute('stroke', stroke);
  ring.setAttribute('stroke-width','1');
  ring.classList.add('ring');
  g.appendChild(ring);

  // subtle halo
  const halo = document.createElementNS(NS,'circle');
  halo.setAttribute('cx',0); halo.setAttribute('cy',0); halo.setAttribute('r', r + 3);
  halo.setAttribute('fill','none');
  halo.setAttribute('stroke', stroke);
  halo.setAttribute('stroke-opacity','0.14'); // slightly softer
  halo.setAttribute('stroke-width','6');
  halo.setAttribute('class','ring-halo');
  g.insertBefore(halo, ring); // under the main ring

  scene.appendChild(g);
}

function placeCardNearNode(cardEl, nodeEl, dx=0, dy=10){
  const svg = nodeEl.ownerSVGElement;
  const bb = nodeEl.getBBox();
  const pt = svg.createSVGPoint(); pt.x = bb.x + bb.width/2; pt.y = bb.y + bb.height/2;
  const screen = pt.matrixTransform(nodeEl.getScreenCTM());
  let left = screen.x + window.scrollX + dx;
  let top  = screen.y + window.scrollY + dy;

  cardEl.classList.remove('hidden');
  cardEl.style.left = left + 'px';
  cardEl.style.top  = top  + 'px';

  const r = cardEl.getBoundingClientRect();
  const margin=12;
  if (r.right > window.innerWidth - margin){
    left = Math.max(margin, window.innerWidth - r.width - margin) + window.scrollX;
  }
  if (r.bottom > window.innerHeight - margin){
    top = screen.y + window.scrollY - r.height - 10;
    if (top < margin) top = margin + window.scrollY;
  }
  cardEl.style.left = left + 'px';
  cardEl.style.top  = top  + 'px';
}

function showCard(d, nodeEl){
  const card = $('#card');
  $('#cardTitle').textContent = d.title || '';
  const meta = `${d.year || ''}${d.year_end?('–'+d.year_end):''}${d.origin_location ? (' • ' + d.origin_location) : ''}`;
  $('#cardMeta').textContent = meta;
  $('#cardCaption').textContent = d.caption || '';


  // Remove any existing Related Items section
  let oldRelated = document.getElementById('cardRelatedItems');
  if (oldRelated) oldRelated.remove();

  // Show the item's image under the abstract if present
  const url = nodeImageURL(d);
  const imgEl = $('#cardImage');
  if (url) {
    imgEl.src = url;
    imgEl.alt = d.title || '';
    imgEl.style.display = 'block';
    // Move the image directly under the abstract
    const captionEl = document.getElementById('cardCaption');
    if (captionEl && imgEl.parentNode) {
      captionEl.insertAdjacentElement('afterend', imgEl);
    }
  } else {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
  }

  // Insert Related Items section if any (from normalized d.related_items)
  let relatedList = [];
  if (d.related_items) {
    relatedList = d.related_items.split(/[,;]/).map(s => s.trim()).filter(Boolean);
  }
  if (relatedList.length > 0) {
    const relatedDiv = document.createElement('div');
    relatedDiv.id = 'cardRelatedItems';
    relatedDiv.style.margin = '12px 0 0 0';
    const label = document.createElement('div');
    label.textContent = 'Related Items:';
    label.style.fontWeight = 'bold';
    label.style.fontSize = '15px';
    label.style.marginBottom = '8px';
    relatedDiv.appendChild(label);
    
    const pillContainer = document.createElement('div');
    pillContainer.style.display = 'flex';
    pillContainer.style.flexWrap = 'wrap';
    pillContainer.style.gap = '6px';
    
    relatedList.forEach(slug => {
      // Try to find the related item in _ALL_ITEMS for title
      let item = (_ALL_ITEMS || []).find(x => x.slug === slug);
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'related-pill';
      pill.textContent = item ? (item.title || slug) : slug;
      pill.title = item ? `Show ${item.title || slug} on map` : slug;
      pill.style.background = '#e0e7ef';
      pill.style.color = '#333';
      pill.style.padding = '6px 12px';
      pill.style.borderRadius = '8px';
      pill.style.border = 'none';
      pill.style.cursor = item ? 'pointer' : 'not-allowed';
      pill.style.fontSize = '13px';
      pill.style.fontFamily = 'inherit';
      pill.style.transition = 'background 0.15s, color 0.15s';
      pill.style.fontWeight = '500';
      
      pill.onmouseenter = () => { 
        if (item) {
          pill.style.background = '#c7d6e7'; 
          pill.style.color = '#1a202c';
        }
      };
      pill.onmouseleave = () => { 
        pill.style.background = '#e0e7ef';
        pill.style.color = '#333';
      };
      
      if (item) {
        pill.onclick = () => {
          // Close current card
          closeCard();
          // Focus on the related item and show its card
          showCard(item, null);
          // If the item has coordinates, center the map on it
          if (item.lat && item.lon && !isNaN(item.lat) && !isNaN(item.lon)) {
            centerMapOn(item.lat, item.lon, 2);
          }
        };
      }
      pillContainer.appendChild(pill);
    });
    relatedDiv.appendChild(pillContainer);
    
    // Insert after the image if present, else after the abstract
    const imgEl2 = document.getElementById('cardImage');
    if (imgEl2 && imgEl2.style.display !== 'none' && imgEl2.parentNode) {
      imgEl2.insertAdjacentElement('afterend', relatedDiv);
    } else {
      const captionEl = document.getElementById('cardCaption');
      if (captionEl && captionEl.parentNode) {
        captionEl.insertAdjacentElement('afterend', relatedDiv);
      }
    }
  }


  imgEl.ondblclick = () => {
    // Use the same logic as the Read More button
    const mdUrl = d.markdown ? d.markdown : `details.html?id=${encodeURIComponent(d.slug)}`;
    window.location.href = mdUrl;
  };

  // Remove any existing button
  const oldBtn = $('#cardOpen');
  if (oldBtn) oldBtn.remove();

  // Create the glassmorphic "Read More" button
  const readMore = document.createElement('a');
  readMore.className = 'read-more-btn';
  readMore.id = 'cardOpen';
  readMore.textContent = 'Read More';
  readMore.href = `details.html?id=${encodeURIComponent(d.slug)}`;
  readMore.style.display = 'inline-block';
  readMore.style.marginTop = '18px';
  readMore.setAttribute('tabindex', '0');
  readMore.setAttribute('role', 'button');

  // Insert the button at the bottom of the card
  card.appendChild(readMore);

  placeCardNearNode(card, nodeEl);
}
function closeCard(){ $('#card')?.classList.add('hidden'); }
$('#closeCard')?.addEventListener('click', closeCard);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCard(); });
document.addEventListener('click', (e)=>{
  const card = $('#card'); if (!card || card.classList.contains('hidden')) return;
  const isInside = card.contains(e.target);
  const isNode   = !!e.target.closest('.node');
  if (!isInside && !isNode) closeCard();
});

// ------- Filters -------
function itemInYearRange(d, start, end){
  const ys = +d.year, ye = +d.year_end;
  const hasS = Number.isFinite(ys), hasE = Number.isFinite(ye);
  if (hasS && hasE) return Math.max(ys, start) <= Math.min(ye, end);
  if (hasS) return ys >= start && ys <= end;
  if (hasE) return ye >= start && ye <= end;
  return true; // show items with unknown year
}
function itemMatchesSearch(d, q){
  if (!q) return true;
  q = q.toLowerCase();
  return (
    (d.title||'').toLowerCase().includes(q) ||
    (d.caption||'').toLowerCase().includes(q) ||
    (d.origin_location||'').toLowerCase().includes(q)
  );
}
function currentFilters(){
  const search = ($('#search')?.value || '').trim();
  const cats = Array.from($('#f_category_group')?.querySelectorAll('input[type="checkbox"]:checked') || [])
    .map(i => i.value);
  return { search, cats };
}
function filteredItems(all){
  const f = currentFilters();
  return all.filter(d =>
    (f.cats.length === 0 || f.cats.includes(d.category)) &&
    itemInYearRange(d, mapYearStart, mapYearEnd) &&
    itemMatchesSearch(d, f.search)
  );
}

// ------- Sidebar (category) -------
function makeCategoryList(items){
  const root = $('#f_category_group'); if (!root) return;
  // Always use this order:
  const ORDER = ['device', 'person', 'story'];
  const label = v => ({device:'Devices', person:'Key People', story:'Stories'}[v] || v);

  // Only include categories present in the data, but in the desired order
  const catsInData = dedupe(items.map(d => (d.category||'').trim().toLowerCase()));
  const categories = ORDER.filter(v => catsInData.includes(v));

  root.innerHTML = '';
  categories.forEach(v=>{
    const lab = document.createElement('label');
    lab.className = 'checkline';
    const cb = document.createElement('input');
    cb.type='checkbox'; cb.value=v; cb.checked=true;
    const txt=document.createElement('span'); txt.textContent=' '+label(v);
    lab.append(cb, txt); root.appendChild(lab);
  });
  root.onchange = ()=> requestRender();
}

// ------- Era pills -------
function renderEraPills(){
  const wrap = $('#eraPills'); if (!wrap) return;
  wrap.innerHTML = '';
  ERAS.forEach(e=>{
    const b = document.createElement('button');
    b.type='button'; b.className='pill-btn'; b.textContent=e.label; b.dataset.era=e.id;
    b.addEventListener('click', ()=>{
      if (_activeEra === e.id){
        _activeEra = null;
        setYearRange(MAP_YEAR_MIN, MAP_YEAR_MAX);
        $$('.pill-btn', wrap).forEach(x=>x.classList.remove('active'));
      } else {
        _activeEra = e.id;
        setYearRange(e.start, e.end);
        $$('.pill-btn', wrap).forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
      }
      requestRender();
    });
    wrap.appendChild(b);
  });
}
function setYearRange(a,b){
  mapYearStart=a; mapYearEnd=b;
  drawMapAxis();
}

// ------- Axis -------
function drawMapAxis(){
  const svg = $('#mapAxis'); if (!svg) return;
  const w = svg.clientWidth || svg.parentNode.clientWidth || 0;
  const h = svg.clientHeight || 48;
  svg.innerHTML = '';
  const pad=20, axisY=Math.round(h/2);

  const line = document.createElementNS(NS,'line');
  line.setAttribute('x1',pad); line.setAttribute('y1',axisY);
  line.setAttribute('x2',w-pad); line.setAttribute('y2',axisY);
  line.setAttribute('stroke','#CBD5E1'); line.setAttribute('stroke-width','4');
  svg.appendChild(line);

  const toX = yr => pad + ((yr - MAP_YEAR_MIN)/(MAP_YEAR_MAX - MAP_YEAR_MIN || 1))*(w - pad*2);
  const x1 = toX(mapYearStart), x2 = toX(mapYearEnd);
  const sel = document.createElementNS(NS,'rect');
  sel.setAttribute('x', Math.min(x1,x2)); sel.setAttribute('y', axisY - 6);
  sel.setAttribute('width', Math.abs(x2 - x1)); sel.setAttribute('height', 12);
  sel.setAttribute('rx','6'); sel.setAttribute('fill','#111827'); sel.setAttribute('opacity','0.35');
  svg.appendChild(sel);

  const ticks = 8;
  for (let i=0;i<=ticks;i++){
    const yr = Math.round(MAP_YEAR_MIN + i*(MAP_YEAR_MAX-MAP_YEAR_MIN)/ticks);
    const x  = toX(yr);
    const t  = document.createElementNS(NS,'text');
    t.setAttribute('x', x-12); t.setAttribute('y', axisY + 18);
    t.setAttribute('fill','#666'); t.setAttribute('font-size','10');
    t.textContent = yr; svg.appendChild(t);
  }
}

// ------- Map render -------
function drawMap(items){
  const svg = $('#mapSvg'); if (!svg) return;
  let scene = svg.querySelector('#mapScene');
  if (!scene){ scene = document.createElementNS(NS,'g'); scene.id='mapScene'; svg.appendChild(scene); }
  ensureBaseMap(scene);
  $$('.node', scene).forEach(n => n.remove());

  // ensure coords (fallback from location if missing)
  const geo=[], noGeo=[];
  items.forEach(d=>{
    if (!Number.isFinite(+d.lat) || !Number.isFinite(+d.lon)) resolveCoordsInPlace(d);
    if (Number.isFinite(+d.lat) && Number.isFinite(+d.lon)) geo.push(d);
    else noGeo.push(d);
  });
  dbg('drawMap geo:', geo.length, 'noGeo:', noGeo.length);

  // Before offsetOverlaps:
geo.forEach(d => {
  const [x, y] = projEquirect(d.lon, d.lat, svg);
  d._orig_px = x;
  d._orig_py = y;
});

// separate exact overlaps and draw
  const positioned = offsetOverlaps(geo, svg);
  // Remove old spider-leg lines
  $$('.spider-leg', scene).forEach(l => l.remove());
  // Draw spider-leg lines first
  positioned.forEach(({d, x, y, _spider_origin}) => {
    // Use spiderfied position if present
    const x2 = d._spider_px !== undefined ? d._spider_px : x;
    const y2 = d._spider_py !== undefined ? d._spider_py : y;
    if (_spider_origin && (x2 !== _spider_origin.x || y2 !== _spider_origin.y)) {
      const line = document.createElementNS(NS, 'line');
      line.setAttribute('class', 'spider-leg');
      line.setAttribute('x1', _spider_origin.x);
      line.setAttribute('y1', _spider_origin.y);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      // All visual style is now in CSS
      scene.insertBefore(line, scene.firstChild);
    }
  });
  // Draw nodes (handle collapsed clusters)
  const drawnClusters = new Set();
  positioned.forEach(({d, x, y, _cluster_id, _cluster_size, _collapsed, _cluster_center}) => {
    if (_collapsed && _cluster_id) {
      // Only draw one node for collapsed cluster
      if (drawnClusters.has(_cluster_id)) return;
      drawnClusters.add(_cluster_id);
      drawImageNode(scene, x, y, 12, d);
      // Draw badge
      const badge = document.createElementNS(NS, 'g');
      badge.setAttribute('class', 'cluster-badge');
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', x+12); circle.setAttribute('cy', y-12);
      circle.setAttribute('r', 10);
      circle.setAttribute('fill', '#222');
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', 2);
      badge.appendChild(circle);
      const text = document.createElementNS(NS, 'text');
      text.setAttribute('x', x+12); text.setAttribute('y', y-8);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#fff');
      text.setAttribute('font-size', '13');
      text.setAttribute('font-family', 'system-ui,sans-serif');
      text.textContent = _cluster_size;
      badge.appendChild(text);
      scene.appendChild(badge);
    } else if (!_collapsed) {
      drawImageNode(scene, x, y, 12, d);
    }
  });

  // badge for off-map items
  let badge = $('#offMapBadge');
  if (!badge){
    badge = document.createElement('div');
    badge.id='offMapBadge';
    badge.style.cssText='position:absolute; right:14px; bottom:14px; background:rgba(17,24,39,.85); color:#fff; padding:6px 10px; border-radius:999px; font:12px/1 system-ui; pointer-events:none;';
    const wrap = $('#map'); (wrap || document.body).appendChild(badge);
  }
  badge.style.display = noGeo.length ? 'block' : 'none';
  if (noGeo.length) badge.textContent = `${noGeo.length} not on map`;

  attachZoomPan('mapSvg','mapScene');
  // Hover enlarge (event delegation on the scene)
  if (!scene._hoverWired){
    scene._hoverWired = true;

    // Use mouseover/mouseout so it bubbles from child <image>/<circle> to .node
    scene.addEventListener('mouseover', (e)=>{
      const svgEl = scene.ownerSVGElement;
      const node = e.target.closest('.node');
      if (!node || !scene.contains(node)) return;
      if (!node._hover){
        node._hover = true;
        node.parentNode.appendChild(node);
        // Use spiderfied position if present
        let d = _VISIBLE.find(d => d.slug === node.dataset.id);
        const x = d && d._spider_px !== undefined ? d._spider_px : +node.dataset.x;
        const y = d && d._spider_py !== undefined ? d._spider_py : +node.dataset.y;
        // Find and highlight matching spider-leg line, and show location label at origin
        const legs = scene.querySelectorAll('.spider-leg');
        let labelShown = false;
        legs.forEach(leg => {
          const lx = +leg.getAttribute('x2');
          const ly = +leg.getAttribute('y2');
          const ox = +leg.getAttribute('x1');
          const oy = +leg.getAttribute('y1');
          if (Math.abs(lx - x) < 1 && Math.abs(ly - y) < 1) {
            leg.classList.add('spider-leg-hover');
            if (!labelShown) {
              if (d && d._spider_origin) {
                // Pin label to the center of the spider-leg
                const midx = (ox + lx) / 2;
                const midy = (oy + ly) / 2;
                let label = document.createElementNS(NS, 'text');
                label.setAttribute('x', midx);
                label.setAttribute('y', midy - 10);
                label.setAttribute('fill', '#222');
                label.setAttribute('font-size', '15');
                label.setAttribute('font-family', 'system-ui,sans-serif');
                label.setAttribute('class', 'spider-leg-label');
                label.setAttribute('pointer-events', 'none');
                label.setAttribute('font-weight', 'bold');
                label.setAttribute('stroke', '#fff');
                label.setAttribute('stroke-width', '2');
                label.setAttribute('text-anchor', 'middle');
                // Fallback if no location
                label.textContent = d.origin_location || d.location || d.place || d.region || 'Unknown location';
                scene.appendChild(label);
                scene.appendChild(label);
                labelShown = true;
              }
            }
          }
        });
        rescaleMarkers(svgEl);
      }
    });

    scene.addEventListener('mouseout', (e)=>{
      const svgEl = scene.ownerSVGElement;
      const node = e.target.closest('.node');
      if (!node || !scene.contains(node)) return;
      if (node._hover){
        node._hover = false;
        // Remove highlight from all spider-leg lines
        scene.querySelectorAll('.spider-leg-hover').forEach(leg => leg.classList.remove('spider-leg-hover'));
        // Remove any spider-leg label
        scene.querySelectorAll('.spider-leg-label').forEach(lab => lab.remove());
        rescaleMarkers(svgEl);
      }
    });
  }

  // node click → card
  if (!scene._wired){
    scene._wired = true;
    scene.addEventListener('click', (e)=>{
      const svgEl = scene.ownerSVGElement;
      if (svgEl && svgEl._justPanned){ svgEl._justPanned = false; return; }
      const node = e.target.closest('.node'); if (!node) return;
      // Bring to front on click
      node.parentNode.appendChild(node);
      const d = _VISIBLE.find(x => x.slug === node.dataset.id);
      if (d) showCard(d, node);
    });
  }

  // Add after your single click event in drawMap
  scene.addEventListener('dblclick', (e) => {
    const svgEl = scene.ownerSVGElement;
    // Prevent browser zoom on ctrl/cmd + double-click
    if (e.ctrlKey || e.metaKey) return;
    // Prevent node double-click from interfering
    const node = e.target.closest('.node');
    if (node) return;

    // Get click position relative to SVG
    let pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const clickX = svgPt.x;
    const clickY = svgPt.y;

    // Always find the nearest cluster center within a generous radius
    let foundCluster = null;
    let minDist = Infinity;
    const threshold = 36; // px radius for cluster center (more generous)
    for (const d of _VISIBLE) {
      if (d._cluster_id && d._cluster_center) {
        const cx = d._cluster_center.x;
        const cy = d._cluster_center.y;
        const dist = Math.sqrt((clickX - cx) ** 2 + (clickY - cy) ** 2);
        if (dist < threshold && dist < minDist) {
          foundCluster = d;
          minDist = dist;
        }
      }
    }
    if (foundCluster && foundCluster._cluster_id && foundCluster._cluster_size > 1) {
      window._CLUSTER_STATE[foundCluster._cluster_id] = !window._CLUSTER_STATE[foundCluster._cluster_id];
      requestRender();
      return;
    }

    // Fallback: old overlap popup
    const overlapNodes = _VISIBLE.filter(d => {
      const px = d._orig_px, py = d._orig_py;
      return Math.abs(px - clickX) < 2 && Math.abs(py - clickY) < 2;
    });
    if (overlapNodes.length > 1) {
      showOverlapPopup(clickX, clickY, overlapNodes, svgEl);
    }
  });

  // After projecting all nodes:
  const overlapMap = new Map();
_VISIBLE.forEach(d => {
  const [x, y] = projEquirect(d.lon, d.lat, svg);
  d._px = x;
  d._py = y;
  const key = `${Math.round(x)},${Math.round(y)}`;
  if (!overlapMap.has(key)) overlapMap.set(key, []);
  overlapMap.get
});
const points = _VISIBLE.map(d => ({
  type: "Feature",
  properties: { ...d },
  geometry: { type: "Point", coordinates: [d.lon, d.lat] }
}));
const clusterIndex = new Supercluster({
  radius: 40, // adjust for your SVG scale
  maxZoom: 6  // adjust as needed
});
clusterIndex.load(points);
}

function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;

  // Always use filtered items
  let items = filteredItems(_ALL_ITEMS);

  // --- SORTING ---
  const sortBy = document.getElementById('sortBySelect')?.value || 'az';
  items = [...items]; // copy array

  if (sortBy === 'az') {
    items.sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
  } else if (sortBy === 'za') {
    items.sort((a, b) => (b.title || '').localeCompare(a.title || '', undefined, { sensitivity: 'base' }));
  } else if (sortBy === 'time') {
    items.sort((a, b) => {
      const ay = Number(a.year) || 0, by = Number(b.year) || 0;
      return ay - by;
    });
  }

  // Clear previous content
  grid.innerHTML = '';

  if (!items.length) {
    grid.innerHTML = '<p class="muted" style="padding:2em;text-align:center;">No items found.</p>';
    return;
  }

  items.forEach(d => {
    // Card container
    const card = document.createElement('div');
    card.className = 'gallery-card glass';
    card.tabIndex = 0;

    // Thumbnail image
    const img = document.createElement('img');
    img.src = nodeImageURL ? nodeImageURL(d) : (d.image || '');
    img.alt = d.title || '';
    img.className = 'gallery-thumb';
    card.appendChild(img);

    // Title
    const title = document.createElement('h3');
    title.textContent = d.title || '';
    card.appendChild(title);

    // Meta (year/location)
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${d.year || ''}${d.year_end ? '–' + d.year_end : ''}${d.origin_location ? ' • ' + d.origin_location : ''}`;
    card.appendChild(meta);

    // Caption (optional)
    if (d.caption) {
      const cap = document.createElement('p');
      cap.className = 'caption';
      cap.textContent = d.caption;
      card.appendChild(cap);
    }

    // "Read More" button
    const readMore = document.createElement('a');
    readMore.className = 'read-more-btn';
    readMore.textContent = 'Read More';
    // Adjust the href to match your markdown page URL pattern
    readMore.href = d.markdown ? d.markdown : `details.html?id=${encodeURIComponent(d.slug)}`;
    card.appendChild(readMore);
    grid.appendChild(card);
  });
}
// ------- View switch (tabs) -------
function switchView(name){
  $$('.view').forEach(v => v.classList.toggle('active', v.id === name));
  $$('.tab-btn[data-view]').forEach(btn => btn.classList.toggle('active', btn.dataset.view === name));
  requestAnimationFrame(()=> render());
  if (name === 'gallery') renderGallery();
  if (name === 'layered_timeline') {
    renderVisLayeredTimeline();
  }
  if (name === 'custom_timeline') {
    renderCustomTimeline();
  }
}

// =======================
// Custom Timeline Navigation
// =======================

let timelineZoom = 1; // 1 = default, >1 = zoomed in

function renderCustomTimeline() {

  // --- Pinch/trackpad zoom support ---
  // Attach after SVG is created

  // Only set max zoom out on first-ever load, not every render
  if (typeof renderCustomTimeline._initialized === 'undefined') {
    timelineZoom = 0.25;
    renderCustomTimeline._initialized = true;
  }

  const container = document.getElementById('timelineNav');
  if (!container) return;
  container.innerHTML = '';

  // --- Zoom controls as floating widget above timelineNav ---
  const zoomWidgetContainer = document.getElementById('timelineZoomWidget');
  zoomWidgetContainer.innerHTML = '';
  let zoomUi = document.createElement('div');
  zoomUi.className = 'zoom-ui';
  zoomUi.style.position = 'relative';
  zoomUi.style.display = 'flex';
  zoomUi.style.justifyContent = 'flex-start';
  zoomUi.style.alignItems = 'center';
  zoomUi.style.gap = '8px';
  zoomUi.style.background = 'none';
  zoomUi.style.borderRadius = '0';
  zoomUi.style.boxShadow = 'none';
  zoomUi.style.padding = '0';
  zoomUi.style.margin = '10px 10px 10px 30px';
  const zoomInBtn = document.createElement('button');
  zoomInBtn.textContent = '+';
  zoomInBtn.className = 'zoom-btn';
  zoomInBtn.title = 'Zoom in';
  zoomInBtn.onclick = () => {
    timelineZoom = Math.min(5, timelineZoom * 1.5);
    renderCustomTimeline();
  };
  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.textContent = '−';
  zoomOutBtn.className = 'zoom-btn';
  zoomOutBtn.title = 'Zoom out';
  zoomOutBtn.onclick = () => {
    timelineZoom = Math.max(0.02, timelineZoom / 1.5);
    renderCustomTimeline();
  };
  // Scroll to end button
  const scrollEndBtn = document.createElement('button');
  scrollEndBtn.textContent = '⇢';
  scrollEndBtn.className = 'zoom-btn';
  scrollEndBtn.title = 'Scroll to end';
  scrollEndBtn.onclick = () => {
    const nav = document.getElementById('timelineNav');
    if (nav) nav.scrollLeft = nav.scrollWidth;
  };

  const zoomResetBtn = document.createElement('button');
  zoomResetBtn.textContent = '⤾';
  zoomResetBtn.className = 'zoom-btn';
  zoomResetBtn.title = 'Reset zoom';
  zoomResetBtn.onclick = () => {
    timelineZoom = 1;
    renderCustomTimeline();
  };
  zoomUi.appendChild(zoomInBtn);
  zoomUi.appendChild(zoomOutBtn);
  zoomUi.appendChild(scrollEndBtn);
  zoomUi.appendChild(zoomResetBtn);
  zoomWidgetContainer.appendChild(zoomUi);

  // Remove old controls if present
  const oldZoomControls = document.getElementById('timelineZoomControls');
  if (oldZoomControls) oldZoomControls.remove();

  // Prepare data: sort by year, stack vertically if same year
  const items = filteredItems(_ALL_ITEMS).slice().sort((a, b) => {
    const ay = Number(a.year) || 0, by = Number(b.year) || 0;
    return ay - by;
  });
  // Debug: log items
  console.log('Custom timeline items:', items);
  if (!items.length) {
    container.innerHTML = '<div style="padding:2em;text-align:center;color:#888;">No items to display in the timeline.<br>Try clearing filters or check your data.</div>';
    return;
  }

  // --- Auto-select the last item by year (atomic clock) unless a hash/slug is present ---
  // Only do this if not restoring a specific slug from the hash
  const isCustomTimelineTab = document.getElementById('custom_timeline')?.classList.contains('active');
  const hash = window.location.hash;
  const restoringSlug = hash && hash.startsWith('#slug=');
  if (!restoringSlug && isCustomTimelineTab && items.length) {
    // Find the last item by year (highest year)
    const lastItem = items.reduce((a, b) => (Number(a.year) > Number(b.year) ? a : b));
    setTimeout(() => activateTimelineItem(lastItem), 0);
  }

  // Config
  const margin = { left: 40, right: 40, top: 0, bottom: 30 };
  const markerRadius = 13; // larger marker for better visibility
  const markerMargin = .1; // vertical margin between stacked markers (was 5)
  const minYear = MAP_YEAR_MIN;
  const maxYear = MAP_YEAR_MAX;
  const width = Math.max(900, (maxYear - minYear) * 18 * timelineZoom + margin.left + margin.right);

  // Stack: group by year, assign y-offsets
  const yearMap = new Map();
  items.forEach(item => {
    const y = Number(item.year) || 0;
    if (!yearMap.has(y)) yearMap.set(y, []);
    yearMap.get(y).push(item);
  });

  // --- Calculate max stack count for each band (category) ---
  const catList = ['story', 'person', 'device'];
  const maxStack = { story: 0, person: 0, device: 0 };
  yearMap.forEach(group => {
    const catCounts = { story: 0, person: 0, device: 0 };
    group.forEach(item => {
      let cat = (item.category || '').toLowerCase();
      if (cat.startsWith('dev')) cat = 'device';
      else if (cat.startsWith('peo')) cat = 'person';
      else if (cat.startsWith('sto')) cat = 'story';
      if (catList.includes(cat)) catCounts[cat]++;
    });
    catList.forEach(cat => {
      if (catCounts[cat] > maxStack[cat]) maxStack[cat] = catCounts[cat];
    });
  });

  // Calculate band heights and total SVG height
  // Use fixed, equal band heights for all groups for perfect alignment
  const fixedBandHeight = 80; // px, adjust as needed
  const bandGap = 8; // reduced gap between bands for a more compact layout
  const bandPadding = 32;
  const height = fixedBandHeight * catList.length + bandGap * (catList.length - 1) + bandPadding * 2;

  // Calculate band center Y positions
  let bandCenters = [];
  let yCursor = bandPadding;
  for (let i = 0; i < catList.length; ++i) {
    const bandCenter = yCursor + fixedBandHeight / 2;
    bandCenters.push(bandCenter);
    yCursor += fixedBandHeight + bandGap;
  }
  const categoryY = {
    story: bandCenters[0],
    person: bandCenters[1],
    device: bandCenters[2]
  };

  // SVG setup
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.style.display = 'block';
  svg.style.background = '#f8fafc';
  svg.style.border = '2px solid #e5e7eb';

  // --- Pinch/trackpad zoom handlers ---
  // --- Drag-to-scroll for timelineNav ---
  if (container.id === 'timelineNav') {
    let isDown = false, startX, scrollLeft;
    container.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDown = true;
      container.classList.add('drag-scroll');
      startX = e.pageX - container.offsetLeft;
      scrollLeft = container.scrollLeft;
      e.preventDefault();
    });
    container.addEventListener('mouseleave', () => {
      isDown = false;
      container.classList.remove('drag-scroll');
    });
    container.addEventListener('mouseup', () => {
      isDown = false;
      container.classList.remove('drag-scroll');
    });
    container.addEventListener('mousemove', (e) => {
      if (!isDown) return;
      const x = e.pageX - container.offsetLeft;
      const walk = (x - startX) * 1.2; // scroll speed
      container.scrollLeft = scrollLeft - walk;
    });
  }
  let pinchZooming = false;
  let lastPinchDist = null;
  let pinchStartZoom = null;
  svg.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
      pinchZooming = true;
      lastPinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      pinchStartZoom = timelineZoom;
      e.preventDefault();
    }
  }, { passive: false });
  svg.addEventListener('touchmove', function(e) {
    if (pinchZooming && e.touches.length === 2) {
      const newDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastPinchDist && pinchStartZoom) {
        let scale = newDist / lastPinchDist;
        let newZoom = Math.max(0.01, Math.min(5, pinchStartZoom * scale));
        if (Math.abs(newZoom - timelineZoom) > 0.01) {
          timelineZoom = newZoom;
          renderCustomTimeline();
        }
      }
      e.preventDefault();
    }
  }, { passive: false });
  svg.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) {
      pinchZooming = false;
      lastPinchDist = null;
      pinchStartZoom = null;
    }
  });
  // Trackpad pinch (ctrl+wheel)
  svg.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
      let factor = e.deltaY < 0 ? 1.08 : 1/1.08;
      let newZoom = Math.max(0.01, Math.min(5, timelineZoom * factor));
      if (Math.abs(newZoom - timelineZoom) > 0.01) {
        timelineZoom = newZoom;
        renderCustomTimeline();
      }
    }
  }, { passive: false });

  // X scale: year to X
  const yearToX = y => margin.left + ((y - minYear) * 18 * timelineZoom);

  // Draw axis

  // Add extra margin for year labels
  const labelMargin = 18;
  const axisY = height - margin.bottom - labelMargin;

  // --- Draw colored era bands in background ---
  // --- Draw dashed horizontal separators between marker groups ---
  // Calculate Y positions between bands (after bandCenters is set)
  if (bandCenters && bandCenters.length === 3) {
    const sepColor = '#b6c2d1';
    const sepOpacity = 0.38;
    const sepDash = '6 7';
    // Y positions: between stories/people and people/devices
    const sepY1 = (bandCenters[0] + bandCenters[1]) / 2;
    const sepY2 = (bandCenters[1] + bandCenters[2]) / 2;
    [sepY1, sepY2].forEach(sepY => {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', yearToX(minYear));
      line.setAttribute('x2', yearToX(maxYear));
      line.setAttribute('y1', sepY);
      line.setAttribute('y2', sepY);
      line.setAttribute('stroke', sepColor);
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', sepDash);
      line.setAttribute('opacity', sepOpacity);
      line.setAttribute('pointer-events', 'none');
      svg.appendChild(line);
    });
  }
  // Modern soft-glass style colors and effects
  // Unique SVG gradients for each era band
  const eraGradients = {
    ancient: [
      { offset: '0%', color: 'rgba(255,111,97,0.5)' },
      { offset: '100%', color: 'rgba(255,107,74,0.5)' }
    ],
    medieval: [
      { offset: '0%', color: 'rgba(255,201,74,0.5)' },
      { offset: '100%', color: 'rgba(181,255,90,0.5)' }
    ],
    renaissance: [
      { offset: '0%', color: 'rgba(90,190,255,0.5)' },
      { offset: '100%', color: 'rgba(93,225,192,0.5)' }
    ],
    scientific: [
      { offset: '0%', color: 'rgba(140,230,200,0.5)' },
      { offset: '100%', color: 'rgba(120,200,180,0.5)' }
    ],
    industrial: [
      { offset: '0%', color: 'rgba(155,225,93,0.5)' },
      { offset: '100%', color: 'rgba(155,225,93,0.5)' }
    ],
    modern: [
      { offset: '0%', color: 'rgba(255,111,97,0.5)' },
      { offset: '33%', color: 'rgba(255,201,74,0.5)' },
      { offset: '66%', color: 'rgba(90,190,255,0.5)' },
      { offset: '100%', color: 'rgba(155,225,93,0.5)' }
    ],
    contemporary: [
      { offset: '0%', color: 'rgba(140,255,210,0.5)' },
      { offset: '100%', color: 'rgba(120,200,180,0.5)' }
    ]
  };
  // Add SVG defs for all gradients if not present
  let defs = svg.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS(svgNS, 'defs');
    svg.appendChild(defs);
  }
  Object.entries(eraGradients).forEach(([eraId, stops]) => {
    if (!svg.querySelector(`#eraBandGradient_${eraId}`)) {
      const grad = document.createElementNS(svgNS, 'linearGradient');
      grad.setAttribute('id', `eraBandGradient_${eraId}`);
      grad.setAttribute('x1', '0%');
      grad.setAttribute('y1', '0%');
      grad.setAttribute('x2', '100%');
      grad.setAttribute('y2', '0%');
      stops.forEach(stop => {
        const stopEl = document.createElementNS(svgNS, 'stop');
        stopEl.setAttribute('offset', stop.offset);
        stopEl.setAttribute('stop-color', stop.color);
        grad.appendChild(stopEl);
      });
      defs.appendChild(grad);
    }
  });
  // For border, use a subtle semi-transparent gray
  const eraBandBorder = 'rgba(180,180,180,0.18)';
  // Make bands fill the entire timelineNav SVG height
  const bandY = 0;
  const bandHeight = height;
  ERAS.forEach(era => {
    // Only draw if era is in visible range
    const startX = yearToX(Math.max(era.start, minYear));
    const endX = yearToX(Math.min(era.end, maxYear));
    if (endX > startX) {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', startX);
      rect.setAttribute('y', bandY);
      rect.setAttribute('width', endX - startX);
      rect.setAttribute('height', bandHeight);
      rect.setAttribute('fill', `url(#eraBandGradient_${era.id})`);
           rect.setAttribute('stroke', eraBandBorder);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('rx', 18); // more rounded corners
      // Removed glassmorphism filter
      rect.setAttribute('pointer-events', 'none');
      svg.appendChild(rect);
      // Add label centered in band, but only if it fits
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('x', (startX + endX) / 2);
      label.setAttribute('y', bandY + 22);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-size', '16.5px');
      label.setAttribute('font-family', '');
      label.setAttribute('fill', '#222');
      label.setAttribute('pointer-events', 'none');
      label.setAttribute('style', 'text-shadow:0 2px 8px rgba(255,255,255,0.25); letter-spacing:0.5px; transition:opacity 0.35s cubic-bezier(.4,0,.2,1);');
      label.textContent = era.label;
      svg.appendChild(label);
      // Estimate label width (SVG text not in DOM yet, so estimate)
      // Use 0.6em per character as a rough estimate, or try getBBox after appending
      let estLabelWidth = era.label.length * 10.5 + 24; // fudge factor for font size/padding
      const bandWidth = endX - startX;
      // If band is too narrow, fade out label
      if (bandWidth < estLabelWidth) {
        label.setAttribute('opacity', '0');
        label.setAttribute('aria-hidden', 'true');
      } else {
        label.setAttribute('opacity', '0.82');
        label.removeAttribute('aria-hidden');
      }
    }
  });
  // Removed glassmorphism filter for era bands

  // Draw axis line on top of bands
  const axis = document.createElementNS(svgNS, 'line');
  axis.setAttribute('x1', yearToX(minYear));
  axis.setAttribute('x2', yearToX(maxYear));
  axis.setAttribute('y1', axisY);
  axis.setAttribute('y2', axisY);
  axis.setAttribute('stroke', '#bbb');
  axis.setAttribute('stroke-width', '2');
  svg.appendChild(axis);

  // --- Dynamic tics and year labels ---
  // Calculate visible year range and pixel density
  const pxPerYear = 6 * timelineZoom;
  const minTicPx = 60; // minimum px between tics
  // Calculate visible year range
  const visibleYears = maxYear - minYear;
  const axisWidth = (maxYear - minYear) * 18 * timelineZoom;
  // Aim for 6–12 tics, but always use a "nice" interval
  function niceNumber(range, round) {
    // Returns a "nice" number approximately equal to range
    // round = true for round numbers, false for ceiling
    const exponent = Math.floor(Math.log10(range));
    const fraction = range / Math.pow(10, exponent);
    let niceFraction;
    if (round) {
      if (fraction < 1.5) niceFraction = 1;
      else if (fraction < 3) niceFraction = 2;
      else if (fraction < 7) niceFraction = 5;
      else niceFraction = 10;
    } else {
      if (fraction <= 1) niceFraction = 1;
      else if (fraction <= 2) niceFraction = 2;
      else if (fraction <= 5) niceFraction = 5;
      else niceFraction = 10;
    }
    return niceFraction * Math.pow(10, exponent);
  }

  // Calculate ideal tic interval
  // Force tic interval to 100 years
  const ticInterval = 100;
  // Find first tic >= minYear
  let ticStart = Math.ceil(minYear / ticInterval) * ticInterval;
  for (let y = ticStart; y <= maxYear; y += ticInterval) {
    const x = yearToX(y);
    // Draw tic
    const tic = document.createElementNS(svgNS, 'line');
    tic.setAttribute('x1', x);
    tic.setAttribute('x2', x);
    tic.setAttribute('y1', axisY);
    tic.setAttribute('y2', axisY + 12);
    tic.setAttribute('stroke', '#888');
    tic.setAttribute('stroke-width', '2');
    svg.appendChild(tic);
    // Draw label at every tic
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', axisY + 28);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('font-size', '13px');
    label.setAttribute('fill', '#444');
    label.setAttribute('dominant-baseline', 'hanging');
    label.textContent = y;
    svg.appendChild(label);
  }

  yearMap.forEach((group, year) => {
    // For each category, stack within its band
    const catStacks = { story: 0, person: 0, device: 0 };
    group.forEach((item, i) => {
  const x = yearToX(Number(item.year) || minYear);
  let cat = (item.category || '').toLowerCase();
  if (cat.startsWith('dev')) cat = 'device';
  else if (cat.startsWith('peo')) cat = 'person';
  else if (cat.startsWith('sto')) cat = 'story';
  const yBase = categoryY[cat] ?? categoryY['person'];
  const stackIdx = catStacks[cat]++;
  // Center the marker in the card background vertically
  const cardHeight = 28; // smaller card height for all markers
  const y = yBase - stackIdx * (cardHeight + markerMargin);

      // --- Dynamic card width calculation (refined) ---
      const minCardWidth = 120;
      const maxCardWidth = 520; // px, max width for very long titles
      const leftPad = markerRadius * 2 + 18; // space for circle + gap
      const rightPad = 24;
      const dateWidth = (item.year_end ? 60 : 0);
      // Measure full title width
      const tempText = document.createElementNS(svgNS, 'text');
      tempText.setAttribute('font-size', '12px');
      tempText.setAttribute('font-family', 'inherit,sans-serif');
      tempText.setAttribute('font-weight', '400');
      tempText.setAttribute('letter-spacing', '0');
      tempText.textContent = item.title || '';
      tempText.setAttribute('x', -9999);
      tempText.setAttribute('y', -9999);
      svg.appendChild(tempText);
      const bbox = tempText.getBBox();
      let textWidth = bbox.width;
      svg.removeChild(tempText);
      let cardWidth = Math.max(minCardWidth, Math.min(leftPad + textWidth + rightPad + dateWidth, maxCardWidth));
      let displayTitle = item.title || '';

      // Marker group
      const g = document.createElementNS(svgNS, 'g');
      g.setAttribute('class', 'timeline-marker');
      g.setAttribute('tabindex', '0');
      g.setAttribute('cursor', 'pointer');
      g.setAttribute('data-slug', item.slug);
      g.setAttribute('transform', `translate(${x},${y})`);

      // Circle (thumb border)
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('r', markerRadius);
  circle.setAttribute('cx', 0);
  circle.setAttribute('cy', 0);
  circle.setAttribute('fill', CAT_STROKES[item.category] || '#888');
  circle.setAttribute('stroke', '#fff');
  circle.setAttribute('stroke-width', '2.5');
  g.appendChild(circle);

      // Image (circle crop)
      if (item.image || item.thumb) {
        const img = document.createElementNS(svgNS, 'image');
        img.setAttribute('href', nodeImageURL(item));
        img.setAttribute('x', -markerRadius + 1);
        img.setAttribute('y', -markerRadius + 1);
        img.setAttribute('width', (markerRadius - 1) * 2);
        img.setAttribute('height', (markerRadius - 1) * 2);
        // No clip-path: show full image, not cropped
        g.appendChild(img);
      }

      // Helper to show expanded title (card) if hovered or active
      function showExpandedTitle() {
        // Remove any previous year-range bar from SVG (global, not per marker)
        const prevBar = svg.querySelector('rect.timeline-year-bar');
        if (prevBar) prevBar.remove();
        // Remove any previous year label from this marker group
        const prevYear = g.querySelector('text.marker-year-label');
        if (prevYear) prevYear.remove();

        // Add year-range bar on the axis for this item
        const yearBarStart = Number(item.year);
        let yearBarEnd = Number(item.year_end);
        if (!isNaN(yearBarStart)) {
          if (isNaN(yearBarEnd)) yearBarEnd = yearBarStart;
          // Bar coordinates
          const barX = yearToX(yearBarStart);
          const barX2 = yearToX(yearBarEnd);
          const barY = axisY - 4; // just above axis
          const barHeight = 8; // thickness of the bar
          const barColor = '#000000ff';
          const bar = document.createElementNS(svgNS, 'rect');
          bar.setAttribute('x', Math.min(barX, barX2));
          bar.setAttribute('y', barY);
          bar.setAttribute('width', Math.abs(barX2 - barX) || 8);
          bar.setAttribute('height', barHeight);
          bar.setAttribute('fill', barColor);
          bar.setAttribute('opacity', '0.85');
          bar.setAttribute('rx', 4);
          bar.classList.add('timeline-year-bar');
          // Insert before markers so it doesn't cover them
          svg.insertBefore(bar, svg.firstChild);
        }

        // Add year/dates label right under the marker image/circle, centered
        let yearLabel = '';
        let yStart = Number(item.year);
        let yEnd = Number(item.year_end);
        if (item.year && item.year_end) {
          yearLabel = `${item.year}–${item.year_end}`;
        } else if (item.year) {
          yearLabel = `${item.year}`;
        }
        if (yearLabel && !isNaN(yStart)) {
          // Place label under the marker (circle at 0,0, radius markerRadius)
          const labelY = markerRadius - 40; // 30px above center of marker
          const yearText = document.createElementNS(svgNS, 'text');
          yearText.setAttribute('x', 0 + 50);
          yearText.setAttribute('y', labelY);
          yearText.setAttribute('text-anchor', 'middle');
          yearText.setAttribute('font-size', '10px');
          yearText.setAttribute('font-family', 'Optician Sans', 'inherit', 'sans-serif');
          yearText.setAttribute('font-weight', '1000');
          yearText.setAttribute('fill', '#222');
          yearText.setAttribute('pointer-events', 'none');
          yearText.classList.add('marker-year-label');
          yearText.textContent = yearLabel;
          g.appendChild(yearText);
        }
        // Remove any previous expanded card background and title
        const prevBg = g.querySelector('rect.card-bg');
        if (prevBg) prevBg.remove();
        const prevTitle = g.querySelector('text.card-title');
        if (prevTitle) prevTitle.remove();

        // Dynamically size card to fit full title (up to a max width)
        const cardHeight = markerRadius * 2 + 8;
        const leftPadding = 12;
        const rightPadding = 16;
        const imageSpace = markerRadius * 2; // space for image
        const maxCardWidth = 520; // px, max width for very long titles

        // Measure full title width
        const tempText = document.createElementNS(svgNS, 'text');
        tempText.setAttribute('font-size', '14px');
        tempText.setAttribute('font-family', 'inherit,sans-serif');
        tempText.setAttribute('font-weight', '400');
        tempText.setAttribute('letter-spacing', '0');
        tempText.textContent = displayTitle;
        svg.appendChild(tempText);
        const textWidth = tempText.getBBox().width;
        svg.removeChild(tempText);
        const cardWidth = Math.min(leftPadding + imageSpace + textWidth + rightPadding, maxCardWidth);

        // Card background (flag: starts at marker, extends right)
        const hoverBg = document.createElementNS(svgNS, 'rect');
        hoverBg.setAttribute('x', markerRadius + 2); // 6px gap between marker and flag
        hoverBg.setAttribute('y', -cardHeight / 2);
        hoverBg.setAttribute('width', cardWidth - 20);
        hoverBg.setAttribute('height', cardHeight);
        hoverBg.setAttribute('rx', 14);
        hoverBg.setAttribute('fill', '#fff');
        hoverBg.setAttribute('stroke', CAT_STROKES[item.category] || '#bbb');
        hoverBg.setAttribute('stroke-width', '1.5');
        hoverBg.setAttribute('filter', 'drop-shadow(0 2px 8px #0001)');
        hoverBg.classList.add('card-bg');
        g.appendChild(hoverBg); // after marker, so flag is behind text

        // Marker image/circle stays at (0,0)
        circle.setAttribute('cx', 0);
        circle.setAttribute('cy', 0);
        // Center image (if present)
        if (item.image || item.thumb) {
          const img = g.querySelector('image');
          if (img) {
            img.setAttribute('x', -markerRadius + 2);
            img.setAttribute('y', -markerRadius + 2);
            img.setAttribute('width', (markerRadius - 2) * 2);
            img.setAttribute('height', (markerRadius - 2) * 2);
          }
        }

        // Text: left-aligned inside flag, vertically centered
        const hoverTitle = document.createElementNS(svgNS, 'text');
        hoverTitle.setAttribute('x', markerRadius + 6 + leftPadding );
        hoverTitle.setAttribute('y', 0);
        hoverTitle.setAttribute('dominant-baseline', 'middle');
        hoverTitle.setAttribute('text-anchor', 'start');
        hoverTitle.setAttribute('font-size', '14px');
        hoverTitle.setAttribute('font-family', 'inherit,sans-serif');
        hoverTitle.setAttribute('fill', '#222');
        hoverTitle.setAttribute('pointer-events', 'none');
        hoverTitle.classList.add('card-title');
        hoverTitle.textContent = displayTitle;
        g.appendChild(hoverTitle);
      }


      // Show expanded title if hovered or active, and move hovered marker to top
      g.addEventListener('mouseenter', () => {
        // Move this marker group to the end of the SVG so it renders on top
        svg.appendChild(g);
        showExpandedTitle();
      });
      g.addEventListener('mouseleave', () => {
        // Only remove year-range bar if no marker is active or hovered
        setTimeout(() => {
          const anyActive = svg.querySelector('.timeline-marker.active:hover, .timeline-marker.active');
          if (!anyActive) {
            const prevBar = svg.querySelector('rect.timeline-year-bar');
            if (prevBar) prevBar.remove();
          }
        }, 10);
  // Remove any previous year-range bar from SVG
  const prevBar = svg.querySelector('rect.timeline-year-bar');
  if (prevBar) prevBar.remove();
        // Only remove if not active
        if (!g.classList.contains('active')) {
          const hoverBg = g.querySelector('rect.card-bg');
          if (hoverBg) hoverBg.remove();
          const hoverTitle = g.querySelector('text.card-title');
          if (hoverTitle) hoverTitle.remove();
          const hoverYear = g.querySelector('text.marker-year-label');
          if (hoverYear) hoverYear.remove();
        }
        // After hover ends, if there is an active marker, move it to top
        const active = svg.querySelector('.timeline-marker.active');
        if (active && active !== g) {
          svg.appendChild(active);
        }
      });

      // If active on render, show expanded title and move to top (unless hovered)
      if (g.classList.contains('active')) {
        showExpandedTitle();
        // Only move to top if not hovered
        if (!g.matches(':hover')) {
          svg.appendChild(g);
        }
      }

      // --- Add click event to marker ---
      g.addEventListener('click', () => {
        // If not hovered, move this marker group to the end of the SVG so it renders on top
        if (!g.matches(':hover')) {
          svg.appendChild(g);
        }
        renderTimelineCard(item);
        // Remove .active from all markers, add to this one
        $$('.timeline-marker').forEach(m => {
          m.classList.remove('active');
          // Remove expanded title and year label from all except hovered
          if (!m.matches(':hover')) {
            const hoverBg = m.querySelector('rect.card-bg');
            if (hoverBg) hoverBg.remove();
            const hoverTitle = m.querySelector('text.card-title');
            if (hoverTitle) hoverTitle.remove();
            const hoverYear = m.querySelector('text.marker-year-label');
            if (hoverYear) hoverYear.remove();
          }
        });
        g.classList.add('active');
  showExpandedTitle();
      });
      svg.appendChild(g);
    });
  });

  container.appendChild(svg);

  // On initial render, highlight the marker for the currently selected card (if any)
  const cardArea = document.getElementById('timelineCardArea');
  if (cardArea && cardArea.firstChild) {
    const h2 = cardArea.querySelector('h2');
    if (h2) {
      const selectedTitle = h2.textContent;
      $$('.timeline-marker').forEach(g => {
        const markerTitle = g.querySelector('text');
        if (markerTitle && markerTitle.textContent === selectedTitle) {
          g.classList.add('active');
          // Show expanded title for the active marker
          const show = g.querySelector('rect.card-bg') && g.querySelector('text.card-title');
          if (!show) {
            // Only show if not already present
            g.dispatchEvent(new Event('mouseenter'));
          }
        }
      });
    }
  }
}

// Render the card above the timeline
function renderTimelineCard(item) {
  // Get sorted items array for navigation
  const itemsSorted = filteredItems(_ALL_ITEMS).slice().sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));
  const idx = itemsSorted.findIndex(i => i.slug === item.slug);
  // Card creation and nav arrows (ensure card is in DOM before DOM ops)
  let cardArea = document.getElementById('timelineCardArea');
  if (!cardArea) return;
  cardArea.innerHTML = '';
  // Card nav container: flex row, center, arrows outside card
  cardArea.style.display = 'flex';
  cardArea.style.flexDirection = 'row';
  cardArea.style.alignItems = 'center';
  cardArea.style.justifyContent = 'center';
  cardArea.innerHTML = '';

  // Prev button (outside card)
  const prevBtn = document.createElement('button');
  prevBtn.innerHTML = '←';
  prevBtn.className = 'card-nav-btn card-nav-outer';
  prevBtn.disabled = idx <= 0;
  prevBtn.title = 'Previous by year';
  prevBtn.onclick = () => {
    if (idx > 0) {
      renderTimelineCard(itemsSorted[idx - 1]);
      syncTimelineMarkerToCard(itemsSorted[idx - 1]);
    }
  };
  cardArea.appendChild(prevBtn);

  let card = document.createElement('div');
  card.className = 'card timeline-horizontal-card';
  card.style.position = 'static';
  card.style.margin = '0 18px 18px 18px';
  card.style.width = '700px';
  card.style.maxWidth = '98vw';
  card.style.aspectRatio = '2/1';
  card.style.display = 'flex';
  card.style.flexDirection = 'row';
  card.style.alignItems = 'stretch';
  card.style.gap = '24px';
  card.style.padding = '24px 32px';
  card.style.boxSizing = 'border-box';
  card.style.background = 'var(--glass-bg, #fff)';
  card.style.borderRadius = '18px';
  card.style.boxShadow = 'var(--shadow-soft, 0 2px 16px #0001)';
  card.style.zIndex = 1;
  cardArea.appendChild(card);

  // Next button (outside card)
  const nextBtn = document.createElement('button');
  nextBtn.innerHTML = '→';
  nextBtn.className = 'card-nav-btn card-nav-outer';
  nextBtn.disabled = idx >= itemsSorted.length - 1;
  nextBtn.title = 'Next by year';
  nextBtn.onclick = () => {
    if (idx < itemsSorted.length - 1) {
      renderTimelineCard(itemsSorted[idx + 1]);
      syncTimelineMarkerToCard(itemsSorted[idx + 1]);
    }
  };
  cardArea.appendChild(nextBtn);

  // Left: image (if any)
  const left = document.createElement('div');
  left.style.flex = '0 0 260px';
  left.style.display = 'flex';
  left.style.alignItems = 'center';
  left.style.justifyContent = 'center';
  if (item.image || item.thumb) {
    const img = document.createElement('img');
    img.src = nodeImageURL(item);
    img.alt = item.title || '';
    img.style.width = '240px';
    img.style.height = 'auto';
    img.style.maxHeight = '90%';
    img.style.borderRadius = '14px';
    img.style.boxShadow = '0 2px 12px #0002';
    left.appendChild(img);
  }
  card.appendChild(left);

  // Right: details (scrollable content)
  const right = document.createElement('div');
  right.style.flex = '1 1 0';
  right.style.display = 'flex';
  right.style.flexDirection = 'column';
  right.style.justifyContent = 'flex-start';
  right.style.overflowY = 'auto';
  right.style.maxHeight = '100%';

  // Container for right + persistent button
  const rightWrap = document.createElement('div');
  rightWrap.style.flex = '1 1 0';
  rightWrap.style.display = 'flex';
  rightWrap.style.flexDirection = 'column';
  rightWrap.style.justifyContent = 'space-between';
  rightWrap.style.height = '100%';


  // Title
  const h2 = document.createElement('h2');
  h2.textContent = item.title || '';
  h2.style.margin = '0 0 6px 0';
  h2.style.fontSize = '1.5em';
  right.appendChild(h2);

  // Meta: years, location, category
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.style.color = '#475569';
  meta.style.fontSize = '1em';
  meta.style.marginBottom = '8px';
  meta.innerHTML =
    `<b>${item.year || ''}${item.year_end ? '–' + item.year_end : ''}</b>` +
    (item.origin_location ? ` &bull; <span>${item.origin_location}</span>` : '') +
    (item.category ? ` &bull; <span style="color:#fff;background:#888;padding:2px 8px;border-radius:8px;font-size:0.95em;">${item.category}</span>` : '');
  right.appendChild(meta);

  // Caption/abstract/description
  if (item.caption) {
    const cap = document.createElement('p');
    cap.className = 'caption';
    cap.textContent = item.caption;
    cap.style.margin = '8px 0 12px 0';
    cap.style.lineHeight = '1.5';
    right.appendChild(cap);
  }

  // Related items (if present)
  if (item.related_items) {
    const relDiv = document.createElement('div');
    relDiv.className = 'related-items';
    relDiv.style.margin = '8px 0 0 0';
    relDiv.innerHTML = `<span style="font-weight:600;color:#666;">Related:</span> `;
    // Split, trim, and look up each related item by slug
    const relatedSlugs = item.related_items.split(',').map(s => s.trim()).filter(Boolean);
    relatedSlugs.forEach(slug => {
      // Find the related item in _ALL_ITEMS
      const related = (_ALL_ITEMS || []).find(i => i.slug === slug);
      const label = related ? (related.title || slug) : slug;
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'related-pill';
      pill.textContent = label;
      pill.title = related ? `Show details for ${label}` : slug;
      pill.style.background = '#e0e7ef';
      pill.style.color = '#333';
      pill.style.padding = '2px 10px';
      pill.style.borderRadius = '8px';
      pill.style.marginRight = '6px';
      pill.style.border = 'none';
      pill.style.cursor = related ? 'pointer' : 'not-allowed';
      pill.style.fontSize = '1em';
      pill.style.fontFamily = 'inherit';
      pill.style.transition = 'background 0.15s, color 0.15s';
      pill.onmouseenter = () => { pill.style.background = '#c7d6e7'; };
      pill.onmouseleave = () => { pill.style.background = '#e0e7ef'; };
      if (related) {
        pill.onclick = () => {
          activateTimelineItem(related);
        };
      }
      relDiv.appendChild(pill);
    });
    right.appendChild(relDiv);
  }

  // Extra fields (show any other non-empty fields not already shown)
  const shown = ['title','year','year_end','origin_location','category','caption','image','thumb','related_items','markdown','slug','id','lat','lon','latitude','longitude'];
  // Also filter out internal coordinate properties and any keys starting with _ or containing 'px'/'py'
  const internalKeys = ['px','py','_orig_px','_orig_py','_px','_py','x','y'];
  const extra = Object.entries(item).filter(([k,v]) => {
    if (!v || shown.includes(k)) return false;
    if (internalKeys.includes(k)) return false;
    if (k.startsWith('_')) return false;
    if (/^(orig_)?p[xy]$/i.test(k)) return false;
    return true;
  });
  if (extra.length) {
    const extraDiv = document.createElement('div');
    extraDiv.className = 'extra-fields';
    extraDiv.style.margin = '12px 0 0 0';
    extraDiv.style.display = 'flex';
    extraDiv.style.flexWrap = 'wrap';
    extraDiv.style.gap = '10px 18px';
    extra.forEach(([k,v]) => {
      const row = document.createElement('div');
      row.innerHTML = `<span style="font-weight:600;color:#888;">${k.replace(/_/g,' ')}:</span> <span style="color:#333;">${v}</span>`;
      extraDiv.appendChild(row);
    });
    right.appendChild(extraDiv);
  }

  // Read More button (persistent, always at bottom)
  const readMore = document.createElement('a');
  readMore.className = 'read-more-btn';
  readMore.textContent = 'Read More';
  // If this is the custom timeline view, add from=timeline and slug
  const isTimelineView = document.getElementById('custom_timeline')?.classList.contains('active');
  if (isTimelineView) {
    readMore.href = `details.html?id=${encodeURIComponent(item.slug)}&from=timeline&slug=${encodeURIComponent(item.slug)}`;
  } else {
    readMore.href = item.markdown ? item.markdown : `details.html?id=${encodeURIComponent(item.slug)}`;
  }
  readMore.style.margin = '18px 0 0 0';
  readMore.style.alignSelf = 'flex-end';

  rightWrap.appendChild(right);
  rightWrap.appendChild(readMore);
  card.appendChild(rightWrap);

  // Helper: scroll timelineNav to marker for item and show expanded title
  function syncTimelineMarkerToCard(item) {
    const nav = document.getElementById('timelineNav');
    if (!nav) return;
    const year = Number(item.year) || 0;
    const markerX = 40 + ((year - MAP_YEAR_MIN) * 18 * (window.timelineZoom || 1));
    nav.scrollLeft = Math.max(0, markerX - nav.clientWidth / 2);
    // Remove .active from all markers, add to this one
    $$('.timeline-marker').forEach(g => {
      g.classList.remove('active');
      // Remove expanded title and year label from all except hovered
      if (!g.matches(':hover')) {
        const hoverBg = g.querySelector('rect.card-bg');
        if (hoverBg) hoverBg.remove();
        const hoverTitle = g.querySelector('text.card-title');
        if (hoverTitle) hoverTitle.remove();
        const hoverYear = g.querySelector('text.marker-year-label');
        if (hoverYear) hoverYear.remove();
      }
    });
    // Find the marker for this item
    const marker = $(`.timeline-marker[data-slug='${item.slug}']`, nav);
    if (marker) {
      marker.classList.add('active');
      // Show expanded title for the active marker
      marker.dispatchEvent(new Event('mouseenter'));
    }
  }
  // (Read More button is now included in the horizontal layout above)
}
// ------- Render pipeline -------
function render(){
  if (!_ALL_ITEMS.length) return;
// apply text/year/category filters first
  const f = currentFilters();
  const prelim = _ALL_ITEMS.filter(d =>
    (f.cats.length === 0 || f.cats.includes(d.category)) &&
    itemInYearRange(d, mapYearStart, mapYearEnd) &&
    itemMatchesSearch(d, f.search)
  );

  // split by coords availability
  const hasGeo = [], noGeo = [];
  prelim.forEach(d=>{
    if (Number.isFinite(+d.lat) && Number.isFinite(+d.lon)) hasGeo.push(d);
    else if (resolveCoordsInPlace(d)) hasGeo.push(d);
    else noGeo.push(d);
  });

  _VISIBLE = hasGeo;

  if (document.getElementById('map')?.classList.contains('active')) {
    drawMap(_VISIBLE);
  }
  if (document.getElementById('custom_timeline')?.classList.contains('active')) {
    renderCustomTimeline();
  }
  drawMapAxis();

  // tiny status
  const totalFilteredOut = _ALL_ITEMS.length - prelim.length;
  updateDebugBadge({ shown:_VISIBLE.length, noGeo:noGeo.length, outYear:0, filtered: totalFilteredOut });

}
function requestRender() {
  requestAnimationFrame(() => {
    render();
    if ($('#gallery').classList.contains('active')) renderGallery();
  });
}

// ------- Bootstrap -------
async function main(){
  try{
    const rows = await loadCSV(DATA_CSV);
    _ALL_ITEMS = rows.map(normalizeItem);

    // derive year limits if present
    const ys = _ALL_ITEMS.flatMap(d=>{
      const out=[]; const a=+d.year, b=+d.year_end;
      if (Number.isFinite(a)) out.push(a);
      if (Number.isFinite(b)) out.push(b);
      return out;
    });
    if (ys.length){ MAP_YEAR_MIN = Math.min(...ys); MAP_YEAR_MAX = Math.max(...ys); }
    mapYearStart = MAP_YEAR_MIN; mapYearEnd = MAP_YEAR_MAX;

    // Year range slider setup
const startSlider = document.getElementById('mapYearStart');
const endSlider   = document.getElementById('mapYearEnd');
const startVal    = document.getElementById('mapYearStartVal');
const endVal      = document.getElementById('mapYearEndVal');

if (startSlider && endSlider && startVal && endVal) {
  // Set min/max/step/initial values
  startSlider.min = endSlider.min = MAP_YEAR_MIN;
  startSlider.max = endSlider.max = MAP_YEAR_MAX;
  startSlider.step = endSlider.step = 1;
  startSlider.value = mapYearStart;
  endSlider.value = mapYearEnd;
  startVal.textContent = mapYearStart;
  endVal.textContent = mapYearEnd;

  function updateYearRange() {
    let start = parseInt(startSlider.value, 10);
    let end = parseInt(endSlider.value, 10);
    // Prevent crossing
    if (start > end) {
      if (this === startSlider) end = start;
      else start = end;
    }
    mapYearStart = start;
    mapYearEnd = end;
    startSlider.value = start;
    endSlider.value = end;
    startVal.textContent = start;
    endVal.textContent = end;
    drawMapAxis();
    requestRender();
  }

  startSlider.addEventListener('input', updateYearRange);
  endSlider.addEventListener('input', updateYearRange);
}

    // sidebar controls
    makeCategoryList(_ALL_ITEMS);

    $('#search')?.addEventListener('input', ()=> requestRender());

    // era pills
    renderEraPills();

    // Move CLEAR FILTERS button directly below era pills
    let clearBtn = document.getElementById('clearFilters');
    if (!clearBtn) {
      clearBtn = document.createElement('button');
      clearBtn.id = 'clearFilters';
      clearBtn.textContent = 'CLEAR FILTERS';
      clearBtn.className = 'clear-filters-btn';
    }
    clearBtn.onclick = () => {
      $('#search').value = '';
      $('#f_category_group')?.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
      _activeEra = null; setYearRange(MAP_YEAR_MIN, MAP_YEAR_MAX);
      $$('#eraPills .pill-btn').forEach(p => p.classList.remove('active'));
      requestRender();
    };
    // Insert after era pills
    const eraPills = document.getElementById('eraPills');
    if (eraPills && eraPills.parentNode) {
      if (clearBtn.parentNode !== eraPills.parentNode) {
        eraPills.parentNode.insertBefore(clearBtn, eraPills.nextSibling);
      }
    }

    // sort dropdown
    document.getElementById('sortBySelect')?.addEventListener('change', ()=> requestRender());

    // tabs
    $$('.tab-btn[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));

    // Restore previous map view if available
    let prevView = null;
    if (localStorage.getItem('mapView')) {
      try { prevView = JSON.parse(localStorage.getItem('mapView')); } catch {}
    }

    // On page load, check hash
    const hash = window.location.hash.slice(1);
    if (hash.startsWith('focus=')) {
      const params = new URLSearchParams(hash.replace(/&/g, '&'));
      const slug = params.get('focus');
      const zoom = Number(params.get('zoom')) || 2;
      const item = _ALL_ITEMS.find(d => d.slug === slug);
      if (item && Number.isFinite(item.lat) && Number.isFinite(item.lon)) {
        centerMapOn(item.lat, item.lon, zoom);
      }
    } else if (hash === 'restore' && prevView) {
      centerMapOn(prevView.lat, prevView.lon, prevView.zoom);
    } else if (prevView) {
      centerMapOn(prevView.lat, prevView.lon, prevView.zoom);
    }

    // first render
    render();
  }catch(e){
    console.error('Init failed:', e);
  }
}

document.addEventListener('DOMContentLoaded', main);

// Before navigating to details, save current map view
function onShowDetails(item) {
  // Save current map center/zoom
  const view = { lat: mapCenterLat, lon: mapCenterLon, zoom: mapZoom };
  localStorage.setItem('mapView', JSON.stringify(view));
  // Navigate to details page
  window.location.href = `details.html?id=${encodeURIComponent(item.slug)}`;
}

function centerMapOn(lat, lon, zoom = 2) {
  const svg = document.getElementById('mapSvg');
  const scene = document.getElementById('mapScene');
  if (!svg || !scene) return;

  // Project lon/lat to SVG coordinates
  const [cx, cy] = projEquirect(lon, lat, svg);

  // Set zoom
  svg._zoom = svg._zoom || { k: 1, tx: 0, ty: 0 };
  svg._zoom.k = zoom;

  // Center the point (cx, cy) in the SVG viewport
  const w = svg.clientWidth, h = svg.clientHeight;
  svg._zoom.tx = w / 2 - cx * zoom;
  svg._zoom.ty = h / 2 - cy * zoom;

  // Apply transform to the scene group
  scene.setAttribute(
    'transform',
    `translate(${svg._zoom.tx},${svg._zoom.ty}) scale(${svg._zoom.k})`
  );
}

// spiderfy: show all overlapping nodes at once
function spiderfyNodesAt(x, y, nodes) {
  const N = nodes.length;
  // Make the spiderfy radius much smaller so nodes stay close to their true location
  const radius = 1.5 + 0.22 * N;
  const svg = document.getElementById('mapSvg');
  const scene = document.getElementById('mapScene');
  const k = svg?._zoom?.k || 1;

  // Arrange nodes in a ring, much smaller
  nodes.forEach((d, i) => {
    const angle = (2 * Math.PI * i) / N;
    const nx = x + Math.cos(angle) * radius;
    const ny = y + Math.sin(angle) * radius;
    const nodeEl = document.querySelector(`.node[data-id="${d.slug}"]`);
    if (nodeEl) {
      const originalTransform = nodeEl.getAttribute('transform') || '';
      nodeEl.setAttribute('transform', `${originalTransform} translate(${nx - x}, ${ny - y})`);
    }
  });
}