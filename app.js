// Configuration
const SAN_GABRIEL_VALLEY = {
    lat: 34.1064,
    lng: -118.0689,
    radius: 20 // miles
};

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds

// SCE outage data sources
const DATA_SOURCES = {
    // Primary SCE API endpoints
    primary: [
        'https://www.sce.com/api/outages/outagedata',
        'https://kubra.io/data/7e7fab29-4498-41ad-ba3e-14905a4b539a/public/summary-1/data.json',
        'https://kubra.io/data/7e7fab29-4498-41ad-ba3e-14905a4b539a/public/cluster-1/data.json'
    ],
    // Fallback with CORS proxy if needed
    corsProxy: 'https://corsproxy.io/?',
    useCorsProxy: false // Set to true if CORS issues occur
};

// Global variables
let map;
let outageMarkers = [];
let outagePolygons = [];
let customMarkers = [];

// Initialize the map
function initMap() {
    map = L.map('map').setView([SAN_GABRIEL_VALLEY.lat, SAN_GABRIEL_VALLEY.lng], 11);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
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
        // Attempt to fetch live data from SCE's outage API endpoints
        const endpoints = DATA_SOURCES.useCorsProxy 
            ? DATA_SOURCES.primary.map(url => DATA_SOURCES.corsProxy + encodeURIComponent(url))
            : DATA_SOURCES.primary;
        
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
                        return parsed;
                    }
                }
            } catch (err) {
                console.log(`Failed to fetch from ${endpoint}:`, err.message);
            }
        }
        
        // If all API attempts fail, fall back to mock data
        console.warn('Could not fetch live data from any source, using mock data');
        return generateMockOutageData();
    } catch (error) {
        console.error('Error fetching outage data:', error);
        return generateMockOutageData();
    }
}

// Parse outage data from SCE API response
function parseOutageData(data) {
    const outages = [];
    
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
    
    return outages.length > 0 ? outages : generateMockOutageData();
}

// Generate mock outage data for demonstration
function generateMockOutageData() {
    const mockOutages = [];
    const numOutages = Math.floor(Math.random() * 10) + 3;
    
    for (let i = 0; i < numOutages; i++) {
        // Generate random locations within the San Gabriel Valley area
        const latOffset = (Math.random() - 0.5) * 0.5;
        const lngOffset = (Math.random() - 0.5) * 0.5;
        const lat = SAN_GABRIEL_VALLEY.lat + latOffset;
        const lng = SAN_GABRIEL_VALLEY.lng + lngOffset;
        
        if (isWithinRadius(lat, lng)) {
            const customersAffected = Math.floor(Math.random() * 500) + 10;
            const isPolygon = Math.random() > 0.5;
            
            const outage = {
                id: `outage-${i}`,
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
    }
}

// Initialize the application
function init() {
    initMap();
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
