// map.js
import { API_BASE } from './api.js';

let map;
let locationMarker, locationCircle;
let _markerTooltipEl = null;
let clusterIndex = null;
let clusterIndexLoaded = false;
export let activeMarkers = [];
let _getSettingsMap = null;
let _showClusterListCallbackMap = null;

// Re-use logic for color mapping
const BIVARIATE_MATRIX = [
    ['#e8f4f8', '#d4b9d5', '#c085be', '#8b3a8b'],
    ['#b1dce5', '#a8a6c8', '#9e72b0', '#7a2d7a'],
    ['#6bc5d2', '#7a8dba', '#8555a2', '#6a206a'],
    ['#1fa5b5', '#4f6dac', '#5e3794', '#5a135a'],
];

function getBivariateQuartile(value, thresholds) {
    if (value <= thresholds[0]) return 0;
    if (value <= thresholds[1]) return 1;
    if (value <= thresholds[2]) return 2;
    return 3;
}

export function getBivariateColor(unitPriceWan, totalPriceWan, settings) {
    const q = settings.bivUnitQ || [25, 40, 60];
    const tq = settings.bivTotalQ || [800, 1500, 2500];
    const xi = getBivariateQuartile(unitPriceWan, q);
    const yi = getBivariateQuartile(totalPriceWan, tq);
    return BIVARIATE_MATRIX[xi][yi];
}

function priceColorGradient(value, lo, hi) {
    if (value <= 0) return '#aaa';
    if (value <= lo) return 'hsl(155,55%,38%)';
    if (value >= hi) return 'hsl(0,65%,48%)';
    const ratio = (value - lo) / (hi - lo);
    const hue = 155 - ratio * 155;
    const sat = 55 + ratio * 10;
    const light = 38 + ratio * 10;
    return `hsl(${Math.round(hue)},${Math.round(sat)}%,${Math.round(light)}%)`;
}

function getUnitPriceColor(wan, settings) { return priceColorGradient(wan, settings.unitThresholds[0], settings.unitThresholds[2]); }
function getTotalPriceColor(wan, settings) { return priceColorGradient(wan, settings.totalThresholds[0], settings.totalThresholds[2]); }
export function getColorForMode(mode, avgPriceWan, avgUnitWan, settings) {
    if (mode === 'total_price') return getTotalPriceColor(avgPriceWan, settings);
    return getUnitPriceColor(avgUnitWan, settings);
}

