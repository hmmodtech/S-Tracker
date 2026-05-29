/* ============================================================
   WatchMe — Smart Security Dashboard
   script.js — Complete Application Logic
   ============================================================
   Sections:
     1.  Constants & State
     2.  Utilities (toast, modal, format)
     3.  Theme (dark / light mode)
     4.  Loading screen
     5.  Sidebar collapse / resize
     6.  Map initialisation
     7.  Tile layer switcher
     8.  Cursor coordinates
     9.  Search (geocode + staff)
    10.  File upload & KML/KMZ/CSV parsing
    11.  Layer management (add, remove, toggle, style)
    12.  Drawing tools (Leaflet.draw)
    13.  Measurement HUD
    14.  Incident form & placement mode
    15.  Proximity scan (Haversine + PIP)
    16.  At-risk staff panel
    17.  Alert modal + send
    18.  Export (KML / KMZ via backend)
    19.  Status bar clock
    20.  Event binding bootstrap
   ============================================================ */

'use strict';

// ════════════════════════════════════════════════════════════
// 1. CONSTANTS & STATE
// ════════════════════════════════════════════════════════════

const API = '';          // same-origin — FastAPI serves both frontend and API
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
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2)**2;
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
    // Dark map tiles
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

  // Leaflet.draw control (hidden toolbar — we use custom buttons)
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

  // Initialize Map Right-Click Context Menu
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

  // Update button states
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
  // Rough scale: metres per pixel at equator = 156543 * cos(lat) / 2^zoom
  const mpp    = 156543 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
  const mapW   = State.map.getSize().x;
  const scaleM = Math.round(mpp * mapW * 0.15); // ~15% of map width
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

    // Try coordinate parse first (e.g. "31.5, 34.47")
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

    // Staff name search across loaded layers
    const staffMatches = searchStaffInLayers(val);
    if (staffMatches.length > 0) {
      showSearchResult(staffMatches.slice(0, 6).map(f => ({
        display_name: `👤 ${f.properties.name || 'Unnamed'} — ${f.properties.Department || f.properties.department || f._layerName || ''}`,
        lat: String(f._lat), lon: String(f._lng),
        _isStaff: true,
      })));
      return;
    }

    // Geocode via Nominatim proxy
    clearTimeout(searchDebounce);
    if (val.length < 3) { results.classList.add('hidden'); return; }
    searchDebounce = setTimeout(() => geocodeSearch(val), 500);
  });

  clear.addEventListener('click', () => {
    input.value = '';
    clear.classList.add('hidden');
    results.classList.add('hidden');
  });

  // Close on outside click
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
    // Silently fail — Nominatim may be unavailable offline
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

  // Store results for click handler
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
  // Drop a temporary marker
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

  // Click the hidden input when drop zone clicked (not on the input itself)
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

  // Drag & drop
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

  // Global drag-over prevention (don't let browser try to navigate)
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
      // Try backend first; fall back to client-side toGeoJSON
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
        // Client-side KMZ fallback via JSZip + toGeoJSON
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
  // Use XMLHttpRequest for progress tracking
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
  // Find the root KML entry
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

// Upload progress UI
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

function addLayer(id, meta, geojson) {
  const color        = meta.color || LAYER_COLORS[0];
  const layerStyle   = { color, fillColor: color, weight: 2, fillOpacity: 0.18, opacity: 1 };
  const leafletGroup = buildLeafletGroup(id, geojson, layerStyle);
  leafletGroup.addTo(State.map);

  State.layers[id] = { meta: { ...meta, id }, geojson, leafletGroup, visible: true, style: layerStyle };
  renderLayerList();
  updateLayerCountBadge();
  updateStatusBar();

  // Auto-fit to new layer
  try {
    const bounds = leafletGroup.getBounds();
    if (bounds.isValid()) State.map.fitBounds(bounds.pad(0.15), { maxZoom: 15 });
  } catch { /* empty group */ }
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

  // Filter display properties
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
    // Remove all dynamic cards
    list.querySelectorAll('.layer-card').forEach(el => el.remove());
    return;
  }
  emptyState.style.display = 'none';

  // Rebuild only changed cards for performance
  const existingIds = new Set(Array.from(list.querySelectorAll('.layer-card')).map(el => el.dataset.id));
  const currentIds  = new Set(layerIds);

  // Remove stale
  existingIds.forEach(id => {
    if (!currentIds.has(id)) list.querySelector(`[data-id="${id}"]`)?.remove();
  });

  // Add/update
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
      <!-- Visibility toggle -->
      <label class="toggle-switch" title="${vis ? 'Hide layer' : 'Show layer'}">
        <input type="checkbox" ${vis ? 'checked' : ''}
               onchange="toggleLayerVisibility('${id}')" />
        <span class="toggle-track"></span>
      </label>
      <!-- Color dot -->
      <span class="layer-color-dot" style="background:${color}; border-color:${color}40"></span>
      <!-- Name -->
      <span class="layer-name" title="${esc(layer.meta.name)}">${esc(layer.meta.name)}</span>
      <!-- Feature count -->
      <span class="layer-feature-count">${count}</span>
      <!-- Action buttons -->
      <div class="layer-actions">
        <!-- Style editor -->
        <button class="layer-action-btn" onclick="openLayerStyleModal('${id}')" title="Edit style">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42"/>
          </svg>
        </button>
        <!-- Fit to layer -->
        <button class="layer-action-btn" onclick="fitToLayer('${id}')" title="Fit to layer">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/>
          </svg>
        </button>
        <!-- Delete -->
        <button class="layer-action-btn danger" onclick="removeLayer('${id}')" title="Delete layer">
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>
          </svg>
        </button>
      </div>
    </div>
    <!-- Opacity slider -->
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

