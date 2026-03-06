// map.js
import { API_BASE } from './api.js';

let map, markerClusterGroup, markerGroup;
let locationMarker, locationCircle;
let _markerTooltipEl = null;

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

function fmtAvgAreaMap(avgSqm, settings) {
    if (settings.areaUnit === 'sqm') {
        return avgSqm > 0 ? avgSqm.toFixed(1) + ' m²' : '-';
    }
    const ping = avgSqm > 0 ? avgSqm / 3.305785 : 0;
    return ping > 0 ? ping.toFixed(1) + '坪' : '-';
}

function fmtBuildDate(raw, settings) {
    if (!raw) return '-';
    const s = String(raw).trim();

    // backend used to supply ROC numeric string (e.g. "11305").
    // newer versions may already format as Chinese ("民國113年05月01日"),
    // so guard against parseInt producing NaN.  Handle both cases.

    // if string starts with the Chinese prefix, try extracting year/month
    const chineseMatch = s.match(/^\s*民國\s*(\d+)\s*年\s*(\d{1,2})/);
    if (chineseMatch) {
        const rocY = parseInt(chineseMatch[1], 10);
        const mm = chineseMatch[2].padStart(2, '0');
        if (!isNaN(rocY)) {
            const y = settings && settings.yearFormat === 'ce' ? rocY + 1911 : rocY;
            return y + '/' + mm;
        }
        // fall through to return raw string below
    }

    // fallback: numeric ROC string like "1040301" (YYYMMDD) or "11305"
    if (s.length >= 7) {
        const rocY = parseInt(s.substring(0, s.length - 4), 10);
        if (!isNaN(rocY)) {
            const y = settings && settings.yearFormat === 'ce' ? rocY + 1911 : rocY;
            return y + '/' + s.substring(s.length - 4, s.length - 2);
        }
    } else if (s.length >= 5) {
        const rocY = parseInt(s.substring(0, 3), 10);
        if (!isNaN(rocY)) {
            const y = settings && settings.yearFormat === 'ce' ? rocY + 1911 : rocY;
            return y + '/' + s.substring(3, 5);
        }
    }

    // nothing parsable, just show original value to avoid NaN
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
    map = L.map('map', { zoomControl: false }).setView([23.6978, 120.9605], 8);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
        maxZoom: 20, attribution: '&copy; OpenStreetMap & CartoDB'
    }).addTo(map);

    const iconCreateFn = function (cluster) {
        const settings = getSettings();
        const markers = cluster.getAllChildMarkers();
        let totalPrice = 0, validP = 0, totalUnit = 0, validU = 0, totalCount = 0;
        markers.forEach(m => {
            const gc = m._groupCount || 1; totalCount += gc;
            if (m._avgPrice > 0) { totalPrice += m._avgPrice * gc; validP += gc; }
            if (m._avgUnitPrice > 0) { totalUnit += m._avgUnitPrice * gc; validU += gc; }
        });
        const avgPriceWan = validP > 0 ? (totalPrice / validP / 10000) : 0;
        const avgUnitWan = validU > 0 ? (totalUnit / validU * 3.305785 / 10000) : 0;  // 元/m² → 萬/坪

        let sz = 44;
        if (totalCount >= 100) sz = 60; else if (totalCount >= 30) sz = 54; else if (totalCount >= 10) sz = 48;
        let priceText = '';
        if (avgPriceWan >= 10000) priceText = (avgPriceWan / 10000).toFixed(1) + '億';
        else if (avgPriceWan >= 1) priceText = avgPriceWan.toFixed(0) + '萬';

        const line1 = priceText || totalCount + '筆';
        const line2 = priceText ? totalCount + '筆' : '';
        let svgHtml;

        if (settings.bubbleMode === 'bivariate') {
            const bvColor = getBivariateColor(avgUnitWan, avgPriceWan, settings);
            svgHtml = makeBivariateSVG({ sz, color: bvColor, line1, line2 });
        } else {
            const outerColor = getColorForMode(settings.outerMode, avgPriceWan, avgUnitWan, settings);
            const innerColor = getColorForMode(settings.innerMode, avgPriceWan, avgUnitWan, settings);
            svgHtml = makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 });
        }

        const labels = markers.map(m => m._groupLabel).filter(Boolean);
        const uniqueLabels = [...new Set(labels)];
        const commLabel = uniqueLabels.length === 1 ? uniqueLabels[0].substring(0, 6) : (uniqueLabels.length > 1 ? uniqueLabels.length + ' 個建案' : '');
        const labelHtml = commLabel ? `<div style="margin-top:-2px;padding:1px 4px;background:rgba(255,255,255,.95);border-radius:5px;font-size:8px;font-weight:600;color:#333;white-space:nowrap;max-width:70px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.1);border:1px solid rgba(0,0,0,.06)">${commLabel}</div>` : '';
        const totalH = commLabel ? sz + 14 : sz;
        // The cluster logic has been updated to accept data-community attributes on markers.
        // We ensure that the first label (the community name if all children belong to same community) is added to dataset.
        const communityDataAttr = (uniqueLabels.length === 1 && uniqueLabels[0]) ? `data-community="${escAttr(uniqueLabels[0])}"` : '';
        return L.divIcon({
            html: `<div ${communityDataAttr} style="display:flex;flex-direction:column;align-items:center">${svgHtml}${labelHtml}</div>`,
            className: 'price-marker custom-cluster-icon',
            iconSize: [sz + 8, totalH], iconAnchor: [(sz + 8) / 2, totalH / 2]
        });
    };

    markerClusterGroup = L.markerClusterGroup({
        spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: false,
        maxClusterRadius: 40, spiderfyDistanceMultiplier: 2.5, iconCreateFunction: iconCreateFn
    });

    markerClusterGroup.on('clusterclick', e => {
        // when clicking a cluster, spiderfy and highlight contained communities
        const cluster = e.layer;

        const bottomCluster = cluster._zoom === map.getMaxZoom() || cluster.getChildCount() <= markerClusterGroup.options.spiderfyDistanceMultiplier * 15;
        if (bottomCluster) {
            if (cluster._icon) {
                cluster._icon.classList.remove('spider-focus');
                cluster._icon.classList.add('spider-parent-blur');
            }
            document.getElementById('map').classList.add('spiderfied-active');
        }

        cluster.spiderfy();
        const childMarkers = cluster.getAllChildMarkers();
        const labels = [...new Set(childMarkers.map(m => m._groupLabel).filter(Boolean))];
        if (labels.length > 0) {
            hoverCommunityOnMap(labels, map, markerClusterGroup, () => {});
        }
    });

    markerClusterGroup.on('spiderfied', e => {
        e.markers.forEach(m => { if (m._icon) m._icon.classList.add('spider-focus'); });
    });

    markerClusterGroup.on('unspiderfied', e => {
        document.getElementById('map').classList.remove('spiderfied-active');
        if (e.cluster._icon) {
            e.cluster._icon.classList.remove('spider-parent-blur');
        }
        e.markers.forEach(m => { if (m._icon) m._icon.classList.remove('spider-focus'); });
    });

    map.addLayer(markerClusterGroup);
    markerGroup = L.featureGroup().addTo(map);
    map.on('moveend', onMapMoveEnd);
    map.on('click', () => {
        unhoverCommunityOnMap();
        document.dispatchEvent(new CustomEvent('map-bg-click'));
    });

    // Add legend initialization logic here, which will be updated by Vue
    return { map, markerClusterGroup, markerGroup };
}