export function makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 }) {
    const cx = sz / 2, cy = sz / 2, outerR = sz / 2 - 1, ringW = Math.max(4, Math.floor(sz * 0.1)), innerR = outerR - ringW - 1.5;
    const hasTwo = line1 && line2, y1 = hasTwo ? cy - 4 : cy, y2 = cy + 7;
    const fs1 = sz >= 54 ? 11 : 10, fs2 = sz >= 54 ? 9 : 8;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">
    <circle cx="${cx}" cy="${cy}" r="${outerR}" fill="${outerColor}" stroke="rgba(255,255,255,.9)" stroke-width="2"/>
    <circle cx="${cx}" cy="${cy}" r="${innerR}" fill="${innerColor}" stroke="rgba(255,255,255,.5)" stroke-width="1.5"/>
    ${line1 ? `<text x="${cx}" y="${y1}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fs1}" font-weight="700" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.25)" stroke-width=".8">${line1}</text>` : ''}
    ${line2 ? `<text x="${cx}" y="${y2}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,.95)" font-size="${fs2}" font-weight="600" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.2)" stroke-width=".6">${line2}</text>` : ''}
  </svg>`;
}

export function makeBivariateSVG({ sz, color, line1, line2 }) {
    const cx = sz / 2, cy = sz / 2, r = sz / 2 - 1;
    const hasTwo = line1 && line2, y1 = hasTwo ? cy - 4 : cy, y2 = cy + 7;
    const fs1 = sz >= 54 ? 11 : 10, fs2 = sz >= 54 ? 9 : 8;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/>
    ${line1 ? `<text x="${cx}" y="${y1}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fs1}" font-weight="700" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.3)" stroke-width="1">${line1}</text>` : ''}
    ${line2 ? `<text x="${cx}" y="${y2}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,.9)" font-size="${fs2}" font-weight="600" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.2)" stroke-width=".6">${line2}</text>` : ''}
  </svg>`;
}

export const escHtml = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const escAttr = s => s ? String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;') : '';

function fmtAvgAreaMap(avgPing, settings) {
    if (settings.areaUnit === 'sqm') {
        const m2 = avgPing > 0 ? avgPing * 3.305785 : 0;
        return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
    }
    return avgPing > 0 ? avgPing.toFixed(1) + '坪' : '-';
}

function fmtBuildDate(raw, settings) {
    if (!raw) return '-';
    const s = String(raw).trim();
    if (s.length >= 5) { const y = settings.yearFormat === 'ce' ? parseInt(s.substring(0, 3), 10) + 1911 : parseInt(s.substring(0, 3), 10); return y + '/' + s.substring(3, 5); }
    return s || '-';
}

function formatDateStrMap(raw, settings) {
    if (!raw) return '-';
    const s = String(raw).trim();
    if (s.length >= 7) {
        const rocY = parseInt(s.substring(0, s.length - 4), 10);
        const mm = s.substring(s.length - 4, s.length - 2);
        const dd = s.substring(s.length - 2);
        if (settings.yearFormat === 'ce') return (rocY + 1911) + '/' + mm + '/' + dd;
        return rocY + '/' + mm + '/' + dd;
    }
    return s;
}


export function initMapInstance(getSettings, onMapMoveEnd, showClusterListCallback) {
    _getSettingsMap = getSettings;
    _showClusterListCallbackMap = showClusterListCallback;

    map = new maplibregl.Map({
        container: 'map',
        style: {
            version: 8,
            sources: {
                'carto-voyager': {
                    type: 'raster',
                    tiles: [
                        'https://a.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png',
                        'https://b.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png',
                        'https://c.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png',
                        'https://d.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}.png'
                    ],
                    tileSize: 256,
                    attribution: '&copy; OpenStreetMap & CartoDB'
                }
            },
            layers: [
                {
                    id: 'carto-voyager-layer',
                    type: 'raster',
                    source: 'carto-voyager',
                    minzoom: 0,
                    maxzoom: 22
                }
            ]
        },
        center: [120.9605, 23.6978],
        zoom: 8,
        minZoom: 4,
        maxZoom: 20,
        pitchWithRotate: false,
        dragRotate: false
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');

    clusterIndex = new Supercluster({
        radius: 40,
        maxZoom: 16,
        map: (props) => ({
            groupCount: props.groupCount || 1,
            sumPrice: props.avgPrice > 0 ? props.avgPrice * (props.groupCount || 1) : 0,
            sumUnitPrice: props.avgUnitPrice > 0 ? props.avgUnitPrice * (props.groupCount || 1) : 0,
            validP: props.avgPrice > 0 ? (props.groupCount || 1) : 0,
            validU: props.avgUnitPrice > 0 ? (props.groupCount || 1) : 0,
            labels: props.groupLabel ? [props.groupLabel] : []
        }),
        reduce: (accumulated, props) => {
            accumulated.groupCount += props.groupCount;
            accumulated.sumPrice += props.sumPrice;
            accumulated.sumUnitPrice += props.sumUnitPrice;
            accumulated.validP += props.validP;
            accumulated.validU += props.validU;
            if (props.labels) {
                for (let i = 0; i < props.labels.length; i++) {
                    if (accumulated.labels.indexOf(props.labels[i]) === -1) {
                        accumulated.labels.push(props.labels[i]);
                    }
                }
            }
        }
    });

    map.on('moveend', () => {
        updateMapMarkers();
        if (onMapMoveEnd) onMapMoveEnd();
    });

    return { map };
}

let _lastBouncingEls = [];
export function stopAllBounce() {
    _lastBouncingEls.forEach(el => { if (el) el.classList.remove('marker-bounce'); });
    _lastBouncingEls = [];
}
export function bounceElement(el) {
    stopAllBounce();
    el.classList.remove('marker-bounce'); void el.offsetWidth;
    el.classList.add('marker-bounce');
    _lastBouncingEls = [el];
}

export function hoverTxOnMap(idx, mapInstance, suppressPanCallback) {
    let targetMarker = null;
    for (let i = 0; i < activeMarkers.length; i++) {
        const items = activeMarkers[i].getGroupItems ? activeMarkers[i].getGroupItems() : activeMarkers[i]._groupItems;
        if (items && items.some(it => it.origIdx === idx)) {
            targetMarker = activeMarkers[i];
            break;
        }
    }
    if (!targetMarker) return;
    const ll = targetMarker.getLngLat();
    if (!mapInstance.getBounds().contains(ll)) {
        suppressPanCallback(true);
        mapInstance.flyTo({ center: ll, duration: 250 });
        setTimeout(() => { suppressPanCallback(false); }, 600);
    }
    const tryBounce = () => {
        const iconEl = targetMarker._icon; if (!iconEl) return;
        bounceElement(iconEl.firstElementChild || iconEl);
    };
    if (targetMarker._icon) tryBounce();
}

export function unhoverTxOnMap() {
    stopAllBounce(); hideMarkerTooltip();
}

export function hoverCommunityOnMap(name, mapInstance, suppressPanCallback) {
    stopAllBounce();
    document.getElementById('map').classList.add('hover-unblur');
    const matched = [];
    activeMarkers.forEach(layer => {
        const items = layer.getGroupItems ? layer.getGroupItems() : layer._groupItems;
        if (layer._groupLabel === name || (items && items.some(it => it.tx.community_name === name)))
            matched.push(layer);
    });
    if (matched.length === 0) return;
    const bounds = mapInstance.getBounds();
    const anyVisible = matched.some(m => m._icon && bounds.contains(m.getLngLat()));
    if (!anyVisible) {
        suppressPanCallback(true);
        mapInstance.flyTo({ center: matched[0].getLngLat(), duration: 300 });
        setTimeout(() => { suppressPanCallback(false); }, 600);
    }
    const first = matched.find(m => m._icon && bounds.contains(m.getLngLat())) || matched[0];
    const doBounce = () => { if (!first._icon) return; bounceElement(first._icon.firstElementChild || first._icon); };
    if (first._icon) doBounce(); else setTimeout(doBounce, 350);
}

export function unhoverCommunityOnMap() {
    stopAllBounce();
    document.getElementById('map').classList.remove('hover-unblur');
}

function showMarkerTooltip(marker, group, settings) {
    hideMarkerTooltip(); if (!marker._icon) return;
    const items = group.items || []; if (items.length === 0) return;
    const label = group.communityName || group.label || '';
    const years = items.map(({ tx }) => tx.date_raw ? formatDateStrMap(tx.date_raw, settings).split('/')[0] : '').filter(Boolean);
    const uniqueYears = [...new Set(years)].sort();
    const yearRange = uniqueYears.length > 0 ? (uniqueYears.length <= 2 ? uniqueYears.join('-') : uniqueYears[0] + '-' + uniqueYears[uniqueYears.length - 1]) : '-';
    const floors = items.map(({ tx }) => tx.total_floors).filter(v => v > 0);
    const maxFloor = floors.length > 0 ? Math.max(...floors) : 0;
    const types = [...new Set(items.map(({ tx }) => tx.building_type).filter(Boolean))];
    const typeText = types.length > 0 ? types.slice(0, 2).join('/') : '-';
    const pings = items.map(({ tx }) => tx.area_ping).filter(v => v > 0);
    const avgPing = pings.length > 0 ? (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(0) : '-';
    const completionDates = [...new Set(items.map(({ tx }) => tx.completion_date).filter(Boolean))];
    const buildDateText = completionDates.length > 0 ? fmtBuildDate(completionDates[0], settings) : '-';
    const materials = [...new Set(items.map(({ tx }) => tx.main_material).filter(Boolean))];
    const materialText = materials.length > 0 ? materials.slice(0, 2).join('/') : '-';

    const tip = document.createElement('div');
    tip.className = 'marker-tooltip-info';
    tip.innerHTML = `${label ? `<div class="mti-name">${escHtml(label)}</div>` : ''}
    <div class="mti-row"><span>📅</span> ${yearRange}年 ｜ 完工 ${buildDateText}</div>
    ${maxFloor > 0 ? `<div class="mti-row"><span>🏢</span> ${maxFloor}樓 ｜ ${escHtml(typeText)} ${escHtml(materialText)}</div>` : `<div class="mti-row"><span>🏠</span> ${escHtml(typeText)} ${escHtml(materialText)}</div>`}
    <div class="mti-row"><span>📐</span> 均${fmtAvgAreaMap(parseFloat(avgPing), settings)}</div>`;
    const iconRect = marker._icon.getBoundingClientRect();
    tip.style.position = 'fixed'; tip.style.left = (iconRect.left + iconRect.width / 2) + 'px';
    tip.style.top = (iconRect.top - 8) + 'px'; tip.style.zIndex = '2000';
    document.body.appendChild(tip);
    _markerTooltipEl = tip;
}

function hideMarkerTooltip() { if (_markerTooltipEl) { _markerTooltipEl.remove(); _markerTooltipEl = null; } }

export function onMarkerHover(marker, group, settings) {
    if (marker._icon) bounceElement(marker._icon.firstElementChild || marker._icon);
    const cn = group.communityName || group.label || '';
    if (cn) {
        const allHeaders = document.querySelectorAll('.community-header');
        for (const h of allHeaders) {
            const nameEl = h.querySelector('.ch-name');
            if (nameEl && nameEl.textContent.trim() === cn) { h.scrollIntoView({ behavior: 'smooth', block: 'center' }); h.classList.add('hover-highlight'); break; }
        }
    } else if (group.items.length > 0) {
        const card = document.querySelector(`.tx-card[data-idx="${group.items[0].origIdx}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    showMarkerTooltip(marker, group, settings);
}

