// Pi Cloud – Dateien und Fotos im Browser für nginx (autoindex JSON + WebDAV).
//
// Server-Pfade: /files/home/…   persönlicher Bereich des angemeldeten Benutzers
//               /files/shared/… gemeinsamer Bereich (Familie)
// Fotos: alle Bilder und Videos unter home/<Bilder>/ und shared/<Bilder>/,
// Alben sind die Unterordner davon.

const $ = (sel, el = document) => el.querySelector(sel);
const API = '/files';
const THUMBS = '/thumb';

const CONFIG = { sharedName: 'Familie', photosFolder: 'Bilder' };
let ME = '';

// ---------- Hilfsfunktionen ----------

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* privat/blockiert */ } },
};

const encPath = (segs) => segs.map(encodeURIComponent).join('/');
const fileUrl = (segs) => `${API}/${encPath(segs)}`;
const dirUrl = (segs) => (segs.length ? `${API}/${encPath(segs)}/` : `${API}/`);
const itemUrl = (it) => (it.dir ? dirUrl(it.segs) : fileUrl(it.segs));
const keyOf = (it) => it.segs.join('/');
const parentOf = (segs) => segs.slice(0, -1);
const sameDir = (a, b) => a.length === b.length && a.every((s, i) => s === b[i]);
const spaceLabel = (id) => (id === 'shared' ? CONFIG.sharedName : 'Meine Dateien');
const photoRoot = (space) => [space, CONFIG.photosFolder];

const nf = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 1 });
function fmtSize(b) {
  if (b < 1024) return `${b} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return `${nf.format(b)} ${u[i]}`;
}
const tf = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });
const df = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'short' });
const dfy = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const mf = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
function fmtDate(ms) {
  const d = new Date(ms), now = new Date();
  if (d.toDateString() === now.toDateString()) return `Heute, ${tf.format(d)}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Gestern, ${tf.format(d)}`;
  return d.getFullYear() === now.getFullYear() ? df.format(d) : dfy.format(d);
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const EXT = {
  image: 'jpg jpeg png gif webp avif bmp svg ico heic heif',
  pdf: 'pdf',
  video: 'mp4 m4v mov webm mkv avi 3gp ogv',
  audio: 'mp3 m4a aac wav flac ogg oga opus wma',
  text: 'txt md markdown log csv tsv json xml yml yaml ini conf cfg toml env sh bash zsh py js mjs ts tsx jsx css scss html htm c h cpp hpp java kt go rs rb php sql srt vtt gpx',
  archive: 'zip rar 7z tar gz tgz bz2 xz zst',
  sheet: 'xlsx xls ods numbers',
  doc: 'doc docx odt rtf pages ppt pptx odp key epub',
};
const KIND_BY_EXT = {};
for (const [k, list] of Object.entries(EXT)) for (const e of list.split(' ')) KIND_BY_EXT[e] = k;
const extOf = (n) => { const i = n.lastIndexOf('.'); return i > 0 ? n.slice(i + 1).toLowerCase() : ''; };
const kindOf = (n) => KIND_BY_EXT[extOf(n)] || 'file';
const ICON = {
  folder: 'folder', image: 'image', pdf: 'pdf', video: 'video', audio: 'audio', text: 'text',
  archive: 'archive', sheet: 'sheet', doc: 'text', file: 'file', 'space-home': 'home', 'space-shared': 'people',
};
const isSafari = /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|Android|Edg\//.test(navigator.userAgent);
const THUMBABLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
function canShowImage(name) {
  const e = extOf(name);
  return !((e === 'heic' || e === 'heif') && !isSafari);
}
function thumbSrc(it) {
  return THUMBABLE.has(extOf(it.name))
    ? `${THUMBS}/${encPath(it.segs)}?v=${Math.floor(it.mtime / 1000)}`
    : fileUrl(it.segs);
}
function thumbImg(it) {
  const jpeg = /^jpe?g$/.test(extOf(it.name)) ? ` data-orig="${esc(fileUrl(it.segs))}"` : '';
  return `<img class="thumb-fade" src="${esc(thumbSrc(it))}" alt="" loading="lazy" decoding="async"${jpeg}>`;
}

// Aufnahmedatum aus dem Dateinamen (IMG_20260712_…, PXL_…, Screenshot_2026-07-12…), sonst Änderungsdatum
const DATE_RE = /(?:^|\D)((?:19|20)\d\d)[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?:[-_ T.]?([01]\d|2[0-3])[-_.:]?([0-5]\d)(?:[-_.:]?([0-5]\d))?)?/;
function photoDate(name, mtime) {
  const m = DATE_RE.exec(name);
  if (m) {
    const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0), +(m[6] || 0)).getTime();
    if (d > Date.UTC(1990, 0, 1) && d < Date.now() + 86_400_000) return d;
  }
  return mtime;
}

function icon(name, cls = 'ic') {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function errorText(status) {
  return ({
    403: 'Keine Berechtigung – Dateirechte auf dem Pi prüfen (PUID/PGID).',
    404: 'Nicht gefunden – evtl. schon gelöscht oder verschoben.',
    405: 'Existiert bereits.',
    409: 'Konflikt – übergeordneter Ordner fehlt.',
    412: 'Eine Datei oder ein Ordner mit diesem Namen existiert bereits.',
    413: 'Datei ist zu groß.',
    500: 'Serverfehler – ist der Speicher voll?',
    502: 'Verschieben zwischen Bereichen ist fehlgeschlagen.',
    507: 'Speicher voll.',
  })[status] || `Fehler ${status}`;
}

function validName(n) {
  return n && n !== '.' && n !== '..' && !n.startsWith('.') && !/[/\\\0]/.test(n);
}

function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 1; ; n++) {
    const cand = `${base} (${n})${ext}`;
    if (!taken.has(cand)) return cand;
  }
}

// ---------- Server ----------

class AuthError extends Error {}
class HttpError extends Error {
  constructor(status) { super(errorText(status)); this.status = status; }
}

function isAuthFailure(res) {
  return res.status === 401 || (res.status === 403 && res.headers.has('WWW-Authenticate'));
}

async function req(method, url, opts = {}) {
  const res = await fetch(url, {
    method,
    cache: 'no-store',
    credentials: 'same-origin',
    ...opts,
    headers: { 'X-PC-App': '1', ...(opts.headers || {}) },
  });
  if (isAuthFailure(res)) {
    showLogin();
    throw new AuthError('auth');
  }
  return res;
}

async function listDir(segs) {
  const res = await req('GET', dirUrl(segs));
  if (res.status === 404) return null;
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()).filter((e) => !e.name.startsWith('.'));
}
async function davMove(fromUrl, toUrl) {
  // Relativer Destination-Pfad funktioniert auch hinter Tailscale/Reverse-Proxy.
  const res = await req('MOVE', fromUrl, { headers: { Destination: toUrl, Overwrite: 'F' } });
  if (!res.ok) throw new HttpError(res.status);
}
async function davDelete(url) {
  const res = await req('DELETE', url, { headers: { Depth: 'infinity' } });
  if (!res.ok && res.status !== 404) throw new HttpError(res.status);
}
async function davMkcol(segs, { okIfExists = false } = {}) {
  const res = await req('MKCOL', dirUrl(segs));
  if (res.ok || (okIfExists && res.status === 405)) return;
  throw new HttpError(res.status);
}
async function ensureDir(segs) {
  for (let i = 2; i <= segs.length; i++) await davMkcol(segs.slice(0, i), { okIfExists: true });
}

function reportError(err) {
  if (!(err instanceof AuthError)) toast(err.message || 'Fehlgeschlagen');
}

// ---------- Zustand & Navigation ----------

const state = {
  route: { mode: 'files', path: [] },
  path: [],
  items: [],
  visible: [],
  view: store.get('pc.view', 'list'),
  sortKey: store.get('pc.sortKey', 'name'),
  sortDir: Number(store.get('pc.sortDir', '1')),
  filter: '',
  selecting: false,
  selected: new Set(),
  loadedAt: 0,
};

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
  if (!parts.length) return store.get('pc.mode', 'files') === 'photos' ? { mode: 'photos', tab: 'all' } : { mode: 'files', path: [] };
  if (parts[0] === 'photos') {
    if (parts[1] === 'albums') return { mode: 'photos', tab: 'albums' };
    if (parts[1] === 'unsorted') return { mode: 'photos', tab: 'unsorted' };
    if (parts[1] === 'album' && parts[3] && (parts[2] === 'home' || parts[2] === 'shared')) {
      return { mode: 'photos', tab: 'album', space: parts[2], album: parts[3] };
    }
    return { mode: 'photos', tab: 'all' };
  }
  const path = parts[0] === 'files' ? parts.slice(1) : parts;
  if (path.length && path[0] !== 'home' && path[0] !== 'shared') return { mode: 'files', path: [] };
  return { mode: 'files', path };
}
const filesHash = (segs) => (segs.length ? `#/files/${encPath(segs)}` : '#/files');
const albumHash = (space, name) => `#/photos/album/${space}/${encodeURIComponent(name)}`;
function go(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

function route() {
  closeViewer({ fromPop: true });
  const r = parseRoute();
  const modeChanged = r.mode !== state.route.mode;
  state.route = r;
  store.set('pc.mode', r.mode);
  state.filter = '';
  $('#search').value = '';
  setSelecting(false);
  window.scrollTo(0, 0);
  if (modeChanged) $('#listing').innerHTML = '';
  if (r.mode === 'files') {
    state.path = r.path;
    loadFiles();
  } else {
    loadPhotos();
  }
}

function refresh({ quiet = true } = {}) {
  if (state.route.mode === 'files') return loadFiles({ quiet });
  photos.stale = true;
  return loadPhotos({ quiet });
}

function renderChrome() {
  const r = state.route;
  for (const a of document.querySelectorAll('#tabs a')) a.classList.toggle('active', a.dataset.tab === r.mode);
  const files = r.mode === 'files';
  const atRoot = files && !state.path.length;
  $('#btn-sort').hidden = !files;
  $('#btn-view').hidden = !files;
  $('#btn-select').hidden = atRoot || r.tab === 'albums';
  $('#btn-album').hidden = r.tab !== 'album';
  $('#fab').hidden = atRoot || state.selecting;
  $('#search').placeholder = files ? (atRoot ? 'Bereiche durchsuchen' : 'In diesem Ordner suchen') : r.tab === 'albums' ? 'Alben suchen' : 'Fotos suchen';
  $('#sel-album').hidden = files;
  $('#sel-move').hidden = !files;
  $('#sel-unalbum').hidden = r.tab !== 'album';
  $('#btn-view use').setAttribute('href', state.view === 'grid' ? '#i-list' : '#i-grid');
  $('#btn-select').classList.toggle('active', state.selecting);
  $('#file-input').accept = files ? '' : 'image/*,video/*';
}

function setCrumbs(html, title) {
  const nav = $('#crumbs');
  nav.innerHTML = html;
  nav.scrollLeft = nav.scrollWidth;
  document.title = title ? `${title} – Pi Cloud` : 'Pi Cloud';
}

// ---------- Dateibaum ----------

let loadSeq = 0;
async function loadFiles({ quiet = false } = {}) {
  const seq = ++loadSeq;
  renderChrome();
  renderFileCrumbs();
  if (!state.path.length) {
    state.items = ['home', 'shared'].map((id) => ({
      name: spaceLabel(id), dir: true, isSpace: true, size: 0, mtime: 0, kind: `space-${id}`, segs: [id],
    }));
    showApp();
    renderFiles();
    return;
  }
  const spin = quiet ? null : setTimeout(() => { $('#loading').hidden = false; }, 200);
  try {
    const data = await listDir(state.path);
    if (seq !== loadSeq) return;
    if (data === null) {
      toast('Ordner nicht gefunden');
      go(filesHash(state.path.slice(0, -1)));
      return;
    }
    state.items = data.map((e) => {
      const dir = e.type === 'directory';
      return { name: e.name, dir, size: e.size ?? 0, mtime: Date.parse(e.mtime) || 0, kind: dir ? 'folder' : kindOf(e.name), segs: [...state.path, e.name] };
    });
    state.loadedAt = Date.now();
    showApp();
    renderFiles();
  } catch (err) {
    reportError(err);
  } finally {
    clearTimeout(spin);
    if (seq === loadSeq) $('#loading').hidden = true;
  }
}

function sortItems(items) {
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const k = state.sortKey, d = state.sortDir;
  return [...items].sort((a, b) => {
    if (a.isSpace || b.isSpace) return 0;
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let r = 0;
    if (k === 'mtime') r = a.mtime - b.mtime;
    else if (k === 'size') r = a.size - b.size;
    if (r === 0) r = coll.compare(a.name, b.name);
    return r * d;
  });
}

function renderFileCrumbs() {
  const p = state.path;
  const parts = [`<a href="#/files">Dateien</a>`];
  p.forEach((seg, i) => {
    parts.push(icon('right', 'sep'));
    parts.push(`<a href="${filesHash(p.slice(0, i + 1))}">${esc(i === 0 ? spaceLabel(seg) : seg)}</a>`);
  });
  setCrumbs(parts.join(''), p.length ? (p.length === 1 ? spaceLabel(p[0]) : p.at(-1)) : 'Dateien');
}

function renderFiles() {
  renderChrome();
  const q = state.filter.trim().toLowerCase();
  state.visible = sortItems(q ? state.items.filter((i) => i.name.toLowerCase().includes(q)) : state.items);
  const listing = $('#listing');
  gridObserver?.disconnect();
  listing.className = `listing ${state.view}${state.selecting ? ' selecting' : ''}`;

  listing.innerHTML = state.visible.map((it, i) => {
    let visual = icon(ICON[it.kind]);
    let media = false;
    if (it.kind === 'image' && canShowImage(it.name)) { visual = thumbImg(it); media = true; }
    const badge = it.kind === 'video' ? ' data-badge="▶"' : '';
    const meta = it.isSpace
      ? (it.segs[0] === 'shared' ? 'Für alle Benutzer' : `Nur für ${esc(ME || 'dich')}`)
      : it.dir ? fmtDate(it.mtime) : `${fmtDate(it.mtime)} · ${fmtSize(it.size)}`;
    const sel = state.selected.has(keyOf(it)) ? ' selected' : '';
    return `<div class="item${media ? ' media' : ''}${sel}" data-i="${i}" role="button" tabindex="0">
      <div class="item-icon t-${it.kind}"${badge}>${visual}</div>
      <div class="item-body"><div class="item-name">${esc(it.name)}</div><div class="item-meta">${meta}</div></div>
      <span class="item-check">${icon('check')}</span>
      ${it.isSpace ? '' : `<button class="icon-btn item-more" aria-label="Aktionen für ${esc(it.name)}">${icon('more')}</button>`}
    </div>`;
  }).join('');
  wireImages(listing);

  const empty = !state.visible.length;
  $('#empty').hidden = !empty;
  if (empty) setEmpty(q ? 'Keine Treffer' : 'Dieser Ordner ist leer', q ? '' : 'Tippe auf <b>+</b> oder ziehe Dateien hierher.');
  updateSelbar();
}

function setEmpty(title, subHtml, iconName = 'folder') {
  $('#empty .empty-title').textContent = title;
  const sub = $('#empty .empty-sub');
  sub.innerHTML = subHtml;
  sub.hidden = !subHtml;
  $('#empty .empty-ic use').setAttribute('href', `#i-${iconName}`);
}

// Bilder verdrahten: Einblenden, Fehler-Fallback, EXIF-Ausrichtung
const thumbObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbObserver.unobserve(e.target);
      fixOrientation(e.target);
    }
  }, { rootMargin: '300px' })
  : null;