let _lastBouncingEls = [];

function showOverlay() {
    const mapEl = document.getElementById('map');
    if (mapEl) {
        mapEl.classList.add('overlay-active');
    }
}

function hideOverlay() {
    const mapEl = document.getElementById('map');
    if (mapEl) {
        mapEl.classList.remove('overlay-active');
    }
}

// markers that should remain clear when a community is being hovered
let _hoverFocusMarkers = [];
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

export function hoverTxOnMap(idx, mapInstance, mcGroup, suppressPanCallback) {
    let targetMarker = null;
    mcGroup.eachLayer(layer => {
        if (!targetMarker && layer._groupItems && layer._groupItems.some(it => it.origIdx === idx)) targetMarker = layer;
    });
    if (!targetMarker) return;
    const ll = targetMarker.getLatLng();
    if (!mapInstance.getBounds().contains(ll)) {
        suppressPanCallback(true);
        mapInstance.panTo(ll, { animate: true, duration: 0.25 });
        setTimeout(() => { suppressPanCallback(false); }, 600);
    }
    const tryBounce = () => {
        const iconEl = targetMarker._icon; if (!iconEl) return;
        bounceElement(iconEl.firstElementChild || iconEl);
    };
    if (targetMarker._icon) tryBounce();
    else mcGroup.zoomToShowLayer(targetMarker, () => setTimeout(tryBounce, 100));
}