export function onMarkerUnhover() {
    stopAllBounce(); hideMarkerTooltip();
    document.querySelectorAll('.community-header.hover-highlight').forEach(h => h.classList.remove('hover-highlight'));
}

export function baseAddress(addr) { if (!addr) return ''; return addr.replace(/\d+樓.*$/, '').replace(/\d+F.*$/i, '').replace(/地下.*$/, ''); }
export function extractDistrict(tx) { return tx.district || ''; }
export function isLotAddress(addr) { return /^\S*段\S*地號/.test(addr) || /段\d+地號/.test(addr); }


let _legendControl = null, _legendDiv = null;

class LegendControl {
    constructor(getLegendHtml, updateAreaAutoSearchCallback) {
        this.getLegendHtml = getLegendHtml;
        this.updateAreaAutoSearchCallback = updateAreaAutoSearchCallback;
    }

    onAdd(map) {
        this._map = map;
        this._container = document.createElement('div');
        this._container.className = 'custom-legend-wrap maplibregl-ctrl';
        this._container.innerHTML = this.getLegendHtml();

        // Disable scroll and click propagation
        this._container.addEventListener('wheel', (e) => e.stopPropagation());
        this._container.addEventListener('mousedown', (e) => e.stopPropagation());
        this._container.addEventListener('dblclick', (e) => e.stopPropagation());
        this._container.addEventListener('click', (e) => e.stopPropagation());

        _legendDiv = this._container;

        setTimeout(() => {
            const toggle = _legendDiv.querySelector('#areaToggle');
            if (toggle) {
                toggle.addEventListener('change', (e) => this.updateAreaAutoSearchCallback(e.target.checked));
            }
        }, 0);

        return this._container;
    }

