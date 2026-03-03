export const API_BASE = 'https://volodos.cs.nthu.edu.tw:5001';

export async function fetchAcResults(kw) {
  try {
    const resp = await fetch(`${API_BASE}/api/com_match?keyword=${encodeURIComponent(kw)}&top_n=8`);
    const data = await resp.json();
    if (data.success && data.results && data.results.length > 0) {
      return data.results;
    }
    return [];
  } catch (e) {
    return [];
  }
}

export async function doSearchApi(kw, limitVal, locationMode, filterParams, selectedCommunity) {
  let url = `${API_BASE}/api/search?keyword=${encodeURIComponent(kw)}&limit=${limitVal}&location_mode=${locationMode}${filterParams}`;
  if (selectedCommunity) url += '&community=' + encodeURIComponent(selectedCommunity);

  try {
    const resp = await fetch(url);
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      return { success: false, error: `伺服器回應異常 (HTTP ${resp.status})`, errorType: 'http' };
    }
    const data = await resp.json();
    if (!data.success) {
      return { success: false, error: data.error || '搜尋失敗', errorType: 'api' };
    }
    return data;
  } catch (e) {
    return { success: false, error: `網路連線異常，請稍後再試<br><span style="font-size:12px">(${e.message})</span>`, errorType: 'network' };
  }
}

let _areaSearchController = null;

export async function doAreaSearchApi(bounds, limitVal, locationMode, filterParams) {
  if (_areaSearchController) {
    _areaSearchController.abort();
  }
  _areaSearchController = new AbortController();

  const url = `${API_BASE}/api/search_area?south=${bounds.getSouth()}&north=${bounds.getNorth()}&west=${bounds.getWest()}&east=${bounds.getEast()}&limit=${limitVal}&location_mode=${locationMode}${filterParams}`;
  try {
    const resp = await fetch(url, { signal: _areaSearchController.signal });
    const ctype = resp.headers.get('content-type') || '';
    if (!ctype.includes('application/json')) {
      return { success: false, error: `搜此區域失敗 (HTTP ${resp.status})`, errorType: 'http' };
    }
    const data = await resp.json();
    if (!data.success) {
      return { success: false, error: data.error || '搜尋失敗', errorType: 'api' };
    }
    return data;
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, aborted: true };
    return { success: false, error: `網路連線異常，請稍後再試<br><span style="font-size:12px">(${e.message})</span>`, errorType: 'network' };
  } finally {
    if (_areaSearchController && !_areaSearchController.signal.aborted) {
      _areaSearchController = null;
    }
  }
}