export function unhoverTxOnMap() {
    stopAllBounce(); hideMarkerTooltip();
}

export function hoverCommunityOnMap(name, mapInstance, mcGroup, suppressPanCallback) {
    console.log("hoverCommunityOnMap called with", name);
    stopAllBounce();
    showOverlay();
    //document.getElementById('map').classList.add('hover-unblur');

    // overlay will grey background; no per-marker dim needed

    // clear previous focus markers
    _hoverFocusMarkers.forEach(m => {
        if (m._icon) {
            m._icon.classList.remove('focus');
            const inner = m._icon.querySelector && m._icon.querySelector('.price-marker');
            if (inner) {
                inner.classList.remove('focus');
            }
        }
    });
    _hoverFocusMarkers = [];

    const names = Array.isArray(name) ? name : [name];
    const matched = [];
    mcGroup.eachLayer(layer => {
        // Find match in dataset first, then by internal labels
        const markerEl = layer._icon ? (layer._icon.firstElementChild || layer._icon) : null;
        const datasetComm = markerEl && markerEl.dataset ? markerEl.dataset.community : null;

        if (names.some(n => datasetComm === n || layer._groupLabel === n || (layer._groupItems && layer._groupItems.some(it => it.tx.community_name === n)))) {
            matched.push(layer);
            if (layer._icon) {
                layer._icon.classList.add('focus');
                layer._icon.classList.remove('dim');
                const inner = layer._icon.querySelector && layer._icon.querySelector('.price-marker');
                if (inner) inner.classList.add('focus');
            }
        }
    });
    console.log("matched markers count", matched.length);
    _hoverFocusMarkers = matched;

    // highlight matched markers (focus class removed dim earlier automatically)

    if (matched.length === 0) { hideOverlay(); return; }
    const bounds = mapInstance.getBounds();
    const anyVisible = matched.some(m => {
        if (m._icon && bounds.contains(m.getLatLng())) return true;
        // Check if the marker is inside a visible cluster
        const parent = mcGroup.getVisibleParent(m);
        if (parent && parent._icon && bounds.contains(parent.getLatLng())) return true;
        return false;
    });

    if (!anyVisible) {
        suppressPanCallback(true);
        mapInstance.panTo(matched[0].getLatLng(), { animate: true, duration: 0.3 });
        setTimeout(() => { suppressPanCallback(false); }, 600);
    }

    // Auto-expand cluster and bounce all matching visible markers
    matched.forEach(m => {
        // If marker is inside a cluster, spiderfy the cluster
        const parent = mcGroup.getVisibleParent(m);
        if (parent && parent.spiderfy) {
            // It's a cluster. Check if it's already spiderfied
            // Leaflet.markercluster doesn't have a direct isSpiderfied, but we can check if m._icon exists
            // If m._icon does not exist, it might be hidden inside the cluster.
            if (!m._icon) {
                // Since spiderfy operates on user interaction or internally, we can trigger it:
                parent.spiderfy();

                // When we trigger spiderfy programmatically, we should manually apply the visual classes to the parent,
                // as the 'clusterclick' event isn't triggered, only the 'spiderfied' event is.
                if (parent._icon) {
                    parent._icon.classList.add('spider-parent-blur');
                }
                const mapEl = document.getElementById('map');
                if (mapEl) mapEl.classList.add('spiderfied-active');
            }
        }

        // Now if the marker has an icon (either it was visible or we just spiderfied it)
        if (m._icon && mapInstance.getBounds().contains(m.getLatLng())) {
             bounceElement(m._icon.firstElementChild || m._icon);
        }
    });
}