    onRemove() {
        if (this._container && this._container.parentNode) {
            this._container.parentNode.removeChild(this._container);
        }
        this._map = undefined;
        _legendDiv = null;
    }
}

export function addLegendToMap(mapInstance, getLegendHtml, updateAreaAutoSearchCallback) {
    if (_legendControl) return;
    _legendControl = new LegendControl(getLegendHtml, updateAreaAutoSearchCallback);
    mapInstance.addControl(_legendControl, 'bottom-left');
}

export function updateLegendOnMap(getLegendHtml, updateAreaAutoSearchCallback) {
    if (!_legendDiv) return;
    _legendDiv.innerHTML = getLegendHtml();
    const toggle = _legendDiv.querySelector('#areaToggle');
    if (toggle) {
         toggle.addEventListener('change', (e) => updateAreaAutoSearchCallback(e.target.checked));
    }
}


export function clearMapMarkers() {
    activeMarkers.forEach(m => m.remove());
    activeMarkers = [];
}

export function updateMapMarkers() {
    if (!map || !clusterIndex || !clusterIndexLoaded) return;

    clearMapMarkers();

    const bounds = map.getBounds();
    const bbox = [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()];
    const zoom = Math.floor(map.getZoom());

    const clusters = clusterIndex.getClusters(bbox, zoom);
    const settings = _getSettingsMap();

    clusters.forEach(cluster => {
        let totalCount = 0;
        let totalPrice = 0;
        let totalUnit = 0;
        let validP = 0;
        let validU = 0;
        let labels = [];

        if (cluster.properties.cluster) {
            const props = cluster.properties;
            totalCount = props.groupCount;
            totalPrice = props.sumPrice;
            totalUnit = props.sumUnitPrice;
            validP = props.validP;
            validU = props.validU;
            labels = props.labels || [];
        } else {
            const props = cluster.properties;
            totalCount = props.groupCount || 1;
            totalPrice = props.avgPrice > 0 ? props.avgPrice * totalCount : 0;
            totalUnit = props.avgUnitPrice > 0 ? props.avgUnitPrice * totalCount : 0;
            validP = props.avgPrice > 0 ? totalCount : 0;
            validU = props.avgUnitPrice > 0 ? totalCount : 0;
            if (props.groupLabel) labels.push(props.groupLabel);
        }

        const avgPriceWan = validP > 0 ? (totalPrice / validP / 10000) : 0;
        const avgUnitWan = validU > 0 ? (totalUnit / validU / 10000) : 0;

        let sz = 44;
        if (totalCount >= 100) sz = 60; else if (totalCount >= 30) sz = 54; else if (totalCount >= 10) sz = 48;
        if (totalCount === 1) sz = 42;
        let priceText = '';
        if (avgPriceWan >= 10000) priceText = (avgPriceWan / 10000).toFixed(1) + '億';
        else if (avgPriceWan >= 1) priceText = avgPriceWan.toFixed(0) + '萬'; else priceText = '-';

        const line1 = priceText || totalCount + '筆';
        const line2 = priceText ? (totalCount === 1 ? '' : totalCount + '筆') : '';
        let svgHtml;

        if (settings.bubbleMode === 'bivariate') {
            const bvColor = getBivariateColor(avgUnitWan, avgPriceWan, settings);
            svgHtml = makeBivariateSVG({ sz, color: bvColor, line1, line2 });
        } else {
            const outerColor = getColorForMode(settings.outerMode, avgPriceWan, avgUnitWan, settings);
            const innerColor = getColorForMode(settings.innerMode, avgPriceWan, avgUnitWan, settings);
            svgHtml = makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 });
        }

        const uniqueLabels = [...new Set(labels.filter(Boolean))];
        const commLabel = uniqueLabels.length === 1 ? uniqueLabels[0].substring(0, 8) : (uniqueLabels.length > 1 ? uniqueLabels.length + ' 個建案' : '');
        const labelHtml = commLabel ? `<div style="margin-top:-2px;padding:1px 5px;background:rgba(255,255,255,.95);border-radius:5px;font-size:${totalCount > 1 ? 9 : 8}px;font-weight:700;color:#333;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.1);border:1px solid rgba(0,0,0,.06)">${escHtml(commLabel)}</div>` : '';
        const totalH = commLabel ? sz + 15 : sz;

        const el = document.createElement('div');
        el.className = 'price-marker custom-cluster-icon';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.width = (sz + 8) + 'px';
        el.style.height = totalH + 'px';
        el.style.cursor = 'pointer';
        el.innerHTML = `${svgHtml}${labelHtml}`;

        const marker = new maplibregl.Marker({
            element: el,
            anchor: 'center',
            offset: [0, 0]
        }).setLngLat(cluster.geometry.coordinates).addTo(map);

        marker._groupCount = totalCount;
        marker._avgPrice = totalPrice / (validP || 1);
        marker._avgUnitPrice = totalUnit / (validU || 1);
        marker._groupLabel = uniqueLabels.length === 1 ? uniqueLabels[0] : '';

        marker.getGroupItems = () => {
            if (marker._groupItems) return marker._groupItems;
            let items = [];
            if (cluster.properties.cluster) {
                const leaves = clusterIndex.getLeaves(cluster.properties.cluster_id, Infinity);
                for (const leaf of leaves) {
                    items = items.concat(leaf.properties.items);
                }
            } else {
                items = cluster.properties.items;
            }
            marker._groupItems = items;
            return items;
        };
        marker._icon = el;

        const groupFake = {
            label: marker._groupLabel,
            communityName: marker._groupLabel,
            get items() { return marker.getGroupItems(); }
        };

        el.addEventListener('mouseenter', () => onMarkerHover(marker, groupFake, settings));
        el.addEventListener('mouseleave', () => onMarkerUnhover());
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            if (cluster.properties.cluster && zoom < 16) {
                map.flyTo({
                    center: cluster.geometry.coordinates,
                    zoom: zoom + 2,
                    speed: 1.2
                });
            } else {
                if (_showClusterListCallbackMap) {
                    _showClusterListCallbackMap(marker.getGroupItems());
                }
            }
        });

        activeMarkers.push(marker);
    });
}

