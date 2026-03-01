/* ══════════════════════════════════════════════════════════════
   app.js — 良富居地產 前端應用
   前後端分離版 · GitHub Pages 部署
   ══════════════════════════════════════════════════════════════ */

// ── API 端點 ──
const API_BASE = 'http://140.114.78.136:5001';

// ── 全域狀態 ──
let map, markerClusterGroup, markerGroup;
let txData = [];
let activeCardIdx = -1;
let currentSort = 'date';
let sortDirection = 'desc';
let lastSearchType = '';
let locationMarker, locationCircle;
let collapsedCommunities = {};
let _lastBouncingEls = [];
let communitySummaries = {};
const PING_TO_SQM = 3.305785;  // 1坪 = 3.305785 m²
let markerSettings = {
  bubbleMode: 'dual_ring',  // 'dual_ring' | 'bivariate'
  outerMode: 'unit_price', innerMode: 'total_price',
  contentMode: 'recent2yr',
  unitThresholds: [20, 45, 70], totalThresholds: [500, 1750, 3000],
  osmZoom: 16, showLotAddr: false, yearFormat: 'roc',
  areaUnit: 'ping',  // 'ping' | 'sqm'
  // Bivariate thresholds
  bivUnitQ: [25, 40, 60], bivTotalQ: [800, 1500, 2500],
};
let areaAutoSearch = false;
let _areaSearchTimer = null;
let _hoverPanSuppressed = false;
let _sidebarCollapsed = false;

// ── Utility ──
const escHtml = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
const escAttr = s => s ? String(s).replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;') : '';
const cssId = s => s ? s.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_') : '';
function fmtWan(v) { if (!v || v <= 0) return '-'; const w = v / 10000; return w >= 10000 ? (w / 10000).toFixed(1) + '億' : Math.round(w) + '萬'; }
function fmtArea(sqm, ping) {
  if (markerSettings.areaUnit === 'sqm') {
    const m2 = sqm > 0 ? sqm : (ping > 0 ? ping * PING_TO_SQM : 0);
    return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
  }
  return ping > 0 ? ping.toFixed(1) + '坪' : (sqm > 0 ? (sqm / PING_TO_SQM).toFixed(1) + '坪' : '-');
}
function fmtUnitPrice(unitPricePing) {
  if (markerSettings.areaUnit === 'sqm') {
    if (unitPricePing <= 0) return '-';
    const perSqm = unitPricePing / PING_TO_SQM;
    return Math.round(perSqm / 10000) + '萬/m²';
  }
  return unitPricePing > 0 ? Math.round(unitPricePing / 10000) + '萬/坪' : '-';
}
function fmtAvgArea(avgPing) {
  if (markerSettings.areaUnit === 'sqm') {
    const m2 = avgPing > 0 ? avgPing * PING_TO_SQM : 0;
    return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
  }
  return avgPing > 0 ? avgPing.toFixed(1) + '坪' : '-';
}
function fmtAvgUnitWan(unitPricePing) {
  if (markerSettings.areaUnit === 'sqm') {
    if (unitPricePing <= 0) return '-';
    return (unitPricePing / PING_TO_SQM / 10000).toFixed(1) + '萬/m²';
  }
  return unitPricePing > 0 ? (unitPricePing / 10000).toFixed(1) + '萬/坪' : '-';
}
function areaLabel() { return markerSettings.areaUnit === 'sqm' ? 'm²' : '坪'; }
function isLotAddress(addr) { return /^\S*段\S*地號/.test(addr) || /段\d+地號/.test(addr); }
function getLocationMode() { const z = map ? map.getZoom() : 15; return z >= (markerSettings.osmZoom || 16) ? 'osm' : 'db'; }

// ── Sidebar toggle ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const bar = document.getElementById('sidebarCollapsedBar');
  if (_sidebarCollapsed) {
    // expand
    sidebar.classList.remove('collapsed');
    bar.style.display = 'none';
    _sidebarCollapsed = false;
    // On mobile, add show class
    if (window.innerWidth <= 768) sidebar.classList.add('show');
  } else {
    // On mobile, just toggle show
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle('show');
    } else {
      collapseSidebar();
    }
  }
}

function collapseSidebar() {
  const sidebar = document.getElementById('sidebar');
  const bar = document.getElementById('sidebarCollapsedBar');
  sidebar.classList.add('collapsed');
  sidebar.classList.remove('show');
  bar.style.display = 'flex';
  _sidebarCollapsed = true;
  updateCollapsedSummary();
}

function updateCollapsedSummary() {
  const el = document.getElementById('collapsedSummary');
  const s = window._summary;
  if (!s || !s.total) {
    el.innerHTML = '尚無搜尋結果';
    return;
  }
  el.innerHTML = `共 <span class="val">${s.total}</span> 筆 ｜ 均價 <span class="val">${fmtWan(s.avg_price)}</span> ｜ 均面積 <span class="val">${fmtAvgArea(s.avg_ping)}</span>`;
}