export function unhoverCommunityOnMap() {
    stopAllBounce();
    hideOverlay();
    // remove dim/focus from all markers
    _hoverFocusMarkers.forEach(m => {
        if (m._icon) {
            m._icon.classList.remove('focus');
            const inner = m._icon.querySelector && m._icon.querySelector('.price-marker');
            if (inner) inner.classList.remove('focus');
        }
    });
    _hoverFocusMarkers = [];
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
    const sqms = items.map(({ tx }) => tx.area_sqm).filter(v => v > 0);
    const avgSqm = sqms.length > 0 ? (sqms.reduce((a, b) => a + b, 0) / sqms.length).toFixed(1) : '-';
    const completionDates = [...new Set(items.map(({ tx }) => tx.completion_date).filter(Boolean))];
    const buildDateText = completionDates.length > 0 ? fmtBuildDate(completionDates[0], settings) : '-';
    const materials = [...new Set(items.map(({ tx }) => tx.main_material).filter(Boolean))];
    const materialText = materials.length > 0 ? materials.slice(0, 2).join('/') : '-';

    const tip = document.createElement('div');
    tip.className = 'marker-tooltip-info';
    tip.innerHTML = `${label ? `<div class="mti-name">${escHtml(label)}</div>` : ''}
    <div class="mti-row"><span>📅</span> ${yearRange}年 ｜ 完工 ${buildDateText}</div>
    ${maxFloor > 0 ? `<div class="mti-row"><span>🏢</span> ${maxFloor}樓 ｜ ${escHtml(typeText)} ${escHtml(materialText)}</div>` : `<div class="mti-row"><span>🏠</span> ${escHtml(typeText)} ${escHtml(materialText)}</div>`}
    <div class="mti-row"><span>📐</span> 均${fmtAvgAreaMap(parseFloat(avgSqm), settings)}</div>`;
    const iconRect = marker._icon.getBoundingClientRect();
    tip.style.position = 'fixed'; tip.style.left = (iconRect.left + iconRect.width / 2) + 'px';
    tip.style.top = (iconRect.top - 8) + 'px'; tip.style.zIndex = '2000';
    document.body.appendChild(tip);
    _markerTooltipEl = tip;
}

function hideMarkerTooltip() { if (_markerTooltipEl) { _markerTooltipEl.remove(); _markerTooltipEl = null; } }

export function onMarkerHover(marker, group, settings) {
    if (marker._icon) bounceElement(marker._icon.firstElementChild || marker._icon);
    // determine which list container is visible (normal results or cluster overlay)
    const overlay = document.querySelector('.cluster-list-overlay');
    const container = (overlay && overlay.style.display !== 'none' && overlay.offsetParent !== null)
        ? overlay
        : document.querySelector('.results');

    const scrollToElement = (el) => {
        if (!el || !container) return;
        // compute offset inside container to account for sticky headers
        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const offset = elRect.top - containerRect.top - containerRect.height / 2 + elRect.height / 2;
        container.scrollBy({ top: offset, behavior: 'smooth' });
    };

    const cn = group.communityName || group.label || '';
    if (cn) {
        const allHeaders = container ? container.querySelectorAll('.community-header') : document.querySelectorAll('.community-header');
        for (const h of allHeaders) {
            const nameEl = h.querySelector('.ch-name');
            if (nameEl && nameEl.textContent.trim() === cn) {
                scrollToElement(h);
                h.classList.add('hover-highlight');
                break;
            }
        }
    } else if (group.items.length > 0) {
        // card selector differs if cluster overlay is active
        let card;
        if (container === overlay) {
            card = container.querySelector(`#cluster-tx-item-${group.items[0].origIdx}`);
        } else {
            card = container ? container.querySelector(`.tx-card[data-idx="${group.items[0].origIdx}"]`) : null;
        }
        if (card) scrollToElement(card);
    }
    showMarkerTooltip(marker, group, settings);
}

export function onMarkerUnhover() {
    stopAllBounce(); hideMarkerTooltip();
    document.querySelectorAll('.community-header.hover-highlight').forEach(h => h.classList.remove('hover-highlight'));
}

export function getBoundsDifference(newB, oldB) {
    if (!oldB || !newB.intersects(oldB)) return [newB];

    const diffs = [];
    const nN = newB.getNorth(), nS = newB.getSouth(), nE = newB.getEast(), nW = newB.getWest();
    const oN = oldB.getNorth(), oS = oldB.getSouth(), oE = oldB.getEast(), oW = oldB.getWest();

    // Top
    if (nN > oN) {
        diffs.push(L.latLngBounds([oN, nW], [nN, nE]));
    }
    // Bottom
    if (nS < oS) {
        diffs.push(L.latLngBounds([nS, nW], [oS, nE]));
    }

    const midN = Math.min(nN, oN);
    const midS = Math.max(nS, oS);

    if (midN > midS) {
        // Left
        if (nW < oW) {
            diffs.push(L.latLngBounds([midS, nW], [midN, oW]));
        }
        // Right
        if (nE > oE) {
            diffs.push(L.latLngBounds([midS, oE], [midN, nE]));
        }
    }
    return diffs;
}