export function plotMarkersOnMap(txData, markerSettings, mapInstance, fitBounds) {
    if (!clusterIndex) return;
    const groups = buildGroups(txData, markerSettings);
    const features = [];
    const minPrice = (markerSettings.displayLogic !== 'all') ? getMinPriceThreshold(mapInstance ? mapInstance.getZoom() : 16, markerSettings) : 0;

    let bounds = new maplibregl.LngLatBounds();
    let hasValidBounds = false;

    groups.forEach(g => {
        const n = g.items.length; if (n === 0) return;
        const sortedLats = g.lats.slice().sort((a, b) => a - b), sortedLngs = g.lngs.slice().sort((a, b) => a - b), mid = Math.floor(sortedLats.length / 2);
        const lat = sortedLats[mid], lng = sortedLngs[mid];
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;

        const useRecent = markerSettings.contentMode === 'recent2yr' && g.recentCount > 0;
        const avgPrice = useRecent ? g.recentAvgPrice : (g.prices.length ? g.prices.reduce((a, b) => a + b, 0) / g.prices.length : 0);
        if (minPrice > 0 && avgPrice < minPrice) return;

        const avgUnitPrice = useRecent ? g.recentAvgUnitPrice : (g.unitPrices.length ? g.unitPrices.reduce((a, b) => a + b, 0) / g.unitPrices.length : 0);

        features.push({
            type: 'Feature',
            properties: {
                groupCount: n,
                avgPrice: avgPrice,
                avgUnitPrice: avgUnitPrice,
                groupLabel: g.label,
                items: g.items
            },
            geometry: {
                type: 'Point',
                coordinates: [lng, lat]
            }
        });

        bounds.extend([lng, lat]);
        hasValidBounds = true;
    });

    clusterIndex.load(features);
    clusterIndexLoaded = true;
    updateMapMarkers();

    if (fitBounds && hasValidBounds) {
        mapInstance.fitBounds(bounds, { padding: 40, maxZoom: 18, duration: 800 });
    }
}