// ── Layer style modal ──────────────────────────────────────

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
  document.getElementById('style-fill-opacity').value     = layer.style.fillOpacity || 0.35;
  document.getElementById('style-fill-opacity-val').textContent = (layer.style.fillOpacity || 0.35).toFixed(2);
  document.getElementById('style-layer-opacity').value    = layer.style.opacity || 1;
  document.getElementById('style-layer-opacity-val').textContent = (layer.style.opacity || 1).toFixed(2);
  openModal('layer-style-modal');
}

function initStyleModal() {
  // Live preview as sliders/pickers change
  ['style-stroke-color','style-fill-color'].forEach(id => {
    document.getElementById(id).addEventListener('input', function() {
      const hexId = id === 'style-stroke-color' ? 'style-stroke-hex' : 'style-fill-hex';
      document.getElementById(hexId).textContent = this.value;
    });
  });
  document.getElementById('style-weight').addEventListener('input', function() {
    document.getElementById('style-weight-val').textContent = this.value + 'px';
  });
  document.getElementById('style-fill-opacity').addEventListener('input', function() {
    document.getElementById('style-fill-opacity-val').textContent = parseFloat(this.value).toFixed(2);
  });
  document.getElementById('style-layer-opacity').addEventListener('input', function() {
    document.getElementById('style-layer-opacity-val').textContent = parseFloat(this.value).toFixed(2);
  });

  document.getElementById('style-apply-btn').addEventListener('click', () => {
    const id = document.getElementById('style-modal-layer-id').value;
    applyLayerStyle(id, {
      color:       document.getElementById('style-stroke-color').value,
      fillColor:   document.getElementById('style-fill-color').value,
      weight:      parseInt(document.getElementById('style-weight').value),
      fillOpacity: parseFloat(document.getElementById('style-fill-opacity').value),
      opacity:     parseFloat(document.getElementById('style-layer-opacity').value),
    });
    closeModal('layer-style-modal');
    toast('Layer style updated.', 'success');
  });
}

// ════════════════════════════════════════════════════════════
// 12. DRAWING TOOLS
// ════════════════════════════════════════════════════════════

function initDrawTools() {
  document.querySelectorAll('.draw-btn').forEach(btn => {
    btn.addEventListener('click', () => activateDrawTool(btn));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') deactivateAllDrawTools();
  });
}