export function baseAddress(addr) { if (!addr) return ''; return addr.replace(/\d+樓.*$/, '').replace(/\d+F.*$/i, '').replace(/地下.*$/, ''); }
export function extractDistrict(tx) { return tx.district || ''; }
export function isLotAddress(addr) { return /^\S*段\S*地號/.test(addr) || /段\d+地號/.test(addr); }


let _legendControl = null, _legendDiv = null;
export function addLegendToMap(mapInstance, getLegendHtml, updateAreaAutoSearchCallback) {
    if (_legendControl) return;
    _legendControl = L.control({ position: 'bottomleft' });
    _legendControl.onAdd = function () {
        _legendDiv = L.DomUtil.create('div', 'custom-legend-wrap');
        _legendDiv.innerHTML = getLegendHtml();
        L.DomEvent.disableScrollPropagation(_legendDiv);
        L.DomEvent.disableClickPropagation(_legendDiv);

        // Ensure to bind events
        setTimeout(() => {
             const toggle = _legendDiv.querySelector('#areaToggle');
             if (toggle) {
                 toggle.addEventListener('change', (e) => updateAreaAutoSearchCallback(e.target.checked));
             }
        }, 0);
        return _legendDiv;
    };
    _legendControl.addTo(mapInstance);
}

export function updateLegendOnMap(getLegendHtml, updateAreaAutoSearchCallback) {
    if (!_legendDiv) return;
    _legendDiv.innerHTML = getLegendHtml();
    const toggle = _legendDiv.querySelector('#areaToggle');
    if (toggle) {
         toggle.addEventListener('change', (e) => updateAreaAutoSearchCallback(e.target.checked));
    }
}


