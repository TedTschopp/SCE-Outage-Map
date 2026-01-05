// Configuration
const SAN_GABRIEL_VALLEY = {
    lat: 34.1064,
    lng: -118.0689,
    radius: 10 // miles
};

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// SCE outage data sources
// NOTE: SCE's outage-center page currently sources outage data from ArcGIS FeatureServer endpoints.
// This app defaults to those endpoints for the freshest data.
const DATA_SOURCES = {
    // Reference page (for humans)
    outageCenterUrl: 'https://www.sce.com/outages-safety/outage-center/check-outage-status',

    // ArcGIS endpoints observed from the outage-center page (preferred)
    arcgis: {
        outagesQueryUrl: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/Outages_P_VwLayer/FeatureServer/0/query',
        majorOutagesQueryUrl: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/Major_Outages_P_VwLayer/FeatureServer/0/query'
    },

    // Legacy / fallback endpoints (kept for resilience)
    fallback: [
        'https://www.sce.com/api/outages/outagedata',
        'https://kubra.io/data/7e7fab29-4498-41ad-ba3e-14905a4b539a/public/summary-1/data.json',
        'https://kubra.io/data/7e7fab29-4498-41ad-ba3e-14905a4b539a/public/cluster-1/data.json'
    ],

    // Optional fallback with CORS proxy if needed
    corsProxy: 'https://corsproxy.io/?',
    useCorsProxy: false // Set to true if CORS issues occur
};