function wireImages(root) {
  for (const img of root.querySelectorAll('img:not([data-w])')) {
    img.dataset.w = '1';
    const done = () => img.classList.add('loaded');
    if (img.complete && img.naturalWidth) done(); else img.addEventListener('load', done, { once: true });
    img.addEventListener('error', () => {
      const box = img.parentElement;
      box.innerHTML = icon('image');
      box.closest('.item')?.classList.remove('media');
    }, { once: true });
    if (img.dataset.orig && thumbObserver) thumbObserver.observe(img);
  }
}

// Vorschaubilder verlieren die EXIF-Ausrichtung; aus dem Original lesen.
const orientationCache = new Map();
const ORIENT_CSS = { 2: 'scaleX(-1)', 3: 'rotate(180deg)', 4: 'scaleY(-1)', 5: 'rotate(90deg) scaleY(-1)', 6: 'rotate(90deg)', 7: 'rotate(-90deg) scaleY(-1)', 8: 'rotate(-90deg)' };
async function fixOrientation(img) {
  const url = img.dataset.orig;
  if (!url || !img.src.includes(THUMBS)) return;
  let o = orientationCache.get(url);
  if (o === undefined) {
    try {
      const res = await fetch(url, { headers: { Range: 'bytes=0-65535' }, credentials: 'same-origin' });
      o = res.ok ? exifOrientation(await res.arrayBuffer()) : 1;
    } catch { o = 1; }
    orientationCache.set(url, o);
  }
  if (ORIENT_CSS[o]) img.style.transform = ORIENT_CSS[o];
}
function exifOrientation(buf) {
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 <= v.byteLength) {
    const marker = v.getUint16(off);
    if ((marker & 0xff00) !== 0xff00) return 1;
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 <= v.byteLength && v.getUint32(off + 4) === 0x45786966) {
      const t = off + 10;
      if (t + 8 > v.byteLength) return 1;
      const le = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, le);
      if (ifd + 2 > v.byteLength) return 1;
      const n = v.getUint16(ifd, le);
      for (let i = 0; i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > v.byteLength) return 1;
        if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le);
      }
      return 1;
    }
    if (marker === 0xffda) return 1;
    off += 2 + len;
  }
  return 1;
}

// ---------- Fotos ----------

// Index aller Fotos/Videos in home/<Bilder> und shared/<Bilder>
const photos = { items: [], albums: [], stale: true, loading: null, at: 0, missing: { home: false, shared: false } };

function crawlPhotos() {
  if (photos.loading) return photos.loading;
  photos.loading = (async () => {
    const items = [];
    const albums = new Map();
    const missing = { home: false, shared: false };
    let level = [photoRoot('home'), photoRoot('shared')];
    while (level.length) {
      const next = [];
      for (let i = 0; i < level.length; i += 4) {
        const batch = level.slice(i, i + 4);
        const results = await Promise.all(batch.map((segs) => listDir(segs).catch((err) => {
          if (err instanceof AuthError) throw err;
          return null;
        })));
        results.forEach((data, j) => {
          const segs = batch[j];
          const space = segs[0];
          if (data === null) { if (segs.length === 2) missing[space] = true; return; }
          for (const e of data) {
            const child = [...segs, e.name];
            if (e.type === 'directory') {
              next.push(child);
              if (segs.length === 2) albums.set(`${space}/${e.name}`, { space, name: e.name, mtime: Date.parse(e.mtime) || 0 });
              continue;
            }
            const kind = kindOf(e.name);
            if (kind !== 'image' && kind !== 'video') continue;
            const mtime = Date.parse(e.mtime) || 0;
            items.push({
              name: e.name, dir: false, kind, size: e.size ?? 0, mtime, segs: child,
              space, album: child.length >= 4 ? child[2] : '', date: photoDate(e.name, mtime),
            });
          }
        });
        const st = $('#photo-status');
        if (st) st.textContent = `Fotos werden eingelesen … ${items.length}`;
      }
      level = next;
    }
    items.sort((a, b) => b.date - a.date || a.name.localeCompare(b.name));
    Object.assign(photos, { items, albums: [...albums.values()], missing, stale: false, at: Date.now() });
  })();
  photos.loading.finally(() => { photos.loading = null; });
  return photos.loading;
}

function albumCards() {
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const cards = photos.albums.map((a) => {
    const list = photos.items.filter((p) => p.space === a.space && p.album === a.name);
    return {
      isAlbum: true, dir: true, space: a.space, name: a.name, segs: [...photoRoot(a.space), a.name],
      count: list.length, cover: list.find((p) => p.kind === 'image' && canShowImage(p.name)) || null, mtime: a.mtime,
    };
  }).sort((x, y) => coll.compare(x.name, y.name) || (x.space === 'home' ? -1 : 1));
  const loose = photos.items.filter((p) => !p.album);
  if (loose.length) {
    cards.push({ isUnsorted: true, dir: true, name: 'Ohne Album', segs: ['~unsorted'], count: loose.length, cover: loose.find((p) => p.kind === 'image' && canShowImage(p.name)) || null });
  }
  return cards;
}

