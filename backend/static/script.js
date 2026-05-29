/* ============================================================
   WatchMe — Smart Security Dashboard
   script.js — Complete Application Logic
   ============================================================ */

'use strict';

// ════════════════════════════════════════════════════════════
// 1. CONSTANTS & STATE
// ════════════════════════════════════════════════════════════

// رابط سيرفر الباك إند الخاص بك على ريندر لتوجيه كافة الطلبات إليه
const API = 'https://s-tracker.onrender.com';          
const GAZA_CENTER = [31.35, 34.30];
const GAZA_ZOOM   = 11;
const MAX_LAYERS  = 15;

/** Central application state */
const State = {
  map:             null,   // Leaflet map instance
  tileLayer:       null,   // active tile layer
  drawControl:     null,   // Leaflet.draw control
  drawnItems:      null,   // FeatureGroup for drawn shapes
  incidentMarker:  null,   // current incident marker on map
  incidentCircle:  null,   // current hazard radius circle
  placingIncident: false,  // is user in click-to-place mode?
  activeDrawTool:  null,   // currently active draw button el
  layers:          {},     // { id: { meta, geojson, leafletGroup, visible, style } }
  incidents:       [],     // logged incidents array
  staffResults:    [],     // last proximity scan results
  staffFilter:     'all',  // current filter tab value
  darkMode:        true,   // theme flag
  allLayersOn:     true,   // toggle-all state
};

// Colour palette cycled for new layers
const LAYER_COLORS = [
  '#f97316','#06b6d4','#22c55e','#3b82f6','#a855f7',
  '#ec4899','#eab308','#14b8a6','#f43f5e','#8b5cf6',
  '#10b981','#0ea5e9','#84cc16','#fb923c','#e879f9',
];
let colorIndex = 0;

// ════════════════════════════════════════════════════════════
// 2. UTILITIES
// ════════════════════════════════════════════════════════════

/** Show a toast notification */
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toast-container');
  const icons = {
    success: `<svg class="w-4 h-4 text-ops-green flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>`,
    error:   `<svg class="w-4 h-4 text-ops-red flex-none"   fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z"/></svg>`,
    warning: `<svg class="w-4 h-4 text-ops-amber flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m9.303 3.376c.866 1.5-.217 3.374-1.948 3.374H4.645c-1.73 0-2.813-1.874-1.948-3.374L10.051 3.378c.866-1.5 3.032-1.5 3.898 0l5.354 12.748z"/></svg>`,
    info:    `<svg class="w-4 h-4 text-ops-blue flex-none"  fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>`,
  };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `${icons[type] || icons.info}<span class="flex-1 text-sm">${message}</span>
    <button class="text-slate-500 hover:text-slate-300 ml-2 flex-none" onclick="dismissToast(this.parentElement)">
      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>`;
  container.appendChild(el);
  if (duration > 0) {
    setTimeout(() => dismissToast(el), duration);
  }
  return el;
}

function dismissToast(el) {
  if (!el || !el.parentElement) return;
  el.classList.add('toast-dismiss');
  setTimeout(() => el.remove(), 350);
}
window.dismissToast = dismissToast;

/** Open a modal by id */
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('hidden'); el.classList.add('show'); }
}
/** Close a modal by id */
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('hidden'); el.classList.remove('show'); }
}

/** Format metres into a readable string */
function fmtDist(m) {
  if (m === undefined || m === null) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** Format square metres */
function fmtArea(m2) {
  if (!m2) return '—';
  if (m2 < 1e6) return `${Math.round(m2).toLocaleString()} m²`;
  return `${(m2 / 1e6).toFixed(3)} km²`;
}

/** Escape HTML */
function esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Generate a short unique id */
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/** Clamp a number */
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

/** Haversine distance (metres) — client-side for instant feedback */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            math.cos(lat1 * Math.PI/180) * math.cos(lat2 * Math.PI/180) *
            math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

/** Ray-casting point-in-polygon (coords = [[lon,lat], ...]) */
function pointInPolygon(lat, lon, ring) {
  let inside = false;
  const n = ring.length;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi)) {
      inside = !inside;
    }
    j = i;
  }
  return inside;
}