function buildGroups(txData, markerSettings) {
    const raw = {};
    txData.forEach((tx, idx) => {
        if (!tx.lat || !tx.lng) return;
        if (!markerSettings.showLotAddr && isLotAddress(tx.address_raw || tx.address || '')) return;
        let key;
        if (tx.community_name) {
            key = 'c:' + tx.community_name + '@' + extractDistrict(tx);
        } else {
            key = 'a:' + baseAddress(tx.address_raw || tx.address);
        }
        if (!raw[key]) raw[key] = { label: tx.community_name || baseAddress(tx.address).replace(/^(?:(?:台|臺)(?:北|中|南|東)市|(?:新北|桃園|高雄|基隆|新竹|嘉義)[市縣]|.{2,3}縣)/, '').replace(/^[\u4e00-\u9fff]{1,4}[區鄉鎮市]/, ''), communityName: tx.community_name || '', items: [], lats: [], lngs: [], prices: [], unitPrices: [] };
        const g = raw[key]; g.items.push({ tx, origIdx: idx }); g.lats.push(tx.lat); g.lngs.push(tx.lng);
        if (tx.price > 0) g.prices.push(tx.price); if (tx.unit_price_ping > 0) g.unitPrices.push(tx.unit_price_ping);
    });
    const arr = Object.values(raw);
    arr.forEach(g => { const sLat = g.lats.slice().sort((a, b) => a - b), sLng = g.lngs.slice().sort((a, b) => a - b), m = Math.floor(sLat.length / 2); g._cLat = sLat[m]; g._cLng = sLng[m]; });
    const nowYear = new Date().getFullYear() - 1911, twoYearThreshold = (nowYear - 2) * 10000;
    arr.forEach(g => {
        const recent = g.items.filter(({ tx }) => { if (tx.is_special) return false; const dr = parseInt(String(tx.date_raw || '0').replace(/\D/g, ''), 10); return dr >= twoYearThreshold; });
        const rPrices = recent.map(({ tx }) => tx.price).filter(v => v > 0), rUnits = recent.map(({ tx }) => tx.unit_price_ping).filter(v => v > 0);
        g.recentCount = recent.length; g.recentAvgPrice = rPrices.length ? rPrices.reduce((a, b) => a + b, 0) / rPrices.length : 0; g.recentAvgUnitPrice = rUnits.length ? rUnits.reduce((a, b) => a + b, 0) / rUnits.length : 0;
    });
    return arr;
}

