// ============================================================================
// GLOBAL STATE & CONFIGURATION
// ============================================================================

const STATE = {
    map: null,
    drawnItems: new L.FeatureGroup(),
    layers: new Map(),
    settings: {},
    darkMode: true,
    proximityActive: false,
    proximityRadius: 500,
    proximityCircles: [],
    rightClickMenu: null,
};

const CONFIG = {
    DEFAULT_CENTER: [31.9454, 35.2338], // Palestine center
    DEFAULT_ZOOM: 10,
    TILE_LAYER: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    TILE_ATTRIBUTION: '&copy; OpenStreetMap contributors',
    API_BASE: '/api',
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 S-Tracker Loading...');
    
    // Initialize map
    initializeMap();
    
    // Load settings from database
    await loadSettings();
    
    // Setup event listeners
    setupEventListeners();
    
    // Setup right-click context menu
    setupContextMenu();
    
    // Setup proximity analysis
    setupProximityAnalysis();
    
    // Load saved layers
    loadSavedLayers();
    
    console.log('✅ S-Tracker Ready');
});

// ============================================================================
// MAP INITIALIZATION
// ============================================================================

function initializeMap() {
    // Create map
    STATE.map = L.map('map', {
        center: CONFIG.DEFAULT_CENTER,
        zoom: CONFIG.DEFAULT_ZOOM,
        contextmenu: true,
        contextmenuWidth: 140,
        zoomControl: true,
    });
    
    // Add tile layer
    L.tileLayer(CONFIG.TILE_LAYER, {
        attribution: CONFIG.TILE_ATTRIBUTION,
        maxZoom: 19,
    }).addTo(STATE.map);
    
    // Add drawn items layer
    STATE.map.addLayer(STATE.drawnItems);
    
    // Initialize draw control
    const drawControl = new L.Control.Draw({
        position: 'topleft',
        draw: {
            polygon: true,
            polyline: true,
            rectangle: true,
            circle: true,
            marker: true,
            circlemarker: false,
        },
        edit: {
            featureGroup: STATE.drawnItems,
        },
    });
    STATE.map.addControl(drawControl);
    
    // Draw events
    STATE.map.on('draw:created', handleDrawCreated);
    STATE.map.on('draw:edited', handleDrawEdited);
    STATE.map.on('draw:deleted', handleDrawDeleted);
}

// ============================================================================
// SETTINGS MANAGEMENT (DATABASE PERSISTENCE)
// ============================================================================

async function loadSettings() {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/settings`);
        STATE.settings = await response.json();
        
        // Apply loaded settings
        if (STATE.settings.darkMode !== undefined) {
            STATE.darkMode = STATE.settings.darkMode;
            applyTheme();
        }
        
        if (STATE.settings.proximityRadius !== undefined) {
            STATE.proximityRadius = STATE.settings.proximityRadius;
        }
        
        console.log('✅ Settings loaded:', STATE.settings);
    } catch (error) {
        console.warn('⚠️ Could not load settings:', error);
        // Use defaults
    }
}

async function saveSetting(key, value) {
    try {
        const response = await fetch(`${CONFIG.API_BASE}/settings/${key}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value }),
        });
        
        if (response.ok) {
            STATE.settings[key] = value;
            console.log(`✅ Setting saved: ${key}`);
        }
    } catch (error) {
        console.error('❌ Error saving setting:', error);
    }
}

// ============================================================================
// THEME MANAGEMENT
// ============================================================================

function applyTheme() {
    const body = document.body;
    const btn = document.getElementById('btn-theme');
    
    if (STATE.darkMode) {
        body.classList.add('dark-mode');
        body.classList.remove('light-mode');
        btn.textContent = '☀️ Light Mode';
    } else {
        body.classList.add('light-mode');
        body.classList.remove('dark-mode');
        btn.textContent = '🌙 Dark Mode';
    }
}

function toggleTheme() {
    STATE.darkMode = !STATE.darkMode;
    applyTheme();
    saveSetting('darkMode', STATE.darkMode);
}

// ============================================================================
// RIGHT-CLICK CONTEXT MENU (LEAFLET CONTEXTMENU)
// ============================================================================