// ── Database Saved Settings Logic ─────────────────────────
async function saveSetting(key, value) {
  // Set in localStorage immediately for instant client feedback
  localStorage.setItem('wm_' + key, value);
  try {
    await fetch(`${API}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'wm_' + key, value: String(value) })
    });
  } catch (e) {
    console.warn(`Local save only for setting: ${key}. Server offline.`);
  }
}

async function loadSavedSettings() {
  let dbSettings = {};
  try {
    const res = await fetch(`${API}/api/settings`);
    dbSettings = await res.json();
  } catch (e) {
    console.warn("Could not retrieve settings from SQLite DB. Restoring local values.");
  }

  // Combine local storage and database settings (DB takes priority)
  const settings = {};
  for (let key in localStorage) {
    if (key.startsWith('wm_')) {
      settings[key] = localStorage.getItem(key);
    }
  }
  Object.assign(settings, dbSettings);

  // Restore Theme
  if (settings.wm_theme) {
    applyTheme(settings.wm_theme === 'dark');
  }
  // Restore Active Tile Layer
  if (settings.wm_tile) {
    setTileLayer(settings.wm_tile);
  }
  // Restore Scanning Range Radius
  if (settings.wm_radius) {
    const r = parseInt(settings.wm_radius);
    document.getElementById('incident-radius').value = r;
    document.getElementById('radius-value-display').textContent = fmtDist(r);
  }
  // Restore Incident Severity selection
  if (settings.wm_severity) {
    const radio = document.querySelector(`input[name="severity"][value="${settings.wm_severity}"]`);
    if (radio) radio.checked = true;
  }
  // Restore Incident Latitude & Longitude Coords
  if (settings.wm_incident_lat && settings.wm_incident_lng) {
    const lat = parseFloat(settings.wm_incident_lat);
    const lng = parseFloat(settings.wm_incident_lng);
    document.getElementById('incident-lat').value = lat.toFixed(6);
    document.getElementById('incident-lng').value = lng.toFixed(6);
    updateIncidentCircle();
  }
}

function activateDrawTool(btn) {
  const tool = btn.dataset.draw;
  // Deactivate current
  deactivateAllDrawTools();

  if (State.activeDrawTool === tool) return; // toggle off

  State.activeDrawTool = tool;
  btn.classList.add('active');
  showDrawModeIndicator(tool);

  const map = State.map;
  const ctrl = State.drawControl;

  const toolMap = {
    marker:   () => new L.Draw.Marker(map, ctrl.options.draw.marker),
    polyline: () => new L.Draw.Polyline(map, ctrl.options.draw.polyline),
    polygon:  () => new L.Draw.Polygon(map, ctrl.options.draw.polygon),
    circle:   () => new L.Draw.Circle(map, ctrl.options.draw.circle),
    edit:     () => new L.EditToolbar.Edit(map, { featureGroup: State.drawnItems }),
    delete:   () => new L.EditToolbar.Delete(map, { featureGroup: State.drawnItems }),
  };

  const handler = toolMap[tool]?.();
  if (handler) handler.enable();
}

function deactivateAllDrawTools() {
  State.activeDrawTool = null;
  document.querySelectorAll('.draw-btn').forEach(b => b.classList.remove('active'));
  hideDrawModeIndicator();
}

function showDrawModeIndicator(tool) {
  const labels = {
    marker:   'Marker mode — click to place',
    polyline: 'Path mode — click points, double-click to finish',
    polygon:  'Zone mode — click points, double-click to finish',
    circle:   'Radius mode — click and drag',
    edit:     'Edit mode — drag handles to reshape',
    delete:   'Delete mode — click features to remove',
  };
  document.getElementById('draw-mode-label').textContent = labels[tool] || 'Drawing active';
  document.getElementById('draw-mode-indicator').classList.remove('hidden');
}
function hideDrawModeIndicator() {
  document.getElementById('draw-mode-indicator').classList.add('hidden');
}

function onDrawCreated(e) {
  const layer = e.layer;
  State.drawnItems.addLayer(layer);
  deactivateAllDrawTools();

  // Compute area / distance for HUD
  if (e.layerType === 'polyline') {
    const latlngs = layer.getLatLngs();
    let total = 0;
    for (let i = 0; i < latlngs.length - 1; i++) {
      total += latlngs[i].distanceTo(latlngs[i+1]);
    }
    showMeasurementHUD(total, null);
  } else if (e.layerType === 'polygon') {
    const geom   = layer.toGeoJSON();
    const areaSM = turf.area(geom);
    showMeasurementHUD(null, areaSM);
  } else if (e.layerType === 'circle') {
    const r = layer.getRadius();
    showMeasurementHUD(null, Math.PI * r * r);
  }
}

function onDrawEdited()  { /* handle edited layers if needed */ }
function onDrawDeleted() { hideMeasurementHUD(); }

// ════════════════════════════════════════════════════════════
// 13. MEASUREMENT HUD
// ════════════════════════════════════════════════════════════

function showMeasurementHUD(distM, areaM2) {
  document.getElementById('meas-distance').textContent = distM  ? fmtDist(distM)  : '—';
  document.getElementById('meas-area').textContent     = areaM2 ? fmtArea(areaM2) : '—';
  document.getElementById('measurement-hud').classList.remove('hidden');
}
function hideMeasurementHUD() {
  document.getElementById('measurement-hud').classList.add('hidden');
}
function initMeasurementHUD() {
  document.getElementById('measurement-close').addEventListener('click', hideMeasurementHUD);
}

// ════════════════════════════════════════════════════════════
// 14. INCIDENT FORM & PLACEMENT MODE
// ════════════════════════════════════════════════════════════

function initIncidentForm() {
  // Radius slider live preview
  const radiusSlider  = document.getElementById('incident-radius');
  const radiusDisplay = document.getElementById('radius-value-display');
  radiusSlider.addEventListener('input', () => {
    const v = parseInt(radiusSlider.value);
    radiusDisplay.textContent = fmtDist(v);
    updateIncidentCircle();
  });
  radiusSlider.addEventListener('change', () => {
    saveSetting('radius', radiusSlider.value);
  });

  // Lat/Lng input → update circle
  ['incident-lat','incident-lng'].forEach(id => {
    document.getElementById(id).addEventListener('input', updateIncidentCircle);
    document.getElementById(id).addEventListener('change', function() {
      const key = id === 'incident-lat' ? 'incident_lat' : 'incident_lng';
      saveSetting(key, parseFloat(this.value));
    });
  });

  // Log incident button
  document.getElementById('btn-log-incident').addEventListener('click', logIncident);

  // Scan area button
  document.getElementById('btn-run-proximity').addEventListener('click', runProximityScan);

  // Click-on-map mode
  document.getElementById('btn-place-incident-mode').addEventListener('click', enterIncidentPlacementMode);
}

function enterIncidentPlacementMode() {
  State.placingIncident = true;
  document.body.classList.add('placing-incident');
  document.getElementById('incident-place-mode-indicator').classList.remove('hidden');
  toast('Click on the map to set the incident location.', 'info', 3000);
}

function exitIncidentPlacementMode() {
  State.placingIncident = false;
  document.body.classList.remove('placing-incident');
  document.getElementById('incident-place-mode-indicator').classList.add('hidden');
}

function onMapClick(e) {
  if (State.placingIncident) {
    const { lat, lng } = e.latlng;
    document.getElementById('incident-lat').value = lat.toFixed(6);
    document.getElementById('incident-lng').value = lng.toFixed(6);
    saveSetting('incident_lat', lat);
    saveSetting('incident_lng', lng);
    exitIncidentPlacementMode();
    placeIncidentMarker(lat, lng);
    updateIncidentCircle();
    toast(`Incident placed at ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success', 2500);
  }
}

function placeIncidentMarker(lat, lng) {
  if (State.incidentMarker) State.map.removeLayer(State.incidentMarker);
  State.incidentMarker = L.marker([lat, lng], { icon: createIncidentIcon(), zIndexOffset: 1000 })
    .addTo(State.map)
    .bindPopup(`<div class="wm-popup wm-popup-incident">
      <div class="wm-popup-header">
        <span class="wm-popup-title">⚠ Incident Location</span>
        <span class="wm-popup-type">INCIDENT</span>
      </div>
      <div class="wm-popup-props">
        <div class="wm-popup-row"><span class="wm-popup-key">Lat</span><span class="wm-popup-val">${lat.toFixed(6)}</span></div>
        <div class="wm-popup-row"><span class="wm-popup-key">Lng</span><span class="wm-popup-val">${lng.toFixed(6)}</span></div>
      </div>
    </div>`);
}

function updateIncidentCircle() {
  const lat = parseFloat(document.getElementById('incident-lat').value);
  const lng = parseFloat(document.getElementById('incident-lng').value);
  const r   = parseInt(document.getElementById('incident-radius').value);
  if (isNaN(lat) || isNaN(lng)) return;

  if (State.incidentCircle) State.map.removeLayer(State.incidentCircle);
  State.incidentCircle = L.circle([lat, lng], {
    radius:      r,
    className:   'incident-radius-circle',
    color:       '#ef4444',
    fillColor:   '#ef4444',
    fillOpacity: 0.06,
    weight:      1.5,
    dashArray:   '6 4',
  }).addTo(State.map);
  placeIncidentMarker(lat, lng);
}

async function logIncident() {
  const lat   = parseFloat(document.getElementById('incident-lat').value);
  const lng   = parseFloat(document.getElementById('incident-lng').value);
  const title = document.getElementById('incident-title').value.trim() || 'Untitled Incident';
  const desc  = document.getElementById('incident-description').value.trim();
  const sev   = document.querySelector('input[name="severity"]:checked')?.value || 'medium';

  if (isNaN(lat) || isNaN(lng)) {
    toast('Please enter valid coordinates or click the map first.', 'warning');
    return;
  }

  const btn = document.getElementById('btn-log-incident');
  btn.disabled = true;
  btn.textContent = 'Logging…';

  try {
    const res = await fetch(`${API}/api/incidents`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, description: desc, severity: sev, lat, lng }),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    State.incidents.push({ id: data.id, title, lat, lng, severity: sev });
    updateStatusBar();
    toast(`Incident "${title}" logged.`, 'success');
  } catch {
    // Backend may be offline in dev; log locally
    State.incidents.push({ id: uid(), title, lat, lng, severity: sev });
    toast(`Incident "${title}" logged (offline mode).`, 'info');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg> Log Incident`;
  }
}

// ════════════════════════════════════════════════════════════
// 15. PROXIMITY SCAN (Haversine + PIP)
// ════════════════════════════════════════════════════════════

function runProximityScan() {
  const lat    = parseFloat(document.getElementById('incident-lat').value);
  const lng    = parseFloat(document.getElementById('incident-lng').value);
  const radius = parseInt(document.getElementById('incident-radius').value);

  if (isNaN(lat) || isNaN(lng)) {
    toast('Set incident coordinates first.', 'warning');
    return;
  }
  if (!Object.keys(State.layers).length) {
    toast('Load at least one staff layer first.', 'warning');
    return;
  }

  // Collect all Point features across all layers
  const staffList = [];
  for (const [layerId, layer] of Object.entries(State.layers)) {
    const features = layer.geojson?.features || [];
    features.forEach(f => {
      if (f.geometry?.type !== 'Point') return;
      const [fLng, fLat] = f.geometry.coordinates;
      const props = f.properties || {};
      staffList.push({
        id:         uid(),
        name:       props.name || props.Name || 'Unnamed',
        department: props.Department || props.department || props.dept || '',
        phone:      props.Phone || props.phone || props.tel || '',
        telegram:   props.Telegram || props.telegram || props.tg || '',
        lat:        fLat,
        lng:        fLng,
        layerName:  layer.meta.name,
        layerColor: layer.style?.color || '#f97316',
      });
    });
  }

  if (!staffList.length) {
    toast('No Point features found in loaded layers. Import a staff CSV or KML.', 'warning');
    return;
  }

  // Run proximity check locally
  let nearestDistance = Infinity;
  const results = staffList.map(staff => {
    const distM = haversine(lat, lng, staff.lat, staff.lng);
    let status;
    if (distM <= 250)    status = 'critical';
    else if (distM <= 500)   status = 'high';
    else if (distM <= radius) status = 'medium';
    else                     status = 'safe';

    // Track closest staff member inside warning radius
    if (status !== 'safe' && distM < nearestDistance) {
      nearestDistance = distM;
    }

    return { ...staff, distance_m: distM, status };
  });

  results.sort((a, b) => a.distance_m - b.distance_m);

  State.staffResults = results;
  renderStaffPanel(results);

  const endangered = results.filter(r => r.status !== 'safe');
  if (endangered.length) {
    document.getElementById('status-risk-badge').classList.remove('hidden');
    toast(`⚠ ${endangered.length} staff within danger zone!`, 'error');
  } else {
    document.getElementById('status-risk-badge').classList.add('hidden');
    toast(`All ${results.length} staff members are outside the danger zone.`, 'success');
  }

  // Add the gorgeously animated pulsing dynamic marker circle at the epicenter
  addIncidentPulsingCircle(lat, lng, nearestDistance);

  // Flash at-risk markers on the map
  flashAtRiskMarkers(lat, lng, radius);
}

// ── Pulse Circle Color Renderer based on closest asset distance ──
function addIncidentPulsingCircle(lat, lng, nearestDistance) {
  let pulseClass = 'pulse-green';
  if (nearestDistance <= 250) {
    pulseClass = 'pulse-red';       // Critical Threat level
  } else if (nearestDistance <= 500) {
    pulseClass = 'pulse-orange';    // High Risk Threat level
  } else if (nearestDistance <= 1000) {
    pulseClass = 'pulse-yellow';    // Warning Threat level
  } else {
    pulseClass = 'pulse-green';     // Low Danger / Safe
  }

  const pulsingIcon = L.divIcon({
    className: `pulsing-marker ${pulseClass}`,
    html: '<div class="pulsing-ring"></div><div class="pulsing-dot"></div>',
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });

  if (window.pulsingIncidentMarker) {
    State.map.removeLayer(window.pulsingIncidentMarker);
  }

  window.pulsingIncidentMarker = L.marker([lat, lng], { icon: pulsingIcon }).addTo(State.map);
}

function flashAtRiskMarkers(incLat, incLng, radiusM) {
  // Add temporary flash circle markers for at-risk staff
  const endangered = State.staffResults.filter(r => r.status !== 'safe');
  if (!endangered.length) return;

  endangered.forEach((staff, i) => {
    setTimeout(() => {
      const circle = L.circleMarker([staff.lat, staff.lng], {
        radius:      10,
        color:       '#ef4444',
        fillColor:   '#ef4444',
        fillOpacity: 0.5,
        weight:      2,
      }).addTo(State.map);
      // Fade out after 2s
      setTimeout(() => State.map.removeLayer(circle), 2000);
    }, i * 120);
  });

  // Fit map to show incident + all at-risk
  const points = endangered.map(s => [s.lat, s.lng]);
  points.push([incLat, incLng]);
  const bounds = L.latLngBounds(points);
  State.map.fitBounds(bounds.pad(0.25), { animate: true });
}

// ════════════════════════════════════════════════════════════
// 16. AT-RISK STAFF PANEL
// ════════════════════════════════════════════════════════════

function renderStaffPanel(results) {
  const list       = document.getElementById('staff-results-list');
  const emptyState = document.getElementById('staff-empty-state');
  const countBadge = document.getElementById('at-risk-count-badge');
  const alertAll   = document.getElementById('btn-alert-all');
  const filter     = State.staffFilter;

  const filtered = filter === 'all'
    ? results
    : results.filter(r => r.status === filter);

  const endangered = results.filter(r => r.status !== 'safe');

  // Badge
  if (endangered.length) {
    countBadge.textContent = endangered.length;
    countBadge.classList.remove('hidden');
    alertAll.classList.remove('hidden');
  } else {
    countBadge.classList.add('hidden');
    alertAll.classList.add('hidden');
  }

  if (!filtered.length) {
    emptyState.style.display = 'flex';
    list.querySelectorAll('.staff-card').forEach(e => e.remove());
    return;
  }
  emptyState.style.display = 'none';

  // Rebuild list
  list.querySelectorAll('.staff-card').forEach(e => e.remove());
  filtered.forEach((staff, i) => {
    const card = buildStaffCard(staff, i);
    list.insertAdjacentHTML('beforeend', card);
  });
}

function buildStaffCard(staff, index) {
  const statusLabels = {
    inside:   '🔴 INSIDE ZONE',
    critical: '🔴 CRITICAL',
    high:     '🟠 HIGH RISK',
    medium:   '🟡 MEDIUM',
    safe:     '🟢 SAFE',
  };
  const label = statusLabels[staff.status] || staff.status.toUpperCase();

  return `<div class="staff-card" data-status="${staff.status}" data-id="${staff.id}"
               style="animation-delay:${index * 50}ms">
    <div class="staff-status-bar"></div>
    <div class="staff-card-body">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="staff-name truncate">${esc(staff.name)}</p>
          ${staff.department ? `<p class="staff-dept">${esc(staff.department)}</p>` : ''}
          ${staff.layerName  ? `<p class="text-[9px] font-mono text-slate-600 mt-0.5">${esc(staff.layerName)}</p>` : ''}
        </div>
        <div class="text-right flex-none">
          <p class="staff-distance">${fmtDist(staff.distance_m)}</p>
          <p class="text-[9px] font-mono text-slate-500 mt-0.5">${label}</p>
        </div>
      </div>
      <!-- Fly-to button -->
      <button onclick="flyToStaff(${staff.lat},${staff.lng})"
              class="mt-2 w-full text-[10px] font-mono text-slate-500 hover:text-brand-300 flex items-center gap-1.5 transition-colors">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
        </svg>
        ${staff.lat.toFixed(5)}, ${staff.lng.toFixed(5)}
      </button>
    </div>
    <!-- Alert buttons -->
    <div class="staff-alert-actions">
      <button class="alert-btn sms"
              onclick="openAlertModal('${staff.id}','sms','${esc(staff.name)}','${esc(staff.phone)}',${staff.distance_m.toFixed(0)})"
              title="Send SMS">
        <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 0h3m-3 8.25h3m-3 3.75h3"/>
        </svg>
        SMS
      </button>
      <button class="alert-btn whatsapp"
              onclick="openAlertModal('${staff.id}','whatsapp','${esc(staff.name)}','${esc(staff.phone)}',${staff.distance_m.toFixed(0)})"
              title="Send WhatsApp">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
        </svg>
        WA
      </button>
      <button class="alert-btn telegram"
              onclick="openAlertModal('${staff.id}','telegram','${esc(staff.name)}','${esc(staff.telegram || staff.phone)}',${staff.distance_m.toFixed(0)})"
              title="Send Telegram">
        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
          <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
        </svg>
        TG
      </button>
    </div>
  </div>`;
}

window.flyToStaff = (lat, lng) => State.map.setView([lat, lng], 16, { animate: true });

function initStaffFilters() {
  document.querySelectorAll('.staff-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.staff-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      State.staffFilter = btn.dataset.filter;
      renderStaffPanel(State.staffResults);
    });
  });

  document.getElementById('btn-alert-all').addEventListener('click', () => {
    const endangered = State.staffResults.filter(r => r.status !== 'safe');
    if (!endangered.length) return;
    endangered.forEach(staff => {
      const ch = staff.phone ? 'whatsapp' : 'telegram';
      sendMockAlert(ch, staff.phone || staff.telegram, buildAlertMessage(staff.name, staff.distance_m), '');
    });
    toast(`Mock alerts sent to ${endangered.length} staff members.`, 'success');
  });
}

// ════════════════════════════════════════════════════════════
// 17. ALERT MODAL & SEND
// ════════════════════════════════════════════════════════════

function buildAlertMessage(name, distM) {
  const incident = document.getElementById('incident-title').value.trim() || 'Security Incident';
  return `⚠ SAFETY ALERT: An incident (${incident}) has occurred ${Math.round(distM)}m from your location. Please follow evacuation procedures immediately. Stay safe. — WatchMe Security Dashboard`;
}

const CHANNEL_ICONS = {
  sms:      { color: '#22c55e', icon: '📱', label: 'SMS' },
  whatsapp: { color: '#22c55e', icon: '💬', label: 'WhatsApp' },
  telegram: { color: '#3b82f6', icon: '✈️', label: 'Telegram' },
};

window.openAlertModal = function(staffId, channel, name, phone, distM) {
  document.getElementById('alert-staff-id').value    = staffId;
  document.getElementById('alert-channel-value').value = channel;
  document.getElementById('alert-recipient-name').textContent = name;
  document.getElementById('alert-recipient-phone').textContent = phone || 'No contact info';
  document.getElementById('alert-modal-title').textContent = `Send ${CHANNEL_ICONS[channel]?.label || channel} Alert`;
  document.getElementById('alert-message').value = buildAlertMessage(name, distM);

  const iconDiv = document.getElementById('alert-channel-icon');
  const ch      = CHANNEL_ICONS[channel] || CHANNEL_ICONS.sms;
  iconDiv.innerHTML = `<span style="font-size:18px">${ch.icon}</span>`;
  document.getElementById('alert-channel-label').textContent = ch.label;

  openModal('alert-modal');
};

function initAlertModal() {
  document.getElementById('alert-send-btn').addEventListener('click', async () => {
    const channel   = document.getElementById('alert-channel-value').value;
    const recipient = document.getElementById('alert-recipient-phone').textContent;
    const message   = document.getElementById('alert-message').value;
    const btn       = document.getElementById('alert-send-btn');

    if (!recipient || recipient === 'No contact info') {
      toast('No contact information available for this staff member.', 'warning');
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'Sending…';

    await sendMockAlert(channel, recipient, message, '');

    btn.disabled = false;
    btn.innerHTML = `<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5"/></svg> Send Alert (Mock)`;

    closeModal('alert-modal');
  });
}

