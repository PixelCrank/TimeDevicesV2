// Set the category badge below the title
function setCategoryBadge(item) {
  const badge = document.getElementById('categoryBadge');
  if (!badge) return;
  let cat = (item.category || '').toLowerCase().trim();
  let label = '';
  let badgeClass = '';
  if (cat === 'device' || cat === 'devices') {
    label = 'Device';
    badgeClass = 'device';
  } else if (cat === 'person' || cat === 'people' || cat === 'key person' || cat === 'key people') {
    label = 'Key Person';
    badgeClass = 'person';
  } else if (cat === 'story' || cat === 'stories') {
    label = 'Story';
    badgeClass = 'story';
  } else {
    label = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : '';
    badgeClass = '';
  }
  badge.textContent = label;
  badge.className = 'category-badge' + (badgeClass ? ' ' + badgeClass : '');
  badge.style.display = label ? '' : 'none';
}

async function renderItemDetails(item, items) {
  document.getElementById('title').textContent = item.title || '';
  setCategoryBadge(item);
  document.getElementById('subtitle').textContent = item.subtitle || '';
}
// --- Related Items Component ---
function renderRelatedItemsSection(item, items) {
  const relatedSection = document.getElementById('relatedItemsSection');
  if (!relatedSection) return;
  let relatedList = [];
  if (item.related_items) {
    relatedList = item.related_items.split(/[;,|]/).map(s => s.trim()).filter(Boolean);
  }
  if (relatedList.length > 0) {
  relatedSection.innerHTML = '';
  // Card-like wrapper
  const card = document.createElement('div');
  card.style.background = 'rgba(255,255,255,0.97)';
  card.style.border = '1.5px solid #e5e7eb';
  card.style.borderRadius = '16px';
  card.style.boxShadow = '0 4px 24px rgba(44,79,79,0.07), 0 1.5px 6px rgba(124,58,237,0.04)';
  card.style.padding = '22px 18px 14px 18px';
  card.style.margin = '0 0 18px 0';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  card.style.gap = '8px';

  const title = document.createElement('h3');
  title.textContent = 'Related Items';
  title.style.marginBottom = '10px';
  title.style.fontSize = '1.08em';
  title.style.color = '#2C4F4F';
  title.style.letterSpacing = '.03em';
  title.style.fontWeight = '600';
  card.appendChild(title);

  const ul = document.createElement('ul');
  ul.style.listStyle = 'none';
  ul.style.padding = '0';
  ul.style.margin = '0';
    relatedList.forEach(slug => {
      let rel = items.find(x => x.slug === slug);
      let li;
      if (rel) {
        li = document.createElement('a');
        li.textContent = rel.title || slug;
        li.href = `details.html?id=${encodeURIComponent(rel.slug)}`;
        li.style.display = 'block';
        li.style.textDecoration = 'none';
        li.style.color = '#1a202c';
        li.style.padding = '10px 14px';
        li.style.borderRadius = '8px';
        li.style.marginBottom = '4px';
        li.style.transition = 'background 0.15s, box-shadow 0.15s';
        li.style.fontWeight = '500';
        li.style.fontSize = '1em';
        li.onmouseover = () => {
          li.style.background = '#f3f4f6';
          li.style.boxShadow = '0 2px 8px rgba(44,79,79,0.07)';
        };
        li.onmouseout = () => {
          li.style.background = '';
          li.style.boxShadow = '';
        };
      } else {
        li = document.createElement('li');
        li.textContent = slug;
        li.style.padding = '10px 14px';
        li.style.color = '#aaa';
        li.style.fontStyle = 'italic';
      }
      ul.appendChild(li);
    });
  card.appendChild(ul);
  relatedSection.appendChild(card);
  relatedSection.style.display = '';
  } else {
    relatedSection.innerHTML = '';
    relatedSection.style.display = 'none';
  }
}
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
    if (cat === 'people') p = 'images/placeholders/person_hero.png';
    else if (cat === 'stories') p = 'images/placeholders/story_hero.png';
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
  if (/devices/.test(cat)) cat = 'devices';
  else if (/people/.test(cat)) cat = 'people';
  else if (/stories/.test(cat)) cat = 'stories';
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
  // Remove YAML front matter (--- ... --- at the top)
  let h = s.replace(/^---[\s\S]*?---\s*/,'');
  h = h.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  // Render # headers as <h1 class="md-title-hidden">
  h = h.replace(/^#\s+(.+)$/gm, '<h1 class="md-title-hidden">$1</h1>');
  // Render ## headers as <h2>
  h = h.replace(/^##\s*(.+)$/gm, '<h2>$1</h2>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  h = h.replace(/\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  h = h.split(/\n{2,}/).map(p=>/^(<h2>|<ul>|<ol>|<li>|<p>|<blockquote>|<pre>|<table>|<tr>|<th>|<td>)/.test(p.trim()) ? p : `<p>${p}</p>`).join('\n');
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
    else if (/perspective/.test(raw)) key = 'PERSPECTIVE';
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
  // Use singular category for matching
  const cat = (item.category || '').replace(/s$/, '');
  if (cat === 'person') {
    tries.push(`content/people/${s}.en.md`, `content/people/${s}.md`);
  } else if (cat === 'story') {
    tries.push(`content/stories/${s}.en.md`, `content/stories/${s}.md`);
  } else if (cat === 'device') {
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


/* ===================== render ===================== */
function renderHeaderAndMeta(d){
  document.title = `${d.title} • Time Stories`;
  $('#docTitle').textContent = `${d.title} • Time Stories`;

  $('#title').textContent = d.title || '';
  $('#subtitle').textContent = [fmtRange(d), d.origin_location].filter(Boolean).join(' • ');

  const hero = $('#heroImg');
  const url = (d.image || d.thumb || '').trim();
  if (url) {
    hero.src = url;
    hero.alt = d.title || '';
    hero.style.display = 'block';
    hero.style.maxHeight = '320px';
  } else {
    hero.style.display = 'none';
    const gallery = document.getElementById('mediaGallery');
    if (gallery) gallery.style.display = 'none';
  }

  const catLabel = d.category === 'people' ? 'Key People' : (d.category === 'stories' ? 'Stories' : 'Time Devices');
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

  // Hide meta info (Years, Location, Coordinates)
  const metaList = $('#metaList');
  if (metaList) metaList.style.display = 'none';
}

function fillSectionsFromMarkdown(item, md){
  const { body } = parseFrontMatter(md);
  const sections = splitH2Sections(body);

  // Hide all by default
  hide($('#peopleSections'));
  hide($('#devicesSections'));
  hide($('#storiesSections'));

  // Map of section containers by category
  const sectionMap = {
    'devices': $('#devicesSections'),
    'people': $('#peopleSections'),
    'stories': $('#storiesSections')
  };
  const keyOrder = {
    'devices': ['DESCRIPTION','FUNCTION','PERSPECTIVE','INNOVATION'],
    'people': ['BIO','WHAT','WHY'],
    'stories': ['DESCRIPTION', 'FUNCTION', 'PERSPECTIVE', 'INNOVATION', 'STORY+']
  };
  const cat = item.category;
  const container = sectionMap[cat];
  const order = keyOrder[cat] || [];
  let filled = 0;
  if (container) {
    // Hide all section headers by default
    Array.from(container.querySelectorAll('h3')).forEach(h => h.style.display = 'none');
    Array.from(container.querySelectorAll('div[data-key]')).forEach(d => { d.innerHTML = ''; d.style.display = 'none'; });
    // Only show and fill those with content
    for (const key of order) {
      const val = sections[key] || '';
      const h = container.querySelector(`h3 + div[data-key="${key}"]`)?.previousElementSibling;
      const d = container.querySelector(`div[data-key="${key}"]`);
      if (val && d && h) {
        h.style.display = '';
        d.style.display = '';
        d.innerHTML = mdToHTML(val);
        filled++;
      }
    }
    if (filled > 0) show(container);
    else hide(container);
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
  // --- Back Button Logic ---
  const urlParams = new URL(location.href).searchParams;
  const from = urlParams.get('from');
  const slug = urlParams.get('slug');
  const backNavLink = document.getElementById('backNavLink');
  if (backNavLink) {
    if (from === 'timeline' && slug) {
      backNavLink.textContent = '← Back to Timeline';
      backNavLink.href = `customtimeline.html#slug=${encodeURIComponent(slug)}`;
    } else {
      backNavLink.textContent = '← Back to map';
      backNavLink.href = 'index.html';
    }
  }
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
  renderMediaGallery(item);

  // Render Related Items Section as a component
  renderRelatedItemsSection(item, items);



  const { md, tried } = await loadMarkdownForItem(item);
  if (md){
    const filled = fillSectionsFromMarkdown(item, md);
    if (!filled){
      hide($('#peopleSections')); hide($('#sSections'));
      show($('#desc'));
      $('#desc').innerHTML = mdToHTML(parseFrontMatter(md).body);
    }
  } else {
    hide($('#peopleSections')); hide($('#devicesSections'));
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