function setupContextMenu() {
    STATE.map.contextmenu.addItem({
        text: '📍 Coordinates',
        callback: showCoordinates,
        icon: '📋',
    });
    
    STATE.map.contextmenu.addItem({
        text: '📋 Copy Coordinates',
        callback: copyCoordinates,
        icon: '📑',
    });
    
    STATE.map.contextmenu.addSeparator();
    
    STATE.map.contextmenu.addItem({
        text: '🎯 Center Map Here',
        callback: (e) => STATE.map.panTo(e.latlng),
        icon: '🎯',
    });
    
    STATE.map.contextmenu.addItem({
        text: '📌 Add Marker',
        callback: (e) => addMarkerAtCoords(e.latlng),
        icon: '📌',
    });
    
    STATE.map.contextmenu.addSeparator();
    
    STATE.map.contextmenu.addItem({
        text: '🛣️ Route From Here',
        callback: (e) => routeFromCoords(e.latlng),
        icon: '➡️',
    });
    
    STATE.map.contextmenu.addItem({
        text: '🛣️ Route To Here',
        callback: (e) => routeToCoords(e.latlng),
        icon: '⬅️',
    });
    
    STATE.map.contextmenu.addSeparator();
    
    STATE.map.contextmenu.addItem({
        text: '⚙️ Map Settings',
        callback: openMapSettings,
        icon: '⚙️',
    });
}

function showCoordinates(e) {
    const { lat, lng } = e.latlng;
    const dms = `${Math.abs(lat).toFixed(0)}°${(Math.abs(lat) % 1 * 60).toFixed(2)}'${((Math.abs(lat) % 1 * 60) % 1 * 60).toFixed(1)}"${lat > 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(0)}°${(Math.abs(lng) % 1 * 60).toFixed(2)}'${((Math.abs(lng) % 1 * 60) % 1 * 60).toFixed(1)}"${lng > 0 ? 'E' : 'W'}`;
    showAlert(`📍 Coordinates\n${lat.toFixed(6)}, ${lng.toFixed(6)}\n${dms}`, 'info');
}

function copyCoordinates(e) {
    const { lat, lng } = e.latlng;
    const text = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    navigator.clipboard.writeText(text);
    showAlert('✅ Coordinates copied to clipboard!', 'success');
}

function addMarkerAtCoords(latlng) {
    const marker = L.marker(latlng, {
        draggable: true,
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            shadowSize: [41, 41],
            iconAnchor: [12, 41],
        }),
    }).addTo(STATE.drawnItems);
    
    showAlert('✅ Marker added!', 'success');
}

function routeFromCoords(latlng) {
    showAlert(`🛣️ Route from: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`, 'info');
    // Integration with routing service (OSRM, etc.) can be added here
}

function routeToCoords(latlng) {
    showAlert(`🛣️ Route to: ${latlng.lat.toFixed(6)}, ${latlng.lng.toFixed(6)}`, 'info');
    // Integration with routing service can be added here
}

function openMapSettings() {
    showAlert('⚙️ Map Settings Modal (To be implemented)', 'info');
}

// ============================================================================
// PROXIMITY ANALYSIS
// ============================================================================

function setupProximityAnalysis() {
    const btn = document.getElementById('btn-proximity-toggle');
    const panel = document.getElementById('proximity-panel');
    
    if (!btn) {
        console.warn('⚠️ Proximity button not found');
        return;
    }
    
    btn.addEventListener('click', () => {
        STATE.proximityActive = !STATE.proximityActive;
        btn.classList.toggle('active');
        panel.classList.toggle('hidden');
        
        if (STATE.proximityActive) {
            showAlert('🎯 Proximity Analysis Mode: Click "Locate & Assess" to analyze', 'info');
        }
    });
    
    // Locate & Assess button
    const locateBtn = document.getElementById('btn-locate-assess');
    if (locateBtn) {
        locateBtn.addEventListener('click', performProximityAnalysis);
    }
    
    // Proximity radius slider
    const radiusSlider = document.getElementById('proximity-radius');
    if (radiusSlider) {
        radiusSlider.addEventListener('input', (e) => {
            STATE.proximityRadius = parseInt(e.target.value);
            document.getElementById('radius-value').textContent = `${STATE.proximityRadius}m`;
            saveSetting('proximityRadius', STATE.proximityRadius);
        });
    }
}