async function sendMockAlert(channel, recipient, message, incidentId) {
  try {
    const res = await fetch(`${API}/api/alert/${channel}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, recipient, message, incident_id: incidentId }),
    });
    const data = await res.json();
    toast(`Mock ${channel.toUpperCase()} sent to ${recipient}`, 'success');
    console.info('Alert response:', data);
  } catch {
    // Offline mode
    toast(`Mock ${channel.toUpperCase()} queued (offline mode) for ${recipient}`, 'info');
  }
}

// ════════════════════════════════════════════════════════════
// 18. EXPORT
// ════════════════════════════════════════════════════════════

function initExport() {
  document.getElementById('btn-export-kml').addEventListener('click', () => exportMap('kml'));
  document.getElementById('btn-export-kmz').addEventListener('click', () => exportMap('kmz'));
}

async function exportMap(format) {
  const allFeatures = [];

  // Collect layer features
  Object.values(State.layers).forEach(layer => {
    if (layer.visible) {
      (layer.geojson?.features || []).forEach(f => allFeatures.push(f));
    }
  });

  // Collect drawn shapes
  State.drawnItems.eachLayer(layer => {
    try { allFeatures.push(layer.toGeoJSON()); } catch {}
  });

  if (!allFeatures.length) {
    toast('No visible features to export.', 'warning');
    return;
  }

  const fc = { type: 'FeatureCollection', features: allFeatures };

  try {
    const res = await fetch(`${API}/api/export`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feature_collection: fc,
        doc_name: 'WatchMe Security Export',
        format,
      }),
    });

    if (!res.ok) throw new Error(await res.text());

    const blob     = await res.blob();
    const url      = URL.createObjectURL(blob);
    const anchor   = document.createElement('a');
    anchor.href     = url;
    anchor.download = `watchme-export.${format}`;
    anchor.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${allFeatures.length} features as .${format.toUpperCase()}`, 'success');
  } catch {
    // Client-side KML fallback
    exportKMLClientSide(fc, format);
  }
}

