export let map;
let _hoverPanSuppressed = false;

// We will attach these handlers from app.js
export let onMapMoveEnd = () => {};
export let onMapZoomEnd = () => {};
export let onMapClick = () => {};
export let onMarkerHover = () => {};
export let onMarkerClick = () => {};

export function setMapHandlers(handlers) {
  if (handlers.onMapMoveEnd) onMapMoveEnd = handlers.onMapMoveEnd;
  if (handlers.onMapZoomEnd) onMapZoomEnd = handlers.onMapZoomEnd;
  if (handlers.onMapClick) onMapClick = handlers.onMapClick;
  if (handlers.onMarkerHover) onMarkerHover = handlers.onMarkerHover;
  if (handlers.onMarkerClick) onMarkerClick = handlers.onMarkerClick;
}

export function getHoverPanSuppressed() {
  return _hoverPanSuppressed;
}

export function setHoverPanSuppressed(val) {
  _hoverPanSuppressed = val;
}

export function initMap() {
  map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
    center: [120.9605, 23.6978],
    zoom: 8,
    attributionControl: false
  });

  map.addControl(new maplibregl.AttributionControl({
    compact: false,
    customAttribution: '&copy; OpenStreetMap & CartoDB'
  }), 'bottom-right');

  map.on('load', () => {
    // Add data source
    map.addSource('transactions', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: []
      },
      cluster: true,
      clusterMaxZoom: 18,
      clusterRadius: 40,
      clusterProperties: {
        totalPrice: ['+', ['get', 'price']],
        totalUnitPrice: ['+', ['get', 'unit_price']],
        totalCount: ['+', 1],
        validPriceCount: ['+', ['case', ['>', ['get', 'price'], 0], 1, 0]],
        validUnitPriceCount: ['+', ['case', ['>', ['get', 'unit_price'], 0], 1, 0]],
      }
    });

    // We'll add layers when data is updated
    attachMapEvents();
  });

  map.on('moveend', () => {
    onMapMoveEnd();
  });

  map.on('zoomend', () => {
    onMapZoomEnd();
  });

  map.on('click', (e) => {
    onMapClick(e);
  });
}

export function updateMapData(transactions, fitBounds = true, settings = null) {
  if (!map || !map.getSource('transactions')) return;

  const features = transactions
    .filter(tx => typeof tx.lat === 'number' && typeof tx.lng === 'number' && !isNaN(tx.lat) && !isNaN(tx.lng))
    .map(tx => {
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [tx.lng, tx.lat] },
      properties: {
        id: tx.id || tx.origIdx, // we'll assign origIdx in app.js
        price: tx.price || 0,
        unit_price: tx.unit_price_ping || 0,
        community_name: tx.community_name || '',
        address: tx.address || '',
        area_ping: tx.area_ping || 0,
        total_floors: tx.total_floors || 0,
        building_type: tx.building_type || '',
        date_raw: tx.date_raw || '',
        is_special: tx.is_special ? 1 : 0
      }
    };
  });

  const geojson = {
    type: 'FeatureCollection',
    features: features
  };

  map.getSource('transactions').setData(geojson);

  if (settings) {
    applyLayers(settings);
    applyClusterLayers(settings);
  }

  if (fitBounds && features.length > 0) {
    const bounds = new maplibregl.LngLatBounds();
    features.forEach(f => {
      bounds.extend(f.geometry.coordinates);
    });
    map.fitBounds(bounds, { padding: 40, maxZoom: 18 });
  }
}

// Color expressions for MapLibre
export function buildDualRingColorExpr(mode, thresholds) {
  // mode: 'total_price' or 'unit_price'
  // thresholds: [min, mid, max] (e.g. 500, 1750, 3000 for total)
  // map price from property

  const prop = mode === 'total_price' ? ['/', ['get', 'price'], 10000] : ['/', ['get', 'unit_price'], 10000];

  const minColor = 'hsl(155, 55%, 38%)'; // green
  const maxColor = 'hsl(0, 65%, 48%)';   // red

  // 0 -> gray
  return [
    'case',
    ['<=', ['get', mode === 'total_price' ? 'price' : 'unit_price'], 0], '#aaaaaa',
    [
      'interpolate',
      ['linear'],
      prop,
      thresholds[0], minColor,
      thresholds[2], maxColor
    ]
  ];
}