let photoSeq = 0;
async function loadPhotos({ quiet = false } = {}) {
  const seq = ++photoSeq;
  renderChrome();
  renderPhotoCrumbs();
  showApp();
  const fresh = !photos.stale && Date.now() - photos.at < 60_000;
  if (!fresh) {
    if (!photos.at && !quiet) {
      $('#listing').className = 'listing photos';
      $('#listing').innerHTML = '<p class="photo-status" id="photo-status">Fotos werden eingelesen …</p>';
      $('#empty').hidden = true;
      $('#loading').hidden = false;
    }
    try { await crawlPhotos(); } catch (err) { reportError(err); return; } finally { $('#loading').hidden = true; }
  }
  if (seq !== photoSeq || state.route.mode !== 'photos') return;
  state.loadedAt = Date.now();
  renderPhotos();
}

function renderPhotoCrumbs() {
  const r = state.route;
  if (r.tab === 'album' || r.tab === 'unsorted') {
    const name = r.tab === 'album' ? r.album : 'Ohne Album';
    const tag = r.tab === 'album' && r.space === 'shared' ? `<span class="tag">${esc(CONFIG.sharedName)}</span>` : '';
    setCrumbs(`<a class="back" href="#/photos/albums" aria-label="Zurück zu den Alben">${icon('left')}</a><span class="title">${esc(name)}</span>${tag}`, name);
    return;
  }
  setCrumbs(`<div class="seg"><a href="#/photos"${r.tab === 'all' ? ' class="active"' : ''}>Alle Fotos</a><a href="#/photos/albums"${r.tab === 'albums' ? ' class="active"' : ''}>Alben</a></div>`, r.tab === 'albums' ? 'Alben' : 'Fotos');
}

function renderPhotos() {
  renderChrome();
  renderPhotoCrumbs();
  const r = state.route;
  const listing = $('#listing');
  const q = state.filter.trim().toLowerCase();
  gridObserver?.disconnect();

  if (r.tab === 'albums') {
    listing.className = 'listing photos';
    let cards = albumCards();
    if (q) cards = cards.filter((c) => c.name.toLowerCase().includes(q));
    state.visible = [{ isNew: true, dir: true, name: 'Neues Album', segs: ['~new'] }, ...cards];
    listing.innerHTML = `<div class="agrid">${state.visible.map((c, i) => albumCardHtml(c, i)).join('')}</div>`;
    wireImages(listing);
    $('#empty').hidden = true;
    updateSelbar();
    return;
  }

  let list = photos.items;
  if (r.tab === 'album') list = list.filter((p) => p.space === r.space && p.album === r.album);
  if (r.tab === 'unsorted') list = list.filter((p) => !p.album);
  if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || p.album.toLowerCase().includes(q));
  state.visible = list;
  listing.className = `listing photos${state.selecting ? ' selecting' : ''}`;
  listing.innerHTML = '';

  if (!list.length) {
    $('#empty').hidden = false;
    if (q) setEmpty('Keine Treffer', '', 'photos');
    else if (r.tab === 'album') {
      const exists = photos.albums.some((a) => a.space === r.space && a.name === r.album);
      setEmpty(exists ? 'Dieses Album ist leer' : 'Album nicht gefunden', exists ? 'Lade Fotos hoch oder wähle Fotos aus und tippe auf <b>Zu Album hinzufügen</b>.' : '', 'album');
    } else {
      setEmpty('Noch keine Fotos', `Lade Fotos mit <b>+</b> hoch. Sie landen im Ordner <b>${esc(CONFIG.photosFolder)}</b> deines Bereichs oder von <b>${esc(CONFIG.sharedName)}</b>.`, 'photos');
    }
    updateSelbar();
    return;
  }
  $('#empty').hidden = true;
  renderPhotoGrid(list, listing, { showSpace: r.tab !== 'album' });
  updateSelbar();
}

function albumCardHtml(c, i) {
  if (c.isNew) {
    return `<div class="acard new" data-i="${i}" role="button" tabindex="0"><div class="acard-cover">${icon('plus')}</div><div class="acard-name">Neues Album</div><div class="acard-meta">&nbsp;</div></div>`;
  }
  const cover = c.cover ? thumbImg(c.cover) : icon(c.isUnsorted ? 'photos' : 'album');
  const badge = c.space === 'shared' ? `<span class="acard-badge">${icon('people')}${esc(CONFIG.sharedName)}</span>` : '';
  return `<div class="acard" data-i="${i}" role="button" tabindex="0">
    <div class="acard-cover">${cover}${badge}</div>
    <div class="acard-name">${esc(c.name)}</div>
    <div class="acard-meta">${plural(c.count, 'Element', 'Elemente')}</div>
  </div>`;
}

const CHUNK = 240;
let gridObserver = null;
function renderPhotoGrid(list, container, { showSpace }) {
  const monthKey = (t) => { const d = new Date(t); return d.getFullYear() * 12 + d.getMonth(); };
  const counts = new Map();
  for (const p of list) { const k = monthKey(p.date); counts.set(k, (counts.get(k) || 0) + 1); }
  let pos = 0, lastKey = null, grid = null;
  const sentinel = document.createElement('div');
  sentinel.className = 'sentinel';
  container.append(sentinel);

  const tile = (it, i) => {
    const sel = state.selected.has(keyOf(it)) ? ' selected' : '';
    const inner = it.kind === 'image' && canShowImage(it.name) ? thumbImg(it) : icon(it.kind === 'video' ? 'video' : 'image');
    return `<div class="ptile${sel}" data-i="${i}" role="button" tabindex="0" aria-label="${esc(it.name)}">
      <div class="ptile-in">${inner}</div>
      ${it.kind === 'video' ? icon('video', 'vbadge') : ''}
      ${showSpace && it.space === 'shared' ? icon('people', 'sbadge') : ''}
      <span class="item-check">${icon('check')}</span>
    </div>`;
  };
  const more = () => {
    const end = Math.min(list.length, pos + CHUNK);
    let html = '';
    const flush = () => { if (html && grid) { grid.insertAdjacentHTML('beforeend', html); html = ''; } };
    for (; pos < end; pos++) {
      const it = list[pos];
      const k = monthKey(it.date);
      if (k !== lastKey) {
        flush();
        lastKey = k;
        const head = document.createElement('div');
        head.className = 'pgroup-head';
        head.innerHTML = `${esc(mf.format(new Date(it.date)))}<small>${counts.get(k)}</small>`;
        grid = document.createElement('div');
        grid.className = 'pgrid';
        container.insertBefore(head, sentinel);
        container.insertBefore(grid, sentinel);
      }
      html += tile(it, pos);
    }
    flush();
    wireImages(container);
    if (pos >= list.length) { gridObserver?.disconnect(); sentinel.remove(); }
  };
  gridObserver = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) more(); }, { rootMargin: '1200px' });
  more();
  if (pos < list.length) gridObserver.observe(sentinel);
}

// ---------- Alben ----------

async function chooseSpace(title) {
  const a = await sheet(title, [
    { id: 'home', icon: 'home', label: 'Persönlich (nur ich)' },
    { id: 'shared', icon: 'people', label: `${CONFIG.sharedName} (alle)` },
  ]);
  return a?.id ?? null;
}

async function createAlbum(space = null) {
  space = space || await chooseSpace('Wo soll das Album liegen?');
  if (!space) return null;
  const name = await dialog({ title: 'Neues Album', text: space === 'shared' ? `Sichtbar für alle in „${CONFIG.sharedName}“.` : 'Nur für dich sichtbar.', input: '', ok: 'Erstellen' });
  if (name == null) return null;
  if (!validName(name)) { toast('Ungültiger Name'); return null; }
  if (photos.albums.some((a) => a.space === space && a.name === name)) { toast('Album existiert bereits'); return null; }
  try {
    await ensureDir(photoRoot(space));
    await davMkcol([...photoRoot(space), name]);
    photos.albums.push({ space, name, mtime: Date.now() });
    photos.stale = true;
    return { space, name };
  } catch (err) { reportError(err); return null; }
}

async function pickAlbum(title) {
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const albums = [...photos.albums].sort((a, b) => coll.compare(a.name, b.name));
  const opts = [{ id: 'new', icon: 'plus', label: 'Neues Album …' }, ...albums.map((a) => ({
    id: 'album', album: a, icon: a.space === 'shared' ? 'people' : 'album',
    label: a.space === 'shared' ? `${a.name} · ${CONFIG.sharedName}` : a.name,
  }))];
  const pick = await sheet(title, opts);
  if (!pick) return null;
  if (pick.id === 'new') return createAlbum();
  return pick.album;
}

// Dateien in einen Ordner verschieben; bei Namenskonflikt "Name (1).jpg"
async function moveInto(items, destDir) {
  const taken = new Set(photos.items.filter((p) => sameDir(parentOf(p.segs), destDir)).map((p) => p.name));
  let moved = 0;
  for (const it of items) {
    if (sameDir(parentOf(it.segs), destDir)) continue;
    let name = uniqueName(it.name, taken);
    for (let attempt = 0; ; attempt++) {
      try {
        await davMove(itemUrl(it), fileUrl([...destDir, name]));
        break;
      } catch (err) {
        if (err instanceof HttpError && err.status === 412 && attempt < 5) { taken.add(name); name = uniqueName(name, taken); continue; }
        throw err;
      }
    }
    taken.add(name);
    it.name = name;
    it.segs = [...destDir, name];
    moved++;
  }
  return moved;
}

async function addToAlbum(items) {
  if (!items.length) return false;
  const album = await pickAlbum(items.length === 1 ? 'Zu Album hinzufügen' : `${items.length} Elemente zu Album hinzufügen`);
  if (!album) return false;
  try {
    const n = await moveInto(items, [...photoRoot(album.space), album.name]);
    toast(n ? `${plural(n, 'Element', 'Elemente')} in „${album.name}“` : 'Schon in diesem Album');
  } catch (err) { reportError(err); }
  photos.stale = true;
  await refresh();
  return true;
}

async function removeFromAlbum(items) {
  const inAlbum = items.filter((p) => p.album);
  if (!inAlbum.length) return false;
  try {
    for (const space of ['home', 'shared']) await moveInto(inAlbum.filter((p) => p.space === space), photoRoot(space));
    toast(`${plural(inAlbum.length, 'Element', 'Elemente')} aus dem Album entfernt`);
  } catch (err) { reportError(err); }
  photos.stale = true;
  await refresh();
  return true;
}

function currentAlbum() {
  const r = state.route;
  if (r.tab !== 'album') return null;
  return albumCards().find((c) => c.isAlbum && c.space === r.space && c.name === r.album)
    || { isAlbum: true, dir: true, space: r.space, name: r.album, segs: [...photoRoot(r.space), r.album], count: 0 };
}