function exportKMLClientSide(fc, format) {
  const kml = buildKMLString(fc);
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `watchme-export.kml`;
  a.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${fc.features.length} features as KML (client-side).`, 'success');
}

function buildKMLString(fc) {
  const placemarks = fc.features.map(f => {
    const props = f.properties || {};
    const name  = props.name || props.Name || 'Feature';
    const desc  = props.description || '';
    let geomKML = '';

    const geom = f.geometry || {};
    if (geom.type === 'Point') {
      const [lon, lat] = geom.coordinates;
      geomKML = `<Point><coordinates>${lon},${lat},0</coordinates></Point>`;
    } else if (geom.type === 'LineString') {
      const coords = geom.coordinates.map(c => `${c[0]},${c[1]},0`).join(' ');
      geomKML = `<LineString><tessellate>1</tessellate><coordinates>${coords}</coordinates></LineString>`;
    } else if (geom.type === 'Polygon') {
      const outer = geom.coordinates[0].map(c => `${c[0]},${c[1]},0`).join(' ');
      geomKML = `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${outer}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }

    const skip = new Set(['name','Name','description','Description','_style']);
    const extData = Object.entries(props)
      .filter(([k,v]) => !skip.has(k) && v !== '')
      .map(([k,v]) => `<Data name="${k.replace(/"/g,'')}""><value>${String(v).replace(/</g,'&lt;')}</value></Data>`)
      .join('');

    return `<Placemark>
      <name>${name.replace(/</g,'&lt;')}</name>
      <description>${desc.replace(/</g,'&lt;')}</description>
      ${extData ? `<ExtendedData>${extData}</ExtendedData>` : ''}
      ${geomKML}
    </Placemark>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>WatchMe Security Dashboard Export</name>
    ${placemarks}
  </Document>
</kml>`;
}