export function buildBivariateColorExpr(unitQ, totalQ) {
  // X = unit_price (cyan), Y = total_price (magenta)
  // unitQ: [25, 40, 60], totalQ: [800, 1500, 2500]

  const u = ['/', ['get', 'unit_price'], 10000];
  const p = ['/', ['get', 'price'], 10000];

  const xi = [
    'case',
    ['<=', u, unitQ[0]], 0,
    ['<=', u, unitQ[1]], 1,
    ['<=', u, unitQ[2]], 2,
    3
  ];

  const yi = [
    'case',
    ['<=', p, totalQ[0]], 0,
    ['<=', p, totalQ[1]], 1,
    ['<=', p, totalQ[2]], 2,
    3
  ];

  // Combine into a single index 0-15: xi + yi * 4
  const idx = ['+', xi, ['*', yi, 4]];

  return [
    'match', idx,
    0, '#e8f4f8',  1, '#b1dce5',  2, '#6bc5d2',  3, '#1fa5b5',  // y=0
    4, '#d4b9d5',  5, '#a8a6c8',  6, '#7a8dba',  7, '#4f6dac',  // y=1
    8, '#c085be',  9, '#9e72b0', 10, '#8555a2', 11, '#5e3794',  // y=2
   12, '#8b3a8b', 13, '#7a2d7a', 14, '#6a206a', 15, '#5a135a',  // y=3
    '#aaaaaa'
  ];
}

export function applyLayers(settings) {
  if (!map || !map.getStyle()) return;

  const isBivariate = settings.bubbleMode === 'bivariate';

  const pointOuterExpr = isBivariate
    ? buildBivariateColorExpr(settings.bivUnitQ, settings.bivTotalQ)
    : buildDualRingColorExpr(settings.outerMode, settings.outerMode === 'total_price' ? settings.totalThresholds : settings.unitThresholds);

  const pointInnerExpr = isBivariate
    ? 'rgba(0,0,0,0)' // hide inner circle in bivariate
    : buildDualRingColorExpr(settings.innerMode, settings.innerMode === 'total_price' ? settings.totalThresholds : settings.unitThresholds);

  // Remove existing layers
  ['unclustered-point-outer', 'unclustered-point-inner', 'unclustered-label'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });

  // Unclustered Point Outer
  map.addLayer({
    id: 'unclustered-point-outer',
    type: 'circle',
    source: 'transactions',
    filter: ['!', ['has', 'point_count']],
    paint: {
      'circle-color': pointOuterExpr,
      'circle-radius': 21,
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.9)'
    }
  });

  // Unclustered Point Inner (only for dual ring)
  if (!isBivariate) {
    map.addLayer({
      id: 'unclustered-point-inner',
      type: 'circle',
      source: 'transactions',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': pointInnerExpr,
        'circle-radius': 15.5,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.5)'
      }
    });
  }

  // Label formatting
  const priceFormatExpr = [
    'let', 'p', ['/', ['get', 'price'], 10000],
    [
      'case',
      ['>=', ['var', 'p'], 10000], ['concat', ['to-string', ['round', ['/', ['var', 'p'], 1000]]], '億'], // Rough appx for 1 decimal
      ['>=', ['var', 'p'], 1], ['concat', ['to-string', ['round', ['var', 'p']]], '萬'],
      '-'
    ]
  ];

  // Unclustered Label
  map.addLayer({
    id: 'unclustered-label',
    type: 'symbol',
    source: 'transactions',
    filter: ['!', ['has', 'point_count']],
    layout: {
      'text-field': priceFormatExpr,
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': 10,
      'text-offset': [0, 0] // Centered
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.25)',
      'text-halo-width': 0.8
    }
  });

}