export function plotMarkersOnMap(txData, markerSettings, mapInstance, markerClusterGroup, fitBounds, showClusterListCallback) {
    markerClusterGroup.clearLayers();
    const boundsArr = [], groups = buildGroups(txData, markerSettings);
    const currentZoom = mapInstance ? mapInstance.getZoom() : 16;
    const minPrice = (markerSettings.displayLogic !== 'all') ? getMinPriceThreshold(currentZoom, markerSettings) : 0;

    groups.forEach(g => {
        const n = g.items.length; if (n === 0) return;
        const sortedLats = g.lats.slice().sort((a, b) => a - b), sortedLngs = g.lngs.slice().sort((a, b) => a - b), mid = Math.floor(sortedLats.length / 2);
        const lat = sortedLats[mid], lng = sortedLngs[mid];
        if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;

        const useRecent = markerSettings.contentMode === 'recent2yr' && g.recentCount > 0;
        const avgPrice = useRecent ? g.recentAvgPrice : (g.prices.length ? g.prices.reduce((a, b) => a + b, 0) / g.prices.length : 0);
        if (minPrice > 0 && avgPrice < minPrice) return;

        const avgUnitPrice = useRecent ? g.recentAvgUnitPrice : (g.unitPrices.length ? g.unitPrices.reduce((a, b) => a + b, 0) / g.unitPrices.length : 0);
        const avgPriceWan = avgPrice / 10000, avgUnitWan = avgUnitPrice * 3.305785 / 10000;  // 元/m² → 萬/坪
        const label = g.label ? g.label.substring(0, 8) : '';
        let priceText = '';
        if (avgPriceWan >= 10000) priceText = (avgPriceWan / 10000).toFixed(1) + '億';
        else if (avgPriceWan >= 1) priceText = Math.round(avgPriceWan) + '萬'; else priceText = '-';
        let sz = n >= 20 ? 56 : (n >= 5 ? 50 : 44); if (n === 1) sz = 42;
        let line1 = priceText, line2 = n === 1 ? '' : n + '筆';

        let svgHtml;
        if (markerSettings.bubbleMode === 'bivariate') {
            svgHtml = makeBivariateSVG({ sz, color: getBivariateColor(avgUnitWan, avgPriceWan, markerSettings), line1, line2 });
        } else {
            const outerColor = getColorForMode(markerSettings.outerMode, avgPriceWan, avgUnitWan, markerSettings);
            const innerColor = getColorForMode(markerSettings.innerMode, avgPriceWan, avgUnitWan, markerSettings);
            svgHtml = makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 });
        }

        const labelHtml = label ? `<div style="margin-top:-2px;padding:1px 5px;background:rgba(255,255,255,.95);border-radius:5px;font-size:${n > 1 ? 9 : 8}px;font-weight:700;color:#333;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.1);border:1px solid rgba(0,0,0,.06)">${escHtml(label)}</div>` : '';
        const totalH = label ? sz + 15 : sz;
        const communityDataAttr = label ? `data-community="${escAttr(label)}"` : '';
        const icon = L.divIcon({ html: `<div ${communityDataAttr} style="display:flex;flex-direction:column;align-items:center">${svgHtml}${labelHtml}</div>`, iconSize: [sz + 8, totalH], iconAnchor: [(sz + 8) / 2, totalH / 2], className: 'price-marker' });
        const marker = L.marker([lat, lng], { icon });
        marker._groupCount = n; marker._avgPrice = avgPrice; marker._avgUnitPrice = avgUnitPrice; marker._groupLabel = g.label; marker._groupItems = g.items;

        marker.on('mouseover', () => onMarkerHover(marker, g, markerSettings));
        marker.on('mouseout', () => onMarkerUnhover());
        marker.on('click', () => {
            showClusterListCallback(g.items);
            if (g.label) {
                console.log('marker clicked, calling hoverCommunityOnMap for', g.label);
                hoverCommunityOnMap(g.label, mapInstance, markerClusterGroup, () => {});
            }
        });
        markerClusterGroup.addLayer(marker);
        boundsArr.push([lat, lng]);
    });
    if (fitBounds && boundsArr.length > 0) mapInstance.fitBounds(boundsArr, { padding: [40, 40], maxZoom: 18 });
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
        if (tx.price > 0) g.prices.push(tx.price); if (tx.unit_price_sqm > 0) g.unitPrices.push(tx.unit_price_sqm);
    });
    const arr = Object.values(raw);
    arr.forEach(g => { const sLat = g.lats.slice().sort((a, b) => a - b), sLng = g.lngs.slice().sort((a, b) => a - b), m = Math.floor(sLat.length / 2); g._cLat = sLat[m]; g._cLng = sLng[m]; });
    const nowYear = new Date().getFullYear() - 1911, twoYearThreshold = (nowYear - 2) * 10000;
    arr.forEach(g => {
        const recent = g.items.filter(({ tx }) => { if (tx.is_special) return false; const dr = parseInt(String(tx.date_raw || '0').replace(/\D/g, ''), 10); return dr >= twoYearThreshold; });
        const rPrices = recent.map(({ tx }) => tx.price).filter(v => v > 0), rUnits = recent.map(({ tx }) => tx.unit_price_sqm).filter(v => v > 0);
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
        if (heading !== null && locationMarker && locationMarker._icon) {
            const headingEl = locationMarker._icon.querySelector('.locate-heading');
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
        mapInstance.setView([lat, lng], 16);
        if (locationMarker) mapInstance.removeLayer(locationMarker);
        if (locationCircle) mapInstance.removeLayer(locationCircle);

        locationCircle = L.circle([lat, lng], { radius: accuracy, color: 'var(--primary)', fillColor: 'var(--primary)', fillOpacity: .1, weight: 1 }).addTo(mapInstance);

        const iconHtml = `<div class="locate-marker-wrap"><div class="locate-heading"></div><div class="locate-pulse"></div></div>`;
        locationMarker = L.marker([lat, lng], { icon: L.divIcon({ html: iconHtml, iconSize: [48, 48], className: '' }), zIndexOffset: 1000 }).addTo(mapInstance).bindPopup(`📍 您的位置<br><span style="font-size:11px;color:var(--text2)">精確度: ±${Math.round(accuracy)}m</span>`).openPopup();

        setTimeout(() => { if (locationCircle) { mapInstance.removeLayer(locationCircle); locationCircle = null; } }, 5000);
    }, err => { alert('定位失敗: ' + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
}