// ════════════════════════════════════════════════════════════
// 19. STATUS BAR CLOCK
// ════════════════════════════════════════════════════════════

function updateStatusBar() {
  document.getElementById('status-layer-count').textContent =
    `${Object.keys(State.layers).length} layers`;
  document.getElementById('status-incident-count').textContent =
    `${State.incidents.length} incidents`;
}

function startClock() {
  function tick() {
    const now = new Date();
    document.getElementById('status-time').textContent =
      now.toUTCString().slice(17, 22) + ' UTC';
  }
  tick();
  setInterval(tick, 30000);
}

// ════════════════════════════════════════════════════════════
// 20. MODAL CLOSE BINDINGS
// ════════════════════════════════════════════════════════════

function initModals() {
  // Close buttons with data-modal attribute
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.modal));
  });
  // Click backdrop to close
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.classList.contains('modal-backdrop')) {
        closeModal(overlay.id);
      }
    });
  });
  // ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
      exitIncidentPlacementMode();
    }
  });
}

// ── Collapsible Right-side Proximity panel bindings ──────
function initProximityPanel() {
  const toggleBtn = document.getElementById('proximity-toggle-btn');
  const panel     = document.getElementById('proximity-panel');
  const closeBtn  = document.getElementById('proximity-panel-close');

  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isClosed = panel.classList.contains('hidden');
    if (isClosed) {
      openProximityPanel();
    } else {
      closeProximityPanel();
    }
  });

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeProximityPanel();
  });
  
  // Closes slide panel if clicking map workspace background
  State.map.on('click', () => {
    if (!State.placingIncident) {
      closeProximityPanel();
    }
  });
}