// ── Filter panel ──
function toggleFilters() {
  const dropdown = document.getElementById('filterDropdown');
  const btn = document.getElementById('filterToggleBtn');
  const show = !dropdown.classList.contains('show');
  dropdown.classList.toggle('show', show);
  btn.classList.toggle('active', show);
}
function clearFilters() {
  ['fBuildType', 'fRooms', 'fPing', 'fRatio', 'fUnitPrice', 'fPrice', 'fYear'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const cb = document.getElementById('fExcludeSpecial'); if (cb) cb.checked = false;
  document.querySelectorAll('.quick-filters button').forEach(b => b.classList.remove('active'));
}
function applyFiltersAndSearch() {
  toggleFilters();
  doSearch();
}
function quickFilter(mode) {
  const nowYear = new Date().getFullYear() - 1911;
  if (mode === '1yr') {
    document.getElementById('fYear').value = `${nowYear - 1}-${nowYear}`;
    document.getElementById('qf1yr').classList.add('active');
    document.getElementById('qf2yr').classList.remove('active');
  } else if (mode === '2yr') {
    document.getElementById('fYear').value = `${nowYear - 2}-${nowYear}`;
    document.getElementById('qf2yr').classList.add('active');
    document.getElementById('qf1yr').classList.remove('active');
  } else if (mode === 'nospecial') {
    const cb = document.getElementById('fExcludeSpecial');
    cb.checked = !cb.checked;
    document.getElementById('qfNoSpec').classList.toggle('active', cb.checked);
  } else if (mode === 'clear') {
    clearFilters();
    if (txData.length > 0) rerunSearch();
    return;
  }
  if (txData.length > 0) rerunSearch();
}
function getFilterParams() {
  let p = '';
  const fields = [
    ['fBuildType', 'building_type'], ['fRooms', 'rooms'], ['fPing', 'ping'],
    ['fRatio', 'public_ratio'], ['fUnitPrice', 'unit_price'], ['fPrice', 'price'], ['fYear', 'year']
  ];
  fields.forEach(([id, param]) => {
    const el = document.getElementById(id);
    if (el && el.value.trim()) p += '&' + param + '=' + encodeURIComponent(el.value.trim());
  });
  const exSp = document.getElementById('fExcludeSpecial');
  if (exSp && exSp.checked) p += '&exclude_special=1';
  return p;
}

// ── Sort ──
function sortData(sortType) {
  const dir = sortDirection === 'asc' ? 1 : -1;
  const sorters = {
    date: (a, b) => dir * (b.date_raw || '').localeCompare(a.date_raw || ''),
    price: (a, b) => dir * ((b.price || 0) - (a.price || 0)),
    unit_price: (a, b) => dir * ((b.unit_price_ping || 0) - (a.unit_price_ping || 0)),
    ping: (a, b) => dir * ((b.area_ping || 0) - (a.area_ping || 0)),
    public_ratio: (a, b) => dir * ((a.public_ratio || 999) - (b.public_ratio || 999)),
    community: (a, b) => {
      const ca = a.community_name || '', cb2 = b.community_name || '';
      if (ca && !cb2) return -1; if (!ca && cb2) return 1;
      if (ca !== cb2) return dir * ca.localeCompare(cb2);
      return dir * (b.date_raw || '').localeCompare(a.date_raw || '');
    }
  };
  if (sorters[sortType]) txData.sort(sorters[sortType]);
}

function setSort(btn) {
  const newSort = btn.dataset.sort;
  if (currentSort === newSort) {
    sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
  } else {
    currentSort = newSort;
    sortDirection = 'desc';
  }
  document.querySelectorAll('.sort-bar button[data-sort]').forEach(b => {
    b.classList.remove('active');
    const oldArrow = b.querySelector('.sort-arrow');
    if (oldArrow) oldArrow.remove();
  });
  btn.classList.add('active');
  const arrow = document.createElement('span');
  arrow.className = 'sort-arrow';
  arrow.textContent = sortDirection === 'desc' ? ' ▼' : ' ▲';
  btn.appendChild(arrow);
  if (txData.length > 0) { sortData(currentSort); renderResults(); plotMarkers(false); }
}

function rerunSearch() {
  if (lastSearchType === 'area') doAreaSearch();
  else if (lastSearchType === 'keyword') doSearch();
}

// ── Autocomplete ──
let _acTimer = null, _acIdx = -1, _acResults = [], _selectedCommunity = null;
function handleSearchKeydown(e) {
  const list = document.getElementById('acList');
  if (list.classList.contains('show') && _acResults.length > 0) {
    if (e.key === 'ArrowDown') { e.preventDefault(); _acIdx = Math.min(_acIdx + 1, _acResults.length - 1); renderAcList(); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); _acIdx = Math.max(_acIdx - 1, -1); renderAcList(); return; }
    if (e.key === 'Enter' && _acIdx >= 0) { e.preventDefault(); selectCommunity(_acResults[_acIdx].name); return; }
  }
  if (e.key === 'Escape') { hideAcList(); return; }
  if (e.key === 'Enter') doSearch();
}
function onSearchInput() {
  if (_selectedCommunity) clearSelectedCommunity();
  const kw = document.getElementById('searchInput').value.trim();
  if (kw.length < 2) { hideAcList(); return; }
  clearTimeout(_acTimer);
  _acTimer = setTimeout(() => fetchAcResults(kw), 250);
}
async function fetchAcResults(kw) {
  try {
    const resp = await fetch(`${API_BASE}/api/com_match?keyword=${encodeURIComponent(kw)}&top_n=8`);
    const data = await resp.json();
    if (data.success && data.results && data.results.length > 0) {
      _acResults = data.results; _acIdx = -1; positionAcList(); renderAcList();
      document.getElementById('acList').classList.add('show');
    } else hideAcList();
  } catch (e) { hideAcList(); }
}
function renderAcList() {
  const list = document.getElementById('acList');
  list.innerHTML = _acResults.map((r, i) => {
    const tagClass = r.match_type === '精確' ? 'exact' : (r.match_type === '包含' ? 'contains' : 'fuzzy');
    const priceWan = r.avg_price ? Math.round(r.avg_price / 10000) : 0;
    return `<div class="autocomplete-item${i === _acIdx ? ' selected' : ''}" onclick="selectCommunity('${escAttr(r.name)}')">
      <span class="ac-name">${escHtml(r.name)}<span class="ac-tag ${tagClass}">${r.match_type}</span></span>
      <span class="ac-meta">${r.tx_count}筆${priceWan > 0 ? ' · 均' + priceWan + '萬' : ''} · ${escHtml(r.district || '')}</span>
    </div>`;
  }).join('');
}
function selectCommunity(name) {
  _selectedCommunity = name;
  document.getElementById('searchInput').value = name;
  document.getElementById('selComName').textContent = name;
  document.getElementById('selectedCommunity').style.display = '';
  hideAcList(); doSearch();
}
function clearSelectedCommunity() {
  _selectedCommunity = null;
  document.getElementById('selectedCommunity').style.display = 'none';
}
function hideAcList() { document.getElementById('acList').classList.remove('show'); _acResults = []; _acIdx = -1; }
function positionAcList() {
  const input = document.getElementById('searchInput'), list = document.getElementById('acList');
  const rect = input.getBoundingClientRect();
  list.style.left = rect.left + 'px'; list.style.top = (rect.bottom + 2) + 'px';
  list.style.width = (rect.right - rect.left + 60) + 'px';
}
function stopAllBounce() {
  _lastBouncingEls.forEach(el => { if (el) el.classList.remove('marker-bounce'); });
  _lastBouncingEls = [];
}
function bounceElement(el) {
  stopAllBounce();
  el.classList.remove('marker-bounce'); void el.offsetWidth;
  el.classList.add('marker-bounce');
  _lastBouncingEls = [el];
}
document.addEventListener('click', e => { if (!e.target.closest('.autocomplete-wrap')) hideAcList(); });

// ── Hover / Select ──
function hoverTx(idx) {
  let targetMarker = null;
  markerClusterGroup.eachLayer(layer => {
    if (!targetMarker && layer._groupItems && layer._groupItems.some(it => it.origIdx === idx)) targetMarker = layer;
  });
  if (!targetMarker) return;
  const ll = targetMarker.getLatLng();
  if (!map.getBounds().contains(ll)) {
    _hoverPanSuppressed = true;
    map.panTo(ll, { animate: true, duration: 0.25 });
    setTimeout(() => { _hoverPanSuppressed = false; }, 600);
  }
  const tryBounce = () => {
    const iconEl = targetMarker._icon; if (!iconEl) return;
    bounceElement(iconEl.firstElementChild || iconEl);
  };
  if (targetMarker._icon) tryBounce();
  else markerClusterGroup.zoomToShowLayer(targetMarker, () => setTimeout(tryBounce, 100));
}
function unhoverTx() { stopAllBounce(); hideMarkerTooltip(); }
function hoverCommunity(name) {
  stopAllBounce();
  const matched = [];
  markerClusterGroup.eachLayer(layer => {
    if (layer._groupLabel === name || (layer._groupItems && layer._groupItems.some(it => it.tx.community_name === name)))
      matched.push(layer);
  });
  if (matched.length === 0) return;
  const bounds = map.getBounds();
  const anyVisible = matched.some(m => m._icon && bounds.contains(m.getLatLng()));
  if (!anyVisible) {
    _hoverPanSuppressed = true;
    map.panTo(matched[0].getLatLng(), { animate: true, duration: 0.3 });
    setTimeout(() => { _hoverPanSuppressed = false; }, 600);
  }
  const first = matched.find(m => m._icon && bounds.contains(m.getLatLng())) || matched[0];
  const doBounce = () => { if (!first._icon) return; bounceElement(first._icon.firstElementChild || first._icon); };
  if (first._icon) doBounce(); else setTimeout(doBounce, 350);
}
function unhoverCommunity() { stopAllBounce(); }