function getMinPriceThreshold(zoom, markerSettings) {
    if (zoom <= 14) return (markerSettings.autoThresh14 || 8000) * 10000;
    if (zoom === 15) return (markerSettings.autoThresh15 || 5000) * 10000;
    if (zoom === 16) return (markerSettings.autoThresh16 || 2000) * 10000;
    return (markerSettings.autoThresh17 || 0) * 10000;
}


let compassListenerAdded = false;

function startCompass(mapInstance) {
    if (compassListenerAdded) return;
    const handleOrientation = (e) => {
        let heading = null;
        if (e.webkitCompassHeading !== undefined) {
            heading = e.webkitCompassHeading;
        } else if (e.alpha !== null) {
            heading = 360 - e.alpha;
        }
        if (heading !== null && locationMarker && locationMarker.getElement()) {
            const headingEl = locationMarker.getElement().querySelector('.locate-heading');
            if (headingEl) {
                headingEl.style.display = 'block';
                headingEl.style.transform = `rotate(${heading}deg)`;
            }
        }
    };
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission()
            .then(permissionState => {
                if (permissionState === 'granted') {
                    window.addEventListener('deviceorientation', handleOrientation, true);
                    compassListenerAdded = true;
                }
            })
            .catch(console.error);
    } else {
        window.addEventListener('deviceorientationabsolute', handleOrientation, true);
        window.addEventListener('deviceorientation', handleOrientation, true);
        compassListenerAdded = true;
    }
}

export function locateUserOnMap(mapInstance) {
    if (!navigator.geolocation) { alert('您的瀏覽器不支援定位功能'); return; }
    startCompass(mapInstance);

    navigator.geolocation.getCurrentPosition(pos => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        mapInstance.flyTo({ center: [lng, lat], zoom: 16 });
        if (locationMarker) locationMarker.remove();
        if (locationCircle) locationCircle.remove();

        // Calculate approximate pixels for circle based on accuracy and latitude
        const elCircle = document.createElement('div');
        elCircle.style.backgroundColor = 'var(--primary)';
        elCircle.style.opacity = '0.1';
        elCircle.style.borderRadius = '50%';
        elCircle.style.border = '1px solid var(--primary)';
        elCircle.style.pointerEvents = 'none';

        // This is a rough estimation of radius in pixels for the given zoom level (16)
        const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, 16);
        const radiusPx = accuracy / metersPerPixel;
        elCircle.style.width = (radiusPx * 2) + 'px';
        elCircle.style.height = (radiusPx * 2) + 'px';

        locationCircle = new maplibregl.Marker({ element: elCircle, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(mapInstance);

        const elMarker = document.createElement('div');
        elMarker.innerHTML = `<div class="locate-marker-wrap" style="width:48px;height:48px"><div class="locate-heading"></div><div class="locate-pulse"></div></div>`;

        locationMarker = new maplibregl.Marker({ element: elMarker, anchor: 'center' })
            .setLngLat([lng, lat])
            .setPopup(new maplibregl.Popup({ offset: 25 }).setHTML(`📍 您的位置<br><span style="font-size:11px;color:var(--text2)">精確度: ±${Math.round(accuracy)}m</span>`))
            .addTo(mapInstance);

        locationMarker.togglePopup();

        setTimeout(() => { if (locationCircle) { locationCircle.remove(); locationCircle = null; } }, 5000);
    }, err => { alert('定位失敗: ' + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
}