export function applyClusterLayers(settings) {
  if (!map || !map.getStyle()) return;

  const isBivariate = settings.bubbleMode === 'bivariate';

  // Calculate average properties for clusters, avoiding division by zero
  const avgPrice = ['case', ['==', ['get', 'validPriceCount'], 0], 0, ['/', ['get', 'totalPrice'], ['get', 'validPriceCount']]];
  const avgUnitPrice = ['case', ['==', ['get', 'validUnitPriceCount'], 0], 0, ['/', ['get', 'totalUnitPrice'], ['get', 'validUnitPriceCount']]];

  // We need to build expressions similar to base points but using averages
  const pointOuterExpr = isBivariate
    ? buildBivariateColorExprCluster(settings.bivUnitQ, settings.bivTotalQ, avgUnitPrice, avgPrice)
    : buildDualRingColorExprCluster(settings.outerMode, settings.outerMode === 'total_price' ? settings.totalThresholds : settings.unitThresholds, avgPrice, avgUnitPrice);

  const pointInnerExpr = isBivariate
    ? 'rgba(0,0,0,0)'
    : buildDualRingColorExprCluster(settings.innerMode, settings.innerMode === 'total_price' ? settings.totalThresholds : settings.unitThresholds, avgPrice, avgUnitPrice);

  // Remove existing cluster layers
  ['cluster-outer', 'cluster-inner', 'cluster-count', 'cluster-price'].forEach(id => {
    if (map.getLayer(id)) map.removeLayer(id);
  });

  // Calculate radius based on count (like in iconCreateFn)
  const radiusExpr = [
    'step',
    ['get', 'point_count'],
    22,   // < 10
    10, 24, // >= 10
    30, 27, // >= 30
    100, 30 // >= 100
  ];

  // Outer cluster ring
  map.addLayer({
    id: 'cluster-outer',
    type: 'circle',
    source: 'transactions',
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': pointOuterExpr,
      'circle-radius': radiusExpr,
      'circle-stroke-width': 2,
      'circle-stroke-color': 'rgba(255,255,255,0.9)'
    }
  });

  // Inner cluster ring
  if (!isBivariate) {
    map.addLayer({
      id: 'cluster-inner',
      type: 'circle',
      source: 'transactions',
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': pointInnerExpr,
        'circle-radius': ['-', radiusExpr, 5.5],
        'circle-stroke-width': 1.5,
        'circle-stroke-color': 'rgba(255,255,255,0.5)'
      }
    });
  }

  // Label formatting for cluster price (line 1)
  const clusterPriceFormatExpr = [
    'let', 'p', ['/', avgPrice, 10000],
    [
      'case',
      ['>=', ['var', 'p'], 10000], ['concat', ['to-string', ['round', ['/', ['var', 'p'], 1000]]], '億'],
      ['>=', ['var', 'p'], 1], ['concat', ['to-string', ['round', ['var', 'p']]], '萬'],
      ['concat', ['to-string', ['get', 'point_count']], '筆'] // Fallback if no valid price
    ]
  ];

  // Line 1: Price
  map.addLayer({
    id: 'cluster-price',
    type: 'symbol',
    source: 'transactions',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': clusterPriceFormatExpr,
      'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
      'text-size': ['step', ['get', 'point_count'], 10, 30, 11],
      'text-offset': [0, -0.4]
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': 'rgba(0,0,0,0.25)',
      'text-halo-width': 0.8
    }
  });

  // Line 2: Count
  map.addLayer({
    id: 'cluster-count',
    type: 'symbol',
    source: 'transactions',
    filter: ['has', 'point_count'],
    layout: {
      'text-field': ['concat', ['to-string', ['get', 'point_count']], '筆'],
      'text-font': ['Open Sans Semibold', 'Arial Unicode MS Regular'],
      'text-size': ['step', ['get', 'point_count'], 8, 30, 9],
      'text-offset': [0, 0.7]
    },
    paint: {
      'text-color': 'rgba(255,255,255,0.95)',
      'text-halo-color': 'rgba(0,0,0,0.2)',
      'text-halo-width': 0.6
    }
  });
}

function buildDualRingColorExprCluster(mode, thresholds, avgPrice, avgUnitPrice) {
  const prop = mode === 'total_price' ? ['/', avgPrice, 10000] : ['/', avgUnitPrice, 10000];
  const minColor = 'hsl(155, 55%, 38%)';
  const maxColor = 'hsl(0, 65%, 48%)';
  return [
    'case',
    ['<=', prop, 0], '#aaaaaa',
    [
      'interpolate',
      ['linear'],
      prop,
      thresholds[0], minColor,
      thresholds[2], maxColor
    ]
  ];
}