// ── Search ──
async function doSearch() {
  const kw = document.getElementById('searchInput').value.trim();
  if (!kw) { alert('請輸入搜尋關鍵字'); return; }
  hideAcList(); lastSearchType = 'keyword';
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading"><div class="skeleton" style="height:60px;margin:16px"></div><div class="skeleton" style="height:60px;margin:16px"></div></div>';
  const limitVal = document.getElementById('limitSelect').value;
  let url = `${API_BASE}/api/search?keyword=${encodeURIComponent(kw)}&limit=${limitVal}&location_mode=${getLocationMode()}${getFilterParams()}`;
  if (_selectedCommunity) url += '&community=' + encodeURIComponent(_selectedCommunity);
  try {
    const resp = await fetch(url);
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) { results.innerHTML = `<div class="empty">❌ 伺服器回應異常 (HTTP ${resp.status})</div>`; return; }
    const data = await resp.json();
    if (!data.success) { results.innerHTML = '<div class="empty">❌ ' + (data.error || '搜尋失敗') + '</div>'; return; }
    handleSearchResult(data);
  } catch (e) { results.innerHTML = '<div class="empty">❌ 網路錯誤: ' + e.message + '</div>'; }
}

async function doAreaSearch() {
  const bounds = map.getBounds(); lastSearchType = 'area';
  const results = document.getElementById('results');
  results.innerHTML = '<div class="loading"><div class="skeleton" style="height:60px;margin:16px"></div></div>';
  const limitVal = document.getElementById('limitSelect').value;
  const url = `${API_BASE}/api/search_area?south=${bounds.getSouth()}&north=${bounds.getNorth()}&west=${bounds.getWest()}&east=${bounds.getEast()}&limit=${limitVal}&location_mode=${getLocationMode()}${getFilterParams()}`;
  try {
    const resp = await fetch(url);
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) { results.innerHTML = `<div class="empty">❌ 搜此區域失敗 (HTTP ${resp.status})</div>`; return; }
    const data = await resp.json();
    if (!data.success) { results.innerHTML = '<div class="empty">❌ ' + (data.error || '搜尋失敗') + '</div>'; return; }
    if (!data.transactions || data.transactions.length === 0) {
      results.innerHTML = '<div class="empty">😢 此區域沒有成交紀錄<br><span style="font-size:12px">試試放大地圖或移動到其他區域</span></div>';
      document.getElementById('summaryBar').style.display = 'none';
      markerGroup.clearLayers(); return;
    }
    handleSearchResult(data, false);
  } catch (e) { results.innerHTML = '<div class="empty">❌ 搜此區域失敗: ' + e.message + '</div>'; }
}

function handleSearchResult(data, fitBounds = true) {
  txData = data.transactions || [];
  if (!markerSettings.showLotAddr) txData = txData.filter(tx => !isLotAddress(tx.address_raw || tx.address || ''));
  if (txData.length === 0) {
    document.getElementById('results').innerHTML = '<div class="empty">😢 沒有找到符合條件的資料</div>';
    document.getElementById('summaryBar').style.display = 'none';
    markerGroup.clearLayers(); return;
  }
  window._communityName = data.community_name || null;
  window._searchType = data.search_type || 'address';
  window._summary = data.summary || {};
  communitySummaries = data.community_summaries || {};
  if (data.search_type === 'area') {
    collapsedCommunities = {};
    const cNames = [...new Set(txData.map(tx => tx.community_name).filter(Boolean))];
    cNames.forEach(cn => { collapsedCommunities[cn] = true; });
  } else { collapsedCommunities = {}; }
  sortData(currentSort); renderResults(); renderSummary(); plotMarkers(fitBounds);
  updateCollapsedSummary();
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.remove('show');
}

// ── Render Results ──
function renderResults() {
  const container = document.getElementById('results');
  const groups = [], communityMap = {}, noComItems = [];
  txData.forEach((tx, i) => {
    if (!markerSettings.showLotAddr && isLotAddress(tx.address_raw || tx.address || '')) return;
    const cn = tx.community_name || '';
    if (cn) { if (!(cn in communityMap)) { communityMap[cn] = groups.length; groups.push({ name: cn, items: [] }); } groups[communityMap[cn]].items.push({ tx, origIdx: i }); }
    else noComItems.push({ tx, origIdx: i });
  });
  let html = '';
  if (window._communityName && groups.length <= 1 && window._searchType !== 'area') {
    html += `<div style="padding:10px 14px;background:var(--green-bg);border-bottom:1px solid var(--border)"><span style="font-weight:800;font-size:14px;color:var(--green)">🏘️ ${escHtml(window._communityName)}</span></div>`;
  }
  groups.forEach(group => {
    const cn = group.name, isCollapsed = collapsedCommunities[cn] === true;
    const stats = communitySummaries[cn] || computeLocalStats(group.items);
    html += `<div class="community-group">`;
    const inlineStats = stats ? [stats.avg_unit_price_ping > 0 ? `均單 ${fmtAvgUnitWan(stats.avg_unit_price_ping)}` : '', stats.avg_ping > 0 ? `均面積 ${fmtAvgArea(stats.avg_ping)}` : '', stats.avg_ratio > 0 ? `公設 ${stats.avg_ratio.toFixed(0)}%` : ''].filter(Boolean) : [];
    html += `<div class="community-header" onclick="toggleCommunity(this,'${escAttr(cn)}')" onmouseenter="hoverCommunity('${escAttr(cn)}')" onmouseleave="unhoverCommunity()">
      <span class="ch-arrow ${isCollapsed ? '' : 'open'}">▶</span>
      <div style="flex:1;min-width:0"><div class="ch-name">${escHtml(cn)}</div>
      ${inlineStats.length ? `<div class="ch-stats-inline">${inlineStats.map(s => `<span>${s}</span>`).join('')}</div>` : ''}</div>
      <span class="ch-count">${group.items.length} 筆</span></div>`;
    if (stats) {
      html += `<div class="community-stats" id="cstats-${cssId(cn)}" style="${isCollapsed ? 'display:none' : ''}">
        <div class="cs-item"><span class="cs-label">📊 筆數</span><span class="cs-value">${group.items.length}</span></div>
        <div class="cs-item"><span class="cs-label">💰 均總</span><span class="cs-value">${fmtWan(stats.avg_price)}</span></div>
        <div class="cs-item"><span class="cs-label"> 均單</span><span class="cs-value">${fmtAvgUnitWan(stats.avg_unit_price_ping)}</span></div>
        <div class="cs-item"><span class="cs-label">📐 均面積</span><span class="cs-value">${fmtAvgArea(stats.avg_ping)}</span></div>
        <div class="cs-item"><span class="cs-label">🏗️ 公設</span><span class="cs-value" style="color:${stats.avg_ratio > 35 ? 'var(--red)' : stats.avg_ratio > 30 ? 'var(--orange)' : 'var(--green)'}">${stats.avg_ratio > 0 ? stats.avg_ratio.toFixed(1) + '%' : '-'}</span></div>
      </div>`;
    }
    html += `<div class="community-items ${isCollapsed ? 'collapsed' : ''}" id="citems-${cssId(cn)}" style="${isCollapsed ? 'max-height:0' : 'max-height:999999px'}">`;
    group.items.forEach(item => { html += renderTxCard(item.tx, item.origIdx); });
    html += `</div></div>`;
  });
  if (noComItems.length > 0) {
    if (groups.length > 0) html += `<div style="padding:6px 14px;background:var(--bg2);border-bottom:1px solid var(--border);font-size:12px;color:var(--text2);font-weight:600">其他交易 (${noComItems.length} 筆)</div>`;
    noComItems.forEach(item => { html += renderTxCard(item.tx, item.origIdx); });
  }
  if (!html) html = '<div class="empty">沒有資料</div>';
  container.innerHTML = html;
}

