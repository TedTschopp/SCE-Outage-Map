# SCE Outage Map - San Gabriel Valley

An interactive web application that tracks and displays Southern California Edison (SCE) power outages affecting the San Gabriel Valley area. The map shows real-time outage data within a 20-mile radius, visualizing outage locations as point markers and affected areas as polygons.

## Features

- **Interactive Map**: Displays outages within a 20-mile radius of San Gabriel Valley
- **Visual Markers**: Shows outage locations as point markers
- **Affected Areas**: Displays impacted regions as polygon overlays
- **Real-time Statistics**: 
  - Number of active outages
  - Total customers affected
  - Number of regions impacted
  - Last update timestamp
- **Custom Markers**: Add custom location markers via URL parameters
- **Auto-refresh**: Automatically updates every 5 minutes

## Usage

### Basic Usage

Simply open `index.html` in a web browser to view the outage map.

### Adding Custom Markers

You can add custom markers to the map by providing URL parameters:

```
index.html?marker=34.1478,-118.1445,My Home
```

**Format**: `?marker=latitude,longitude,label`

**Multiple Markers**: Separate multiple markers with semicolons:

```
index.html?marker=34.1478,-118.1445,Home;34.1064,-118.0689,Office
```

### Viewing Outage Details

Click on any marker or polygon to view detailed information about the outage, including:
- Region name
- Number of customers affected
- Outage cause
- Estimated restoration time

## Technical Details

### Dependencies

- **Leaflet.js** (v1.9.4): Open-source JavaScript library for interactive maps
- **OpenStreetMap**: Map tile provider

### File Structure

- `index.html`: Main HTML file with map container and UI
- `app.js`: JavaScript application logic
- `style.css`: Styling and layout
- `README.md`: Documentation

### Configuration

The San Gabriel Valley center point and radius can be configured in `app.js`:

```javascript
const SAN_GABRIEL_VALLEY = {
    lat: 34.1064,
    lng: -118.0689,
    radius: 20 // miles
};
```

The refresh interval can be adjusted:

```javascript
const REFRESH_INTERVAL = 5 * 60 * 1000; // milliseconds
```

## Development

### Local Testing

To test locally, you can use any local web server. For example:

Using Python:
```bash
python -m http.server 8000
```

Using Node.js:
```bash
npx http-server
```

Then navigate to `http://localhost:8000` in your browser.

### Data Source

The application attempts to fetch live outage data using the same backend data sources as SCE’s official outage page:

- <https://www.sce.com/outages-safety/outage-center/check-outage-status>

In practice, that page currently pulls outage data from ArcGIS FeatureServer endpoints. This app defaults to those ArcGIS endpoints (scoped to a bounding box around San Gabriel Valley to avoid transfer limits), and then falls back to older endpoints if needed.

If all attempts fail (e.g., due to CORS restrictions or API changes), the application falls back to mock data for demonstration purposes.

### DRPEP Polygon Overlays

The map also loads polygon-only overlays from SCE’s DRPEP portal:

- <https://drpep.sce.com/drpep/?page=Page>

These layers are discovered at runtime from the DRPEP ArcGIS `FeatureServer` services and rendered as Leaflet polygons (no point/line layers).

To disable DRPEP overlays entirely, set `DRPEP_SOURCES.enabled = false` in `app.js`.

#### Enabling CORS Proxy

If you encounter CORS issues when accessing the live API, you can enable the CORS proxy by editing `app.js`:

```javascript
const DATA_SOURCES = {
    // ... other config
    useCorsProxy: true  // Change to true
};
```

#### Using Custom Data Source

To use a different data source, modify `DATA_SOURCES.arcgis` (preferred) and/or `DATA_SOURCES.fallback` in `app.js`:

```javascript
const DATA_SOURCES = {
    arcgis: {
        outagesQueryUrl: 'https://your-custom-arcgis-server/.../query'
    },
    fallback: [
        'https://your-custom-api.com/outages'
    ],
    // ...
};
```

## Browser Compatibility

- Modern browsers with JavaScript enabled
- Tested on Chrome, Firefox, Safari, and Edge

## License

This project is open source and available for use.

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.