// ════════════════════════════════════════════════════════════
// 3. THEME  (dark / light mode)
// ════════════════════════════════════════════════════════════

function applyTheme(dark) {
  State.darkMode = dark;
  const body = document.body;
  if (dark) {
    body.classList.remove('light-mode');
    document.documentElement.classList.add('dark');
    document.getElementById('icon-sun').classList.remove('hidden');
    document.getElementById('icon-moon').classList.add('hidden');
    State.map && State.map.getContainer().querySelector('.leaflet-tile-pane')
      && State.map.getContainer().classList.add('dark-map');
  } else {
    body.classList.add('light-mode');
    document.documentElement.classList.remove('dark');
    document.getElementById('icon-sun').classList.add('hidden');
    document.getElementById('icon-moon').classList.remove('hidden');
    State.map && State.map.getContainer().classList.remove('dark-map');
  }
  saveSetting('theme', dark ? 'dark' : 'light');
}

function initTheme() {
  const saved = localStorage.getItem('wm_theme');
  applyTheme(saved !== 'light');   // default = dark
}

// ════════════════════════════════════════════════════════════
// 4. LOADING SCREEN
// ════════════════════════════════════════════════════════════

function runLoadingScreen() {
  const bar   = document.getElementById('loading-bar');
  const steps = [10, 30, 55, 75, 90, 100];
  let   i     = 0;
  const tick = setInterval(() => {
    if (i < steps.length) {
      bar.style.width = steps[i] + '%';
      i++;
    } else {
      clearInterval(tick);
      setTimeout(() => {
        const screen = document.getElementById('loading-screen');
        screen.classList.add('fade-out');
        setTimeout(() => screen.remove(), 600);
      }, 300);
    }
  }, 180);
}

// ════════════════════════════════════════════════════════════
// 5. SIDEBAR COLLAPSE / RESIZE
// ════════════════════════════════════════════════════════════

function initSidebar() {
  const sidebar     = document.getElementById('sidebar');
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  const expandBtn   = document.getElementById('sidebar-expand-btn');

  collapseBtn.addEventListener('click', () => {
    sidebar.classList.add('collapsed');
    expandBtn.classList.remove('hidden');
    expandBtn.classList.add('flex');
  });
  expandBtn.addEventListener('click', () => {
    sidebar.classList.remove('collapsed');
    expandBtn.classList.add('hidden');
    expandBtn.classList.remove('flex');
  });

  // Drag-to-resize
  const handle = document.getElementById('sidebar-resize-handle');
  let dragging  = false;
  let startX, startW;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startX   = e.clientX;
    startW   = sidebar.offsetWidth;
    document.body.style.cursor    = 'col-resize';
    document.body.style.userSelect = 'none';
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const w = clamp(startW + e.clientX - startX, 280, 560);
    sidebar.style.width    = w + 'px';
    sidebar.style.minWidth = w + 'px';
  });
  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.cursor    = '';
    document.body.style.userSelect = '';
  });
}

// ════════════════════════════════════════════════════════════
// 6. MAP INITIALISATION
// ════════════════════════════════════════════════════════════

function initMap() {
  State.map = L.map('map', {
    center:        GAZA_CENTER,
    zoom:          GAZA_ZOOM,
    zoomControl:   false,
    attributionControl: false,
  });

  // Default tile: OpenStreetMap
  setTileLayer('street');

  // FeatureGroup for drawn shapes
  State.drawnItems = new L.FeatureGroup();
  State.map.addLayer(State.drawnItems);

  // Leaflet.draw control
  State.drawControl = new L.Control.Draw({
    edit:   { featureGroup: State.drawnItems },
    draw: {
      marker:    { icon: createCustomMarkerIcon('#f97316') },
      polyline:  { shapeOptions: { color: '#3b82f6', weight: 3 } },
      polygon:   { shapeOptions: { color: '#f59e0b', fillOpacity: 0.15, weight: 2 } },
      circle:    { shapeOptions: { color: '#ef4444', fillOpacity: 0.08, weight: 2, dashArray: '6 4' } },
      rectangle: false,
      circlemarker: false,
    },
  });
  State.map.addControl(State.drawControl);

  // Map event listeners
  State.map.on('mousemove', onMapMouseMove);
  State.map.on('click',     onMapClick);
  State.map.on('draw:created', onDrawCreated);
  State.map.on('draw:edited',  onDrawEdited);
  State.map.on('draw:deleted', onDrawDeleted);
  State.map.on('zoomend moveend', updateScaleDisplay);

  // Custom zoom buttons
  document.getElementById('map-zoom-in').addEventListener('click',   () => State.map.zoomIn());
  document.getElementById('map-zoom-out').addEventListener('click',  () => State.map.zoomOut());
  document.getElementById('map-fit-all').addEventListener('click',   fitAllLayers);
  document.getElementById('map-locate-me').addEventListener('click', locateMe);

  initMapContextMenu();
  updateScaleDisplay();
}