function performProximityAnalysis() {
    const lat = parseFloat(document.getElementById('incident-lat').value);
    const lng = parseFloat(document.getElementById('incident-lng').value);
    
    if (isNaN(lat) || isNaN(lng)) {
        showAlert('❌ Please enter valid coordinates', 'error');
        return;
    }
    
    // Clear previous circles
    clearProximityCycles();
    
    // Create incident point
    const incidentLatLng = L.latLng(lat, lng);
    
    // Add center marker
    L.marker(incidentLatLng, {
        icon: L.icon({
            iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-red.png',
            shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
            iconSize: [25, 41],
            shadowSize: [41, 41],
            iconAnchor: [12, 41],
        }),
    }).addTo(STATE.map).bindPopup('📍 Incident Center');
    
    // Add pulsing circles for proximity zones
    const zones = [
        { radius: STATE.proximityRadius * 0.3, class: 'critical', label: 'Critical (0-30%)' },
        { radius: STATE.proximityRadius * 0.6, class: 'high', label: 'High (30-60%)' },
        { radius: STATE.proximityRadius * 0.85, class: 'medium', label: 'Medium (60-85%)' },
        { radius: STATE.proximityRadius, class: 'low', label: 'Low (85-100%)' },
    ];
    
    zones.forEach((zone) => {
        const circle = L.circle(incidentLatLng, {
            radius: zone.radius,
            color: getColorByZone(zone.class),
            weight: 2,
            opacity: 0.6,
            fillOpacity: 0.1,
            dashArray: '5, 5',
            className: `proximity-circle ${zone.class}`,
        }).addTo(STATE.map);
        
        STATE.proximityCircles.push(circle);
    });
    
    // Center map on incident
    STATE.map.setView(incidentLatLng, 13);
    
    showAlert('✅ Proximity analysis zones created with pulsing animations!', 'success');
}

function getColorByZone(zoneClass) {
    const colors = {
        critical: '#ef4444',
        high: '#f59e0b',
        medium: '#eab308',
        low: '#10b981',
    };
    return colors[zoneClass] || '#3b82f6';
}

function clearProximityCycles() {
    STATE.proximityCircles.forEach((circle) => STATE.map.removeLayer(circle));
    STATE.proximityCircles = [];
}

// ============================================================================
// DRAW HANDLERS
// ============================================================================

function handleDrawCreated(e) {
    const layer = e.layer;
    STATE.drawnItems.addLayer(layer);
    saveSetting('drawnLayers', STATE.drawnItems.toGeoJSON());
    showAlert('✅ Layer created!', 'success');
}

function handleDrawEdited(e) {
    saveSetting('drawnLayers', STATE.drawnItems.toGeoJSON());
    showAlert('✅ Layer edited!', 'success');
}

function handleDrawDeleted(e) {
    saveSetting('drawnLayers', STATE.drawnItems.toGeoJSON());
    showAlert('✅ Layer deleted!', 'success');
}

// ============================================================================
// FILE HANDLING (KML, KMZ, CSV)
// ============================================================================

function setupFileUpload() {
    const uploadArea = document.getElementById('upload-area');
    
    if (!uploadArea) return;
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#3b82f6';
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.style.borderColor = '#4b5563';
    });
    
    uploadArea.addEventListener('drop', async (e) => {
        e.preventDefault();
        uploadArea.style.borderColor = '#4b5563';
        
        const files = e.dataTransfer.files;
        for (const file of files) {
            await handleFileUpload(file);
        }
    });
}

async function handleFileUpload(file) {
    const fileName = file.name.toLowerCase();
    
    try {
        if (fileName.endsWith('.kml')) {
            await parseKML(file);
        } else if (fileName.endsWith('.kmz')) {
            await parseKMZ(file);
        } else if (fileName.endsWith('.csv')) {
            await parseCSV(file);
        } else {
            showAlert('❌ Unsupported file format', 'error');
        }
    } catch (error) {
        console.error('❌ File upload error:', error);
        showAlert('❌ Error processing file', 'error');
    }
}

async function parseKML(file) {
    const text = await file.text();
    const kml = new DOMParser().parseFromString(text, 'text/xml');
    const geojson = toGeoJSON.kml(kml);
    
    const layer = L.geoJSON(geojson, {
        onEachFeature: (feature, layer) => {
            if (feature.properties) {
                layer.bindPopup(
                    Object.entries(feature.properties)
                        .map(([k, v]) => `<strong>${k}</strong>: ${v}`)
                        .join('<br>')
                );
            }
        },
    }).addTo(STATE.map);
    
    const layerName = file.name.replace('.kml', '');
    STATE.layers.set(layerName, layer);
    
    showAlert(`✅ KML loaded: ${layerName}`, 'success');
    updateLayersList();
}

async function parseKMZ(file) {
    const zip = new JSZip();
    const zipData = await zip.loadAsync(file);
    
