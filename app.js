// Configuration
const SAN_GABRIEL_VALLEY = {
    lat: 34.1064,
    lng: -118.0689,
    radius: 20 // miles
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

// DRPEP (Distributed Resources Plan / Enhanced Plan) polygon layer sources
// These are ArcGIS FeatureServer services observed from https://drpep.sce.com/drpep/?page=Page
// We intentionally render polygons only (no point/line layers).
const DRPEP_SOURCES = {
    enabled: true,
    // A curated set of FeatureServer service roots used by DRPEP.
    // Each service may contain multiple sublayers; we discover polygon sublayers at runtime.
    services: [
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DDOR_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/LNBA_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/GNA_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DRP_PSPS_Layer/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/DRP_Transmission_Projects/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/AVL_LOAD_CAP_TOGGLE/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/AVL_LOAD_HEAT_MAP_TOGGLE/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/SUBTRANS_HEATMAP/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/LOAD_GROWTH_PEN_HTMAP/FeatureServer' },
        { label: 'DRPEP', url: 'https://drpep.sce.com/arcgis_server/rest/services/Hosted/ICA_Layer/FeatureServer' },

        // Public risk-area polygon layers also loaded by DRPEP (helpful context overlays)
        { label: 'SCE Public', url: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/SCE_HighFireRiskArea_PublicView/FeatureServer' },
        { label: 'SCE Public', url: 'https://services5.arcgis.com/z6hI6KRjKHvhNO0r/arcgis/rest/services/SCE_HHZ_Tier1_PublicView/FeatureServer' }
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

// Global variables
let map;
let outageMarkers = [];
let outagePolygons = [];
let customMarkers = [];

let drpepPolygonLayerGroup;
let drpepPolygonLayers = [];

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
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);

    // DRPEP overlays (polygons only)
    drpepPolygonLayerGroup = L.layerGroup().addTo(map);
    
    // Add a circle to show the 20-mile radius
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

function maybeProxyUrl(url) {
    return DATA_SOURCES.useCorsProxy ? DATA_SOURCES.corsProxy + encodeURIComponent(url) : url;
}

async function fetchJson(url) {
    const response = await fetch(maybeProxyUrl(url), {
        method: 'GET',
        headers: {
            'Accept': 'application/json'
        }
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
    }
    return response.json();
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

async function fetchArcgisFeaturesPaged(layerQueryUrl, { bbox, where = '1=1', outFields = 'OBJECTID', pageSize = 1000, maxFeatures = 5000 }) {
    const allFeatures = [];
    for (let offset = 0; offset < maxFeatures; offset += pageSize) {
        const url = buildArcgisQueryUrl(layerQueryUrl, {
            where,
            outFields,
            bbox,
            extraParams: {
                resultOffset: String(offset),
                resultRecordCount: String(pageSize)
            }
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

async function discoverDrpepPolygonLayers() {
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
                    if (layerInfo && layerInfo.geometryType === 'esriGeometryPolygon') {
                        discovered.push({
                            serviceLabel: service.label,
                            serviceUrl: service.url,
                            layerId: layer.id,
                            layerName: layerInfo.name || layer.name || `Layer ${layer.id}`
                        });
                    }
                } catch (e) {
                    // Skip layers that fail to describe (often auth-gated or transient).
                }
            }
        } catch (e) {
            // Skip services that fail to load.
        }
    }
    return discovered;
}

async function refreshDrpepPolygonOverlays() {
    if (!DRPEP_SOURCES.enabled || !map) {
        return;
    }

    if (!drpepPolygonLayerGroup) {
        drpepPolygonLayerGroup = L.layerGroup().addTo(map);
    }

    const bbox = getSgvBoundingBox4326();
    drpepPolygonLayerGroup.clearLayers();

    for (const layer of drpepPolygonLayers) {
        try {
            const layerQueryUrl = `${layer.serviceUrl}/${layer.layerId}/query`;
            const features = await fetchArcgisFeaturesPaged(layerQueryUrl, {
                bbox,
                where: '1=1',
                outFields: 'OBJECTID',
                pageSize: 1000,
                maxFeatures: 5000
            });

            for (const feature of features) {
                const rings = feature?.geometry?.rings;
                const latLngs = arcgisRingsToLeafletLatLngs(rings);
                if (!latLngs) {
                    continue;
                }

                const polygon = L.polygon(latLngs, {
                    color: '#007bff',
                    fillColor: '#007bff',
                    fillOpacity: 0.08,
                    weight: 1
                });

                polygon.bindPopup(`<div class="popup-title">${layer.displayName}</div>`);
                polygon.addTo(drpepPolygonLayerGroup);
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

    const polygonLayers = await discoverDrpepPolygonLayers();
    drpepPolygonLayers = polygonLayers.map(({ serviceLabel, serviceUrl, layerId, layerName }) => ({
        displayName: `${serviceLabel}: ${layerName}`,
        serviceUrl,
        layerId
    }));

    await refreshDrpepPolygonOverlays();
}

// Convert miles to meters
function milesToMeters(miles) {
    return miles * 1609.34;
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

        const bbox = getBoundingBoxForRadiusMiles(
            SAN_GABRIEL_VALLEY.lat,
            SAN_GABRIEL_VALLEY.lng,
            SAN_GABRIEL_VALLEY.radius
        );

        // Preferred: the same ArcGIS endpoints used by SCE's outage-center page.
        const preferredEndpoints = [
            buildArcgisQueryUrl(DATA_SOURCES.arcgis.outagesQueryUrl, {
                where: "UPPER(Status)='ACTIVE'",
                outFields: 'OBJECTID,OanNo,IncidentId,NoOfAffectedCust_Inci,CityName,CountyName,ERT,OutageStartDateTime,IncidentType,ProblemCode,JobStatus,Status',
                bbox
            }),
            buildArcgisQueryUrl(DATA_SOURCES.arcgis.majorOutagesQueryUrl, {
                where: 'MacroId > 0',
                outFields: '*',
                bbox
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

            if (!isWithinRadius(lat, lng)) {
                return;
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
                    // Use center of polygon
                    lng = coords[0][0][0];
                    lat = coords[0][0][1];
                }
                
                if (lat && lng && isWithinRadius(lat, lng)) {
                    outages.push({
                        id: item.id || `outage-${outages.length}`,
                        lat: lat,
                        lng: lng,
                        customersAffected: item.desc?.n_out || item.customers_out || 0,
                        region: item.desc?.name || getRegionName(lat, lng),
                        estimatedRestoration: item.desc?.etr || 'Unknown',
                        cause: item.desc?.cause || 'Under investigation',
                        isPolygon: item.geom.type === 'Polygon',
                        polygon: item.geom.type === 'Polygon' ? coords[0].map(c => [c[1], c[0]]) : null
                    });
                }
            }
        });
    }

    return outages;
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
                fillOpacity: 0.2,
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
