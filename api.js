// api.js

export const API_BASE = 'https://volodos.cs.nthu.edu.tw:5001';

export async function fetchAcResultsFromApi(kw) {
    try {
        const resp = await fetch(`${API_BASE}/api/com_match?keyword=${encodeURIComponent(kw)}&top_n=8`);
        const data = await resp.json();
        return data;
    } catch (e) {
        throw e;
    }
}

export async function doSearchApi(kw, limitVal, locationMode, filterParams, selectedCommunity) {
    let url = `${API_BASE}/api/search?keyword=${encodeURIComponent(kw)}&limit=${limitVal}&location_mode=${locationMode}${filterParams}`;
    if (selectedCommunity) url += '&community=' + encodeURIComponent(selectedCommunity);

    try {
        const resp = await fetch(url);
        const ctype = resp.headers.get('content-type') || '';
        if (!ctype.includes('application/json')) {
            throw new Error(`伺服器回應異常 (HTTP ${resp.status})`);
        }
        const data = await resp.json();
        return data;
    } catch (e) {
        throw e;
    }
}

export async function doAreaSearchApi(bounds, limitVal, locationMode, filterParams, signal) {
    const url = `${API_BASE}/api/search_area?south=${bounds.getSouth()}&north=${bounds.getNorth()}&west=${bounds.getWest()}&east=${bounds.getEast()}&limit=${limitVal}&location_mode=${locationMode}${filterParams}`;
    try {
        const resp = await fetch(url, { signal });
        const ctype = resp.headers.get('content-type') || '';
        if (!ctype.includes('application/json')) {
            throw new Error(`搜此區域失敗 (HTTP ${resp.status})`);
        }
        const data = await resp.json();
        return data;
    } catch (e) {
        throw e;
    }
}