async function renameAlbum(album) {
  const name = await dialog({ title: 'Album umbenennen', input: album.name, ok: 'Umbenennen' });
  if (name == null || name === album.name) return;
  if (!validName(name)) return toast('Ungültiger Name');
  try {
    await davMove(dirUrl(album.segs), dirUrl([...photoRoot(album.space), name]));
    photos.stale = true;
    if (state.route.tab === 'album') go(albumHash(album.space, name)); else refresh();
  } catch (err) { reportError(err); }
}

async function deleteAlbum(album) {
  const a = await sheet(`Album „${album.name}“ löschen`, [
    { id: 'keep', icon: 'album-remove', label: 'Album auflösen, Fotos behalten' },
    { id: 'all', icon: 'trash', label: 'Album mit allen Fotos löschen', danger: true },
  ]);
  if (!a) return;
  try {
    if (a.id === 'all') {
      const ok = await dialog({ title: `„${album.name}“ mit ${plural(album.count, 'Element', 'Elementen')} löschen?`, text: 'Das kann nicht rückgängig gemacht werden.', ok: 'Löschen', danger: true });
      if (!ok) return;
      await davDelete(dirUrl(album.segs));
      toast('Album gelöscht');
    } else {
      const list = photos.items.filter((p) => p.space === album.space && p.album === album.name);
      await moveInto(list, photoRoot(album.space));
      const rest = await listDir(album.segs);
      if (rest && rest.length) toast('Fotos behalten. Der Ordner enthält noch andere Dateien und bleibt bestehen.', 4500);
      else { await davDelete(dirUrl(album.segs)); toast('Album aufgelöst – Fotos sind unter „Ohne Album“'); }
    }
  } catch (err) { reportError(err); }
  photos.stale = true;
  if (state.route.tab === 'album') go('#/photos/albums'); else refresh();
}

// ---------- Auswahl ----------

const selectable = (it) => it && !it.isSpace && !it.isAlbum && !it.isNew && !it.isUnsorted;

function setSelecting(on) {
  state.selecting = on;
  if (!on) state.selected.clear();
  document.body.classList.toggle('selecting-mode', on);
  $('#listing').classList.toggle('selecting', on);
  if (!on) for (const el of document.querySelectorAll('#listing .selected')) el.classList.remove('selected');
  renderChrome();
  updateSelbar();
}
function toggleSelect(i) {
  const it = state.visible[i];
  if (!selectable(it)) return;
  const k = keyOf(it);
  if (state.selected.has(k)) state.selected.delete(k); else state.selected.add(k);
  $(`#listing [data-i="${i}"]`)?.classList.toggle('selected', state.selected.has(k));
  updateSelbar();
}
function updateSelbar() {
  const n = state.selected.size;
  $('#selbar').hidden = !state.selecting;
  $('#sel-count').textContent = `${n} ausgewählt`;
  $('#fab').hidden = state.selecting || (state.route.mode === 'files' && !state.path.length);
}
const selectedItems = () => state.visible.filter((i) => state.selected.has(keyOf(i)));

// ---------- Menüs & Dialoge ----------