function createCustomMarkerIcon(color) {
  return L.divIcon({
    className: '',
    html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.268 0 0 6.268 0 14c0 9.333 14 22 14 22s14-12.667 14-22C28 6.268 21.732 0 14 0z" fill="${color}"/>
      <circle cx="14" cy="14" r="6" fill="white" fill-opacity="0.9"/>
    </svg>`,
    iconSize:   [28, 36],
    iconAnchor: [14, 36],
    popupAnchor:[0, -38],
  });
}

function createIncidentIcon() {
  return L.divIcon({
    className: '',
    html: `<div class="incident-marker-icon">
      <svg width="36" height="36" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="18" cy="18" r="17" fill="rgba(239,68,68,0.15)" stroke="#ef4444" stroke-width="1.5" stroke-dasharray="4 3"/>
        <circle cx="18" cy="18" r="8" fill="#ef4444" opacity="0.9"/>
        <text x="18" y="23" text-anchor="middle" fill="white" font-size="12" font-weight="bold">!</text>
      </svg>
    </div>`,
    iconSize:   [36, 36],
    iconAnchor: [18, 18],
    popupAnchor:[0, -20],
  });
}

// ════════════════════════════════════════════════════════════
// 7. TILE LAYER SWITCHER
// ════════════════════════════════════════════════════════════

const TILE_PROVIDERS = {
  street: {
    url:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap contributors',
    maxZoom: 19,
  },
  satellite: {
    url:  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri — Earthstar Geographics',
    maxZoom: 19,
  },
  topo: {
    url:  'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap contributors',
    maxZoom: 17,
  },
};

function setTileLayer(key) {
  if (State.tileLayer) State.map.removeLayer(State.tileLayer);
  const p = TILE_PROVIDERS[key];
  State.tileLayer = L.tileLayer(p.url, { attribution: p.attr, maxZoom: p.maxZoom });
  State.tileLayer.addTo(State.map);

  document.querySelectorAll('.tile-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tile === key);
  });
  
  saveSetting('tile', key);
}

function initTileSwitcher() {
  document.querySelectorAll('.tile-btn').forEach(btn => {
    btn.addEventListener('click', () => setTileLayer(btn.dataset.tile));
  });
}

// ════════════════════════════════════════════════════════════
// 8. CURSOR COORDINATES
// ════════════════════════════════════════════════════════════

function onMapMouseMove(e) {
  const { lat, lng } = e.latlng;
  const fmt = (v, pos, neg) => `${Math.abs(v).toFixed(5)}°${v >= 0 ? pos : neg}`;
  document.getElementById('cursor-coords').textContent =
    `${fmt(lat,'N','S')}, ${fmt(lng,'E','W')}`;
}

function updateScaleDisplay() {
  if (!State.map) return;
  const zoom   = State.map.getZoom();
  const center = State.map.getCenter();
  const mpp    = 156543 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
  const mapW   = State.map.getSize().x;
  const scaleM = Math.round(mpp * mapW * 0.15);
  document.getElementById('map-scale-text').textContent = fmtDist(scaleM) + ' scale';
}

// ════════════════════════════════════════════════════════════
// 9. SEARCH
// ════════════════════════════════════════════════════════════

let searchDebounce = null;

function initSearch() {
  const input   = document.getElementById('global-search');
  const clear   = document.getElementById('search-clear');
  const results = document.getElementById('search-results');

  input.addEventListener('input', () => {
    const val = input.value.trim();
    clear.classList.toggle('hidden', !val);

    const coordMatch = val.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        showSearchResult([{
          display_name: `📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
          lat: String(lat), lon: String(lng),
          _isCoord: true,
        }]);
        return;
      }
    }

    const staffMatches = searchStaffInLayers(val);
    if (staffMatches.length > 0) {
      showSearchResult(staffMatches.slice(0, 6).map(f => ({
        display_name: `👤 ${f.properties.name || 'Unnamed'} — ${f.properties.Department || f.properties.department || f._layerName || ''}`,
        lat: String(f._lat), lon: String(f._lng),
        _isStaff: true,
      })));
      return;
    }

    clearTimeout(searchDebounce);
    if (val.length < 3) { results.classList.add('hidden'); return; }
    searchDebounce = setTimeout(() => geocodeSearch(val), 500);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.classList.add('hidden');
    results.classList.add('hidden');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#global-search') && !e.target.closest('#search-results')) {
      results.classList.add('hidden');
    }
  });
}