// DRPEP (Distributed Resources Plan / Enhanced Plan) layer sources
// These are ArcGIS FeatureServer services observed from https://drpep.sce.com/drpep/?page=Page
// We render point/line/polygon feature layers.
const DRPEP_SOURCES = {
    enabled: true,
    // A curated set of FeatureServer service roots used by DRPEP.
    // Each service may contain multiple sublayers; we discover renderable sublayers at runtime.
    services: [
        // DRPEP Available Load Capacity Map
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/AVL_LOAD_CAP_TOGGLE/FeatureServer' },

        // DRPEP Available Capacity Heat Map
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/AVL_LOAD_HEAT_MAP_TOGGLE/FeatureServer' },

        // DRPEP Transmission Circuits Map (often line geometry; polygon-only renderer will skip non-polygons)
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/Distribution_circuits/FeatureServer' },

        // DRPEP Transmission Projects (may include polygons/lines depending on sublayer)
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DRP_Transmission_Projects/FeatureServer' },

        // DRPEP GNA Layers
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/GNA_Layer/FeatureServer' },

        // DRPEP ICA Layers
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/ICA_Layer/FeatureServer' },

        // DRPEP LNBA Layers
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/LNBA_Layer/FeatureServer' },

        // Other DRPEP layers commonly present
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DDOR_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DRP_PSPS_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/SUBTRANS_HEATMAP/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/LOAD_GROWTH_PEN_HTMAP/FeatureServer' },

        // SCE Fire Threat Areas layers (polygons)
        { label: 'SCE Fire Threat Areas', url: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/SCE_HighFireRiskArea_PublicView/FeatureServer' },
        { label: 'SCE Fire Threat Areas', url: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/SCE_HHZ_Tier1_PublicView/FeatureServer' }
    ]
};

function getBoundingBoxForRadiusMiles(centerLat, centerLng, radiusMiles) {
    const latDelta = radiusMiles / 69;
    const lngDelta = radiusMiles / (Math.cos(centerLat * Math.PI / 180) * 69);

    return {
        xmin: centerLng - lngDelta,
        ymin: centerLat - latDelta,
        xmax: centerLng + lngDelta,
        ymax: centerLat + latDelta
    };
}

function buildArcgisQueryUrl(baseUrl, { where, outFields, bbox, outSR = '4326', inSR = '4326', extraParams = {} }) {
    const params = new URLSearchParams({
        f: 'json',
        where,
        outFields,
        returnGeometry: 'true',
        outSR: String(outSR),
        geometry: `${bbox.xmin},${bbox.ymin},${bbox.xmax},${bbox.ymax}`,
        geometryType: 'esriGeometryEnvelope',
        inSR: String(inSR),
        spatialRel: 'esriSpatialRelIntersects',
        ...extraParams
    });

    return `${baseUrl}?${params.toString()}`;
}

function buildArcgisCircleQueryUrl(baseUrl, { where, outFields, center, radiusMeters, outSR = '4326', inSR = '4326', extraParams = {} }) {
    const params = new URLSearchParams({
        f: 'json',
        where,
        outFields,
        returnGeometry: 'true',
        outSR: String(outSR),
        geometry: `${center.lng},${center.lat}`,
        geometryType: 'esriGeometryPoint',
        inSR: String(inSR),
        spatialRel: 'esriSpatialRelIntersects',
        distance: String(radiusMeters),
        units: 'esriSRUnit_Meter',
        ...extraParams
    });

    return `${baseUrl}?${params.toString()}`;
}

// Global variables
let map;
let outageMarkers = [];
let outagePolygons = [];
let customMarkers = [];

let baseTileLayer;
let layerControl;

let drpepPolygonOverlaysByKey = new Map();
let drpepOverlayKeyByLeafletId = new Map();

const LAYER_PREFS_STORAGE_KEY = 'sce-outage-map.layer-prefs.v1';

// Global styling preference: all polygons render at 50% fill opacity.
const POLYGON_FILL_OPACITY = 0.5;

// Expose a small public API for programmatic layer control.
// NOTE: DRPEP layers are discovered async; use `window.LayerManager.ready()` before accessing them.
let drpepLayersReadyResolve;
const drpepLayersReady = new Promise(resolve => {
    drpepLayersReadyResolve = resolve;
});

function resolveDrpepLayersReady() {
    if (typeof drpepLayersReadyResolve === 'function') {
        drpepLayersReadyResolve();
        drpepLayersReadyResolve = null;
    }
}

function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
}

function arcgisColorArrayToRgba(color) {
    if (!Array.isArray(color) || color.length < 3) {
        return null;
    }
    const r = clamp(Number(color[0]) || 0, 0, 255);
    const g = clamp(Number(color[1]) || 0, 0, 255);
    const b = clamp(Number(color[2]) || 0, 0, 255);
    const a255 = color.length >= 4 ? clamp(Number(color[3]) || 255, 0, 255) : 255;
    const a = a255 / 255;
    return { css: `rgba(${r},${g},${b},${a})`, alpha: a };
}

function clampByte(n) {
    return clamp(n, 0, 255);
}

function parseCssColorToRgba(input) {
    if (typeof input !== 'string') {
        return null;
    }
    const s = input.trim();
    if (!s) {
        return null;
    }

    // Hex: #rgb, #rgba, #rrggbb, #rrggbbaa
    if (s[0] === '#') {
        const hex = s.slice(1);
        const isValid = /^[0-9a-fA-F]+$/.test(hex);
        if (!isValid) {
            return null;
        }

        if (hex.length === 3 || hex.length === 4) {
            const r = parseInt(hex[0] + hex[0], 16);
            const g = parseInt(hex[1] + hex[1], 16);
            const b = parseInt(hex[2] + hex[2], 16);
            const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
            return { r, g, b, a: clamp(a, 0, 1) };
        }
        if (hex.length === 6 || hex.length === 8) {
            const r = parseInt(hex.slice(0, 2), 16);
            const g = parseInt(hex.slice(2, 4), 16);
            const b = parseInt(hex.slice(4, 6), 16);
            const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
            return { r, g, b, a: clamp(a, 0, 1) };
        }
        return null;
    }

    // rgb()/rgba()
    const m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
    if (m) {
        const r = clampByte(Number(m[1]) || 0);
        const g = clampByte(Number(m[2]) || 0);
        const b = clampByte(Number(m[3]) || 0);
        const a = m[4] == null ? 1 : clamp(Number(m[4]) || 0, 0, 1);
        return { r, g, b, a };
    }

    // Best-effort: allow a handful of named colors if browser can resolve them.
    // Keep this lightweight; if it fails we just return null.
    try {
        const el = document.createElement('div');
        el.style.color = s;
        document.body.appendChild(el);
        const computed = getComputedStyle(el).color; // typically "rgb(r, g, b)" or "rgba(r, g, b, a)"
        document.body.removeChild(el);
        return parseCssColorToRgba(computed);
    } catch {
        return null;
    }
}

function rgbaToRgbCss({ r, g, b }) {
    return `rgb(${clampByte(r)},${clampByte(g)},${clampByte(b)})`;
}

function cssColorToHex(input, fallback = '#007bff') {
    const rgba = parseCssColorToRgba(input);
    if (!rgba) {
        return fallback;
    }
    const toHex2 = (n) => clampByte(n).toString(16).padStart(2, '0');
    return `#${toHex2(rgba.r)}${toHex2(rgba.g)}${toHex2(rgba.b)}`;
}

function getRendererFromLayerInfo(layerInfo) {
    return layerInfo?.drawingInfo?.renderer || null;
}

function getDefaultColorFromRenderer(renderer) {
    if (!renderer) {
        return '#007bff';
    }

    const trySymbol = (symbol) => {
        const c = arcgisColorArrayToRgba(symbol?.color);
        if (c && c.css) {
            return c.css;
        }
        const oc = arcgisColorArrayToRgba(symbol?.outline?.color);
        if (oc && oc.css) {
            return oc.css;
        }
        return null;
    };

    if (renderer.type === 'simple') {
        return trySymbol(renderer.symbol) || '#007bff';
    }
    if (renderer.type === 'uniqueValue') {
        return trySymbol(renderer.defaultSymbol) || trySymbol(renderer.uniqueValueInfos?.[0]?.symbol) || '#007bff';
    }
    if (renderer.type === 'classBreaks') {
        return trySymbol(renderer.defaultSymbol) || trySymbol(renderer.classBreakInfos?.[0]?.symbol) || '#007bff';
    }
    return '#007bff';
}

function buildStyleFromSymbol({ geometryType, symbol, fallbackColor }) {
    const rgba = arcgisColorArrayToRgba(symbol?.color);
    const outlineRgba = arcgisColorArrayToRgba(symbol?.outline?.color);
    const color = outlineRgba?.css || rgba?.css || fallbackColor;
    const fillColor = rgba?.css || fallbackColor;
    const fillOpacity = rgba?.alpha ?? 0.15;
    const outlineWidth = Number(symbol?.outline?.width);

    if (geometryType === 'esriGeometryPolygon') {
        return {
            color,
            fillColor,
            fillOpacity: clamp(POLYGON_FILL_OPACITY, 0, 1),
            weight: Number.isFinite(outlineWidth) ? outlineWidth : 1
        };
    }
    if (geometryType === 'esriGeometryPolyline') {
        const width = Number(symbol?.width);
        return {
            color: rgba?.css || fallbackColor,
            weight: Number.isFinite(width) ? width : 2,
            opacity: clamp(rgba?.alpha ?? 0.8, 0, 1)
        };
    }
    if (geometryType === 'esriGeometryPoint') {
        const size = Number(symbol?.size);
        return {
            radius: Number.isFinite(size) ? clamp(size / 2, 2, 10) : 4,
            color: outlineRgba?.css || fallbackColor,
            fillColor: rgba?.css || fallbackColor,
            fillOpacity: clamp(rgba?.alpha ?? 0.7, 0, 1),
            weight: Number.isFinite(outlineWidth) ? outlineWidth : 1
        };
    }
    return { color: fallbackColor };
}

function buildStyleFromOverride({ geometryType, color, overrideStyle }) {
    const parsed = parseCssColorToRgba(color);
    const baseColor = parsed ? rgbaToRgbCss(parsed) : color;
    const alpha = parsed ? clamp(parsed.a, 0, 1) : null;

    const defaultOpacity = alpha == null ? 0.8 : alpha;
    const defaultFillOpacity = alpha == null ? 0.08 : alpha;

    if (geometryType === 'esriGeometryPolygon') {
        return {
            color: baseColor,
            fillColor: baseColor,
            fillOpacity: clamp(POLYGON_FILL_OPACITY, 0, 1),
            weight: overrideStyle?.weight ?? 1,
            opacity: clamp(overrideStyle?.opacity ?? defaultOpacity, 0, 1)
        };
    }
    if (geometryType === 'esriGeometryPolyline') {
        return {
            color: baseColor,
            weight: overrideStyle?.weight ?? 2,
            opacity: clamp(overrideStyle?.opacity ?? defaultOpacity, 0, 1)
        };
    }
    if (geometryType === 'esriGeometryPoint') {
        return {
            radius: overrideStyle?.radius ?? 4,
            color: baseColor,
            fillColor: baseColor,
            fillOpacity: clamp(overrideStyle?.fillOpacity ?? (alpha == null ? 0.7 : alpha), 0, 1),
            weight: overrideStyle?.weight ?? 1,
            opacity: clamp(overrideStyle?.opacity ?? (alpha == null ? 0.9 : alpha), 0, 1)
        };
    }
    return { color: baseColor };
}

function applyStyleAdjust(style, geometryType, adjust) {
    if (!adjust || !style) {
        return style;
    }

    const opacityScale = typeof adjust.opacityScale === 'number' ? adjust.opacityScale : 1;
    const fillOpacityScale = typeof adjust.fillOpacityScale === 'number' ? adjust.fillOpacityScale : 1;

    if (geometryType === 'esriGeometryPolygon') {
        if (typeof style.opacity === 'number') {
            style.opacity = clamp(style.opacity * opacityScale, 0, 1);
        }
        if (typeof style.fillOpacity === 'number') {
            style.fillOpacity = clamp(style.fillOpacity * fillOpacityScale, 0, 1);
        }
        return style;
    }

    if (geometryType === 'esriGeometryPolyline') {
        if (typeof style.opacity === 'number') {
            style.opacity = clamp(style.opacity * opacityScale, 0, 1);
        }
        return style;
    }

    if (geometryType === 'esriGeometryPoint') {
        if (typeof style.opacity === 'number') {
            style.opacity = clamp(style.opacity * opacityScale, 0, 1);
        }
        if (typeof style.fillOpacity === 'number') {
            style.fillOpacity = clamp(style.fillOpacity * fillOpacityScale, 0, 1);
        }
        return style;
    }

    return style;
}

function getSymbolForFeature(renderer, featureAttributes) {
    if (!renderer) {
        return null;
    }

    if (renderer.type === 'simple') {
        return renderer.symbol || null;
    }

    if (renderer.type === 'uniqueValue') {
        const field = renderer.field1;
        const value = field ? featureAttributes?.[field] : undefined;
        const match = (renderer.uniqueValueInfos || []).find(info => String(info.value) === String(value));
        return match?.symbol || renderer.defaultSymbol || renderer.symbol || null;
    }

    if (renderer.type === 'classBreaks') {
        const field = renderer.field;
        const raw = field ? featureAttributes?.[field] : undefined;
        const num = Number(raw);
        if (!Number.isFinite(num)) {
            return renderer.defaultSymbol || renderer.symbol || null;
        }

        // ArcGIS classBreakInfos use classMaxValue; choose first class where num <= classMaxValue.
        const match = (renderer.classBreakInfos || []).find(info => Number.isFinite(Number(info.classMaxValue)) && num <= Number(info.classMaxValue));
        return match?.symbol || renderer.defaultSymbol || renderer.symbol || null;
    }

    return renderer.symbol || null;
}

function loadLayerPrefs() {
    try {
        const raw = localStorage.getItem(LAYER_PREFS_STORAGE_KEY);
        if (!raw) {
            return {};
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function saveLayerPrefs(prefs) {
    try {
        localStorage.setItem(LAYER_PREFS_STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        // ignore
    }
}

function setActiveDataSourceLabel(label) {
    const el = document.getElementById('data-source-value');
    if (!el) {
        return;
    }
    el.textContent = label;
}

function labelForSuccessfulEndpoint(endpoint) {
    if (endpoint.startsWith(DATA_SOURCES.arcgis.outagesQueryUrl)) {
        return 'Live: SCE Outage Center (Current Outages)';
    }
    if (endpoint.startsWith(DATA_SOURCES.arcgis.majorOutagesQueryUrl)) {
        return 'Live: SCE Outage Center (Major Outages)';
    }
    if (endpoint.includes('sce.com/api/outages/outagedata')) {
        return 'Live: Legacy SCE API';
    }
    if (endpoint.includes('kubra.io')) {
        return 'Live: Legacy Kubra feed';
    }
    return 'Live: Custom endpoint';
}

// Initialize the map
function initMap() {
    map = L.map('map').setView([SAN_GABRIEL_VALLEY.lat, SAN_GABRIEL_VALLEY.lng], 11);

    // Move zoom controls to bottom-right.
    if (map && map.zoomControl && typeof map.zoomControl.setPosition === 'function') {
        map.zoomControl.setPosition('bottomright');
    }
    
    baseTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    layerControl = L.control.layers(
        { 'OpenStreetMap': baseTileLayer },
        {},
        { collapsed: true }
    ).addTo(map);

    // Persist visibility changes even when toggled via the Leaflet layer control.
    map.on('overlayadd', (e) => {
        const key = drpepOverlayKeyByLeafletId.get(L.stamp(e.layer));
        if (!key) {
            return;
        }
        const overlay = drpepPolygonOverlaysByKey.get(key);
        if (!overlay) {
            return;
        }
        overlay.visible = true;
        const prefs = loadLayerPrefs();
        prefs[key] = {
            ...(prefs[key] || {}),
            visible: true,
            styleMode: overlay.styleMode,
            overrideColor: overlay.overrideColor
        };
        saveLayerPrefs(prefs);
        renderLayerSettingsPanel();
    });

    map.on('overlayremove', (e) => {
        const key = drpepOverlayKeyByLeafletId.get(L.stamp(e.layer));
        if (!key) {
            return;
        }
        const overlay = drpepPolygonOverlaysByKey.get(key);
        if (!overlay) {
            return;
        }
        overlay.visible = false;
        const prefs = loadLayerPrefs();
        prefs[key] = {
            ...(prefs[key] || {}),
            visible: false,
            styleMode: overlay.styleMode,
            overrideColor: overlay.overrideColor
        };
        saveLayerPrefs(prefs);
        renderLayerSettingsPanel();
    });
    
    // Add a circle to show the configured radius
    L.circle([SAN_GABRIEL_VALLEY.lat, SAN_GABRIEL_VALLEY.lng], {
        color: '#007bff',
        fillColor: '#007bff',
        fillOpacity: 0.1,
        radius: milesToMeters(SAN_GABRIEL_VALLEY.radius)
    }).addTo(map);
    
    // Add custom markers from URL parameters
    addCustomMarkersFromURL();
}

function getSgvBoundingBox4326() {
    return getBoundingBoxForRadiusMiles(
        SAN_GABRIEL_VALLEY.lat,
        SAN_GABRIEL_VALLEY.lng,
        SAN_GABRIEL_VALLEY.radius
    );
}

function getSgvCircleQuery() {
    return {
        center: { lat: SAN_GABRIEL_VALLEY.lat, lng: SAN_GABRIEL_VALLEY.lng },
        radiusMeters: milesToMeters(SAN_GABRIEL_VALLEY.radius)
    };
}

function getOverlayKey(serviceUrl, layerId) {
    return `${serviceUrl}::${layerId}`;
}

function getOrCreatePolygonOverlay({ key, displayName, serviceUrl, layerId, geometryType, initialColor, initialVisible }) {
    const existing = drpepPolygonOverlaysByKey.get(key);
    if (existing) {
        return existing;
    }

    const layerGroup = L.layerGroup();
    const overlay = {
        key,
        displayName,
        serviceUrl,
        layerId,
        geometryType,
        layerGroup,
        renderer: null,
        defaultColor: initialColor,
        styleMode: 'renderer',
        overrideColor: initialColor,
        overrideStyle: null,
        styleAdjust: null,
        color: initialColor,
        visible: initialVisible
    };

    drpepPolygonOverlaysByKey.set(key, overlay);
    drpepOverlayKeyByLeafletId.set(L.stamp(layerGroup), key);

    if (layerControl) {
        layerControl.addOverlay(layerGroup, displayName);
    }

    if (overlay.visible) {
        layerGroup.addTo(map);
    }

    return overlay;
}

function applyOverlayColor(overlay, color) {
    overlay.styleMode = 'override';
    overlay.overrideColor = color;
    overlay.color = color;
    overlay.layerGroup.eachLayer(layer => {
        if (typeof layer.setStyle === 'function') {
            layer.setStyle(buildStyleFromOverride({ geometryType: overlay.geometryType, color, overrideStyle: overlay.overrideStyle }));
        }
    });
}

function applyOverlayDefaultColor(overlay, color) {
    overlay.defaultColor = color;
    if (overlay.styleMode !== 'override') {
        overlay.color = color;
        overlay.layerGroup.eachLayer(layer => {
            if (typeof layer.setStyle !== 'function') {
                return;
            }
            const attrs = layer && layer.__sceAttributes ? layer.__sceAttributes : null;
            const symbol = attrs ? getSymbolForFeature(overlay.renderer, attrs) : null;
            const style = symbol
                ? buildStyleFromSymbol({ geometryType: overlay.geometryType, symbol, fallbackColor: overlay.defaultColor })
                : (overlay.geometryType === 'esriGeometryPolygon'
                    ? { color: overlay.defaultColor, fillColor: overlay.defaultColor, fillOpacity: 0.08, weight: 1 }
                    : overlay.geometryType === 'esriGeometryPolyline'
                        ? { color: overlay.defaultColor, weight: 2, opacity: 0.8 }
                        : { radius: 4, color: overlay.defaultColor, fillColor: overlay.defaultColor, fillOpacity: 0.7, weight: 1 });

            applyStyleAdjust(style, overlay.geometryType, overlay.styleAdjust);
            layer.setStyle(style);
        });
    }
}

function persistOverlayPrefs(overlay) {
    const prefs = loadLayerPrefs();
    prefs[overlay.key] = {
        ...(prefs[overlay.key] || {}),
        visible: !!overlay.visible,
        styleMode: overlay.styleMode,
        overrideColor: overlay.overrideColor,
        defaultColor: overlay.defaultColor
    };
    saveLayerPrefs(prefs);
}

function setOverlayVisibility(overlay, visible) {
    overlay.visible = visible;
    const onMap = map && map.hasLayer(overlay.layerGroup);
    if (visible && !onMap) {
        overlay.layerGroup.addTo(map);
    }
    if (!visible && onMap) {
        overlay.layerGroup.removeFrom(map);
    }
}

function buildProxyUrl(url) {
    return DATA_SOURCES.corsProxy + encodeURIComponent(url);
}

async function fetchJson(url, { allowProxyFallback = true } = {}) {
    const attempt = async (targetUrl) => {
        const response = await fetch(targetUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status} for ${url}`);
        }
        return response.json();
    };

    // If the user explicitly enabled the proxy, always use it.
    if (DATA_SOURCES.useCorsProxy) {
        return attempt(buildProxyUrl(url));
    }

    // Otherwise, try direct first (fast / no third-party), and fall back to proxy on CORS/network failure.
    try {
        return await attempt(url);
    } catch (err) {
        if (!allowProxyFallback) {
            throw err;
        }
        try {
            return await attempt(buildProxyUrl(url));
        } catch {
            throw err;
        }
    }
}

function arcgisRingsToLeafletLatLngs(rings) {
    if (!Array.isArray(rings)) {
        return null;
    }

    const ringLatLngs = rings
        .filter(ring => Array.isArray(ring) && ring.length)
        .map(ring => ring
            .filter(pt => Array.isArray(pt) && pt.length >= 2)
            .map(([x, y]) => [y, x])
        )
        .filter(ring => ring.length >= 3);

    return ringLatLngs.length ? ringLatLngs : null;
}

function arcgisPathsToLeafletLatLngs(paths) {
    if (!Array.isArray(paths)) {
        return null;
    }

    const pathLatLngs = paths
        .filter(path => Array.isArray(path) && path.length)
        .map(path => path
            .filter(pt => Array.isArray(pt) && pt.length >= 2)
            .map(([x, y]) => [y, x])
        )
        .filter(path => path.length >= 2);

    return pathLatLngs.length ? pathLatLngs : null;
}

async function fetchArcgisFeaturesPaged(layerQueryUrl, { bbox, circle, where = '1=1', outFields = 'objectid', orderByFields = '', pageSize = 1000, maxFeatures = 5000 }) {
    const allFeatures = [];
    for (let offset = 0; offset < maxFeatures; offset += pageSize) {
        const extraParams = {
            resultOffset: String(offset),
            resultRecordCount: String(pageSize),
            ...(orderByFields ? { orderByFields } : {})
        };

        const url = circle
            ? buildArcgisCircleQueryUrl(layerQueryUrl, {
                where,
                outFields,
                center: circle.center,
                radiusMeters: circle.radiusMeters,
                extraParams
            })
            : buildArcgisQueryUrl(layerQueryUrl, {
                where,
                outFields,
                bbox,
                extraParams
            });

        const data = await fetchJson(url);
        if (!data || data.error) {
            break;
        }

        const features = Array.isArray(data.features) ? data.features : [];
        allFeatures.push(...features);
        if (features.length < pageSize) {
            break;
        }
    }

    return allFeatures;
}

async function discoverDrpepLayers() {
    const discovered = [];
    for (const service of DRPEP_SOURCES.services) {
        try {
            const serviceInfo = await fetchJson(`${service.url}?f=json`);
            const layers = Array.isArray(serviceInfo.layers) ? serviceInfo.layers : [];

            for (const layer of layers) {
                if (typeof layer.id !== 'number') {
                    continue;
                }
                try {
                    const layerInfo = await fetchJson(`${service.url}/${layer.id}?f=json`);
                    const geometryType = layerInfo && layerInfo.geometryType;
                    const isRenderable = geometryType === 'esriGeometryPolygon' || geometryType === 'esriGeometryPolyline' || geometryType === 'esriGeometryPoint';
                    if (layerInfo && isRenderable) {
                        const renderer = getRendererFromLayerInfo(layerInfo);

                        const objectIdField =
                            layerInfo.objectIdField ||
                            layerInfo.objectIdFieldName ||
                            'OBJECTID';

                        const maxRecordCount = typeof layerInfo.maxRecordCount === 'number'
                            ? layerInfo.maxRecordCount
                            : 2000;

                        const rendererFields = [];
                        if (renderer?.type === 'uniqueValue') {
                            if (renderer.field1) rendererFields.push(renderer.field1);
                            if (renderer.field2) rendererFields.push(renderer.field2);
                            if (renderer.field3) rendererFields.push(renderer.field3);
                        }
                        if (renderer?.type === 'classBreaks') {
                            if (renderer.field) rendererFields.push(renderer.field);
                        }

                        discovered.push({
                            serviceLabel: service.label,
                            serviceUrl: service.url,
                            layerId: layer.id,
                            layerName: layerInfo.name || layer.name || `Layer ${layer.id}`,
                            geometryType,
                            renderer,
                            objectIdField,
                            maxRecordCount,
                            rendererFields
                        });
                    }
                } catch (e) {
                    // Skip layers that fail to describe (often auth-gated or transient).
                }
            }
        } catch (e) {
            console.warn('Failed to load DRPEP service:', service.url, e && e.message ? e.message : e);
        }
    }
    return discovered;
}

async function refreshDrpepPolygonOverlays() {
    if (!DRPEP_SOURCES.enabled || !map) {
        return;
    }

    const circle = getSgvCircleQuery();
    const clipConfig = {
        centerLat: circle.center.lat,
        centerLng: circle.center.lng,
        radiusMeters: circle.radiusMeters
    };

    for (const overlay of drpepPolygonOverlaysByKey.values()) {
        try {
            overlay.layerGroup.clearLayers();
            const layerQueryUrl = `${overlay.serviceUrl}/${overlay.layerId}/query`;

            const outFieldsSet = new Set();
            if (overlay.objectIdField) {
                outFieldsSet.add(overlay.objectIdField);
            }
            if (Array.isArray(overlay.rendererFields)) {
                overlay.rendererFields.forEach(f => {
                    if (typeof f === 'string' && f.trim()) {
                        outFieldsSet.add(f);
                    }
                });
            }
            const outFields = outFieldsSet.size ? Array.from(outFieldsSet).join(',') : '*';
            const pageSize = typeof overlay.maxRecordCount === 'number'
                ? Math.min(1000, overlay.maxRecordCount)
                : 1000;

            const features = await fetchArcgisFeaturesPaged(layerQueryUrl, {
                circle,
                where: '1=1',
                outFields,
                orderByFields: overlay.objectIdField || '',
                pageSize,
                maxFeatures: 20000
            });

            for (const feature of features) {
                const geometry = feature?.geometry;
                if (!geometry) {
                    continue;
                }

                const objectId = overlay.objectIdField ? feature?.attributes?.[overlay.objectIdField] : undefined;
                const attrs = feature?.attributes || {};

                const effectiveColor = overlay.styleMode === 'override' ? overlay.overrideColor : overlay.defaultColor;
                const symbol = overlay.styleMode === 'override' ? null : getSymbolForFeature(overlay.renderer, attrs);
                const style = overlay.styleMode === 'override'
                    ? buildStyleFromOverride({ geometryType: overlay.geometryType, color: effectiveColor, overrideStyle: overlay.overrideStyle })
                    : (symbol
                        ? buildStyleFromSymbol({ geometryType: overlay.geometryType, symbol, fallbackColor: effectiveColor })
                        : (overlay.geometryType === 'esriGeometryPolygon'
                            ? { color: effectiveColor, fillColor: effectiveColor, fillOpacity: 0.08, weight: 1 }
                            : overlay.geometryType === 'esriGeometryPolyline'
                                ? { color: effectiveColor, weight: 2, opacity: 0.8 }
                                : { radius: 4, color: effectiveColor, fillColor: effectiveColor, fillOpacity: 0.7, weight: 1 }));

                applyStyleAdjust(style, overlay.geometryType, overlay.styleAdjust);

                if (overlay.geometryType === 'esriGeometryPolygon') {
                    const latLngs = arcgisRingsToLeafletLatLngs(geometry.rings);
                    if (!latLngs) {
                        continue;
                    }

                    const clipped = clipLatLngsToCircle(latLngs, { ...clipConfig, geometryType: 'esriGeometryPolygon' });
                    if (!clipped) {
                        continue;
                    }

                    const polygon = L.polygon(clipped, style);
                    polygon.__sceAttributes = attrs;
                    polygon.bindPopup(`<div class="popup-title">${overlay.displayName}</div><div class="popup-info"><strong>OBJECTID:</strong> ${objectId ?? '—'}</div>`);
                    polygon.addTo(overlay.layerGroup);
                    continue;
                }

                if (overlay.geometryType === 'esriGeometryPolyline') {
                    const latLngs = arcgisPathsToLeafletLatLngs(geometry.paths);
                    if (!latLngs) {
                        continue;
                    }

                    const clipped = clipLatLngsToCircle(latLngs, { ...clipConfig, geometryType: 'esriGeometryPolyline' });
                    if (!clipped) {
                        continue;
                    }

                    const line = L.polyline(clipped, style);
                    line.__sceAttributes = attrs;
                    line.bindPopup(`<div class="popup-title">${overlay.displayName}</div><div class="popup-info"><strong>OBJECTID:</strong> ${objectId ?? '—'}</div>`);
                    line.addTo(overlay.layerGroup);
                    continue;
                }

                if (overlay.geometryType === 'esriGeometryPoint') {
                    if (typeof geometry.x !== 'number' || typeof geometry.y !== 'number') {
                        continue;
                    }

                    // Strict: do not display points outside the circle.
                    if (!isWithinRadius(geometry.y, geometry.x)) {
                        continue;
                    }

                    const point = L.circleMarker([geometry.y, geometry.x], style);
                    point.__sceAttributes = attrs;
                    point.bindPopup(`<div class="popup-title">${overlay.displayName}</div><div class="popup-info"><strong>OBJECTID:</strong> ${objectId ?? '—'}</div>`);
                    point.addTo(overlay.layerGroup);
                }
            }
        } catch (e) {
            // Non-fatal: leave the overlay empty if it errors.
        }
    }
}

async function initDrpepLayers() {
    if (!DRPEP_SOURCES.enabled || !map) {
        return;
    }

    try {
        const polygonLayers = await discoverDrpepLayers();

        const prefs = loadLayerPrefs();
        polygonLayers
        // Do not include the PARTIAL grid layer at all.
        .filter(l => {
            const name = typeof l.layerName === 'string' ? l.layerName.trim().toUpperCase() : '';
            if (name === 'GRID_RANK_AGGR_FULL_PARTIAL') {
                return false;
            }
            if (name === 'CPUC_APPROVED_POLYGON') {
                return false;
            }
            return true;
        })
        .forEach(({ serviceLabel, serviceUrl, layerId, layerName, geometryType, renderer, objectIdField, maxRecordCount, rendererFields }) => {
        const key = getOverlayKey(serviceUrl, layerId);
        const geometrySuffix = geometryType === 'esriGeometryPolygon'
            ? ' (Polygon)'
            : geometryType === 'esriGeometryPolyline'
                ? ' (Line)'
                : geometryType === 'esriGeometryPoint'
                    ? ' (Point)'
                    : '';
        const displayName = `${serviceLabel}: ${layerName}${geometrySuffix}`;
        const saved = prefs[key] || {};
        const derivedDefaultColor = getDefaultColorFromRenderer(renderer);
        const persistedDefaultColor = typeof saved.defaultColor === 'string' ? saved.defaultColor : null;
        const defaultColor = persistedDefaultColor || derivedDefaultColor;

        const overlay = getOrCreatePolygonOverlay({
            key,
            displayName,
            serviceUrl,
            layerId,
            geometryType,
            initialColor: defaultColor,
            initialVisible: typeof saved.visible === 'boolean' ? saved.visible : true
        });

        // Attach renderer + defaults, then apply persisted overrides if present.
        overlay.renderer = renderer || null;
        overlay.objectIdField = objectIdField;
        overlay.maxRecordCount = maxRecordCount;
        overlay.rendererFields = Array.isArray(rendererFields) ? rendererFields : [];
        overlay.defaultColor = defaultColor;
        overlay.styleMode = saved.styleMode === 'override' ? 'override' : 'renderer';
        overlay.overrideColor = typeof saved.overrideColor === 'string' ? saved.overrideColor : defaultColor;
        overlay.color = overlay.styleMode === 'override' ? overlay.overrideColor : overlay.defaultColor;

        // Special-case: DRPEP "SCE Service Territory" should default to #00664f and be transparent.
        // Only apply this default when the user has not already customized this layer.
        const isServiceTerritory =
            typeof layerName === 'string' &&
            layerName.trim().toLowerCase() === 'sce service territory' &&
            typeof serviceUrl === 'string' &&
            serviceUrl.includes('/ICA_Layer/');

        if (isServiceTerritory && !saved.styleMode && !saved.overrideColor) {
            overlay.styleMode = 'override';
            overlay.overrideColor = '#00664f';
            overlay.overrideStyle = { fillOpacity: 0.06, weight: 1, opacity: 0.7 };
            overlay.color = overlay.overrideColor;
        }

        // Make DRPEP GRID_RANK_AGGR_FULL transparent (keep renderer/multi-color, just lower opacity).
        const isGridRankFull = typeof layerName === 'string' && layerName.trim().toUpperCase() === 'GRID_RANK_AGGR_FULL';
        if (isGridRankFull) {
            // Global polygon fill opacity is 0.5; scale to 0.25 => 75% transparent.
            overlay.styleAdjust = { opacityScale: 0.7, fillOpacityScale: 0.5 };
        }
    });

        renderLayerSettingsPanel();

        await refreshDrpepPolygonOverlays();
    } finally {
        resolveDrpepLayersReady();
    }
}

function renderLayerSettingsPanel() {
    const root = document.getElementById('layers-panel');
    if (!root) {
        return;
    }

    const list = document.getElementById('layers-list');
    if (!list) {
        return;
    }

    list.innerHTML = '';
    const overlays = Array.from(drpepPolygonOverlaysByKey.values())
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

    const prefs = loadLayerPrefs();

    overlays.forEach(overlay => {
        const row = document.createElement('div');
        row.className = 'layers-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = !!overlay.visible;
        checkbox.className = 'layers-toggle';
        checkbox.addEventListener('change', () => {
            setOverlayVisibility(overlay, checkbox.checked);
            prefs[overlay.key] = {
                ...(prefs[overlay.key] || {}),
                visible: checkbox.checked,
                styleMode: overlay.styleMode,
                overrideColor: overlay.overrideColor,
                defaultColor: overlay.defaultColor
            };
            saveLayerPrefs(prefs);
        });

        const label = document.createElement('div');
        label.className = 'layers-label';
        label.textContent = overlay.displayName;

        const color = document.createElement('input');
        color.type = 'color';
        // If a layer is multi-color by renderer, the picker acts as an override.
        color.value = cssColorToHex(overlay.styleMode === 'override' ? overlay.overrideColor : overlay.defaultColor);
        color.className = 'layers-color';
        color.addEventListener('input', () => {
            applyOverlayColor(overlay, color.value);
            prefs[overlay.key] = {
                ...(prefs[overlay.key] || {}),
                visible: overlay.visible,
                styleMode: 'override',
                overrideColor: color.value,
                defaultColor: overlay.defaultColor
            };
            saveLayerPrefs(prefs);
        });

        row.appendChild(checkbox);
        row.appendChild(label);
        row.appendChild(color);
        list.appendChild(row);
    });
}

function getOverlayByKey(key) {
    return key ? drpepPolygonOverlaysByKey.get(key) || null : null;
}

function findOverlaysByText(text) {
    const q = typeof text === 'string' ? text.trim().toLowerCase() : '';
    if (!q) {
        return [];
    }
    return Array.from(drpepPolygonOverlaysByKey.values()).filter(o => (o.displayName || '').toLowerCase().includes(q));
}

function applyLayerConfig(config = {}) {
    if (!config || typeof config !== 'object') {
        return;
    }

    for (const [key, cfg] of Object.entries(config)) {
        const overlay = getOverlayByKey(key);
        if (!overlay || !cfg || typeof cfg !== 'object') {
            continue;
        }

        if (typeof cfg.visible === 'boolean') {
            setOverlayVisibility(overlay, cfg.visible);
        }

        if (typeof cfg.defaultColor === 'string') {
            applyOverlayDefaultColor(overlay, cfg.defaultColor);
        }

        if (typeof cfg.overrideColor === 'string') {
            applyOverlayColor(overlay, cfg.overrideColor);
        }

        if (cfg.styleMode === 'renderer' || cfg.styleMode === 'override') {
            overlay.styleMode = cfg.styleMode;
            overlay.color = overlay.styleMode === 'override' ? overlay.overrideColor : overlay.defaultColor;
            if (overlay.styleMode === 'override') {
                applyOverlayColor(overlay, overlay.overrideColor);
            } else {
                applyOverlayDefaultColor(overlay, overlay.defaultColor);
            }
        }

        persistOverlayPrefs(overlay);
    }

    renderLayerSettingsPanel();
}

// Public programmatic API
window.LayerManager = {
    ready: () => drpepLayersReady,
    listLayers: () => Array.from(drpepPolygonOverlaysByKey.values()).map(o => ({
        key: o.key,
        displayName: o.displayName,
        geometryType: o.geometryType,
        visible: !!o.visible,
        styleMode: o.styleMode,
        defaultColor: o.defaultColor,
        overrideColor: o.overrideColor,
        effectiveColor: o.styleMode === 'override' ? o.overrideColor : o.defaultColor
    })),
    getLayer: (key) => {
        const o = getOverlayByKey(key);
        return o ? {
            key: o.key,
            displayName: o.displayName,
            geometryType: o.geometryType,
            visible: !!o.visible,
            styleMode: o.styleMode,
            defaultColor: o.defaultColor,
            overrideColor: o.overrideColor,
            effectiveColor: o.styleMode === 'override' ? o.overrideColor : o.defaultColor
        } : null;
    },
    findLayers: ({ text } = {}) => findOverlaysByText(text).map(o => o.key),
    setVisible: (key, visible) => {
        const o = getOverlayByKey(key);
        if (!o || typeof visible !== 'boolean') return false;
        setOverlayVisibility(o, visible);
        persistOverlayPrefs(o);
        renderLayerSettingsPanel();
        return true;
    },
    setDefaultColor: (key, color) => {
        const o = getOverlayByKey(key);
        if (!o || typeof color !== 'string') return false;
        applyOverlayDefaultColor(o, color);
        persistOverlayPrefs(o);
        renderLayerSettingsPanel();
        return true;
    },
    setOverrideColor: (key, color) => {
        const o = getOverlayByKey(key);
        if (!o || typeof color !== 'string') return false;
        applyOverlayColor(o, color);
        persistOverlayPrefs(o);
        renderLayerSettingsPanel();
        return true;
    },
    setStyleMode: (key, mode) => {
        const o = getOverlayByKey(key);
        if (!o || (mode !== 'renderer' && mode !== 'override')) return false;
        o.styleMode = mode;
        o.color = o.styleMode === 'override' ? o.overrideColor : o.defaultColor;
        if (o.styleMode === 'override') {
            applyOverlayColor(o, o.overrideColor);
        } else {
            applyOverlayDefaultColor(o, o.defaultColor);
        }
        persistOverlayPrefs(o);
        renderLayerSettingsPanel();
        return true;
    },
    applyConfig: (config) => applyLayerConfig(config)
};

// Convert miles to meters
function milesToMeters(miles) {
    return miles * 1609.34;
}

function projectLatLngToLocalMeters(lat, lng, centerLat, centerLng) {
    // Local equirectangular approximation around the center.
    const R = 6378137; // meters
    const dLat = (lat - centerLat) * Math.PI / 180;
    const dLng = (lng - centerLng) * Math.PI / 180;
    const x = dLng * Math.cos(centerLat * Math.PI / 180) * R;
    const y = dLat * R;
    return { x, y };
}

function unprojectLocalMetersToLatLng(x, y, centerLat, centerLng) {
    const R = 6378137; // meters
    const lat = centerLat + (y / R) * 180 / Math.PI;
    const lng = centerLng + (x / (R * Math.cos(centerLat * Math.PI / 180))) * 180 / Math.PI;
    return [lat, lng];
}

function getCirclePolygonXY(radiusMeters, segments = 64) {
    const pts = [];
    const n = clamp(Math.floor(segments), 16, 256);
    for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2;
        pts.push({ x: Math.cos(t) * radiusMeters, y: Math.sin(t) * radiusMeters });
    }

    // Ensure CCW winding for the clip polygon.
    const signedArea = pts.reduce((acc, p, i) => {
        const q = pts[(i + 1) % pts.length];
        return acc + (p.x * q.y - q.x * p.y);
    }, 0);
    if (signedArea < 0) {
        pts.reverse();
    }

    return pts;
}

function normalizeRingXY(ring) {
    if (!Array.isArray(ring)) {
        return [];
    }
    const cleaned = ring
        .filter(p => p && typeof p.x === 'number' && typeof p.y === 'number')
        .filter((p, idx, arr) => {
            if (idx === 0) return true;
            const prev = arr[idx - 1];
            return Math.abs(p.x - prev.x) > 1e-6 || Math.abs(p.y - prev.y) > 1e-6;
        });

    if (cleaned.length >= 2) {
        const first = cleaned[0];
        const last = cleaned[cleaned.length - 1];
        if (Math.abs(first.x - last.x) <= 1e-6 && Math.abs(first.y - last.y) <= 1e-6) {
            cleaned.pop();
        }
    }

    return cleaned;
}

function clipPolylineToCircleXY(pointsXY, radiusMeters) {
    if (!Array.isArray(pointsXY) || pointsXY.length < 2) {
        return [];
    }

    const r2 = radiusMeters * radiusMeters;
    const inside = (p) => (p.x * p.x + p.y * p.y) <= r2;

    const intersectionsT = (a, b) => {
        // Solve |a + t(b-a)|^2 = r^2 for t in [0,1]
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const A = dx * dx + dy * dy;
        if (A === 0) {
            return [];
        }
        const B = 2 * (a.x * dx + a.y * dy);
        const C = (a.x * a.x + a.y * a.y) - r2;
        const disc = B * B - 4 * A * C;
        if (disc < 0) {
            return [];
        }
        const sqrt = Math.sqrt(Math.max(0, disc));
        const t1 = (-B - sqrt) / (2 * A);
        const t2 = (-B + sqrt) / (2 * A);
        const ts = [];
        if (t1 >= 0 && t1 <= 1) ts.push(t1);
        if (t2 >= 0 && t2 <= 1 && Math.abs(t2 - t1) > 1e-9) ts.push(t2);
        ts.sort((x, y) => x - y);
        return ts;
    };

    const pointAt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

    const parts = [];
    let current = null;

    for (let i = 0; i < pointsXY.length - 1; i++) {
        const a = pointsXY[i];
        const b = pointsXY[i + 1];
        const aIn = inside(a);
        const bIn = inside(b);
        const ts = intersectionsT(a, b);

        if (aIn && bIn) {
            if (!current) {
                current = [a];
            }
            current.push(b);
            continue;
        }

        if (aIn && !bIn) {
            if (!current) {
                current = [a];
            }
            if (ts.length) {
                const tExit = ts[ts.length - 1];
                current.push(pointAt(a, b, tExit));
            }
            if (current.length >= 2) {
                parts.push(current);
            }
            current = null;
            continue;
        }

        if (!aIn && bIn) {
            if (ts.length) {
                const tEnter = ts[0];
                current = [pointAt(a, b, tEnter), b];
            } else {
                current = [b];
            }
            continue;
        }

        // both outside
        if (ts.length >= 2) {
            parts.push([pointAt(a, b, ts[0]), pointAt(a, b, ts[1])]);
        }
        if (current && current.length >= 2) {
            parts.push(current);
        }
        current = null;
    }

    if (current && current.length >= 2) {
        parts.push(current);
    }

    return parts
        .map(part => part.filter((p, idx) => idx === 0 || (Math.abs(p.x - part[idx - 1].x) > 1e-6 || Math.abs(p.y - part[idx - 1].y) > 1e-6)))
        .filter(part => part.length >= 2);
}

function clipPolygonRingToConvexPolygonXY(subjectPts, clipPts) {
    // Sutherland–Hodgman polygon clipping. Assumes clipPts is convex and CCW.
    if (!Array.isArray(subjectPts) || subjectPts.length < 3) {
        return [];
    }
    if (!Array.isArray(clipPts) || clipPts.length < 3) {
        return [];
    }

    const isInside = (p, a, b) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-12;

    const intersection = (s, e, a, b) => {
        const dxSE = e.x - s.x;
        const dySE = e.y - s.y;
        const dxAB = b.x - a.x;
        const dyAB = b.y - a.y;
        const denom = dxSE * dyAB - dySE * dxAB;
        if (Math.abs(denom) < 1e-12) {
            return e;
        }
        const t = ((a.x - s.x) * dyAB - (a.y - s.y) * dxAB) / denom;
        return { x: s.x + t * dxSE, y: s.y + t * dySE };
    };

    let output = subjectPts;
    for (let i = 0; i < clipPts.length; i++) {
        const a = clipPts[i];
        const b = clipPts[(i + 1) % clipPts.length];
        const input = output;
        output = [];
        if (!input.length) {
            break;
        }
        let S = input[input.length - 1];
        for (const E of input) {
            const EIn = isInside(E, a, b);
            const SIn = isInside(S, a, b);
            if (EIn) {
                if (!SIn) {
                    output.push(intersection(S, E, a, b));
                }
                output.push(E);
            } else if (SIn) {
                output.push(intersection(S, E, a, b));
            }
            S = E;
        }
    }

    const deduped = [];
    for (const p of output) {
        const last = deduped[deduped.length - 1];
        if (!last || Math.abs(p.x - last.x) > 1e-6 || Math.abs(p.y - last.y) > 1e-6) {
            deduped.push(p);
        }
    }
    return deduped.length >= 3 ? deduped : [];
}

function clipLatLngsToCircle(latLngs, { centerLat, centerLng, radiusMeters, geometryType }) {
    if (!latLngs) {
        return null;
    }

    if (geometryType === 'esriGeometryPoint') {
        if (Array.isArray(latLngs) && latLngs.length === 2 && typeof latLngs[0] === 'number' && typeof latLngs[1] === 'number') {
            return isWithinRadius(latLngs[0], latLngs[1]) ? latLngs : null;
        }
        return null;
    }

    if (geometryType === 'esriGeometryPolyline') {
        const paths = (Array.isArray(latLngs) && latLngs.length && Array.isArray(latLngs[0]) && typeof latLngs[0][0] === 'number')
            ? [latLngs]
            : (Array.isArray(latLngs) ? latLngs : []);

        const outPaths = [];
        for (const path of paths) {
            const ptsXY = path
                .filter(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
                .map(([lat, lng]) => projectLatLngToLocalMeters(lat, lng, centerLat, centerLng));
            const clippedPartsXY = clipPolylineToCircleXY(ptsXY, radiusMeters);
            for (const part of clippedPartsXY) {
                const out = part.map(p => unprojectLocalMetersToLatLng(p.x, p.y, centerLat, centerLng));
                if (out.length >= 2) {
                    outPaths.push(out);
                }
            }
        }

        return outPaths.length ? outPaths : null;
    }

    if (geometryType === 'esriGeometryPolygon') {
        const rings = (Array.isArray(latLngs) && latLngs.length && Array.isArray(latLngs[0]) && typeof latLngs[0][0] === 'number')
            ? [latLngs]
            : (Array.isArray(latLngs) ? latLngs : []);

        const clipPoly = getCirclePolygonXY(radiusMeters);
        const outRings = [];
        for (const ring of rings) {
            const subject = normalizeRingXY(ring
                .filter(p => Array.isArray(p) && p.length === 2 && typeof p[0] === 'number' && typeof p[1] === 'number')
                .map(([lat, lng]) => projectLatLngToLocalMeters(lat, lng, centerLat, centerLng))
            );
            const clipped = clipPolygonRingToConvexPolygonXY(subject, clipPoly);
            if (clipped.length >= 3) {
                outRings.push(clipped.map(p => unprojectLocalMetersToLatLng(p.x, p.y, centerLat, centerLng)));
            }
        }

        return outRings.length ? outRings : null;
    }

    return null;
}

function centroidOfLatLngs(latLngs) {
    const flatten = (x) => {
        if (!x) return [];
        if (Array.isArray(x) && x.length === 2 && typeof x[0] === 'number' && typeof x[1] === 'number') {
            return [x];
        }
        if (Array.isArray(x)) {
            return x.flatMap(flatten);
        }
        return [];
    };
    const pts = flatten(latLngs);
    if (!pts.length) {
        return null;
    }
    const sum = pts.reduce((acc, [lat, lng]) => ({ lat: acc.lat + lat, lng: acc.lng + lng }), { lat: 0, lng: 0 });
    return [sum.lat / pts.length, sum.lng / pts.length];
}

// Calculate distance between two points in miles
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 3959; // Earth's radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Check if location is within radius
function isWithinRadius(lat, lng) {
    const distance = calculateDistance(
        SAN_GABRIEL_VALLEY.lat, 
        SAN_GABRIEL_VALLEY.lng, 
        lat, 
        lng
    );
    return distance <= SAN_GABRIEL_VALLEY.radius;
}

// Parse URL parameters for custom markers
function addCustomMarkersFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    const markerParam = urlParams.get('marker');
    
    if (markerParam) {
        try {
            // Expected format: lat,lng,label or multiple markers separated by semicolon
            const markers = markerParam.split(';');
            markers.forEach(markerStr => {
                const parts = markerStr.split(',');
                if (parts.length >= 2) {
                    const lat = parseFloat(parts[0]);
                    const lng = parseFloat(parts[1]);
                    const label = parts[2] || 'Custom Location';
                    
                    if (!isNaN(lat) && !isNaN(lng)) {
                        if (!isWithinRadius(lat, lng)) {
                            return;
                        }
                        addCustomMarker(lat, lng, label);
                    }
                }
            });
        } catch (error) {
            console.error('Error parsing custom markers:', error);
        }
    }
}

// Add a custom marker
function addCustomMarker(lat, lng, label) {
    const marker = L.marker([lat, lng], {
        icon: L.divIcon({
            className: 'custom-marker',
            iconSize: [20, 20]
        })
    }).addTo(map);
    
    marker.bindPopup(`
        <div class="popup-title">${label}</div>
        <div class="popup-info"><strong>Location:</strong> ${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
    `);
    
    customMarkers.push(marker);
}

// Fetch outage data from SCE
async function fetchOutageData() {
    try {
        setActiveDataSourceLabel('Loading…');

        const circle = getSgvCircleQuery();

        // Preferred: the same ArcGIS endpoints used by SCE's outage-center page.
        const preferredEndpoints = [
            buildArcgisCircleQueryUrl(DATA_SOURCES.arcgis.outagesQueryUrl, {
                where: "UPPER(Status)='ACTIVE'",
                outFields: 'OBJECTID,OanNo,IncidentId,NoOfAffectedCust_Inci,CityName,CountyName,ERT,OutageStartDateTime,IncidentType,ProblemCode,JobStatus,Status',
                center: circle.center,
                radiusMeters: circle.radiusMeters
            }),
            buildArcgisCircleQueryUrl(DATA_SOURCES.arcgis.majorOutagesQueryUrl, {
                where: 'MacroId > 0',
                outFields: '*',
                center: circle.center,
                radiusMeters: circle.radiusMeters
            })
        ];

        // Legacy/fallback endpoints
        const endpointsToTry = [...preferredEndpoints, ...DATA_SOURCES.fallback];

        // Attempt to fetch live data from SCE's outage endpoints
        const endpoints = DATA_SOURCES.useCorsProxy
            ? endpointsToTry.map(url => DATA_SOURCES.corsProxy + encodeURIComponent(url))
            : endpointsToTry;
        
        for (const endpoint of endpoints) {
            try {
                console.log(`Attempting to fetch from: ${endpoint}`);
                const response = await fetch(endpoint, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    console.log('Successfully fetched data:', data);
                    const parsed = parseOutageData(data);
                    if (parsed && parsed.length > 0) {
                        setActiveDataSourceLabel(labelForSuccessfulEndpoint(endpoint));
                        return parsed;
                    }
                }
            } catch (err) {
                console.log(`Failed to fetch from ${endpoint}:`, err.message);
            }
        }
        
        // If all API attempts fail, fall back to mock data
        console.warn('Could not fetch live data from any source, using mock data');
        setActiveDataSourceLabel('Mock: Generated demo data');
        return generateMockOutageData();
    } catch (error) {
        console.error('Error fetching outage data:', error);
        setActiveDataSourceLabel('Mock: Generated demo data');
        return generateMockOutageData();
    }
}

// Parse outage data from SCE API response
function parseOutageData(data) {
    const outages = [];

    // ArcGIS FeatureServer format (used by SCE outage-center page)
    if (data && Array.isArray(data.features)) {
        data.features.forEach(feature => {
            const geometry = feature?.geometry;
            const attributes = feature?.attributes || {};

            if (!geometry) {
                return;
            }

            let lat;
            let lng;
            let polygon = null;
            let isPolygon = false;

            if (typeof geometry.x === 'number' && typeof geometry.y === 'number') {
                lng = geometry.x;
                lat = geometry.y;
            } else if (Array.isArray(geometry.rings) && geometry.rings[0] && geometry.rings[0].length) {
                isPolygon = true;
                const ring = geometry.rings[0];
                // Leaflet expects [lat, lng]
                polygon = ring.map(([x, y]) => [y, x]);

                // Simple centroid approximation (average of vertices)
                const centroid = ring.reduce(
                    (acc, [x, y]) => ({
                        latSum: acc.latSum + y,
                        lngSum: acc.lngSum + x,
                        count: acc.count + 1
                    }),
                    { latSum: 0, lngSum: 0, count: 0 }
                );

                if (centroid.count > 0) {
                    lat = centroid.latSum / centroid.count;
                    lng = centroid.lngSum / centroid.count;
                }
            }

            if (typeof lat !== 'number' || typeof lng !== 'number') {
                return;
            }

            // Clip polygons to the circle; keep if any part intersects.
            if (isPolygon && Array.isArray(polygon) && polygon.length) {
                const circle = getSgvCircleQuery();
                const clipped = clipLatLngsToCircle(polygon, {
                    centerLat: circle.center.lat,
                    centerLng: circle.center.lng,
                    radiusMeters: circle.radiusMeters,
                    geometryType: 'esriGeometryPolygon'
                });
                if (!clipped || !clipped[0] || clipped[0].length < 3) {
                    return;
                }
                polygon = clipped[0];
                const c = centroidOfLatLngs(polygon);
                if (c) {
                    lat = c[0];
                    lng = c[1];
                }
            } else {
                // Points must be inside the radius.
                if (!isWithinRadius(lat, lng)) {
                    return;
                }
            }

            const customersAffected =
                attributes.NoOfAffectedCust_Inci ??
                attributes.CustomersAffected ??
                attributes.CustomersAffectedCount ??
                0;

            const region =
                attributes.CityName ||
                attributes.CountyName ||
                attributes.district ||
                attributes.County ||
                getRegionName(lat, lng);

            const estimatedRestoration =
                attributes.ERT ||
                attributes.EstimatedRestorationTime ||
                'Unknown';

            const cause =
                attributes.IncidentType ||
                attributes.OutageType ||
                attributes.ProblemCode ||
                'Under investigation';

            outages.push({
                id: attributes.OanNo || attributes.IncidentId || attributes.OBJECTID || `outage-${outages.length}`,
                lat,
                lng,
                customersAffected,
                region,
                estimatedRestoration,
                cause,
                isPolygon,
                polygon
            });
        });

        return outages;
    }
    
    // Handle different possible data structures from SCE
    if (data.outages && Array.isArray(data.outages)) {
        data.outages.forEach(outage => {
            if (outage.latitude && outage.longitude) {
                const lat = parseFloat(outage.latitude);
                const lng = parseFloat(outage.longitude);
                
                if (isWithinRadius(lat, lng)) {
                    outages.push({
                        id: outage.id || `outage-${outages.length}`,
                        lat: lat,
                        lng: lng,
                        customersAffected: outage.customersAffected || outage.numCustomers || 0,
                        region: outage.region || outage.area || getRegionName(lat, lng),
                        estimatedRestoration: outage.estimatedRestoration || 'Unknown',
                        cause: outage.cause || outage.outageType || 'Under investigation',
                        isPolygon: outage.polygon || outage.area,
                        polygon: outage.polygon
                    });
                }
            }
        });
    } else if (data.file_data && Array.isArray(data.file_data)) {
        // Kubra API format
        data.file_data.forEach(item => {
            if (item.geom && item.geom.coordinates) {
                const coords = item.geom.coordinates;
                let lat, lng;
                
                if (item.geom.type === 'Point') {
                    lng = coords[0];
                    lat = coords[1];
                } else if (item.geom.type === 'Polygon' && coords[0] && coords[0][0]) {
                    // Use first vertex for a quick location check, but also strictly ensure all vertices are within the circle.
                    lng = coords[0][0][0];
                    lat = coords[0][0][1];
                }

                let polygonLatLngs = item.geom.type === 'Polygon' && coords[0]
                    ? coords[0].map(c => [c[1], c[0]])
                    : null;

                if (item.geom.type === 'Polygon' && polygonLatLngs && polygonLatLngs.length) {
                    const circle = getSgvCircleQuery();
                    const clipped = clipLatLngsToCircle(polygonLatLngs, {
                        centerLat: circle.center.lat,
                        centerLng: circle.center.lng,
                        radiusMeters: circle.radiusMeters,
                        geometryType: 'esriGeometryPolygon'
                    });
                    if (!clipped || !clipped[0] || clipped[0].length < 3) {
                        return;
                    }
                    polygonLatLngs = clipped[0];
                    const c = centroidOfLatLngs(polygonLatLngs);
                    if (c) {
                        lat = c[0];
                        lng = c[1];
                    }
                }

                // Points must be inside the radius; polygons are already clipped.
                if (item.geom.type === 'Point' && !(lat && lng && isWithinRadius(lat, lng))) {
                    return;
                }

                if (lat && lng) {
                    outages.push({
                        id: item.id || `outage-${outages.length}`,
                        lat: lat,
                        lng: lng,
                        customersAffected: item.desc?.n_out || item.customers_out || 0,
                        region: item.desc?.name || getRegionName(lat, lng),
                        estimatedRestoration: item.desc?.etr || 'Unknown',
                        cause: item.desc?.cause || 'Under investigation',
                        isPolygon: item.geom.type === 'Polygon',
                        polygon: item.geom.type === 'Polygon' ? polygonLatLngs : null
                    });
                }
            }
        });
    }

    return outages;
}

function areAllLatLngsWithinRadius(latLngs) {
    if (!latLngs) {
        return false;
    }

    // Accept:
    // - [lat, lng]
    // - [[lat,lng], ...]
    // - [[[lat,lng], ...], ...] (rings / multi)
    if (Array.isArray(latLngs) && latLngs.length === 2 && typeof latLngs[0] === 'number' && typeof latLngs[1] === 'number') {
        return isWithinRadius(latLngs[0], latLngs[1]);
    }

    if (!Array.isArray(latLngs)) {
        return false;
    }

    for (const child of latLngs) {
        if (!areAllLatLngsWithinRadius(child)) {
            return false;
        }
    }

    return true;
}

// Generate mock outage data for demonstration
function generateMockOutageData() {
    const mockOutages = [];
    const MIN_MOCK_OUTAGES = 3;
    const MAX_MOCK_OUTAGES = 10;
    const targetOutages = Math.floor(Math.random() * (MAX_MOCK_OUTAGES - MIN_MOCK_OUTAGES + 1)) + MIN_MOCK_OUTAGES;
    
    // Generate outages within the radius
    let attempts = 0;
    const maxAttempts = targetOutages * 3; // Prevent infinite loops
    
    while (mockOutages.length < targetOutages && attempts < maxAttempts) {
        attempts++;
        
        // Generate random locations within the San Gabriel Valley area
        const latOffset = (Math.random() - 0.5) * 0.5;
        const lngOffset = (Math.random() - 0.5) * 0.5;
        const lat = SAN_GABRIEL_VALLEY.lat + latOffset;
        const lng = SAN_GABRIEL_VALLEY.lng + lngOffset;
        
        if (isWithinRadius(lat, lng)) {
            const customersAffected = Math.floor(Math.random() * 500) + 10;
            const isPolygon = Math.random() > 0.5;
            
            const outage = {
                id: `outage-${mockOutages.length}`,
                lat: lat,
                lng: lng,
                customersAffected: customersAffected,
                region: getRegionName(lat, lng),
                estimatedRestoration: getRandomFutureTime(),
                cause: getRandomCause(),
                isPolygon: isPolygon
            };
            
            if (isPolygon) {
                outage.polygon = generatePolygonAroundPoint(lat, lng);
            }
            
            mockOutages.push(outage);
        }
    }
    
    return mockOutages;
}

// Generate a polygon around a point
function generatePolygonAroundPoint(lat, lng) {
    const numPoints = 6;
    const radiusInDegrees = 0.01;
    const points = [];
    
    for (let i = 0; i < numPoints; i++) {
        const angle = (i / numPoints) * 2 * Math.PI;
        const pointLat = lat + radiusInDegrees * Math.sin(angle);
        const pointLng = lng + radiusInDegrees * Math.cos(angle);
        points.push([pointLat, pointLng]);
    }
    
    return points;
}

// Get region name based on coordinates
function getRegionName(lat, lng) {
    const regions = [
        'Pasadena', 'Arcadia', 'Monrovia', 'Azusa', 'Covina',
        'West Covina', 'El Monte', 'San Gabriel', 'Temple City', 
        'Rosemead', 'Alhambra', 'San Marino', 'South Pasadena'
    ];
    return regions[Math.floor(Math.random() * regions.length)];
}

// Get random future time for restoration
function getRandomFutureTime() {
    const now = new Date();
    const hoursToAdd = Math.floor(Math.random() * 8) + 1;
    const futureTime = new Date(now.getTime() + hoursToAdd * 60 * 60 * 1000);
    return futureTime.toLocaleString();
}

// Get random outage cause
function getRandomCause() {
    const causes = [
        'Equipment failure',
        'Weather conditions',
        'Vehicle accident',
        'Tree contact',
        'Under investigation',
        'Planned maintenance'
    ];
    return causes[Math.floor(Math.random() * causes.length)];
}

// Clear existing markers and polygons
function clearOutages() {
    outageMarkers.forEach(marker => map.removeLayer(marker));
    outagePolygons.forEach(polygon => map.removeLayer(polygon));
    outageMarkers = [];
    outagePolygons = [];
}

// Display outages on the map
function displayOutages(outages) {
    clearOutages();
    
    let totalCustomers = 0;
    const regions = new Set();
    
    outages.forEach(outage => {
        totalCustomers += outage.customersAffected;
        regions.add(outage.region);
        
        // Add point marker
        const marker = L.marker([outage.lat, outage.lng], {
            icon: L.divIcon({
                className: 'outage-marker',
                iconSize: [20, 20]
            })
        }).addTo(map);
        
        marker.bindPopup(`
            <div class="popup-title">Power Outage</div>
            <div class="popup-info"><strong>Region:</strong> ${outage.region}</div>
            <div class="popup-info"><strong>Customers Affected:</strong> ${outage.customersAffected}</div>
            <div class="popup-info"><strong>Cause:</strong> ${outage.cause}</div>
            <div class="popup-info"><strong>Est. Restoration:</strong> ${outage.estimatedRestoration}</div>
        `);
        
        outageMarkers.push(marker);
        
        // Add polygon if available
        if (outage.isPolygon && outage.polygon) {
            const polygon = L.polygon(outage.polygon, {
                color: '#dc3545',
                fillColor: '#dc3545',
                fillOpacity: 0.5,
                weight: 2
            }).addTo(map);
            
            polygon.bindPopup(`
                <div class="popup-title">Affected Area: ${outage.region}</div>
                <div class="popup-info"><strong>Customers Affected:</strong> ${outage.customersAffected}</div>
            `);
            
            outagePolygons.push(polygon);
        }
    });
    
    // Update statistics
    updateStats(outages.length, totalCustomers, regions.size);
}

// Update statistics display
function updateStats(outageCount, customerCount, regionCount) {
    document.getElementById('outage-count').textContent = outageCount;
    document.getElementById('customer-count').textContent = customerCount.toLocaleString();
    document.getElementById('region-count').textContent = regionCount;
    
    const now = new Date();
    const timeString = now.toLocaleTimeString();
    document.getElementById('last-updated').textContent = timeString;
}

// Update outage data
async function updateOutageData() {
    try {
        const outages = await fetchOutageData();
        displayOutages(outages);
    } catch (error) {
        console.error('Error updating outage data:', error);
        setActiveDataSourceLabel('Error: Unable to load data');
    }
}

// Initialize the application
function init() {
    initMap();
    initDrpepLayers();
    updateOutageData();
    
    // Set up auto-refresh
    setInterval(updateOutageData, REFRESH_INTERVAL);
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