function openProximityPanel() {
  const panel = document.getElementById('proximity-panel');
  panel.classList.remove('hidden');
  setTimeout(() => {
    panel.classList.remove('translate-x-[380px]', 'opacity-0');
    panel.classList.add('translate-x-0', 'opacity-100');
  }, 50);
}

function closeProximityPanel() {
  const panel = document.getElementById('proximity-panel');
  panel.classList.remove('translate-x-0', 'opacity-100');
  panel.classList.add('translate-x-[380px]', 'opacity-0');
  setTimeout(() => {
    panel.classList.add('hidden');
  }, 300);
}

// ── Custom Right-Click Context Menu setup on the Leaflet Map ──
function initMapContextMenu() {
  State.map.on('contextmenu', (e) => {
    if (e.originalEvent) {
      e.originalEvent.preventDefault();
    }

    // Clean up older active menus
    const oldMenu = document.getElementById('map-context-menu');
    if (oldMenu) oldMenu.remove();

    // Context list menu wrapper
    const menu = document.createElement('div');
    menu.id = 'map-context-menu';
    menu.className = 'absolute z-[9999] semi-transparent-glass shadow-panel rounded-xl py-1 w-48 text-xs text-slate-800 dark:text-slate-200 transition-all duration-150 animate-fade-up';
    
    menu.style.left = e.originalEvent.pageX + 'px';
    menu.style.top  = e.originalEvent.pageY + 'px';

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    const options = [
      {
        text: '📍 Place Incident Here',
        action: () => {
          document.getElementById('incident-lat').value = lat.toFixed(6);
          document.getElementById('incident-lng').value = lng.toFixed(6);
          saveSetting('incident_lat', lat);
          saveSetting('incident_lng', lng);
          
          updateIncidentCircle();
          openProximityPanel();
          
          // Execute calculations immediately
          runProximityScan();
        }
      },
      {
        text: '📌 Add Custom Marker',
        action: () => {
          const label = prompt("Enter marker name:", "Assessment Point");
          if (label !== null) {
            L.marker([lat, lng], { icon: createCustomMarkerIcon('#3b82f6') })
              .addTo(State.drawnItems)
              .bindPopup(`<div class="wm-popup"><div class="wm-popup-header"><span class="wm-popup-title">${esc(label)}</span></div></div>`)
              .openPopup();
          }
        }
      },
      {
        text: '📋 Copy Coordinates',
        action: () => {
          const coords = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          navigator.clipboard.writeText(coords).then(() => {
            toast('Coordinates copied to clipboard!', 'success');
          });
        }
      },
      {
        text: '❌ Clear Map Scans',
        action: () => {
          if (State.incidentMarker) State.map.removeLayer(State.incidentMarker);
          if (State.incidentCircle) State.map.removeLayer(State.incidentCircle);
          if (window.pulsingIncidentMarker) State.map.removeLayer(window.pulsingIncidentMarker);
          State.drawnItems.clearLayers();
          hideMeasurementHUD();
          toast('Cleared scans and layers.', 'info');
        }
      }
    ];

    options.forEach(opt => {
      const item = document.createElement('div');
      item.className = 'px-3 py-2 hover:bg-white/10 dark:hover:bg-white/5 cursor-pointer flex items-center transition-colors font-mono font-semibold';
      item.innerHTML = opt.text;
      item.onclick = (event) => {
        event.stopPropagation();
        opt.action();
        menu.remove();
      };
      menu.appendChild(item);
    });

    document.body.appendChild(menu);

    const closeMenu = () => {
      menu.remove();
      document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 50);
  });
}