function searchStaffInLayers(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  const matches = [];
  for (const [, layer] of Object.entries(State.layers)) {
    const features = layer.geojson?.features || [];
    features.forEach(f => {
      const name = (f.properties?.name || '').toLowerCase();
      const dept = (f.properties?.Department || f.properties?.department || '').toLowerCase();
      if (name.includes(q) || dept.includes(q)) {
        if (f.geometry?.type === 'Point') {
          matches.push({
            ...f,
            _lat:       f.geometry.coordinates[1],
            _lng:       f.geometry.coordinates[0],
            _layerName: layer.meta.name,
          });
        }
      }
    });
  }
  return matches;
}

async function geocodeSearch(query) {
  try {
    const res  = await fetch(`${API}/api/geocode?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    showSearchResult(Array.isArray(data) ? data : []);
  } catch {
    // Silently fail
  }
}

function showSearchResult(results) {
  const container = document.getElementById('search-results');
  const list      = document.getElementById('search-results-list');
  if (!results.length) { container.classList.add('hidden'); return; }

  list.innerHTML = results.map((r, i) => `
    <button class="w-full text-left px-3 py-2.5 hover:bg-slate-700 transition-colors flex items-start gap-2.5"
            onclick="selectSearchResult(${i})">
      <svg class="w-3.5 h-3.5 mt-0.5 text-brand-400 flex-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
        <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
      </svg>
      <span class="text-xs text-slate-300 leading-snug">${esc(r.display_name)}</span>
    </button>
  `).join('');

  container._results = results;
  container.classList.remove('hidden');
}

window.selectSearchResult = function(index) {
  const container = document.getElementById('search-results');
  const r = container._results?.[index];
  if (!r) return;
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  State.map.setView([lat, lng], 15, { animate: true });
  container.classList.add('hidden');
  document.getElementById('global-search').value = '';
  document.getElementById('search-clear').classList.add('hidden');
  
  L.marker([lat, lng], { icon: createCustomMarkerIcon('#06b6d4') })
    .addTo(State.map)
    .bindPopup(`<div class="wm-popup"><div class="wm-popup-header">
      <span class="wm-popup-title">${esc(r.display_name.split(',')[0])}</span>
    </div><div class="wm-popup-props">
      <div class="wm-popup-row"><span class="wm-popup-key">Lat</span><span class="wm-popup-val">${lat.toFixed(6)}</span></div>
      <div class="wm-popup-row"><span class="wm-popup-key">Lng</span><span class="wm-popup-val">${lng.toFixed(6)}</span></div>
    </div></div>`)
    .openPopup();
};

// ════════════════════════════════════════════════════════════
// 10. FILE UPLOAD & PARSING
// ════════════════════════════════════════════════════════════

function initUpload() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('click', (e) => {
    if (e.target !== fileInput) fileInput.click();
  });
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) handleFiles(Array.from(fileInput.files));
    fileInput.value = '';
  });

  dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); });
  dropZone.addEventListener('dragleave', (e) => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f =>
      /\.(kml|kmz|csv)$/i.test(f.name));
    if (files.length) handleFiles(files);
    else toast('Only .kml, .kmz and .csv files are supported.', 'warning');
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop',     (e) => e.preventDefault());
}

async function handleFiles(files) {
  if (Object.keys(State.layers).length + files.length > MAX_LAYERS) {
    toast(`Cannot add ${files.length} layer(s). Maximum is ${MAX_LAYERS}.`, 'error');
    return;
  }
  for (const file of files) {
    await processFile(file);
  }
}

async function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  showUploadProgress(file.name, 0);

  try {
    let geojson;

    if (ext === 'csv') {
      geojson = await parseCSV(file);
      setUploadProgress(file.name, 100);
    } else if (ext === 'kml') {
      try {
        geojson = await uploadToBackend(file, (p) => setUploadProgress(file.name, p));
      } catch {
        const text = await file.text();
        const parser = new DOMParser();
        const dom    = parser.parseFromString(text, 'text/xml');
        geojson      = toGeoJSON.kml(dom);
        setUploadProgress(file.name, 100);
      }
    } else if (ext === 'kmz') {
      try {
        geojson = await uploadToBackend(file, (p) => setUploadProgress(file.name, p));
      } catch {
        geojson = await parseKMZClientSide(file);
        setUploadProgress(file.name, 100);
      }
    }

    if (!geojson || !geojson.features) throw new Error('Invalid GeoJSON output');

    const layerId = uid();
    const color   = LAYER_COLORS[colorIndex % LAYER_COLORS.length];
    colorIndex++;

    addLayer(layerId, {
      name:    file.name.replace(/\.(kml|kmz|csv)$/i, ''),
      color,
      file:    file.name,
    }, geojson);

    toast(`✓ Loaded "${file.name}" — ${geojson.features.length} features`, 'success');
  } catch (err) {
    console.error('File parse error:', err);
    toast(`Failed to load "${file.name}": ${err.message}`, 'error');
    removeUploadProgress(file.name);
  }
}

async function uploadToBackend(file, onProgress) {
  const form = new FormData();
  form.append('file', file);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/api/upload`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 80));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText);
        onProgress(100);
        resolve(data.geojson);
      } else {
        reject(new Error(`Backend error ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.send(form);
  });
}

async function parseKMZClientSide(file) {
  const buf    = await file.arrayBuffer();
  const zip    = await JSZip.loadAsync(buf);
  let kmlEntry = zip.file('doc.kml');
  if (!kmlEntry) {
    const kmlFiles = Object.keys(zip.files).filter(n => n.toLowerCase().endsWith('.kml'));
    if (!kmlFiles.length) throw new Error('No KML file inside KMZ archive');
    kmlEntry = zip.file(kmlFiles[0]);
  }
  const kmlText = await kmlEntry.async('string');
  const parser  = new DOMParser();
  const dom     = parser.parseFromString(kmlText, 'text/xml');
  return toGeoJSON.kml(dom);
}

async function parseCSV(file) {
  const text = await file.text();
  const rows = text.trim().split('\n');
  if (rows.length < 2) throw new Error('CSV file is empty or has no data rows');

  const headers = rows[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const latIdx  = headers.findIndex(h => /^lat(itude)?$/i.test(h));
  const lngIdx  = headers.findIndex(h => /^lo?n(gitude)?$/i.test(h));

  if (latIdx === -1 || lngIdx === -1) {
    throw new Error('CSV must have "lat" and "lng" (or "latitude"/"longitude") columns');
  }

  const features = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const lat   = parseFloat(cells[latIdx]);
    const lng   = parseFloat(cells[lngIdx]);
    if (isNaN(lat) || isNaN(lng)) continue;

    const props = {};
    headers.forEach((h, idx) => {
      if (idx !== latIdx && idx !== lngIdx) props[h] = cells[idx] || '';
    });

    features.push({
      type:       'Feature',
      geometry:   { type: 'Point', coordinates: [lng, lat] },
      properties: props,
    });
  }

  if (!features.length) throw new Error('No valid coordinate rows found in CSV');
  return { type: 'FeatureCollection', features };
}

function showUploadProgress(filename, pct) {
  const container = document.getElementById('upload-progress-container');
  container.classList.remove('hidden');
  let item = container.querySelector(`[data-file="${CSS.escape(filename)}"]`);
  if (!item) {
    item = document.createElement('div');
    item.className = 'upload-progress-item';
    item.dataset.file = filename;
    item.innerHTML = `
      <span class="upload-progress-filename">${esc(filename)}</span>
      <div class="upload-progress-bar-track">
        <div class="upload-progress-bar-fill" style="width:${pct}%"></div>
      </div>`;
    container.appendChild(item);
  }
  setUploadProgress(filename, pct);
}

function setUploadProgress(filename, pct) {
  const item = document.querySelector(`[data-file="${CSS.escape(filename)}"] .upload-progress-bar-fill`);
  if (item) item.style.width = pct + '%';
  if (pct >= 100) setTimeout(() => removeUploadProgress(filename), 1500);
}

function removeUploadProgress(filename) {
  const item = document.querySelector(`[data-file="${CSS.escape(filename)}"]`);
  if (item) item.remove();
  const container = document.getElementById('upload-progress-container');
  if (!container.children.length) container.classList.add('hidden');
}

// ════════════════════════════════════════════════════════════
// 11. LAYER MANAGEMENT
// ════════════════════════════════════════════════════════════

function addLayer(id, meta, geojson, autoFit = true) {
  const color        = meta.color || LAYER_COLORS[0];
  const layerStyle   = { color, fillColor: color, weight: 2, fillOpacity: 0.18, opacity: 1 };
  const leafletGroup = buildLeafletGroup(id, geojson, layerStyle);
  leafletGroup.addTo(State.map);

  State.layers[id] = { meta: { ...meta, id }, geojson, leafletGroup, visible: true, style: layerStyle };
  renderLayerList();
  updateLayerCountBadge();
  updateStatusBar();

  if (autoFit) {
    try {
      const bounds = leafletGroup.getBounds();
      if (bounds.isValid()) State.map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
    } catch { }
  }
}

function buildLeafletGroup(layerId, geojson, style) {
  return L.geoJSON(geojson, {
    style: () => ({
      color:       style.color,
      fillColor:   style.fillColor,
      weight:      style.weight,
      fillOpacity: style.fillOpacity,
      opacity:     style.opacity,
    }),
    pointToLayer: (feature, latlng) => {
      const iconColor = feature.properties?._style?.iconColor || style.color;
      return L.marker(latlng, { icon: createCustomMarkerIcon(iconColor) });
    },
    onEachFeature: (feature, layer) => {
      const props = feature.properties || {};
      layer.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        showFeaturePopup(feature, layer, layerId, e.latlng);
      });
    },
  });
}

function showFeaturePopup(feature, leafletLayer, layerId, latlng) {
  const props    = feature.properties || {};
  const gType    = feature.geometry?.type || 'Unknown';
  const layerMeta = State.layers[layerId]?.meta || {};
  const name     = props.name || props.Name || 'Unnamed Feature';
  const desc     = props.description || props.Description || '';
  const style    = State.layers[layerId]?.style || {};

  const skip = new Set(['name','Name','description','Description','_style']);
  const dispProps = Object.entries(props).filter(([k]) => !skip.has(k) && k && props[k] !== '');

  const propsHtml = dispProps.length ? dispProps.map(([k, v]) => `
    <div class="wm-popup-row">
      <span class="wm-popup-key">${esc(k)}</span>
      <span class="wm-popup-val">${esc(String(v))}</span>
    </div>`).join('') : '';

  const coordHtml = feature.geometry?.type === 'Point' ? `
    <div class="wm-popup-row">
      <span class="wm-popup-key">Lat</span>
      <span class="wm-popup-val">${feature.geometry.coordinates[1].toFixed(6)}</span>
    </div>
    <div class="wm-popup-row">
      <span class="wm-popup-key">Lng</span>
      <span class="wm-popup-val">${feature.geometry.coordinates[0].toFixed(6)}</span>
    </div>` : '';

  const popupHtml = `<div class="wm-popup">
    <div class="wm-popup-header">
      <span class="wm-popup-title">${esc(name)}</span>
      <span class="wm-popup-type">${gType.toUpperCase()}</span>
    </div>
    <div class="wm-popup-props">
      ${desc ? `<p class="wm-popup-desc">${esc(desc)}</p>` : ''}
      ${coordHtml}
      ${propsHtml}
      <div class="wm-popup-row" style="border:none;padding-top:6px">
        <span class="wm-popup-key" style="color:#475569">Layer</span>
        <span class="wm-popup-val" style="color:#94a3b8">${esc(layerMeta.name || '')}</span>
      </div>
    </div>
  </div>`;

  State.map.openPopup(L.popup({ maxWidth: 300, minWidth: 220 })
    .setLatLng(latlng || leafletLayer.getLatLng?.() || State.map.getCenter())
    .setContent(popupHtml));
}

function removeLayer(id) {
  const layer = State.layers[id];
  if (!layer) return;
  State.map.removeLayer(layer.leafletGroup);
  delete State.layers[id];
  renderLayerList();
  updateLayerCountBadge();
  updateStatusBar();
  
  fetch(`${API}/api/layers/${id}`, { method: 'DELETE' }).catch(err => console.error(err));
}

function toggleLayerVisibility(id) {
  const layer = State.layers[id];
  if (!layer) return;
  layer.visible = !layer.visible;
  if (layer.visible) State.map.addLayer(layer.leafletGroup);
  else               State.map.removeLayer(layer.leafletGroup);
  renderLayerList();
}

function setLayerOpacity(id, opacity) {
  const layer = State.layers[id];
  if (!layer) return;
  layer.style.opacity     = opacity;
  layer.style.fillOpacity = opacity * 0.35;
  layer.leafletGroup.setStyle({ opacity, fillOpacity: opacity * 0.35 });
}

function applyLayerStyle(id, newStyle) {
  const layer = State.layers[id];
  if (!layer) return;
  Object.assign(layer.style, newStyle);
  layer.leafletGroup.setStyle({
    color:       newStyle.color       || layer.style.color,
    fillColor:   newStyle.fillColor   || layer.style.fillColor,
    weight:      newStyle.weight      || layer.style.weight,
    fillOpacity: newStyle.fillOpacity || layer.style.fillOpacity,
    opacity:     newStyle.opacity     || layer.style.opacity,
  });
  if (newStyle.color) layer.meta.color = newStyle.color;
  renderLayerList();
}

function renderLayerList() {
  const list       = document.getElementById('layer-list');
  const emptyState = document.getElementById('layer-empty-state');
  const layerIds   = Object.keys(State.layers);

  if (!layerIds.length) {
    emptyState.style.display = 'flex';
    list.querySelectorAll('.layer-card').forEach(el => el.remove());
    return;
  }
  emptyState.style.display = 'none';

  const existingIds = new Set(Array.from(list.querySelectorAll('.layer-card')).map(el => el.dataset.id));
  const currentIds  = new Set(layerIds);

  existingIds.forEach(id => {
    if (!currentIds.has(id)) list.querySelector(`[data-id="${id}"]`)?.remove();
  });

  layerIds.forEach((id, i) => {
    const layer = State.layers[id];
    const existing = list.querySelector(`[data-id="${id}"]`);
    const cardHtml = buildLayerCardHTML(id, layer, i);
    if (existing) {
      existing.outerHTML = cardHtml;
    } else {
      const temp = document.createElement('div');
      temp.innerHTML = cardHtml;
      list.appendChild(temp.firstElementChild);
    }
  });
}

function buildLayerCardHTML(id, layer, index) {
  const vis   = layer.visible;
  const count = layer.geojson?.features?.length || 0;
  const color = layer.style?.color || '#f97316';
  const op    = layer.style?.opacity ?? 1;

  return `<div class="layer-card ${vis ? '' : 'layer-hidden'} animate-fade-up" data-id="${id}" style="animation-delay:${index * 40}ms">
    <div class="layer-card-header">
      <label class="toggle-switch" title="${vis ? 'Hide layer' : 'Show layer'}">
        <input type="checkbox" ${vis ? 'checked' : ''}
               onchange="toggleLayerVisibility('${id}')" />
        <span class="toggle-track"></span>
      </label>
      <span class="layer-color-dot" style="background:${color}; border-color:${color}40"></span>
      <span class="layer-name" title="${esc(layer.meta.name)}">${esc(layer.meta.name)}</span>
      <span class="layer-feature-count">${count}</span>
      <div class="layer-actions">
        <button class="layer-action-btn" onclick="openLayerStyleModal('${id}')" title="Edit style">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/>
          </svg>
        </button>
        <button class="layer-action-btn" onclick="fitToLayer('${id}')" title="Fit to layer">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/>
          </svg>
        </button>
        <button class="layer-action-btn danger" onclick="removeLayer('${id}')" title="Delete layer">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
          </svg>
        </button>
      </div>
    </div>
    <div class="px-3 pb-2.5 flex items-center gap-2">
      <span class="text-[9px] font-mono text-slate-600 w-12">Opacity</span>
      <input type="range" min="0.05" max="1" step="0.05" value="${op}"
             class="flex-1 accent-brand-500 cursor-pointer h-1"
             oninput="setLayerOpacity('${id}', parseFloat(this.value))" />
      <span class="text-[9px] font-mono text-slate-600 w-6 text-right">${Math.round(op*100)}%</span>
    </div>
  </div>`;
}

window.removeLayer               = removeLayer;
window.toggleLayerVisibility     = toggleLayerVisibility;
window.setLayerOpacity           = setLayerOpacity;
window.fitToLayer                = (id) => {
  const layer = State.layers[id];
  if (!layer) return;
  try { State.map.fitBounds(layer.leafletGroup.getBounds().pad(0.15)); } catch {}
};
window.openLayerStyleModal       = openLayerStyleModal;

function updateLayerCountBadge() {
  const count = Object.keys(State.layers).length;
  document.getElementById('layer-count-badge').textContent = `${count} / ${MAX_LAYERS}`;
}

function fitAllLayers() {
  const all = Object.values(State.layers).map(l => l.leafletGroup);
  if (!all.length) { State.map.setView(GAZA_CENTER, GAZA_ZOOM); return; }
  const group = L.featureGroup(all);
  try { State.map.fitBounds(group.getBounds().pad(0.1)); } catch {}
}

function locateMe() {
  if (!navigator.geolocation) { toast('Geolocation not supported by this browser.', 'warning'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      State.map.setView([lat, lng], 15, { animate: true });
      L.marker([lat, lng], { icon: createCustomMarkerIcon('#22c55e') })
        .addTo(State.drawnItems)
        .bindPopup('<div class="wm-popup"><div class="wm-popup-header"><span class="wm-popup-title">My Location</span></div></div>')
        .openPopup();
    },
    () => toast('Could not get your location.', 'error')
  );
}

function initToggleAllLayers() {
  document.getElementById('toggle-all-layers').addEventListener('click', function() {
    State.allLayersOn = !State.allLayersOn;
    this.textContent = State.allLayersOn ? 'All OFF' : 'All ON';
    Object.keys(State.layers).forEach(id => {
      State.layers[id].visible = State.allLayersOn;
      if (State.allLayersOn) State.map.addLayer(State.layers[id].leafletGroup);
      else                   State.map.removeLayer(State.layers[id].leafletGroup);
    });
    renderLayerList();
  });

  document.getElementById('delete-all-layers').addEventListener('click', () => {
    if (!Object.keys(State.layers).length) return;
    if (!confirm('Delete all layers?')) return;
    Object.keys(State.layers).forEach(id => removeLayer(id));
    toast('All layers removed.', 'info');
  });
}

function openLayerStyleModal(id) {
  const layer = State.layers[id];
  if (!layer) return;
  document.getElementById('style-modal-layer-id').value  = id;
  document.getElementById('style-modal-title').textContent = `Style — ${layer.meta.name}`;
  document.getElementById('style-stroke-color').value    = layer.style.color || '#f97316';
  document.getElementById('style-fill-color').value      = layer.style.fillColor || '#f97316';
  document.getElementById('style-stroke-hex').textContent = layer.style.color || '#f97316';
  document.getElementById('style-fill-hex').textContent   = layer.style.fillColor || '#f97316';
  document.getElementById('style-weight').value           = layer.style.weight || 2;
  document.getElementById('style-weight-val').textContent = (layer.style.weight || 2) + 'px';
  document.getElementById('style-f