function renderTxCard(tx, idx) {
  const isActive = idx === activeCardIdx;
  if (!markerSettings.showLotAddr && isLotAddress(tx.address_raw || tx.address || '')) return '';
  const upWan = (tx.unit_price_ping || 0) / 10000;
  let priceClass = ''; if (upWan > 100) priceClass = ' price-high'; else if (upWan > 50) priceClass = ' price-mid'; else if (upWan > 0) priceClass = ' price-low';

  const avgPriceW = (tx.price || 0) / 10000, avgUnitW = upWan;
  let colorDot;
  if (markerSettings.bubbleMode === 'bivariate') {
    const bvColor = getBivariateColor(avgUnitW, avgPriceW);
    colorDot = `<svg class="tx-color-dot" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${bvColor}" stroke="#fff" stroke-width="1.5"/></svg>`;
  } else {
    const dotOuter = getColorForMode(markerSettings.outerMode, avgPriceW, avgUnitW);
    const dotInner = getColorForMode(markerSettings.innerMode, avgPriceW, avgUnitW);
    colorDot = `<svg class="tx-color-dot" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${dotOuter}" stroke="#fff" stroke-width="1.5"/><circle cx="9" cy="9" r="5" fill="${dotInner}"/></svg>`;
  }

  const cn = tx.community_name || '';
  const cnTag = cn ? `<span class="tx-community-tag" title="${escAttr(cn)}">${escHtml(cn)}</span>` : '';
  const cnRow = cnTag ? `<div class="tx-community-row">${cnTag}</div>` : '';
  const specialBadge = tx.is_special ? '<span class="special-badge">特殊</span>' : '';
  const parkingTag = tx.has_parking ? `<span class="tx-parking-tag">🚗 含車位${tx.parking_price > 0 ? ' ' + fmtWan(tx.parking_price) : ''}</span>` : '';

  return `<div class="tx-card${isActive ? ' active' : ''}${priceClass}${tx.is_special ? ' special' : ''}" onclick="selectTx(${idx})" onmouseenter="hoverTx(${idx})" onmouseleave="unhoverTx()" data-idx="${idx}">
    ${colorDot}
    <div class="tx-price-col"><div class="tx-price">${fmtWan(tx.price)}</div><div class="tx-unit">${fmtUnitPrice(tx.unit_price_ping)}</div></div>
    <div class="tx-addr" title="${escAttr(tx.address)}">${escHtml(tx.address)}${specialBadge}</div>
    ${cnRow}
    <div class="tx-detail-row">
      <span>📅 ${formatDateStr(tx.date_raw)}</span>
      <span>📐 ${fmtArea(tx.area_sqm, tx.area_ping)}</span>
      <span>🏠 ${tx.rooms || 0}房${tx.halls || 0}廳${tx.baths || 0}衛</span>
      ${tx.floor ? `<span>🏢 ${escHtml(String(tx.floor))}F/${escHtml(String(tx.total_floors))}F</span>` : ''}
      ${tx.public_ratio > 0 ? `<span class="tag">公設${tx.public_ratio}%</span>` : ''}
      ${tx.building_type ? `<span class="tag">${escHtml(tx.building_type)}</span>` : ''}
      ${parkingTag}
      ${tx.note ? `<span style="color:var(--text3);font-size:10px">📝 ${escHtml(tx.note.length > 30 ? tx.note.substring(0, 30) + '…' : tx.note)}</span>` : ''}
    </div>
  </div>`;
}

function computeLocalStats(items) {
  if (!items || items.length === 0) return null;
  let prices = [], ups = [], pings = [], ratios = [];
  items.forEach(({ tx }) => { if (tx.price > 0) prices.push(tx.price); if (tx.unit_price_ping > 0) ups.push(tx.unit_price_ping); if (tx.area_ping > 0) pings.push(tx.area_ping); if (tx.public_ratio > 0) ratios.push(tx.public_ratio); });
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return { count: items.length, avg_price: Math.round(avg(prices)), avg_unit_price_ping: avg(ups), avg_ping: avg(pings), avg_ratio: avg(ratios) };
}

function toggleCommunity(headerEl, name) {
  const isNowCollapsed = !collapsedCommunities[name]; collapsedCommunities[name] = isNowCollapsed;
  const itemsEl = document.getElementById('citems-' + cssId(name));
  const statsEl = document.getElementById('cstats-' + cssId(name));
  const arrow = headerEl.querySelector('.ch-arrow');
  if (itemsEl) { if (isNowCollapsed) { itemsEl.classList.add('collapsed'); itemsEl.style.maxHeight = '0'; } else { itemsEl.classList.remove('collapsed'); itemsEl.style.maxHeight = '999999px'; } }
  if (statsEl) statsEl.style.display = isNowCollapsed ? 'none' : '';
  if (arrow) arrow.classList.toggle('open', !isNowCollapsed);
}

function renderSummary() {
  const s = window._summary;
  if (!s || !s.total) { document.getElementById('summaryBar').style.display = 'none'; return; }
  const bar = document.getElementById('summaryBar'); bar.style.display = 'block';
  const avgUp = fmtUnitPrice(s.avg_unit_price_ping);
  const minUp = fmtUnitPrice(s.min_unit_price_ping);
  const maxUp = fmtUnitPrice(s.max_unit_price_ping);
  const comCount = Object.keys(communitySummaries).length;
  const comInfo = comCount > 0 ? ` ｜ <span class="val">${comCount}</span> 個建案` : '';
  bar.innerHTML = `共 <span class="val">${s.total}</span> 筆${comInfo} ｜ 均價 <span class="val">${fmtWan(s.avg_price)}</span> ｜ 均面積 <span class="val">${fmtAvgArea(s.avg_ping)}</span> ｜ 單價 <span class="val">${avgUp}</span><br>單價區間 <span class="val">${minUp}</span> ~ <span class="val">${maxUp}</span> ｜ 均公設 <span class="val">${s.avg_ratio || '-'}%</span>`;
}

// ══════════════════════════════════════════════════════════
// COLOR SYSTEMS
// ══════════════════════════════════════════════════════════

// ── Dual Ring: green -> yellow -> red HSL ──
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
function getUnitPriceColor(wan) { const t = markerSettings.unitThresholds; return priceColorGradient(wan, t[0], t[2]); }
function getTotalPriceColor(wan) { const t = markerSettings.totalThresholds; return priceColorGradient(wan, t[0], t[2]); }
function getColorForMode(mode, avgPriceWan, avgUnitWan) {
  if (mode === 'total_price') return getTotalPriceColor(avgPriceWan);
  return getUnitPriceColor(avgUnitWan);
}

// ── Bivariate Color Map (4x4 matrix) ──
// X-axis: unit_price (cyan), Y-axis: total_price (magenta)
function getBivariateQuartile(value, thresholds) {
  if (value <= thresholds[0]) return 0;
  if (value <= thresholds[1]) return 1;
  if (value <= thresholds[2]) return 2;
  return 3;
}