let sheetResolve = null;
function sheet(title, items) {
  sheetResolve?.(null);
  const box = $('#sheet-items');
  $('#sheet-title').textContent = title || '';
  box.innerHTML = items.map((it, i) => `<button class="sheet-item${it.danger ? ' danger' : ''}${it.checked ? ' checked' : ''}" data-k="${i}">${icon(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
  $('#sheet').hidden = false;
  return new Promise((resolve) => {
    sheetResolve = (k) => {
      $('#sheet').hidden = true;
      sheetResolve = null;
      resolve(k == null ? null : items[k]);
    };
  });
}
$('#sheet').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-k]');
  if (btn) sheetResolve?.(Number(btn.dataset.k));
  else if (e.target.closest('[data-close]')) sheetResolve?.(null);
});

function dialog({ title, text = '', input = null, ok = 'OK', danger = false, select = null }) {
  const dlg = $('#dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-text').textContent = text;
  const inp = $('#dialog-input');
  inp.hidden = input === null;
  inp.value = input ?? '';
  const okBtn = $('#dialog-ok');
  okBtn.textContent = ok;
  okBtn.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
  dlg.returnValue = '';
  dlg.showModal();
  if (input !== null) {
    inp.focus();
    inp.setSelectionRange(0, select ?? inp.value.length);
  }
  return new Promise((resolve) => {
    dlg.addEventListener('close', () => {
      if (dlg.returnValue !== 'ok') return resolve(null);
      resolve(input === null ? true : inp.value.trim());
    }, { once: true });
  });
}
$('#dialog-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('#dialog').close('ok'); }
});

// ---------- Aktionen ----------

function download(it) {
  const a = document.createElement('a');
  a.href = fileUrl(it.segs);
  a.download = it.name;
  document.body.append(a);
  a.click();
  a.remove();
}

async function createFolder() {
  const name = await dialog({ title: 'Neuer Ordner', input: '', ok: 'Erstellen' });
  if (name == null) return;
  if (!validName(name)) return toast('Ungültiger Name');
  if (state.items.some((i) => i.name === name)) return toast('Existiert bereits');
  try {
    await davMkcol([...state.path, name]);
    photos.stale = true;
    await refresh();
  } catch (err) { reportError(err); }
}

async function rename(it) {
  const dot = it.dir ? -1 : it.name.lastIndexOf('.');
  const name = await dialog({ title: 'Umbenennen', input: it.name, ok: 'Umbenennen', select: dot > 0 ? dot : null });
  if (name == null || name === it.name) return false;
  if (!validName(name)) { toast('Ungültiger Name'); return false; }
  const segs = [...parentOf(it.segs), name];
  try {
    await davMove(itemUrl(it), it.dir ? dirUrl(segs) : fileUrl(segs));
    it.name = name;
    it.segs = segs;
    photos.stale = true;
    await refresh();
    return name;
  } catch (err) { reportError(err); return false; }
}

async function remove(items) {
  items = items.filter(selectable);
  if (!items.length) return false;
  const one = items.length === 1;
  const hasDir = items.some((i) => i.dir);
  const shared = items.some((i) => i.segs[0] === 'shared');
  const ok = await dialog({
    title: one ? `„${items[0].name}“ löschen?` : `${items.length} Elemente löschen?`,
    text: `${hasDir ? 'Ordner werden mit ihrem gesamten Inhalt gelöscht. ' : ''}${shared ? `Auch für alle anderen in „${CONFIG.sharedName}“. ` : ''}Das kann nicht rückgängig gemacht werden.`,
    ok: 'Löschen',
    danger: true,
  });
  if (!ok) return false;
  let failed = 0;
  for (const it of items) {
    try { await davDelete(itemUrl(it)); } catch (err) {
      if (err instanceof AuthError) return false;
      failed++;
      toast(err.message);
    }
  }
  if (!failed) toast(one ? 'Gelöscht' : `${items.length} Elemente gelöscht`);
  photos.stale = true;
  await refresh();
  return true;
}

const isPhoto = (it) => state.route.mode === 'photos' && selectable(it);

async function itemMenu(it) {
  if (!it || it.isSpace || it.isNew || it.isUnsorted) { if (it) open(it); return; }
  if (it.isAlbum) {
    const a = await sheet(it.name, [
      { id: 'open', icon: 'album', label: 'Öffnen' },
      { id: 'rename', icon: 'edit', label: 'Umbenennen' },
      { id: 'delete', icon: 'trash', label: 'Album löschen', danger: true },
    ]);
    if (a?.id === 'open') open(it);
    if (a?.id === 'rename') renameAlbum(it);
    if (a?.id === 'delete') deleteAlbum(it);
    return;
  }
  const actions = [{ id: 'open', icon: it.dir ? 'folder' : 'right', label: 'Öffnen' }];
  if (!it.dir) actions.push({ id: 'download', icon: 'download', label: 'Herunterladen' });
  if (isPhoto(it)) {
    actions.push({ id: 'album', icon: 'album-add', label: 'Zu Album hinzufügen' });
    if (it.album) actions.push({ id: 'unalbum', icon: 'album-remove', label: 'Aus Album entfernen' });
  }
  actions.push({ id: 'rename', icon: 'edit', label: 'Umbenennen' });
  if (state.route.mode === 'files') actions.push({ id: 'move', icon: 'move', label: 'Verschieben' });
  actions.push({ id: 'select', icon: 'select', label: 'Auswählen' });
  actions.push({ id: 'delete', icon: 'trash', label: 'Löschen', danger: true });
  const a = await sheet(it.name, actions);
  if (!a) return;
  if (a.id === 'open') open(it);
  else if (a.id === 'download') download(it);
  else if (a.id === 'rename') rename(it);
  else if (a.id === 'move') moveItems([it]);
  else if (a.id === 'delete') remove([it]);
  else if (a.id === 'album') addToAlbum([it]);
  else if (a.id === 'unalbum') removeFromAlbum([it]);
  else if (a.id === 'select') {
    if (!state.selecting) setSelecting(true);
    toggleSelect(state.visible.indexOf(it));
  }
}

function open(it) {
  if (it.isNew) { createAlbum().then((a) => { if (a) go(albumHash(a.space, a.name)); }); return; }
  if (it.isUnsorted) return go('#/photos/unsorted');
  if (it.isAlbum) return go(albumHash(it.space, it.name));
  if (it.dir) return go(filesHash(it.segs));
  openViewer(it);
}

// ---------- Verschieben ----------

// Ordnerauswahl; liefert die Ziel-Segmente oder null. Ordner in `blocked`
// (die verschobenen Ordner selbst) können nicht betreten werden.
let pickerResolve = null;
function pickFolder(title, { start = [], blocked = [] } = {}) {
  pickerResolve?.(null);
  const isBlocked = (segs) => blocked.some((b) => b.length <= segs.length && b.every((s, i) => s === segs[i]));
  let cur = start.length && !isBlocked(start) ? [...start] : [];
  let seq = 0;
  const box = $('#picker-items');

  async function show(segs) {
    const my = ++seq;
    cur = segs;
    $('#picker-up').style.visibility = segs.length ? '' : 'hidden';
    $('#picker-new').style.visibility = segs.length ? '' : 'hidden';
    $('#picker-ok').disabled = !segs.length;
    $('#picker-path').textContent = segs.length ? [spaceLabel(segs[0]), ...segs.slice(1)].join(' / ') : 'Dateien';
    let dirs;
    if (!segs.length) {
      dirs = ['home', 'shared'].map((id) => ({ name: spaceLabel(id), segs: [id], icon: id === 'home' ? 'home' : 'people' }));
    } else {
      box.innerHTML = '<div class="picker-empty">Wird geladen …</div>';
      let data;
      try { data = await listDir(segs); } catch (err) {
        if (my !== seq) return;
        if (err instanceof AuthError) return pickerResolve?.(null);
        box.innerHTML = `<div class="picker-empty">${esc(err.message)}</div>`;
        return;
      }
      if (my !== seq) return;
      if (data === null) return show(parentOf(segs));
      const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
      dirs = data.filter((e) => e.type === 'directory').map((e) => e.name).sort(coll.compare)
        .map((name) => ({ name, segs: [...segs, name], icon: 'folder' }));
    }
    box.innerHTML = dirs.length
      ? dirs.map((d, i) => `<button class="sheet-item" data-k="${i}"${isBlocked(d.segs) ? ' disabled' : ''}>${icon(d.icon)}<span>${esc(d.name)}</span></button>`).join('')
      : '<div class="picker-empty">Keine Unterordner</div>';
    box.onclick = (e) => {
      const btn = e.target.closest('[data-k]');
      if (btn && !btn.disabled) show(dirs[Number(btn.dataset.k)].segs);
    };
  }

  $('#picker-title').textContent = title;
  $('#picker').hidden = false;
  show(cur);
  return new Promise((resolve) => {
    pickerResolve = (segs) => {
      seq++;
      $('#picker').hidden = true;
      pickerResolve = null;
      resolve(segs);
    };
    $('#picker-ok').onclick = () => { if (cur.length) pickerResolve?.(cur); };
    $('#picker-up').onclick = () => { if (cur.length) show(parentOf(cur)); };
    $('#picker-new').onclick = async () => {
      const name = await dialog({ title: 'Neuer Ordner', input: '', ok: 'Erstellen' });
      if (name == null || !pickerResolve) return;
      if (!validName(name)) return toast('Ungültiger Name');
      try {
        await davMkcol([...cur, name]);
        show([...cur, name]);
      } catch (err) { reportError(err); }
    };
  });
}
$('#picker').addEventListener('click', (e) => {
  if (e.target.closest('[data-close]')) pickerResolve?.(null);
});

// Dateien und Ordner in einen anderen Ordner verschieben; bei Namenskonflikt "Name (1)"
async function moveItems(items) {
  items = items.filter(selectable);
  if (!items.length) return false;
  const one = items.length === 1;
  const dest = await pickFolder(one ? `„${items[0].name}“ verschieben` : `${items.length} Elemente verschieben`, {
    start: parentOf(items[0].segs),
    blocked: items.filter((i) => i.dir).map((i) => i.segs),
  });
  if (!dest) return false;
  const todo = items.filter((it) => !sameDir(parentOf(it.segs), dest));
  if (!todo.length) { toast('Liegt schon in diesem Ordner'); return false; }
  let moved = 0;
  try {
    const taken = new Set((await listDir(dest) ?? []).map((e) => e.name));
    for (const it of todo) {
      let name = uniqueName(it.name, taken);
      for (let attempt = 0; ; attempt++) {
        const target = [...dest, name];
        try {
          await davMove(itemUrl(it), it.dir ? dirUrl(target) : fileUrl(target));
          break;
        } catch (err) {
          if (err instanceof HttpError && err.status === 412 && attempt < 5) { taken.add(name); name = uniqueName(name, taken); continue; }
          throw err;
        }
      }
      taken.add(name);
      moved++;
    }
    const where = dest.length === 1 ? spaceLabel(dest[0]) : dest.at(-1);
    toast(`${one ? 'Verschoben' : `${plural(moved, 'Element', 'Elemente')} verschoben`} nach „${where}“`);
  } catch (err) {
    reportError(err);
  }
  photos.stale = true;
  await refresh();
  return moved > 0;
}

// ---------- Hochladen ----------

const up = { queue: [], active: 0, total: 0, done: 0, failed: 0, bytes: 0, loaded: 0, reloadTimer: null, hideTimer: null };
const MAX_PARALLEL = 2;
let uploadTarget = null; // Zielordner für den nächsten Datei-Dialog

function takenNames(dir) {
  if (state.route.mode === 'files' && sameDir(dir, state.path)) return new Set(state.items.map((i) => i.name));
  const names = photos.items.filter((p) => sameDir(parentOf(p.segs), dir)).map((p) => p.name);
  if (dir.length === 2) for (const a of photos.albums) if (a.space === dir[0]) names.push(a.name);
  return new Set(names);
}

// entries: [{ file, rel: ['Unterordner', ...] }]
async function enqueue(entries, base) {
  if (!entries.length || !base?.length) return;
  const taken = takenNames(base);
  const clashes = entries.filter((e) => !e.rel.length && taken.has(e.file.name));
  let policy = 'replace';
  if (clashes.length) {
    const a = await sheet(clashes.length === 1 ? `„${clashes[0].file.name}“ existiert bereits` : `${clashes.length} Dateien existieren bereits`, [
      { id: 'keep', icon: 'plus', label: 'Beide behalten' },
      { id: 'replace', icon: 'refresh', label: 'Ersetzen' },
      { id: 'skip', icon: 'close', label: 'Überspringen' },
    ]);
    if (!a) return;
    policy = a.id;
  }
  const list = $('#uploads-list');
  for (const e of entries) {
    let name = e.file.name;
    if (!e.rel.length && taken.has(name)) {
      if (policy === 'skip') continue;
      if (policy === 'keep') name = uniqueName(name, taken);
    }
    if (!e.rel.length) taken.add(name);
    const li = document.createElement('li');
    li.innerHTML = `<span class="name"></span><span class="state">wartet</span>`;
    li.firstChild.textContent = [...e.rel, name].join('/');
    list.append(li);
    up.queue.push({ file: e.file, segs: [...base, ...e.rel, name], li, loaded: 0 });
    up.total++;
    up.bytes += e.file.size;
  }
  clearTimeout(up.hideTimer);
  $('#uploads').hidden = false;
  updateUploads();
  pump();
}

function pump() {
  while (up.active < MAX_PARALLEL && up.queue.length) startUpload(up.queue.shift());
}

function startUpload(u) {
  up.active++;
  const st = u.li.querySelector('.state');
  st.textContent = '0 %';
  const xhr = new XMLHttpRequest();
  xhr.open('PUT', fileUrl(u.segs));
  xhr.setRequestHeader('X-PC-App', '1');
  xhr.upload.onprogress = (e) => {
    up.loaded += e.loaded - u.loaded;
    u.loaded = e.loaded;
    st.textContent = `${Math.floor((e.loaded / (e.total || 1)) * 100)} %`;
    updateUploads();
  };
  const finish = (ok, msg) => {
    up.active--;
    up.loaded += u.file.size - u.loaded;
    u.loaded = u.file.size;
    if (ok) { up.done++; st.textContent = 'fertig'; st.className = 'state done'; } else { up.failed++; st.textContent = msg; st.className = 'state err'; }
    updateUploads();
    scheduleReload(u.segs);
    pump();
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) finish(true);
    else if (xhr.status === 401 || (xhr.status === 403 && xhr.getResponseHeader('WWW-Authenticate'))) { finish(false, 'abgemeldet'); showLogin(); }
    else finish(false, `Fehler ${xhr.status}`);
  };
  xhr.onerror = () => finish(false, 'Netzwerkfehler');
  xhr.send(u.file);
}

function scheduleReload(segs) {
  if (segs[1] === CONFIG.photosFolder) photos.stale = true;
  const r = state.route;
  const relevant = r.mode === 'photos'
    ? segs[1] === CONFIG.photosFolder
    : segs.length > state.path.length && state.path.every((s, i) => segs[i] === s);
  if (!relevant) return;
  clearTimeout(up.reloadTimer);
  up.reloadTimer = setTimeout(() => refresh(), up.active ? 2000 : 250);
}

function updateUploads() {
  const finished = up.done + up.failed;
  const running = finished < up.total;
  $('#uploads-title').textContent = running
    ? `${finished} von ${up.total} hochgeladen`
    : up.failed ? `${up.done} hochgeladen, ${up.failed} fehlgeschlagen` : `${plural(up.done, 'Datei', 'Dateien')} hochgeladen`;
  $('#uploads-progress').style.width = `${up.bytes ? (up.loaded / up.bytes) * 100 : 100}%`;
  if (!running && !up.failed) up.hideTimer = setTimeout(closeUploads, 4000);
}
function closeUploads() {
  $('#uploads').hidden = true;
  if (up.active || up.queue.length) return;
  $('#uploads-list').innerHTML = '';
  Object.assign(up, { total: 0, done: 0, failed: 0, bytes: 0, loaded: 0 });
}
window.addEventListener('beforeunload', (e) => {
  if (up.active || up.queue.length) { e.preventDefault(); e.returnValue = ''; }
});

function filesFromInput(input) {
  return [...input.files].map((file) => {
    const rel = (file.webkitRelativePath || '').split('/').filter(Boolean).slice(0, -1);
    return { file, rel };
  });
}

// Ordner per Drag & Drop rekursiv einlesen
async function filesFromDrop(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return [...dt.files].map((file) => ({ file, rel: [] }));
  const out = [];
  async function walk(entry, rel) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, rel });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      let batch;
      do {
        batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        for (const child of batch) await walk(child, [...rel, entry.name]);
      } while (batch.length);
    }
  }
  for (const e of entries) await walk(e, []);
  return out;
}

// Standard-Ziel für Drag & Drop in der aktuellen Ansicht
function defaultUploadDir() {
  const r = state.route;
  if (r.mode === 'files') return state.path.length ? state.path : null;
  if (r.tab === 'album') return [...photoRoot(r.space), r.album];
  return photoRoot('home');
}

function pickFiles(dir, { folder = false } = {}) {
  uploadTarget = dir;
  const input = $('#file-input');
  input.webkitdirectory = folder;
  input.value = '';
  input.click();
}

// ---------- Betrachter ----------

const viewer = { list: [], index: 0, cleanup: null, pushed: false };

function openViewer(it) {
  viewer.list = state.visible.filter((i) => !i.dir && selectable(i));
  viewer.index = Math.max(0, viewer.list.indexOf(it));
  $('#viewer').hidden = false;
  document.body.style.overflow = 'hidden';
  if (!viewer.pushed) { history.pushState({ viewer: true }, ''); viewer.pushed = true; }
  showCurrent();
}

function closeViewer({ fromPop = false } = {}) {
  if ($('#viewer').hidden) return;
  viewer.cleanup?.();
  viewer.cleanup = null;
  $('#v-stage').innerHTML = '';
  $('#viewer').hidden = true;
  document.body.style.overflow = '';
  if (viewer.pushed && !fromPop) { viewer.pushed = false; history.back(); }
  viewer.pushed = false;
}

function step(d) {
  const n = viewer.index + d;
  if (n < 0 || n >= viewer.list.length) return;
  viewer.index = n;
  showCurrent();
}

function showCurrent() {
  viewer.cleanup?.();
  viewer.cleanup = null;
  const it = viewer.list[viewer.index];
  const url = fileUrl(it.segs);
  const stage = $('#v-stage');
  stage.className = 'viewer-stage';
  stage.innerHTML = '';
  $('#v-name').textContent = it.name;
  const where = it.album ? ` · ${it.album}` : it.segs[0] === 'shared' && state.route.mode === 'photos' ? ` · ${CONFIG.sharedName}` : '';
  $('#v-meta').textContent = `${fmtSize(it.size)} · ${fmtDate(it.date ?? it.mtime)}${where}${viewer.list.length > 1 ? ` · ${viewer.index + 1} / ${viewer.list.length}` : ''}`;
  const dl = $('#v-download');
  dl.href = url;
  dl.setAttribute('download', it.name);
  $('#v-prev').disabled = viewer.index === 0;
  $('#v-next').disabled = viewer.index === viewer.list.length - 1;
  $('#v-pdf-tools').hidden = true;
  $('#v-page').hidden = true;

  if (it.kind === 'image' && canShowImage(it.name)) viewer.cleanup = showImage(stage, url);
  else if (it.kind === 'pdf') viewer.cleanup = showPdf(stage, url);
  else if (it.kind === 'video') showMedia(stage, url, 'video');
  else if (it.kind === 'audio') showMedia(stage, url, 'audio');
  else if (it.kind === 'text' && it.size <= 5 * 1024 * 1024) showText(stage, url, it.size);
  else showFallback(stage, it, url);

  for (const d of [1, -1]) {
    const n = viewer.list[viewer.index + d];
    if (n && n.kind === 'image' && canShowImage(n.name)) new Image().src = fileUrl(n.segs);
  }
}

function spinner(stage) {
  stage.insertAdjacentHTML('beforeend', '<div class="viewer-msg" data-spin><span class="spinner"></span></div>');
  return () => stage.querySelector('[data-spin]')?.remove();
}

function showFallback(stage, it, url, note = 'Für diesen Dateityp gibt es keine Vorschau.') {
  stage.innerHTML = `<div class="viewer-msg"><div class="card">
    <span class="t-${it.kind}">${icon(ICON[it.kind])}</span>
    <div><b></b><div class="muted">${fmtSize(it.size)}</div></div>
    <div class="muted">${esc(note)}</div>
    <a class="btn btn-primary" href="${esc(url)}" download>Herunterladen</a>
  </div></div>`;
  stage.querySelector('b').textContent = it.name;
}

function showMedia(stage, url, tag) {
  const el = document.createElement(tag);
  el.src = url;
  el.controls = true;
  el.autoplay = true;
  el.preload = 'metadata';
  if (tag === 'video') el.playsInline = true;
  el.addEventListener('error', () => {
    const it = viewer.list[viewer.index];
    showFallback(stage, it, url, 'Dieses Format kann der Browser nicht abspielen.');
  });
  stage.append(el);
}

async function showText(stage, url, size) {
  stage.classList.add('scroll');
  const stop = spinner(stage);
  const LIMIT = 512 * 1024;
  try {
    const res = await req('GET', url, { headers: size > LIMIT ? { Range: `bytes=0-${LIMIT - 1}` } : {} });
    const text = await res.text();
    stop();
    const pre = document.createElement('pre');
    pre.className = 'text-view';
    pre.textContent = text;
    stage.append(pre);
    if (size > LIMIT) stage.insertAdjacentHTML('beforeend', `<p class="text-note">Nur die ersten ${fmtSize(LIMIT)} werden angezeigt – für den Rest herunterladen.</p>`);
  } catch { stop(); }
}

// Bild mit Pinch-Zoom, Doppeltipp, Mausrad und Wischen
function showImage(stage, url) {
  const img = new Image();
  img.className = 'zoomable';
  img.alt = '';
  img.draggable = false;
  img.style.transformOrigin = 'center center';
  const stop = spinner(stage);
  img.onload = stop;
  img.onerror = () => { stop(); showFallback(stage, viewer.list[viewer.index], url, 'Das Bild konnte nicht geladen werden.'); };
  img.src = url;
  stage.append(img);

  let s = 1, tx = 0, ty = 0;
  const pts = new Map();
  let g = null; // laufende Geste
  let lastTap = { t: 0, x: 0, y: 0 };

  const apply = (anim = false) => {
    img.style.transition = anim ? 'transform .2s ease-out' : 'none';
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  };
  const center = () => { const r = stage.getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2, r }; };
  const local = (e, c) => ({ x: e.clientX - c.r.left, y: e.clientY - c.r.top });
  const clamp = () => {
    if (s <= 1) { s = 1; tx = 0; ty = 0; return; }
    const r = stage.getBoundingClientRect();
    const mx = Math.max(0, (img.clientWidth * s - r.width) / 2);
    const my = Math.max(0, (img.clientHeight * s - r.height) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  };
  const zoomAt = (p, ns, c) => {
    ns = Math.min(8, Math.max(1, ns));
    const dx = (p.x - c.x - tx) / s, dy = (p.y - c.y - ty) / s;
    s = ns; tx = p.x - c.x - s * dx; ty = p.y - c.y - s * dy;
  };

  const down = (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = center();
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const m = { x: (a.x + b.x) / 2 - c.r.left, y: (a.y + b.y) / 2 - c.r.top };
      g = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y), s0: s, dx: (m.x - c.x - tx) / s, dy: (m.y - c.y - ty) / s };
    } else if (pts.size === 1) {
      g = { type: s > 1 ? 'pan' : 'swipe', x0: e.clientX, y0: e.clientY, tx0: tx, ty0: ty, t0: Date.now(), moved: false };
    }
  };
  const move = (e) => {
    if (!pts.has(e.pointerId) || !g) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const c = center();
    if (g.type === 'pinch' && pts.size >= 2) {
      const [a, b] = [...pts.values()];
      const m = { x: (a.x + b.x) / 2 - c.r.left, y: (a.y + b.y) / 2 - c.r.top };
      s = Math.min(8, Math.max(0.8, g.s0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0));
      tx = m.x - c.x - s * g.dx; ty = m.y - c.y - s * g.dy;
      apply();
    } else if (g.type === 'pan') {
      tx = g.tx0 + e.clientX - g.x0; ty = g.ty0 + e.clientY - g.y0;
      g.moved = g.moved || Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8;
      apply();
    } else if (g.type === 'swipe') {
      const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
      g.moved = g.moved || Math.hypot(dx, dy) > 8;
      if (Math.abs(dx) > Math.abs(dy)) { tx = dx; ty = 0; } else if (dy > 0) { tx = 0; ty = dy; }
      apply();
    }
  };
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const c = center();
    if (g?.type === 'pinch') {
      if (pts.size === 1) {
        const [p] = [...pts.values()];
        g = { type: 'pan', x0: p.x, y0: p.y, tx0: tx, ty0: ty, moved: true };
      } else g = null;
      if (s < 1) { s = 1; }
      clamp(); apply(true);
      return;
    }
    if (pts.size) return;
    const gest = g; g = null;
    if (!gest) return;
    const dx = e.clientX - gest.x0, dy = e.clientY - gest.y0;
    if (gest.type === 'swipe' && gest.moved) {
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
        const d = dx < 0 ? 1 : -1;
        if (viewer.list[viewer.index + d]) { step(d); return; }
      } else if (dy > 110 && Math.abs(dy) > Math.abs(dx)) { closeViewer(); return; }
      tx = 0; ty = 0; apply(true);
      return;
    }
    if (!gest.moved) {
      const now = Date.now();
      if (now - lastTap.t < 300 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30) {
        if (s > 1) { s = 1; tx = 0; ty = 0; } else zoomAt(local(e, c), 2.5, c);
        clamp(); apply(true);
        lastTap.t = 0;
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    clamp(); apply(true);
  };
  const wheel = (e) => {
    e.preventDefault();
    const c = center();
    zoomAt(local(e, c), s * Math.exp(-e.deltaY * 0.0022), c);
    clamp(); apply();
  };

  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', wheel, { passive: false });
  return () => {
    stage.removeEventListener('pointerdown', down);
    stage.removeEventListener('pointermove', move);
    stage.removeEventListener('pointerup', up);
    stage.removeEventListener('pointercancel', up);
    stage.removeEventListener('wheel', wheel);
  };
}

// PDF-Betrachter auf Basis von pdf.js
let pdfjsLib = null;
async function loadPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import('/vendor/pdfjs/pdf.min.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.js';
  }
  return pdfjsLib;
}

function showPdf(stage, url) {
  stage.classList.add('scroll');
  const stop = spinner(stage);
  let alive = true, doc = null, task = null, io = null;
  let zoom = 1;
  const pages = []; // { el, w, h, rendered, renderTask }
  const wrap = document.createElement('div');
  wrap.className = 'pdf-pages';
  const pageLabel = $('#v-page');
  const MAX_PIXELS = 10_000_000;

  const baseWidth = () => Math.min(stage.clientWidth - 16, 980);

  function layout() {
    const bw = baseWidth();
    for (const p of pages) {
      const w = Math.round(bw * zoom);
      p.el.style.width = `${w}px`;
      p.el.style.height = `${Math.round(w * (p.h / p.w))}px`;
    }
  }

  async function renderPage(i) {
    const p = pages[i];
    if (!alive || p.rendered || p.busy) return;
    p.busy = true;
    try {
      const page = await doc.getPage(i + 1);
      if (!alive) return;
      const vp1 = page.getViewport({ scale: 1 });
      if (Math.abs(vp1.width / vp1.height - p.w / p.h) > 0.01) { p.w = vp1.width; p.h = vp1.height; layout(); }
      const cssW = p.el.clientWidth;
      let scale = (cssW / vp1.width) * (window.devicePixelRatio || 1);
      const px = vp1.width * vp1.height * scale * scale;
      if (px > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / px);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      p.renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp });
      await p.renderTask.promise;
      if (!alive) return;
      p.el.replaceChildren(canvas);
      p.rendered = true;
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.warn(err);
    } finally {
      p.busy = false;
      p.renderTask = null;
    }
  }

  function unrender(p) {
    p.renderTask?.cancel();
    if (p.rendered) { p.el.replaceChildren(); p.rendered = false; }
  }

  function rerenderAll() {
    io?.disconnect();
    for (const p of pages) unrender(p);
    for (const p of pages) io.observe(p.el);
  }

  function updateLabel() {
    if (!pages.length) return;
    const mid = stage.scrollTop + stage.clientHeight / 3;
    let cur = 0;
    for (let i = 0; i < pages.length; i++) { if (pages[i].el.offsetTop <= mid) cur = i; else break; }
    pageLabel.textContent = `${cur + 1} / ${pages.length}`;
  }

  function setZoom(nz, anchor) {
    nz = Math.min(5, Math.max(0.5, nz));
    if (Math.abs(nz - zoom) < 0.001) return;
    const ax = anchor?.x ?? stage.clientWidth / 2, ay = anchor?.y ?? stage.clientHeight / 2;
    const fx = (stage.scrollLeft + ax) / Math.max(1, stage.scrollWidth);
    const fy = (stage.scrollTop + ay) / Math.max(1, stage.scrollHeight);
    zoom = nz;
    layout();
    stage.scrollLeft = fx * stage.scrollWidth - ax;
    stage.scrollTop = fy * stage.scrollHeight - ay;
    rerenderAll();
  }

  // Pinch-Zoom auf Touch-Geräten
  let pinch = null;
  const tStart = (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    const r = stage.getBoundingClientRect();
    pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), ratio: 1, x: (a.clientX + b.clientX) / 2 - r.left, y: (a.clientY + b.clientY) / 2 - r.top };
    wrap.style.transformOrigin = `${stage.scrollLeft + pinch.x}px ${stage.scrollTop + pinch.y}px`;
  };
  const tMove = (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const [a, b] = e.touches;
    pinch.ratio = Math.min(5 / zoom, Math.max(0.5 / zoom, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d0));
    wrap.style.transform = `scale(${pinch.ratio})`;
  };
  const tEnd = (e) => {
    if (!pinch || e.touches.length >= 2) return;
    const { ratio, x, y } = pinch;
    pinch = null;
    wrap.style.transform = '';
    setZoom(zoom * ratio, { x, y });
  };
  const onWheel = (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  const onResize = () => { layout(); rerenderAll(); };

  (async () => {
    try {
      const lib = await loadPdfjs();
      if (!alive) return;
      task = lib.getDocument({
        url,
        cMapUrl: '/vendor/pdfjs/cmaps/',
        cMapPacked: true,
        standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
        wasmUrl: '/vendor/pdfjs/wasm/',
        httpHeaders: { 'X-PC-App': '1' },
      });
      doc = await task.promise;
      if (!alive) return;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      for (let i = 0; i < doc.numPages; i++) {
        const el = document.createElement('div');
        el.className = 'pdf-page';
        el.dataset.i = i;
        wrap.append(el);
        pages.push({ el, w: first.width, h: first.height, rendered: false });
      }
      stop();
      stage.append(wrap);
      layout();
      io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          const p = pages[Number(e.target.dataset.i)];
          if (e.isIntersecting) renderPage(Number(e.target.dataset.i));
          else unrender(p);
        }
      }, { root: stage, rootMargin: '150% 0px' });
      for (const p of pages) io.observe(p.el);
      $('#v-pdf-tools').hidden = false;
      pageLabel.hidden = false;
      updateLabel();
    } catch (err) {
      stop();
      if (!alive) return;
      const it = viewer.list[viewer.index];
      showFallback(stage, it, url, err?.name === 'PasswordException' ? 'Das PDF ist passwortgeschützt.' : 'Das PDF konnte nicht angezeigt werden.');
    }
  })();

  const zin = () => setZoom(zoom * 1.25);
  const zout = () => setZoom(zoom / 1.25);
  $('#v-zoom-in').addEventListener('click', zin);
  $('#v-zoom-out').addEventListener('click', zout);
  stage.addEventListener('scroll', updateLabel, { passive: true });
  stage.addEventListener('touchstart', tStart, { passive: false });
  stage.addEventListener('touchmove', tMove, { passive: false });
  stage.addEventListener('touchend', tEnd);
  stage.addEventListener('touchcancel', tEnd);
  stage.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', onResize);

  return () => {
    alive = false;
    io?.disconnect();
    for (const p of pages) p.renderTask?.cancel();
    task?.destroy();
    $('#v-zoom-in').removeEventListener('click', zin);
    $('#v-zoom-out').removeEventListener('click', zout);
    stage.removeEventListener('scroll', updateLabel);
    stage.removeEventListener('touchstart', tStart);
    stage.removeEventListener('touchmove', tMove);
    stage.removeEventListener('touchend', tEnd);
    stage.removeEventListener('touchcancel', tEnd);
    stage.removeEventListener('wheel', onWheel);
    window.removeEventListener('resize', onResize);
    pageLabel.hidden = true;
  };
}

// ---------- Login ----------

function showLogin() {
  closeViewer();
  $('#app').hidden = true;
  $('#login').hidden = false;
  setTimeout(() => $('#login input[name=username]').focus(), 50);
}
function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
}

async function whoAmI() {
  const res = await req('GET', '/api/me');
  ME = res.headers.get('X-PC-User') || '';
  loadAvatar();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const user = f.get('username').trim().toLowerCase();
  const pass = f.get('password');
  const err = $('#login-error');
  err.hidden = true;
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  const b64 = btoa(String.fromCharCode(...bytes));
  try {
    const res = await fetch('/api/login', { headers: { 'X-PC-App': '1', Authorization: `Basic ${b64}` }, cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 403 || res.status === 401 ? 'Benutzer oder Passwort ist falsch.' : `Serverfehler ${res.status}`);
    ME = res.headers.get('X-PC-User') || user;
    loadAvatar();
    e.target.reset();
    Object.assign(photos, { items: [], albums: [], stale: true, at: 0 });
    state.route = { mode: null };
    route();
  } catch (ex) {
    err.textContent = ex.message === 'Failed to fetch' ? 'Server nicht erreichbar.' : ex.message;
    err.hidden = false;
  }
});

async function logout() {
  await fetch('/api/logout', { cache: 'no-store' }).catch(() => {});
  state.items = [];
  ME = '';
  avatarUrl = null;
  renderAvatars();
  Object.assign(photos, { items: [], albums: [], stale: true, at: 0 });
  showLogin();
}

// ---------- Profil ----------

// Das Profilbild liegt als versteckte Datei im eigenen Bereich.
const AVATAR_DIR = ['home', '.pi-cloud'];
const AVATAR = [...AVATAR_DIR, 'avatar.jpg'];
const AVATAR_SIZE = 384;
let avatarUrl = null;

function renderAvatars() {
  const initial = (ME || '?').charAt(0).toUpperCase();
  for (const el of [$('#menu-avatar'), $('#profile-avatar')]) {
    el.textContent = initial;
    el.classList.toggle('has-img', !!avatarUrl);
    el.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : '';
  }
  $('#avatar-remove').hidden = !avatarUrl;
}

function loadAvatar(bust = false) {
  const url = fileUrl(AVATAR) + (bust ? `?v=${Date.now()}` : '');
  const img = new Image();
  img.onload = () => { avatarUrl = url; renderAvatars(); };
  img.onerror = () => { avatarUrl = null; renderAvatars(); };
  img.src = url;
  renderAvatars();
}

async function squareJpeg(file) {
  let src;
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    src = await new Promise((resolve, reject) => {
      const img = new Image();
      const u = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(u); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(u); reject(new Error('Dieses Bildformat wird nicht unterstützt.')); };
      img.src = u;
    });
  }
  const w = src.width;
  const h = src.height;
  const side = Math.min(w, h);
  const out = Math.min(AVATAR_SIZE, side);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = out;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
  src.close?.();
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht verarbeitet werden.'))), 'image/jpeg', 0.88);
  });
}

async function setAvatar(file) {
  if (!file) return;
  try {
    const blob = await squareJpeg(file);
    await ensureDir(AVATAR_DIR);
    const res = await req('PUT', fileUrl(AVATAR), { body: blob, headers: { 'Content-Type': 'image/jpeg' } });
    if (!res.ok) throw new HttpError(res.status);
    loadAvatar(true);
    toast('Profilbild gespeichert');
  } catch (err) { reportError(err); }
}

async function removeAvatar() {
  if (!await dialog({ title: 'Profilbild entfernen?', ok: 'Entfernen', danger: true })) return;
  try {
    await davDelete(fileUrl(AVATAR));
    avatarUrl = null;
    renderAvatars();
  } catch (err) { reportError(err); }
}

function openProfile() {
  $('#profile-name').textContent = ME;
  const form = $('#password-form');
  form.reset();
  form.elements.username.value = ME;
  $('#password-error').hidden = true;
  renderAvatars();
  $('#profile').showModal();
}

$('#profile-close').addEventListener('click', () => $('#profile').close());
$('#profile').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
$('#profile-avatar').addEventListener('click', () => $('#avatar-input').click());
$('#avatar-change').addEventListener('click', () => $('#avatar-input').click());
$('#avatar-remove').addEventListener('click', removeAvatar);
$('#avatar-input').addEventListener('change', (e) => {
  setAvatar(e.target.files[0]);
  e.target.value = '';
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target.elements;
  const err = $('#password-error');
  const fail = (msg) => { err.textContent = msg; err.hidden = false; };
  err.hidden = true;
  if (f.next.value !== f.repeat.value) return fail('Die neuen Passwörter stimmen nicht überein.');
  const btn = $('#password-ok');
  btn.disabled = true;
  try {
    const res = await req('POST', '/api/password', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: f.current.value, next: f.next.value }),
    });
    if (res.status === 429) return fail('Zu viele Versuche. Bitte kurz warten.');
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || errorText(res.status));
    e.target.reset();
    f.username.value = ME;
    $('#profile').close();
    toast('Passwort geändert');
  } catch (ex) {
    if (!(ex instanceof AuthError)) fail(ex.message === 'Failed to fetch' ? 'Server nicht erreichbar.' : ex.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Ereignisse ----------

const listing = $('#listing');
let press = null;
let suppressClick = false;

listing.addEventListener('click', (e) => {
  const el = e.target.closest('[data-i]');
  if (!el) return;
  if (suppressClick) { suppressClick = false; return; }
  const i = Number(el.dataset.i);
  const it = state.visible[i];
  if (!it) return;
  if (e.target.closest('.item-more')) { itemMenu(it); return; }
  if (state.selecting && selectable(it)) toggleSelect(i);
  else if (!state.selecting) open(it);
});
listing.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const el = e.target.closest('[data-i]');
  if (el) open(state.visible[Number(el.dataset.i)]);
});
listing.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-i]');
  if (!el) return;
  e.preventDefault();
  if (press?.fired) return;
  itemMenu(state.visible[Number(el.dataset.i)]);
});
listing.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  const el = e.target.closest('[data-i]');
  if (!el || e.target.closest('.item-more')) return;
  const i = Number(el.dataset.i);
  press = { x: e.clientX, y: e.clientY, fired: false, timer: setTimeout(() => {
    press.fired = true;
    suppressClick = true;
    navigator.vibrate?.(12);
    const it = state.visible[i];
    if (!selectable(it)) { if (it?.isAlbum) itemMenu(it); return; }
    if (!state.selecting) setSelecting(true);
    toggleSelect(i);
  }, 480) };
});
const cancelPress = (e) => {
  if (!press) return;
  if (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
  clearTimeout(press.timer);
  if (e.type !== 'pointermove') setTimeout(() => { press = null; }, 50);
};
listing.addEventListener('pointermove', cancelPress);
listing.addEventListener('pointerup', cancelPress);
listing.addEventListener('pointercancel', cancelPress);

let searchTimer;
$('#search').addEventListener('input', (e) => {
  state.filter = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => (state.route.mode === 'files' ? renderFiles() : renderPhotos()), 120);
});

$('#btn-view').addEventListener('click', () => {
  state.view = state.view === 'grid' ? 'list' : 'grid';
  store.set('pc.view', state.view);
  renderFiles();
});

$('#btn-sort').addEventListener('click', async () => {
  const arrow = state.sortDir > 0 ? ' ↑' : ' ↓';
  const opts = [
    { id: 'name', icon: 'sort', label: 'Name' },
    { id: 'mtime', icon: 'sort', label: 'Geändert' },
    { id: 'size', icon: 'sort', label: 'Größe' },
  ].map((o) => ({ ...o, checked: o.id === state.sortKey, label: o.label + (o.id === state.sortKey ? arrow : '') }));
  const a = await sheet('Sortieren nach', opts);
  if (!a) return;
  if (a.id === state.sortKey) state.sortDir *= -1;
  else { state.sortKey = a.id; state.sortDir = a.id === 'name' ? 1 : -1; }
  store.set('pc.sortKey', state.sortKey);
  store.set('pc.sortDir', String(state.sortDir));
  renderFiles();
});

$('#btn-select').addEventListener('click', () => setSelecting(!state.selecting));
$('#btn-album').addEventListener('click', async () => {
  const album = currentAlbum();
  if (!album) return;
  const a = await sheet(album.name, [
    { id: 'upload', icon: 'upload', label: 'Fotos hinzufügen (hochladen)' },
    { id: 'rename', icon: 'edit', label: 'Album umbenennen' },
    { id: 'files', icon: 'folder', label: 'Im Dateibaum öffnen' },
    { id: 'delete', icon: 'trash', label: 'Album löschen', danger: true },
  ]);
  if (a?.id === 'upload') pickFiles(album.segs);
  if (a?.id === 'rename') renameAlbum(album);
  if (a?.id === 'files') go(filesHash(album.segs));
  if (a?.id === 'delete') deleteAlbum(album);
});
$('#sel-cancel').addEventListener('click', () => setSelecting(false));
$('#sel-all').addEventListener('click', () => {
  const pool = state.visible.filter(selectable);
  const all = pool.every((i) => state.selected.has(keyOf(i)));
  state.selected = new Set(all ? [] : pool.map(keyOf));
  for (const el of listing.querySelectorAll('[data-i]')) {
    const it = state.visible[Number(el.dataset.i)];
    if (selectable(it)) el.classList.toggle('selected', state.selected.has(keyOf(it)));
  }
  updateSelbar();
});
$('#sel-delete').addEventListener('click', async () => {
  if (await remove(selectedItems())) setSelecting(false);
});
$('#sel-move').addEventListener('click', async () => {
  const items = selectedItems();
  if (!items.length) return toast('Nichts ausgewählt');
  if (await moveItems(items)) setSelecting(false);
});
$('#sel-download').addEventListener('click', async () => {
  const files = selectedItems().filter((i) => !i.dir);
  if (!files.length) return toast('Ordner können nicht heruntergeladen werden – nur Dateien.');
  for (const f of files) { download(f); await new Promise((r) => setTimeout(r, 400)); }
  setSelecting(false);
});
$('#sel-album').addEventListener('click', async () => {
  const items = selectedItems();
  if (!items.length) return toast('Nichts ausgewählt');
  if (await addToAlbum(items)) setSelecting(false);
});
$('#sel-unalbum').addEventListener('click', async () => {
  const items = selectedItems();
  if (!items.length) return toast('Nichts ausgewählt');
  if (await removeFromAlbum(items)) setSelecting(false);
});

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });

$('#btn-menu').addEventListener('click', async () => {
  const items = [
    { id: 'profile', icon: 'user', label: 'Profil' },
    { id: 'refresh', icon: 'refresh', label: 'Aktualisieren' },
  ];
  if (installPrompt) items.push({ id: 'install', icon: 'download', label: 'App installieren' });
  items.push({ id: 'logout', icon: 'logout', label: 'Abmelden' });
  const a = await sheet(ME ? `Angemeldet als ${ME}` : '', items);
  if (!a) return;
  if (a.id === 'refresh') { photos.stale = true; refresh({ quiet: false }); }
  if (a.id === 'logout') logout();
  if (a.id === 'profile') openProfile();
  if (a.id === 'install') { installPrompt.prompt(); installPrompt = null; }
});

$('#fab').addEventListener('click', async () => {
  const r = state.route;
  if (r.mode === 'files') {
    if (!state.path.length) return;
    const items = [
      { id: 'upload', icon: 'upload', label: 'Dateien hochladen' },
      { id: 'folder', icon: 'folder-plus', label: 'Neuer Ordner' },
    ];
    const dirPick = 'webkitdirectory' in document.createElement('input') && !/iPhone|iPad|iPod|Android/.test(navigator.userAgent);
    if (dirPick) items.splice(1, 0, { id: 'upload-dir', icon: 'folder', label: 'Ordner hochladen' });
    const a = await sheet('', items);
    if (a?.id === 'upload') pickFiles(state.path);
    if (a?.id === 'upload-dir') pickFiles(state.path, { folder: true });
    if (a?.id === 'folder') createFolder();
    return;
  }
  if (r.tab === 'album') {
    const a = await sheet(`Album „${r.album}“`, [
      { id: 'upload', icon: 'upload', label: 'Fotos hochladen' },
      { id: 'new', icon: 'album', label: 'Neues Album' },
    ]);
    if (a?.id === 'upload') pickFiles([...photoRoot(r.space), r.album]);
    if (a?.id === 'new') { const al = await createAlbum(); if (al) go(albumHash(al.space, al.name)); }
    return;
  }
  const a = await sheet('', [
    { id: 'up-home', icon: 'upload', label: 'Fotos hochladen – persönlich' },
    { id: 'up-shared', icon: 'people', label: `Fotos hochladen – ${CONFIG.sharedName}` },
    { id: 'new', icon: 'album', label: 'Neues Album' },
  ]);
  if (a?.id === 'up-home') pickFiles(photoRoot('home'));
  if (a?.id === 'up-shared') pickFiles(photoRoot('shared'));
  if (a?.id === 'new') { const al = await createAlbum(); if (al) go(albumHash(al.space, al.name)); }
});
$('#file-input').addEventListener('change', (e) => enqueue(filesFromInput(e.target), uploadTarget));
$('#uploads-close').addEventListener('click', closeUploads);

// Drag & Drop
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e) || $('#app').hidden || !defaultUploadDir()) return;
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', async (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').hidden = true;
  const dir = defaultUploadDir();
  if ($('#app').hidden || !dir) return;
  enqueue(await filesFromDrop(e.dataTransfer), dir);
});

// Betrachter-Steuerung
$('#v-close').addEventListener('click', () => closeViewer());
$('#v-prev').addEventListener('click', () => step(-1));
$('#v-next').addEventListener('click', () => step(1));
$('#v-more').addEventListener('click', async () => {
  const it = viewer.list[viewer.index];
  const inPhotos = it.segs[1] === CONFIG.photosFolder && (it.kind === 'image' || it.kind === 'video');
  const opts = [{ id: 'rename', icon: 'edit', label: 'Umbenennen' }];
  if (inPhotos) opts.push({ id: 'album', icon: 'album-add', label: 'Zu Album hinzufügen' });
  opts.push({ id: 'files', icon: 'folder', label: 'Im Dateibaum zeigen' });
  opts.push({ id: 'delete', icon: 'trash', label: 'Löschen', danger: true });
  const a = await sheet(it.name, opts);
  if (!a) return;
  if (a.id === 'rename') { if (await rename(it)) showCurrent(); }
  if (a.id === 'album') {
    const album = await pickAlbum('Zu Album hinzufügen');
    if (!album) return;
    try {
      await moveInto([it], [...photoRoot(album.space), album.name]);
      it.space = album.space;
      it.album = album.name;
      toast(`In „${album.name}“ verschoben`);
      photos.stale = true;
      showCurrent();
    } catch (err) { reportError(err); }
  }
  if (a.id === 'files') { closeViewer(); setTimeout(() => go(filesHash(parentOf(it.segs))), 0); }
  if (a.id === 'delete' && await remove([it])) {
    viewer.list.splice(viewer.index, 1);
    if (!viewer.list.length) closeViewer();
    else { viewer.index = Math.min(viewer.index, viewer.list.length - 1); showCurrent(); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#sheet').hidden) { sheetResolve?.(null); return; }
  if (e.key === 'Escape' && !$('#picker').hidden && !$('#dialog').open) { pickerResolve?.(null); return; }
  if ($('#viewer').hidden || $('#dialog').open || !$('#sheet').hidden) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowLeft') step(-1);
  if (e.key === 'ArrowRight') step(1);
});

window.addEventListener('popstate', () => {
  if (!$('#viewer').hidden) closeViewer({ fromPop: true });
});
window.addEventListener('hashchange', route);
window.addEventListener('scroll', () => {
  document.querySelector('.topbar').classList.toggle('scrolled', window.scrollY > 4);
}, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('#app').hidden && Date.now() - state.loadedAt > 30_000) {
    photos.stale = true;
    refresh();
  }
});

// ---------- Start ----------

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

(async () => {
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (res.ok) Object.assign(CONFIG, await res.json());
  } catch { /* Standardwerte */ }
  for (const a of document.querySelectorAll('#tabs a')) a.addEventListener('click', () => { if (state.selecting) setSelecting(false); });
  try {
    await whoAmI();
  } catch (err) {
    if (err instanceof AuthError) return;
  }
  state.route = { mode: null };
  route();
})();