function buildBivariateColorExprCluster(unitQ, totalQ, avgUnitPrice, avgPrice) {
  const u = ['/', avgUnitPrice, 10000];
  const p = ['/', avgPrice, 10000];

  const xi = [
    'case',
    ['<=', u, unitQ[0]], 0,
    ['<=', u, unitQ[1]], 1,
    ['<=', u, unitQ[2]], 2,
    3
  ];

  const yi = [
    'case',
    ['<=', p, totalQ[0]], 0,
    ['<=', p, totalQ[1]], 1,
    ['<=', p, totalQ[2]], 2,
    3
  ];

  const idx = ['+', xi, ['*', yi, 4]];
  return [
    'match', idx,
    0, '#e8f4f8',  1, '#b1dce5',  2, '#6bc5d2',  3, '#1fa5b5',
    4, '#d4b9d5',  5, '#a8a6c8',  6, '#7a8dba',  7, '#4f6dac',
    8, '#c085be',  9, '#9e72b0', 10, '#8555a2', 11, '#5e3794',
   12, '#8b3a8b', 13, '#7a2d7a', 14, '#6a206a', 15, '#5a135a',
    '#aaaaaa'
  ];
}

export function attachMapEvents() {
  if (!map) return;

  // Hover events for base points
  map.on('mouseenter', 'unclustered-point-outer', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0) {
      onMarkerHover(e.features[0].properties);
    }
  });

  map.on('mouseleave', 'unclustered-point-outer', () => {
    map.getCanvas().style.cursor = '';
    onMarkerHover(null);
  });

  // Click event for base points
  map.on('click', 'unclustered-point-outer', (e) => {
    if (e.features.length > 0) {
      onMarkerClick('point', e.features[0].properties);
    }
  });

  // Hover events for clusters
  map.on('mouseenter', 'cluster-outer', (e) => {
    map.getCanvas().style.cursor = 'pointer';
    if (e.features.length > 0) {
      onMarkerHover({
        isCluster: true,
        count: e.features[0].properties.point_count,
        cluster_id: e.features[0].properties.cluster_id
      });
    }
  });

  map.on('mouseleave', 'cluster-outer', () => {
    map.getCanvas().style.cursor = '';
    onMarkerHover(null);
  });

  // Click event for clusters (spiderfy or zoom)
  map.on('click', 'cluster-outer', (e) => {
    if (e.features.length > 0) {
      const clusterId = e.features[0].properties.cluster_id;
      const point_count = e.features[0].properties.point_count;
      const clusterSource = map.getSource('transactions');

      clusterSource.getClusterExpansionZoom(clusterId, (err, zoom) => {
        if (err) return;

        const coordinates = e.features[0].geometry.coordinates;

        // If we are already at high zoom, get leaves and show list
        if (map.getZoom() >= 17 || zoom > 18) {
           clusterSource.getClusterLeaves(clusterId, point_count, 0, (err, leaves) => {
              if (err) return;
              const mappedLeaves = leaves.map(l => l.properties);
              onMarkerClick('cluster', mappedLeaves);
           });
        } else {
          // Otherwise, just zoom in
          setHoverPanSuppressed(true);
          map.easeTo({
            center: coordinates,
            zoom: zoom + 1
          });
          setTimeout(() => { setHoverPanSuppressed(false); }, 800);
        }
      });
    }
  });
}

export function updateMapHighlight(ids) {
  if (!map || !map.getSource('transactions')) return;
  // Use filter to visually highlight items based on ID
  // In MapLibre, we can achieve this with feature state or filters.
  // We'll update the filter on the unclustered layers to lower opacity of non-highlighted ones.
  if (ids && ids.length > 0) {
    const filter = ['in', ['get', 'id'], ['literal', ids]];
    ['unclustered-point-inner', 'unclustered-point-outer'].forEach(layer => {
      if (map.getLayer(layer)) {
         map.setPaintProperty(layer, 'circle-opacity', [
           'case', filter, 1, 0.2
         ]);
      }
    });
  } else {
    // Reset
    ['unclustered-point-inner', 'unclustered-point-outer'].forEach(layer => {
      if (map.getLayer(layer)) {
         map.setPaintProperty(layer, 'circle-opacity', 1);
      }
    });
  }
}