// Generate bivariate color from cyan (x) and magenta (y) mix
// Low cyan = light, High cyan = deep cyan
// Low magenta = light, High magenta = deep magenta
const BIVARIATE_MATRIX = [
  // y=0(low total)  y=1            y=2            y=3(high total)
  ['#e8f4f8', '#d4b9d5', '#c085be', '#8b3a8b'],  // x=0 (low unit)
  ['#b1dce5', '#a8a6c8', '#9e72b0', '#7a2d7a'],  // x=1
  ['#6bc5d2', '#7a8dba', '#8555a2', '#6a206a'],  // x=2
  ['#1fa5b5', '#4f6dac', '#5e3794', '#5a135a'],  // x=3 (high unit)
];

function getBivariateColor(unitPriceWan, totalPriceWan) {
  const q = markerSettings.bivUnitQ || [25, 40, 60];
  const tq = markerSettings.bivTotalQ || [800, 1500, 2500];
  const xi = getBivariateQuartile(unitPriceWan, q);
  const yi = getBivariateQuartile(totalPriceWan, tq);
  return BIVARIATE_MATRIX[xi][yi];
}

// ══════════════════════════════════════════════════════════
// MAP & MARKERS
// ══════════════════════════════════════════════════════════

function initMap() {
  map = L.map('map', { zoomControl: false }).setView([23.6978, 120.9605], 8);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, attribution: '&copy; OpenStreetMap & CartoDB'
  }).addTo(map);

  const iconCreateFn = function (cluster) {
    const markers = cluster.getAllChildMarkers();
    let totalPrice = 0, validP = 0, totalUnit = 0, validU = 0, totalCount = 0;
    markers.forEach(m => {
      const gc = m._groupCount || 1; totalCount += gc;
      if (m._avgPrice > 0) { totalPrice += m._avgPrice * gc; validP += gc; }
      if (m._avgUnitPrice > 0) { totalUnit += m._avgUnitPrice * gc; validU += gc; }
    });
    const avgPriceWan = validP > 0 ? (totalPrice / validP / 10000) : 0;
    const avgUnitWan = validU > 0 ? (totalUnit / validU / 10000) : 0;

    let sz = 44;
    if (totalCount >= 100) sz = 60; else if (totalCount >= 30) sz = 54; else if (totalCount >= 10) sz = 48;
    let priceText = '';
    if (avgPriceWan >= 10000) priceText = (avgPriceWan / 10000).toFixed(1) + '億';
    else if (avgPriceWan >= 1) priceText = avgPriceWan.toFixed(0) + '萬';

    const line1 = priceText || totalCount + '筆';
    const line2 = priceText ? totalCount + '筆' : '';
    let svgHtml;

    if (markerSettings.bubbleMode === 'bivariate') {
      const bvColor = getBivariateColor(avgUnitWan, avgPriceWan);
      svgHtml = makeBivariateSVG({ sz, color: bvColor, line1, line2 });
    } else {
      const outerColor = getColorForMode(markerSettings.outerMode, avgPriceWan, avgUnitWan);
      const innerColor = getColorForMode(markerSettings.innerMode, avgPriceWan, avgUnitWan);
      svgHtml = makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 });
    }

    const labels = markers.map(m => m._groupLabel).filter(Boolean);
    const uniqueLabels = [...new Set(labels)];
    const commLabel = uniqueLabels.length === 1 ? uniqueLabels[0].substring(0, 6) : (uniqueLabels.length > 1 ? uniqueLabels.length + ' 個建案' : '');
    const labelHtml = commLabel ? `<div style="margin-top:-2px;padding:1px 4px;background:rgba(255,255,255,.95);border-radius:5px;font-size:8px;font-weight:600;color:#333;white-space:nowrap;max-width:70px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.1);border:1px solid rgba(0,0,0,.06)">${commLabel}</div>` : '';
    const totalH = commLabel ? sz + 14 : sz;
    return L.divIcon({
      html: `<div style="display:flex;flex-direction:column;align-items:center">${svgHtml}${labelHtml}</div>`,
      className: 'price-marker custom-cluster-icon',
      iconSize: [sz + 8, totalH], iconAnchor: [(sz + 8) / 2, totalH / 2]
    });
  };

  markerClusterGroup = L.markerClusterGroup({
    spiderfyOnMaxZoom: true, showCoverageOnHover: false, zoomToBoundsOnClick: false,
    maxClusterRadius: 40, spiderfyDistanceMultiplier: 2.5, iconCreateFunction: iconCreateFn
  });
  markerClusterGroup.on('clusterclick', a => a.layer.spiderfy());
  markerClusterGroup.on('spiderfied', e => {
    e.cluster._icon.classList.add('spider-focus');
    e.markers.forEach(m => { if (m._icon) m._icon.classList.add('spider-focus'); });
    document.getElementById('map').classList.add('spiderfied-active');
  });
  markerClusterGroup.on('unspiderfied', e => {
    if (e.cluster._icon) e.cluster._icon.classList.remove('spider-focus');
    e.markers.forEach(m => { if (m._icon) m._icon.classList.remove('spider-focus'); });
    document.getElementById('map').classList.remove('spiderfied-active');
  });
  map.addLayer(markerClusterGroup);
  markerGroup = L.featureGroup().addTo(map);
  map.on('moveend', onMapMoveEnd);
  addLegend();
}

function makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 }) {
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

function makeBivariateSVG({ sz, color, line1, line2 }) {
  const cx = sz / 2, cy = sz / 2, r = sz / 2 - 1;
  const hasTwo = line1 && line2, y1 = hasTwo ? cy - 4 : cy, y2 = cy + 7;
  const fs1 = sz >= 54 ? 11 : 10, fs2 = sz >= 54 ? 9 : 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${sz}" height="${sz}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="rgba(255,255,255,.9)" stroke-width="2"/>
    ${line1 ? `<text x="${cx}" y="${y1}" text-anchor="middle" dominant-baseline="central" fill="#fff" font-size="${fs1}" font-weight="700" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.3)" stroke-width="1">${line1}</text>` : ''}
    ${line2 ? `<text x="${cx}" y="${y2}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,.9)" font-size="${fs2}" font-weight="600" font-family="Arial,sans-serif" style="paint-order:stroke" stroke="rgba(0,0,0,.2)" stroke-width=".6">${line2}</text>` : ''}
  </svg>`;
}

function baseAddress(addr) { if (!addr) return ''; return addr.replace(/\d+樓.*$/, '').replace(/\d+F.*$/i, '').replace(/地下.*$/, ''); }
function extractDistrict(tx) { return tx.district || ''; }

function buildGroups() {
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

function plotMarkers(fitBounds = true) {
  markerClusterGroup.clearLayers();
  const boundsArr = [], groups = buildGroups();
  groups.forEach(g => {
    const n = g.items.length; if (n === 0) return;
    const sortedLats = g.lats.slice().sort((a, b) => a - b), sortedLngs = g.lngs.slice().sort((a, b) => a - b), mid = Math.floor(sortedLats.length / 2);
    const lat = sortedLats[mid], lng = sortedLngs[mid];
    if (lat == null || lng == null || isNaN(lat) || isNaN(lng)) return;
    const useRecent = markerSettings.contentMode === 'recent2yr' && g.recentCount > 0;
    const avgPrice = useRecent ? g.recentAvgPrice : (g.prices.length ? g.prices.reduce((a, b) => a + b, 0) / g.prices.length : 0);
    const avgUnitPrice = useRecent ? g.recentAvgUnitPrice : (g.unitPrices.length ? g.unitPrices.reduce((a, b) => a + b, 0) / g.unitPrices.length : 0);
    const avgPriceWan = avgPrice / 10000, avgUnitWan = avgUnitPrice / 10000;
    const label = g.label ? g.label.substring(0, 8) : '';
    let priceText = '';
    if (avgPriceWan >= 10000) priceText = (avgPriceWan / 10000).toFixed(1) + '億';
    else if (avgPriceWan >= 1) priceText = Math.round(avgPriceWan) + '萬'; else priceText = '-';
    let sz = n >= 20 ? 56 : (n >= 5 ? 50 : 44); if (n === 1) sz = 42;
    let line1 = priceText, line2 = n === 1 ? '' : n + '筆';

    let svgHtml;
    if (markerSettings.bubbleMode === 'bivariate') {
      svgHtml = makeBivariateSVG({ sz, color: getBivariateColor(avgUnitWan, avgPriceWan), line1, line2 });
    } else {
      const outerColor = getColorForMode(markerSettings.outerMode, avgPriceWan, avgUnitWan);
      const innerColor = getColorForMode(markerSettings.innerMode, avgPriceWan, avgUnitWan);
      svgHtml = makeDualRingSVG({ sz, outerColor, innerColor, line1, line2 });
    }

    const labelHtml = label ? `<div style="margin-top:-2px;padding:1px 5px;background:rgba(255,255,255,.95);border-radius:5px;font-size:${n > 1 ? 9 : 8}px;font-weight:700;color:#333;white-space:nowrap;max-width:80px;overflow:hidden;text-overflow:ellipsis;box-shadow:0 1px 3px rgba(0,0,0,.1);border:1px solid rgba(0,0,0,.06)">${escHtml(label)}</div>` : '';
    const totalH = label ? sz + 15 : sz;
    const icon = L.divIcon({ html: `<div style="display:flex;flex-direction:column;align-items:center">${svgHtml}${labelHtml}</div>`, iconSize: [sz + 8, totalH], iconAnchor: [(sz + 8) / 2, totalH / 2], className: 'price-marker' });
    const marker = L.marker([lat, lng], { icon });
    marker._groupCount = n; marker._avgPrice = avgPrice; marker._avgUnitPrice = avgUnitPrice; marker._groupLabel = g.label; marker._groupItems = g.items;
    marker.on('mouseover', () => onMarkerHover(marker, g));
    marker.on('mouseout', () => onMarkerUnhover());
    marker.on('click', () => showClusterList(g.items));
    markerClusterGroup.addLayer(marker);
    boundsArr.push([lat, lng]);
  });
  if (fitBounds && boundsArr.length > 0) map.fitBounds(boundsArr, { padding: [40, 40], maxZoom: 18 });
}

function selectTx(idx) {
  activeCardIdx = idx; renderResults();
  const tx = txData[idx];
  if (tx && tx.lat && tx.lng) { map.setView([tx.lat, tx.lng], 17); }
}

// ── Marker tooltip ──
let _markerTooltipEl = null;
function onMarkerHover(marker, group) {
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
  showMarkerTooltip(marker, group);
}
function onMarkerUnhover() {
  stopAllBounce(); hideMarkerTooltip();
  document.querySelectorAll('.community-header.hover-highlight').forEach(h => h.classList.remove('hover-highlight'));
}
function formatDateStr(raw) {
  if (!raw) return '-';
  const s = String(raw).trim();
  if (s.length >= 7) {
    const rocY = parseInt(s.substring(0, s.length - 4), 10);
    const mm = s.substring(s.length - 4, s.length - 2);
    const dd = s.substring(s.length - 2);
    if (markerSettings.yearFormat === 'ce') return (rocY + 1911) + '/' + mm + '/' + dd;
    return rocY + '/' + mm + '/' + dd;
  }
  return s;
}
function fmtBuildDate(raw) {
  if (!raw) return '-';
  const s = String(raw).trim();
  if (s.length >= 5) { const y = markerSettings.yearFormat === 'ce' ? parseInt(s.substring(0, 3), 10) + 1911 : parseInt(s.substring(0, 3), 10); return y + '/' + s.substring(3, 5); }
  return s || '-';
}
function showMarkerTooltip(marker, group) {
  hideMarkerTooltip(); if (!marker._icon) return;
  const items = group.items || []; if (items.length === 0) return;
  const label = group.communityName || group.label || '';
  const years = items.map(({ tx }) => tx.date_raw ? formatDateStr(tx.date_raw).split('/')[0] : '').filter(Boolean);
  const uniqueYears = [...new Set(years)].sort();
  const yearRange = uniqueYears.length > 0 ? (uniqueYears.length <= 2 ? uniqueYears.join('-') : uniqueYears[0] + '-' + uniqueYears[uniqueYears.length - 1]) : '-';
  const floors = items.map(({ tx }) => tx.total_floors).filter(v => v > 0);
  const maxFloor = floors.length > 0 ? Math.max(...floors) : 0;
  const types = [...new Set(items.map(({ tx }) => tx.building_type).filter(Boolean))];
  const typeText = types.length > 0 ? types.slice(0, 2).join('/') : '-';
  const pings = items.map(({ tx }) => tx.area_ping).filter(v => v > 0);
  const avgPing = pings.length > 0 ? (pings.reduce((a, b) => a + b, 0) / pings.length).toFixed(0) : '-';
  const completionDates = [...new Set(items.map(({ tx }) => tx.completion_date).filter(Boolean))];
  const buildDateText = completionDates.length > 0 ? fmtBuildDate(completionDates[0]) : '-';
  const materials = [...new Set(items.map(({ tx }) => tx.main_material).filter(Boolean))];
  const materialText = materials.length > 0 ? materials.slice(0, 2).join('/') : '-';

  const tip = document.createElement('div');
  tip.className = 'marker-tooltip-info';
  tip.innerHTML = `${label ? `<div class="mti-name">${escHtml(label)}</div>` : ''}
    <div class="mti-row"><span>📅</span> ${yearRange}年 ｜ 完工 ${buildDateText}</div>
    ${maxFloor > 0 ? `<div class="mti-row"><span>🏢</span> ${maxFloor}樓 ｜ ${escHtml(typeText)} ${escHtml(materialText)}</div>` : `<div class="mti-row"><span>🏠</span> ${escHtml(typeText)} ${escHtml(materialText)}</div>`}
    <div class="mti-row"><span>📐</span> 均${fmtAvgArea(parseFloat(avgPing))}</div>`;
  const iconRect = marker._icon.getBoundingClientRect();
  tip.style.position = 'fixed'; tip.style.left = (iconRect.left + iconRect.width / 2) + 'px';
  tip.style.top = (iconRect.top - 8) + 'px'; tip.style.zIndex = '2000';
  document.body.appendChild(tip);
  _markerTooltipEl = tip;
}
function hideMarkerTooltip() { if (_markerTooltipEl) { _markerTooltipEl.remove(); _markerTooltipEl = null; } }

// ── Legend ──
let _legendControl = null, _legendDiv = null;
function updateLegend() {
  if (!_legendDiv) return;
  let legendContent = '';
  if (markerSettings.bubbleMode === 'bivariate') {
    // Bivariate legend: mini 4x4 matrix
    const q = markerSettings.bivUnitQ, tq = markerSettings.bivTotalQ;
    let matrixHtml = '<div style="display:grid;grid-template-columns:repeat(4,20px);gap:2px;margin:4px 0">';
    for (let yi = 3; yi >= 0; yi--) {
      for (let xi = 0; xi < 4; xi++) {
        matrixHtml += `<div style="width:20px;height:20px;border-radius:3px;background:${BIVARIATE_MATRIX[xi][yi]}"></div>`;
      }
    }
    matrixHtml += '</div>';
    const unitLabel = markerSettings.areaUnit === 'sqm' ? '萬/m²' : '萬/坪';
    const unitShort = markerSettings.areaUnit === 'sqm' ? '單價/m²' : '單價/坪';
    legendContent = `<div style="font-weight:700;margin-bottom:4px;font-size:12px">🎨 雙變數色彩圖例</div>
      <div style="font-size:10px;color:var(--text2)">→ ${unitShort}（青色）<br>↑ 總價（洋紅）</div>
      ${matrixHtml}
      <div style="font-size:9px;color:var(--text3)">單價: ≤${q[0]}|${q[0]}-${q[1]}|${q[1]}-${q[2]}|>${q[2]}${unitLabel}<br>總價: ≤${tq[0]}|${tq[0]}-${tq[1]}|${tq[1]}-${tq[2]}|>${tq[2]}萬</div>`;
  } else {
    const unitShort = markerSettings.areaUnit === 'sqm' ? '單價/m²' : '單價/坪';
    const unitLabel = markerSettings.areaUnit === 'sqm' ? '萬/m²' : '萬/坪';
    legendContent = `<div style="font-weight:700;margin-bottom:4px;font-size:12px">🎯 雙圈色彩圖例</div>
      <div style="font-weight:600;font-size:10px;color:var(--primary);margin-bottom:2px">● 外環＝${markerSettings.outerMode === 'unit_price' ? unitShort : '總價'} ｜ ● 內圈＝${markerSettings.innerMode === 'unit_price' ? unitShort : '總價'}</div>
      <div style="display:flex;align-items:center;gap:4px;font-size:10px"><div style="width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,hsl(155,55%,38%),hsl(60,60%,42%))"></div><span>低→中（綠→黃）</span></div>
      <div style="display:flex;align-items:center;gap:4px;font-size:10px"><div style="width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,hsl(60,60%,42%),hsl(0,65%,48%))"></div><span>中→高（黃→紅）</span></div>
      <div style="font-size:9px;color:var(--text3);margin-top:2px">單價: ${markerSettings.unitThresholds[0]}~${markerSettings.unitThresholds[2]}${unitLabel}<br>總價: ${markerSettings.totalThresholds[0]}~${markerSettings.totalThresholds[2]}萬</div>`;
  }

  _legendDiv.innerHTML = `<div style="background:#fff;padding:10px 12px;border-radius:var(--radius);box-shadow:var(--shadow-md);font-size:11px;line-height:1.7;min-width:160px;border:1px solid var(--border)">
    ${legendContent}
    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
      <button onclick="toggleSettings()" title="設定" style="width:28px;height:28px;padding:0;display:flex;align-items:center;justify-content:center;font-size:14px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;cursor:pointer;">⚙️</button>
      <div class="area-toggle-wrap">
        <label class="area-toggle"><input type="checkbox" id="areaToggle" ${areaAutoSearch ? 'checked' : ''} onchange="toggleAreaAutoSearch(this.checked)"><span class="area-toggle-slider"></span></label>
        <span class="area-toggle-label">自動顯示建案</span>
      </div>
    </div>
  </div>`;
}
function addLegend() {
  if (_legendControl) return;
  _legendControl = L.control({ position: 'bottomright' });
  _legendControl.onAdd = function () {
    _legendDiv = L.DomUtil.create('div', '');
    updateLegend();
    L.DomEvent.disableScrollPropagation(_legendDiv);
    L.DomEvent.disableClickPropagation(_legendDiv);
    return _legendDiv;
  };
  _legendControl.addTo(map);
}

// ── Location ──
function locateMe() {
  if (!navigator.geolocation) { alert('您的瀏覽器不支援定位功能'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    map.setView([lat, lng], 16);
    if (locationMarker) map.removeLayer(locationMarker);
    if (locationCircle) map.removeLayer(locationCircle);
    locationCircle = L.circle([lat, lng], { radius: accuracy, color: 'var(--primary)', fillColor: 'var(--primary)', fillOpacity: .1, weight: 1 }).addTo(map);
    locationMarker = L.marker([lat, lng], { icon: L.divIcon({ html: '<div class="locate-pulse"></div>', iconSize: [16, 16], className: '' }), zIndexOffset: 1000 }).addTo(map).bindPopup(`📍 您的位置<br><span style="font-size:11px;color:var(--text2)">精確度: ±${Math.round(accuracy)}m</span>`).openPopup();
    setTimeout(() => { if (locationCircle) { map.removeLayer(locationCircle); locationCircle = null; } }, 5000);
  }, err => { alert('定位失敗: ' + err.message); }, { enableHighAccuracy: true, timeout: 10000 });
}

function showClusterList(items) {
  const container = document.getElementById('results');
  const comGroups = {}; items.forEach(it => { const cn = it.tx.community_name || '未知建案'; if (!comGroups[cn]) comGroups[cn] = []; comGroups[cn].push(it); });
  const comList = Object.entries(comGroups).sort((a, b) => b[1].length - a[1].length);
  let html = `<div class="cluster-list-header"><span>📍 此位置 ${items.length} 筆重疊資料</span><button onclick="renderResults()">↩ 返回全列表</button></div>`;
  comList.forEach(([cn, comItems]) => {
    html += `<div style="padding:6px 12px;background:#fff;border-bottom:1px solid var(--border);font-weight:600;font-size:13px;color:var(--text)">🏘️ ${escHtml(cn)}（${comItems.length}筆）</div>`;
    comItems.forEach(({ tx, origIdx }) => { html += renderTxCard(tx, origIdx); });
  });
  container.innerHTML = html;
  if (window.innerWidth <= 768) document.getElementById('sidebar').classList.add('show');
}

// ── Settings ──
function toggleSettings() {
  document.getElementById('settingsPanel').classList.toggle('show');
  document.getElementById('settingsOverlay').classList.toggle('show');
}
function onBubbleModeChange() {
  markerSettings.bubbleMode = document.getElementById('sBubbleMode').value;
  document.getElementById('dualRingSettings').style.display = markerSettings.bubbleMode === 'dual_ring' ? '' : 'none';
  document.getElementById('bivariateSettings').style.display = markerSettings.bubbleMode === 'bivariate' ? '' : 'none';
  if (markerSettings.bubbleMode === 'bivariate') renderBivariatePreview();
  applySettings();
}
function renderBivariatePreview() {
  const container = document.getElementById('bivMatrixPreview');
  if (!container) return;
  let html = '';
  for (let yi = 3; yi >= 0; yi--) {
    for (let xi = 0; xi < 4; xi++) {
      html += `<div class="biv-cell" style="background:${BIVARIATE_MATRIX[xi][yi]}"></div>`;
    }
  }
  container.innerHTML = html;
}
function updateThresh() {
  let um1 = parseInt(document.getElementById('unitMin').value, 10);
  let um2 = parseInt(document.getElementById('unitMax').value, 10);
  if (um1 >= um2) { um1 = Math.max(0, um2 - 5); document.getElementById('unitMin').value = um1; }
  document.getElementById('vUnitMin').textContent = um1;
  document.getElementById('vUnitMax').textContent = um2;
  let tm1 = parseInt(document.getElementById('totalMin').value, 10);
  let tm2 = parseInt(document.getElementById('totalMax').value, 10);
  if (tm1 >= tm2) { tm1 = Math.max(0, tm2 - 100); document.getElementById('totalMin').value = tm1; }
  document.getElementById('vTotalMin').textContent = tm1;
  document.getElementById('vTotalMax').textContent = tm2;
  markerSettings.unitThresholds = [um1, (um1 + um2) / 2, um2];
  markerSettings.totalThresholds = [tm1, (tm1 + tm2) / 2, tm2];
  updateLegend();
  if (txData.length > 0) {
    clearTimeout(window._replotTimer);
    window._replotTimer = setTimeout(() => { plotMarkers(false); }, 300);
  }
}
function applySettings() {
  markerSettings.outerMode = document.getElementById('sOuter').value;
  markerSettings.innerMode = document.getElementById('sInner').value;
  markerSettings.showLotAddr = document.getElementById('sShowLotAddr').checked;
  markerSettings.yearFormat = document.getElementById('sYearFormat') ? document.getElementById('sYearFormat').value : 'roc';
  markerSettings.contentMode = document.getElementById('sContent') ? document.getElementById('sContent').value : 'recent2yr';
  markerSettings.osmZoom = parseInt(document.getElementById('sOsmZoom').value, 10) || 16;
  markerSettings.bubbleMode = document.getElementById('sBubbleMode').value;
  markerSettings.areaUnit = document.getElementById('sAreaUnit') ? document.getElementById('sAreaUnit').value : 'ping';

  // Bivariate thresholds
  const bq1 = parseInt(document.getElementById('bivUnitQ1').value, 10);
  const bq2 = parseInt(document.getElementById('bivUnitQ2').value, 10);
  const bq3 = parseInt(document.getElementById('bivUnitQ3').value, 10);
  if (bq1 > 0 && bq2 > bq1 && bq3 > bq2) markerSettings.bivUnitQ = [bq1, bq2, bq3];
  const btq1 = parseInt(document.getElementById('bivTotalQ1').value, 10);
  const btq2 = parseInt(document.getElementById('bivTotalQ2').value, 10);
  const btq3 = parseInt(document.getElementById('bivTotalQ3').value, 10);
  if (btq1 > 0 && btq2 > btq1 && btq3 > btq2) markerSettings.bivTotalQ = [btq1, btq2, btq3];

  localStorage.setItem('markerSettings', JSON.stringify(markerSettings));
  updateLegend();
  if (txData.length > 0) { renderResults(); plotMarkers(false); }
}
function loadSettings() {
  try {
    const saved = localStorage.getItem('markerSettings');
    if (saved) Object.assign(markerSettings, JSON.parse(saved));
  } catch (e) { }
  // Ensure valid defaults
  if (!markerSettings.unitThresholds || markerSettings.unitThresholds.length !== 3) markerSettings.unitThresholds = [20, 45, 70];
  if (!markerSettings.totalThresholds || markerSettings.totalThresholds.length !== 3) markerSettings.totalThresholds = [500, 1750, 3000];
  if (!markerSettings.bivUnitQ || markerSettings.bivUnitQ.length !== 3) markerSettings.bivUnitQ = [25, 40, 60];
  if (!markerSettings.bivTotalQ || markerSettings.bivTotalQ.length !== 3) markerSettings.bivTotalQ = [800, 1500, 2500];
  if (!markerSettings.bubbleMode) markerSettings.bubbleMode = 'dual_ring';
  if (!markerSettings.areaUnit) markerSettings.areaUnit = 'ping';

  document.getElementById('sOuter').value = markerSettings.outerMode || 'unit_price';
  document.getElementById('sInner').value = markerSettings.innerMode || 'total_price';
  document.getElementById('sShowLotAddr').checked = !!markerSettings.showLotAddr;
  if (document.getElementById('sYearFormat')) document.getElementById('sYearFormat').value = markerSettings.yearFormat || 'roc';
  if (document.getElementById('sContent')) document.getElementById('sContent').value = markerSettings.contentMode || 'recent2yr';
  if (document.getElementById('sOsmZoom')) document.getElementById('sOsmZoom').value = markerSettings.osmZoom || 16;
  if (document.getElementById('sAreaUnit')) document.getElementById('sAreaUnit').value = markerSettings.areaUnit || 'ping';
  document.getElementById('sBubbleMode').value = markerSettings.bubbleMode;
  document.getElementById('dualRingSettings').style.display = markerSettings.bubbleMode === 'dual_ring' ? '' : 'none';
  document.getElementById('bivariateSettings').style.display = markerSettings.bubbleMode === 'bivariate' ? '' : 'none';

  // Bivariate thresholds
  document.getElementById('bivUnitQ1').value = markerSettings.bivUnitQ[0];
  document.getElementById('bivUnitQ2').value = markerSettings.bivUnitQ[1];
  document.getElementById('bivUnitQ3').value = markerSettings.bivUnitQ[2];
  document.getElementById('bivTotalQ1').value = markerSettings.bivTotalQ[0];
  document.getElementById('bivTotalQ2').value = markerSettings.bivTotalQ[1];
  document.getElementById('bivTotalQ3').value = markerSettings.bivTotalQ[2];

  const ut = markerSettings.unitThresholds, tt = markerSettings.totalThresholds;
  document.getElementById('unitMin').value = ut[0]; document.getElementById('unitMax').value = ut[2];
  document.getElementById('totalMin').value = tt[0]; document.getElementById('totalMax').value = tt[2];
  updateThresh();
  renderBivariatePreview();
  updateLegend();
}

// ── Area auto search ──
function toggleAreaAutoSearch(on) {
  areaAutoSearch = on;
  try { localStorage.setItem('areaAutoSearch', on ? '1' : '0'); } catch (e) { }
  if (on && map && map.getZoom() >= (markerSettings.osmZoom || 16)) doAreaSearch();
}
function onMapMoveEnd() {
  if (!areaAutoSearch || _hoverPanSuppressed) return;
  if (map.getZoom() < (markerSettings.osmZoom || 16)) return;
  clearTimeout(_areaSearchTimer);
  _areaSearchTimer = setTimeout(() => {
    if (!_hoverPanSuppressed && areaAutoSearch && map.getZoom() >= (markerSettings.osmZoom || 16)) doAreaSearch();
  }, 800);
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === '/' || e.key === 's') { document.getElementById('searchInput').focus(); e.preventDefault(); }
});

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  loadSettings(); initMap();
  try {
    const saved = localStorage.getItem('areaAutoSearch');
    if (saved === '1') { areaAutoSearch = true; const cb = document.getElementById('areaToggle'); if (cb) cb.checked = true; }
  } catch (e) { }
  window.addEventListener('resize', hideAcList);
  // Close filter dropdown when clicking outside
  document.addEventListener('click', e => {
    const dd = document.getElementById('filterDropdown');
    const btn = document.getElementById('filterToggleBtn');
    if (dd.classList.contains('show') && !dd.contains(e.target) && !btn.contains(e.target)) {
      dd.classList.remove('show'); btn.classList.remove('active');
    }
  });
  if (window.innerWidth <= 768) {
    map.on('click', () => { document.getElementById('sidebar').classList.remove('show'); });
  }
});