// ════════════════════════════════════════════════════════════
// BOOTSTRAP — DOMContentLoaded
// ════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  runLoadingScreen();
  initTheme();
  initMap();
  initTileSwitcher();
  initSidebar();
  initSearch();
  initUpload();
  initToggleAllLayers();
  initStyleModal();
  initDrawTools();
  initMeasurementHUD();
  initIncidentForm();
  initStaffFilters();
  initAlertModal();
  initExport();
  initModals();
  initProximityPanel();
  startClock();
  updateStatusBar();

  // Load Saved DB/Local Settings
  loadSavedSettings();

  // Theme toggle button
  document.getElementById('dark-mode-toggle').addEventListener('click', () => {
    applyTheme(!State.darkMode);
  });

  // Severity radio visual update
  document.querySelectorAll('input[name="severity"]').forEach(radio => {
    radio.addEventListener('change', () => {
      saveSetting('severity', radio.value);
    });
  });

  // Pre-select "medium" severity if none found
  const medRadio = document.querySelector('input[name="severity"][value="medium"]');
  if (medRadio && !localStorage.getItem('wm_severity')) medRadio.checked = true;

  // Health-check the backend (informational only)
  fetch(`${API}/api/health`)
    .then(r => r.json())
    .then(d => console.info('Backend:', d.status, '| Layers in store:', d.layers))
    .catch(() => console.info('Backend offline — running in client-only mode'));
});
