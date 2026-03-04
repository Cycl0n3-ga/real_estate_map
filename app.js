// app.js
import { fetchAcResultsFromApi, doSearchApi, doAreaSearchApi } from './api.js';
import {
    initMapInstance, plotMarkersOnMap, hoverTxOnMap, unhoverTxOnMap,
    hoverCommunityOnMap, unhoverCommunityOnMap, locateUserOnMap,
    addLegendToMap, updateLegendOnMap,
    getColorForMode, getBivariateColor, isLotAddress
} from './map.js';

const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

const PING_TO_SQM = 3.305785;

createApp({
    setup() {
        // --- State ---
        const searchKeyword = ref('');
        const showAcList = ref(false);
        const acResults = ref([]);
        const acIdx = ref(-1);
        let _acTimer = null;

        const selectedCommunity = ref('');
        const searchedCommunityName = ref(null);
        const searchType = ref('address');
        const lastSearchType = ref('');
        let _areaSearchController = null;
        let _areaSearchTimer = null;

        const sidebarCollapsed = ref(false);
        const sidebarShowMobile = ref(false);
        const isHoveringList = ref(false);

        const showSettings = ref(false);
        const markerSettings = reactive({
            bubbleMode: 'dual_ring',
            outerMode: 'unit_price', innerMode: 'total_price',
            contentMode: 'recent2yr',
            unitThresholds: [20, 45, 70], totalThresholds: [500, 1750, 3000],
            displayLogic: 'auto', osmZoom: 16, showLotAddr: false, yearFormat: 'roc',
            useExactLocation: false,
            autoThresh14: 8000, autoThresh15: 5000, autoThresh16: 2000, autoThresh17: 0,
            areaUnit: 'ping', themeMode: 'light',
            bivUnitQ: [25, 40, 60], bivTotalQ: [800, 1500, 2500],
        });

        // Range slider bounds helpers
        const unitThresholdsMin = ref(20);
        const unitThresholdsMax = ref(70);
        const totalThresholdsMin = ref(500);
        const totalThresholdsMax = ref(3000);

        const showFilters = ref(false);
        const filters = reactive({
            buildType: '', rooms: '', ping: '', ratio: '', unitPrice: '', price: '', year: '', excludeSpecial: false
        });
        const quickFilterActive = ref('');

        const sortOptions = [
            { label: '日期', value: 'date' }, { label: '總價', value: 'price' },
            { label: '單價', value: 'unit_price' }, { label: '坪數', value: 'ping' },
            { label: '公設', value: 'public_ratio' }, { label: '建案', value: 'community' }
        ];
        const currentSort = ref('date');
        const sortDirection = ref('desc');
        const limitSelect = ref('2500');

        const isLoading = ref(false);
        const searchMessage = ref('');

        const txData = ref([]);
        const summary = ref({});
        const communitySummaries = ref({});
        const collapsedCommunities = reactive({});
        const hoveredCommunity = ref(null);

        const resultGroups = ref([]);
        const noComItems = ref([]);

        const activeCardIdx = ref(-1);

        const clusterListItems = ref([]);
        const clusterGroups = ref([]);

        const areaAutoSearch = ref(true);
        let _hoverPanSuppressed = false;

        // Map integration refs
        let mapInstance = null;
        let markerClusterGroup = null;
        let markerGroup = null;

        const windowWidth = ref(window.innerWidth);

        // --- Computed ---
        const hamburgerIcon = computed(() => {
            if (windowWidth.value <= 768) return sidebarCollapsed.value ? '▲' : '▼';
            return sidebarCollapsed.value ? '▶' : '◀';
        });

        const hasActiveFilters = computed(() => {
            return Object.values(filters).some(val => val !== '' && val !== false);
        });

        const summaryHtml = computed(() => {
            const s = summary.value;
            if (!s || !s.total) return '';
            const avgUp = fmtUnitPrice(s.avg_unit_price_ping);
            const minUp = fmtUnitPrice(s.min_unit_price_ping);
            const maxUp = fmtUnitPrice(s.max_unit_price_ping);
            const comCount = Object.keys(communitySummaries.value).length;
            const comInfo = comCount > 0 ? ` ｜ <span class="val">${comCount}</span> 個建案` : '';
            return `共 <span class="val">${s.total}</span> 筆${comInfo} ｜ 均價 <span class="val">${fmtWan(s.avg_price)}</span> ｜ 均面積 <span class="val">${fmtAvgArea(s.avg_ping)}</span> ｜ 單價 <span class="val">${avgUp}</span><br>單價區間 <span class="val">${minUp}</span> ~ <span class="val">${maxUp}</span> ｜ 均公設 <span class="val">${s.avg_ratio || '-'}%</span>`;
        });

        // --- Formatter & Utilities ---
        const escHtml = s => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        const fmtWan = v => { if (!v || v <= 0) return '-'; const w = v / 10000; return w >= 10000 ? (w / 10000).toFixed(1) + '億' : Math.round(w) + '萬'; };
        const fmtArea = (sqm, ping) => {
            if (markerSettings.areaUnit === 'sqm') {
                const m2 = sqm > 0 ? sqm : (ping > 0 ? ping * PING_TO_SQM : 0);
                return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
            }
            return ping > 0 ? ping.toFixed(1) + '坪' : (sqm > 0 ? (sqm / PING_TO_SQM).toFixed(1) + '坪' : '-');
        };
        const fmtUnitPrice = (unitPricePing) => {
            if (markerSettings.areaUnit === 'sqm') {
                if (unitPricePing <= 0) return '-';
                return Math.round((unitPricePing / PING_TO_SQM) / 10000) + '萬/m²';
            }
            return unitPricePing > 0 ? Math.round(unitPricePing / 10000) + '萬/坪' : '-';
        };
        const fmtAvgArea = (avgPing) => {
            if (markerSettings.areaUnit === 'sqm') {
                const m2 = avgPing > 0 ? avgPing * PING_TO_SQM : 0;
                return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
            }
            return avgPing > 0 ? avgPing.toFixed(1) + '坪' : '-';
        };
        const fmtAvgUnitWan = (unitPricePing) => {
            if (markerSettings.areaUnit === 'sqm') {
                if (unitPricePing <= 0) return '-';
                return (unitPricePing / PING_TO_SQM / 10000).toFixed(1) + '萬/m²';
            }
            return unitPricePing > 0 ? (unitPricePing / 10000).toFixed(1) + '萬/坪' : '-';
        };

        const formatDateStr = (raw) => {
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
        };

        const getMatchTagClass = (matchType) => {
            return matchType === '精確' ? 'exact' : (matchType === '包含' ? 'contains' : 'fuzzy');
        };

        const getPriceClass = (tx) => {
             const upWan = (tx.unit_price_ping || 0) / 10000;
             if (upWan > 100) return 'price-high';
             if (upWan > 50) return 'price-mid';
             if (upWan > 0) return 'price-low';
             return '';
        };

        const getColorDotSvg = (tx) => {
            const upWan = (tx.unit_price_ping || 0) / 10000;
            const avgPriceW = (tx.price || 0) / 10000, avgUnitW = upWan;
            if (markerSettings.bubbleMode === 'bivariate') {
                const bvColor = getBivariateColor(avgUnitW, avgPriceW, markerSettings);
                return `<svg class="tx-color-dot" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${bvColor}" stroke="#fff" stroke-width="1.5"/></svg>`;
            } else {
                const dotOuter = getColorForMode(markerSettings.outerMode, avgPriceW, avgUnitW, markerSettings);
                const dotInner = getColorForMode(markerSettings.innerMode, avgPriceW, avgUnitW, markerSettings);
                return `<svg class="tx-color-dot" width="18" height="18" viewBox="0 0 18 18"><circle cx="9" cy="9" r="8" fill="${dotOuter}" stroke="#fff" stroke-width="1.5"/><circle cx="9" cy="9" r="5" fill="${dotInner}"/></svg>`;
            }
        };

        // --- Methods ---
        const toggleSidebar = () => {
            if (sidebarCollapsed.value) {
                sidebarCollapsed.value = false;
                if (windowWidth.value <= 768) sidebarShowMobile.value = true;
            } else {
                if (windowWidth.value <= 768) {
                    sidebarShowMobile.value = false;
                    sidebarCollapsed.value = true;
                } else {
                    sidebarCollapsed.value = true;
                    sidebarShowMobile.value = false;
                }
            }
        };

        const toggleSettings = () => {
            showSettings.value = !showSettings.value;
        };

        const toggleFilters = () => {
             showFilters.value = !showFilters.value;
        };

        const clearFilters = () => {
            filters.buildType = ''; filters.rooms = ''; filters.ping = '';
            filters.ratio = ''; filters.unitPrice = ''; filters.price = '';
            filters.year = ''; filters.excludeSpecial = false;
            quickFilterActive.value = '';
        };

        const applyFiltersAndSearch = () => {
            showFilters.value = false;
            doSearch();
        };

        const quickFilter = (mode) => {
            const nowYear = new Date().getFullYear() - 1911;
            if (mode === '1yr') {
                filters.year = `${nowYear - 1}-${nowYear}`;
                quickFilterActive.value = '1yr';
            } else if (mode === '2yr') {
                filters.year = `${nowYear - 2}-${nowYear}`;
                quickFilterActive.value = '2yr';
            } else if (mode === 'nospecial') {
                filters.excludeSpecial = !filters.excludeSpecial;
                if(filters.excludeSpecial) quickFilterActive.value = 'nospecial';
                else quickFilterActive.value = '';
            } else if (mode === 'clear') {
                clearFilters();
                if (txData.value.length > 0) rerunSearch();
                return;
            }
            if (txData.value.length > 0) rerunSearch();
        };

        const getFilterParamsString = () => {
            let p = '';
            if(filters.buildType) p += `&building_type=${encodeURIComponent(filters.buildType)}`;
            if(filters.rooms) p += `&rooms=${encodeURIComponent(filters.rooms)}`;
            if(filters.ping) p += `&ping=${encodeURIComponent(filters.ping)}`;
            if(filters.ratio) p += `&public_ratio=${encodeURIComponent(filters.ratio)}`;
            if(filters.unitPrice) p += `&unit_price=${encodeURIComponent(filters.unitPrice)}`;
            if(filters.price) p += `&price=${encodeURIComponent(filters.price)}`;
            if(filters.year) p += `&year=${encodeURIComponent(filters.year)}`;
            if(filters.excludeSpecial) p += `&exclude_special=1`;
            return p;
        };

        const getLocationMode = () => {
            const z = mapInstance ? mapInstance.getZoom() : 15;
            return z >= (markerSettings.osmZoom || 16) ? 'osm' : 'db';
        };

        // --- Autocomplete ---
        const hideAcList = () => { showAcList.value = false; acResults.value = []; acIdx.value = -1; };

        const handleSearchKeydown = (e) => {
            if (showAcList.value && acResults.value.length > 0) {
                if (e.key === 'ArrowDown') { e.preventDefault(); acIdx.value = Math.min(acIdx.value + 1, acResults.value.length - 1); return; }
                if (e.key === 'ArrowUp') { e.preventDefault(); acIdx.value = Math.max(acIdx.value - 1, -1); return; }
                if (e.key === 'Enter' && acIdx.value >= 0) { e.preventDefault(); selectCommunity(acResults.value[acIdx.value].name); return; }
            }
            if (e.key === 'Escape') { hideAcList(); return; }
            if (e.key === 'Enter') doSearch();
        };

        const onSearchInput = () => {
            if (selectedCommunity.value) clearSelectedCommunity();
            const kw = searchKeyword.value.trim();
            if (kw.length < 2) { hideAcList(); return; }
            clearTimeout(_acTimer);
            _acTimer = setTimeout(async () => {
                try {
                    const data = await fetchAcResultsFromApi(kw);
                    if (data.success && data.results && data.results.length > 0) {
                        acResults.value = data.results; acIdx.value = -1; showAcList.value = true;
                    } else hideAcList();
                } catch(e) { hideAcList(); }
            }, 250);
        };

        const selectCommunity = (name) => {
            selectedCommunity.value = name;
            searchKeyword.value = name;
            hideAcList(); doSearch();
        };

        const clearSelectedCommunity = () => {
            selectedCommunity.value = '';
        };

        // --- Search ---
        const doSearch = async () => {
            const kw = searchKeyword.value.trim();
            if (!kw && !hasActiveFilters.value && !selectedCommunity.value) {
                alert('請輸入搜尋關鍵字或選擇篩選條件'); return;
            }
            if (!kw && !selectedCommunity.value) {
                doAreaSearch(); return;
            }

            hideAcList(); lastSearchType.value = 'keyword';
            isLoading.value = true; searchMessage.value = '';
            txData.value = [];

            try {
                const data = await doSearchApi(kw, limitSelect.value, getLocationMode(), getFilterParamsString(), selectedCommunity.value);
                if (!data.success) {
                    searchMessage.value = `❌ ${data.error || '搜尋失敗'}`;
                } else {
                    handleSearchResult(data);
                }
            } catch (e) {
                searchMessage.value = `❌ 網路連線異常，請稍後再試<br><span style="font-size:12px">(${e.message})</span>`;
            } finally {
                isLoading.value = false;
            }
        };

        const doAreaSearch = async () => {
            if (_areaSearchController) _areaSearchController.abort();
            _areaSearchController = new AbortController();

            const bounds = mapInstance.getBounds(); lastSearchType.value = 'area';
            isLoading.value = true; searchMessage.value = '';

            try {
                const data = await doAreaSearchApi(bounds, limitSelect.value, getLocationMode(), getFilterParamsString(), _areaSearchController.signal);
                if (!data.success) {
                    searchMessage.value = `❌ ${data.error || '搜尋失敗'}`;
                } else if (!data.transactions || data.transactions.length === 0) {
                    searchMessage.value = '😢 此區域沒有成交紀錄<br><span style="font-size:12px">試試放大地圖或移動到其他區域</span>';
                    summary.value = {};
                    if(markerClusterGroup) markerClusterGroup.clearLayers();
                    txData.value = [];
                    processResults();
                } else {
                    handleSearchResult(data, false);
                }
            } catch (e) {
                if (e.name === 'AbortError') return;
                searchMessage.value = `❌ 網路連線異常，請稍後再試<br><span style="font-size:12px">(${e.message})</span>`;
            } finally {
                if (_areaSearchController && !_areaSearchController.signal.aborted) {
                    _areaSearchController = null;
                }
                isLoading.value = false;
            }
        };

        const rerunSearch = () => {
            if (lastSearchType.value === 'area') doAreaSearch();
            else if (lastSearchType.value === 'keyword') doSearch();
        };

        const handleSearchResult = (data, fitBounds = true) => {
            let resData = data.transactions || [];
            if (!markerSettings.showLotAddr) resData = resData.filter(tx => !isLotAddress(tx.address_raw || tx.address || ''));

            if (data.search_type !== 'area' && selectedCommunity.value) {
                const mainCounty = data.district ? data.district.substring(0, 3) : '';
                if (mainCounty) {
                    resData = resData.filter(tx => {
                        const txCounty = tx.district ? tx.district.substring(0, 3) : '';
                        return !txCounty || txCounty === mainCounty;
                    });
                }
            }

            if (data.search_type !== 'area') {
                const searchedName = data.community_name || selectedCommunity.value || searchKeyword.value.trim();
                if (searchedName) {
                    resData = resData.filter(tx => {
                        const cn = tx.community_name || '';
                        return !cn || cn.includes(searchedName) || searchedName.includes(cn);
                    });
                }
            }

            if (resData.length === 0) {
                searchMessage.value = '😢 沒有找到符合條件的資料';
                summary.value = {};
                if(markerClusterGroup) markerClusterGroup.clearLayers();
                txData.value = [];
                processResults();
                return;
            }

            searchedCommunityName.value = data.community_name || null;
            searchType.value = data.search_type || 'address';
            summary.value = data.summary || {};
            communitySummaries.value = data.community_summaries || {};

            // clear reactive object and refill it
            Object.keys(collapsedCommunities).forEach(k => delete collapsedCommunities[k]);
            if (data.search_type === 'area') {
                const cNames = [...new Set(resData.map(tx => tx.community_name).filter(Boolean))];
                cNames.forEach(cn => { collapsedCommunities[cn] = true; });
            }

            txData.value = resData;
            sortData();
            processResults();
            if (mapInstance && markerClusterGroup) {
                plotMarkersOnMap(txData.value, markerSettings, mapInstance, markerClusterGroup, fitBounds, openClusterList);
            }
            if (windowWidth.value <= 768) sidebarShowMobile.value = false;
        };

        // --- Data Processing ---
        const sortData = () => {
            const dir = sortDirection.value === 'asc' ? 1 : -1;
            const sortType = currentSort.value;
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
            if (sorters[sortType]) txData.value.sort(sorters[sortType]);
        };

        const setSort = (sortType) => {
            if (currentSort.value === sortType) {
                sortDirection.value = sortDirection.value === 'desc' ? 'asc' : 'desc';
            } else {
                currentSort.value = sortType;
                sortDirection.value = 'desc';
            }
            if (txData.value.length > 0) {
                sortData();
                processResults();
                plotMarkersOnMap(txData.value, markerSettings, mapInstance, markerClusterGroup, false, openClusterList);
            }
        };

        const processResults = () => {
            const groups = [];
            const communityMap = {};
            const noComs = [];
            txData.value.forEach((tx, i) => {
                if (!markerSettings.showLotAddr && isLotAddress(tx.address_raw || tx.address || '')) return;
                const cn = tx.community_name || '';
                if (cn) {
                    if (!(cn in communityMap)) {
                        communityMap[cn] = groups.length;
                        groups.push({ name: cn, items: [], stats: null });
                    }
                    groups[communityMap[cn]].items.push({ tx, origIdx: i });
                } else {
                    noComs.push({ tx, origIdx: i });
                }
            });

            groups.forEach(group => {
                group.stats = communitySummaries.value[group.name] || computeLocalStats(group.items);
            });

            resultGroups.value = groups;
            noComItems.value = noComs;
        };

        const computeLocalStats = (items) => {
            if (!items || items.length === 0) return null;
            let prices = [], ups = [], pings = [], ratios = [];
            items.forEach(({ tx }) => { if (tx.price > 0) prices.push(tx.price); if (tx.unit_price_ping > 0) ups.push(tx.unit_price_ping); if (tx.area_ping > 0) pings.push(tx.area_ping); if (tx.public_ratio > 0) ratios.push(tx.public_ratio); });
            const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
            return { count: items.length, avg_price: Math.round(avg(prices)), avg_unit_price_ping: avg(ups), avg_ping: avg(pings), avg_ratio: avg(ratios) };
        };

        const toggleCommunity = (name) => {
            collapsedCommunities[name] = !collapsedCommunities[name];
        };

        // --- Interaction ---
        const selectTx = (idx) => {
            activeCardIdx.value = idx;
            const tx = txData.value[idx];
            if (tx && tx.lat && tx.lng && mapInstance) {
                _hoverPanSuppressed = true;
                mapInstance.setView([tx.lat, tx.lng], 17);
                setTimeout(() => { _hoverPanSuppressed = false; }, 800);
            }
        };

        const hoverTx = (idx) => {
            if (mapInstance && markerClusterGroup) {
                hoverTxOnMap(idx, mapInstance, markerClusterGroup, (suppressed) => { _hoverPanSuppressed = suppressed; });
            }
        };
        const unhoverTx = () => {
            unhoverTxOnMap();
        };

        const hoverCommunity = (name) => {
            hoveredCommunity.value = name;
            if (mapInstance && markerClusterGroup) {
                hoverCommunityOnMap(name, mapInstance, markerClusterGroup, (suppressed) => { _hoverPanSuppressed = suppressed; });
            }
        };

        const unhoverCommunity = () => {
            hoveredCommunity.value = null;
            unhoverCommunityOnMap();
        };

        const openClusterList = (items) => {
            clusterListItems.value = items;
            const comGroups = {};
            items.forEach(it => {
                const cn = it.tx.community_name || '未知建案';
                if (!comGroups[cn]) comGroups[cn] = [];
                comGroups[cn].push(it);
            });
            const comList = Object.entries(comGroups)
                .sort((a, b) => b[1].length - a[1].length)
                .map(([name, items]) => ({ name, items }));
            clusterGroups.value = comList;
            if (windowWidth.value <= 768) sidebarShowMobile.value = true;
        };

        const closeClusterList = () => {
            clusterListItems.value = [];
            clusterGroups.value = [];
        };

        // --- Settings & Map Legend ---
        const onBubbleModeChange = () => {
            applySettings();
        };

        const updateThresh = () => {
            let um1 = unitThresholdsMin.value;
            let um2 = unitThresholdsMax.value;
            if (um1 >= um2) { um1 = Math.max(0, um2 - 5); unitThresholdsMin.value = um1; }

            let tm1 = totalThresholdsMin.value;
            let tm2 = totalThresholdsMax.value;
            if (tm1 >= tm2) { tm1 = Math.max(0, tm2 - 100); totalThresholdsMin.value = tm1; }

            markerSettings.unitThresholds = [um1, (um1 + um2) / 2, um2];
            markerSettings.totalThresholds = [tm1, (tm1 + tm2) / 2, tm2];

            updateLegendOnMap(getLegendHtml, updateAreaAutoSearch);
            if (txData.value.length > 0) {
                clearTimeout(window._replotTimer);
                window._replotTimer = setTimeout(() => { plotMarkersOnMap(txData.value, markerSettings, mapInstance, markerClusterGroup, false, openClusterList); }, 300);
            }
        };

        const applySettings = () => {
            localStorage.setItem('markerSettings', JSON.stringify(markerSettings));
            updateLegendOnMap(getLegendHtml, updateAreaAutoSearch);
            if (txData.value.length > 0) {
                processResults();
                plotMarkersOnMap(txData.value, markerSettings, mapInstance, markerClusterGroup, false, openClusterList);
            }
        };

        const loadSettings = () => {
            try {
                const saved = localStorage.getItem('markerSettings');
                if (saved) Object.assign(markerSettings, JSON.parse(saved));
            } catch (e) { }

            if (!markerSettings.unitThresholds || markerSettings.unitThresholds.length !== 3) markerSettings.unitThresholds = [20, 45, 70];
            if (!markerSettings.totalThresholds || markerSettings.totalThresholds.length !== 3) markerSettings.totalThresholds = [500, 1750, 3000];
            if (!markerSettings.bivUnitQ || markerSettings.bivUnitQ.length !== 3) markerSettings.bivUnitQ = [25, 40, 60];
            if (!markerSettings.bivTotalQ || markerSettings.bivTotalQ.length !== 3) markerSettings.bivTotalQ = [800, 1500, 2500];

            unitThresholdsMin.value = markerSettings.unitThresholds[0];
            unitThresholdsMax.value = markerSettings.unitThresholds[2];
            totalThresholdsMin.value = markerSettings.totalThresholds[0];
            totalThresholdsMax.value = markerSettings.totalThresholds[2];

            try {
                const savedArea = localStorage.getItem('areaAutoSearch');
                if (savedArea === '1') { areaAutoSearch.value = true; }
                else if (savedArea === '0') { areaAutoSearch.value = false; }
            } catch(e){}
        };

        const getBivariateMatrixPreview = () => {
            const matrix = window.BIVARIATE_MATRIX || [
                ['#e8f4f8', '#d4b9d5', '#c085be', '#8b3a8b'],
                ['#b1dce5', '#a8a6c8', '#9e72b0', '#7a2d7a'],
                ['#6bc5d2', '#7a8dba', '#8555a2', '#6a206a'],
                ['#1fa5b5', '#4f6dac', '#5e3794', '#5a135a'],
            ];
            let colors = [];
            for (let yi = 3; yi >= 0; yi--) {
                for (let xi = 0; xi < 4; xi++) {
                    colors.push(matrix[xi][yi]);
                }
            }
            return colors;
        };

        const getLegendHtml = () => {
            let legendContent = '';
            if (markerSettings.bubbleMode === 'bivariate') {
                const q = markerSettings.bivUnitQ, tq = markerSettings.bivTotalQ;
                const matrixColors = getBivariateMatrixPreview();
                let matrixHtml = '<div style="display:grid;grid-template-columns:repeat(4,24px);gap:3px;margin:6px 0">';
                matrixColors.forEach(color => {
                    matrixHtml += `<div style="width:24px;height:24px;border-radius:4px;background:${color}"></div>`;
                });
                matrixHtml += '</div>';
                const unitShort = markerSettings.areaUnit === 'sqm' ? '單價/m²' : '單價/坪';
                legendContent = `<div style="font-weight:800;margin-bottom:8px;font-size:12px;color:var(--primary-dark)">🎨 雙變數色彩映射</div>
                <div style="font-size:10px;color:var(--text2);line-height:1.6;margin-bottom:6px">
                    <span style="display:inline-block;width:8px;height:8px;background:#6bc5d2;border-radius:1px;margin-right:4px"></span>水平：${unitShort}越高越青<br>
                    <span style="display:inline-block;width:8px;height:8px;background:#c085be;border-radius:1px;margin-right:4px"></span>垂直：總價越高越洋紅
                </div>
                <div style="display:flex;justify-content:center;margin-bottom:6px">${matrixHtml}</div>
                <div style="font-size:9px;color:var(--text3);line-height:1.4">
                    單價: ≤${q[0]}|${q[0]}-${q[1]}|${q[1]}-${q[2]}|>${q[2]}<br>
                    總價: ≤${tq[0]}|${tq[0]}-${tq[1]}|${tq[1]}-${tq[2]}|>${tq[2]}
                </div>`;
            } else {
                const unitShort = markerSettings.areaUnit === 'sqm' ? '單價/m²' : '單價/坪';
                const unitLabel = markerSettings.areaUnit === 'sqm' ? '萬/m²' : '萬/坪';
                legendContent = `<div style="font-weight:800;margin-bottom:8px;font-size:12px;color:var(--primary-dark)">🎯 雙圈色彩定義</div>
                <div style="font-weight:600;font-size:10px;color:var(--text);margin-bottom:6px;background:var(--bg2);padding:2px 6px;border-radius:4px;display:inline-block">外環＝${markerSettings.outerMode === 'unit_price' ? unitShort : '總價'} ｜ 內圈＝${markerSettings.innerMode === 'unit_price' ? unitShort : '總價'}</div>
                <div style="display:flex;flex-direction:column;gap:4px;font-size:10px">
                    <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,hsl(155,55%,38%),hsl(60,60%,42%))"></div><span>低→中 (綠→黃)</span></div>
                    <div style="display:flex;align-items:center;gap:6px"><div style="width:12px;height:12px;border-radius:50%;background:linear-gradient(135deg,hsl(60,60%,42%),hsl(0,65%,48%))"></div><span>中→高 (黃→紅)</span></div>
                </div>
                <div style="font-size:9px;color:var(--text3);margin-top:6px;border-top:1px dashed var(--border);padding-top:4px;line-height:1.4">
                    單價: ${markerSettings.unitThresholds[0]}~${markerSettings.unitThresholds[2]}${unitLabel}<br>總價: ${markerSettings.totalThresholds[0]}~${markerSettings.totalThresholds[2]}萬
                </div>`;
            }

            return `
                ${legendContent}
                <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:flex-start;align-items:center;pointer-events:auto;">
                <div class="area-toggle-wrap">
                    <label class="area-toggle"><input type="checkbox" id="areaToggle" ${areaAutoSearch.value ? 'checked' : ''}><span class="area-toggle-slider"></span></label>
                    <span class="area-toggle-label">自動顯示建案</span>
                </div>
                </div>
            `;
        };

        const updateAreaAutoSearch = (val) => {
            areaAutoSearch.value = val;
            try { localStorage.setItem('areaAutoSearch', val ? '1' : '0'); } catch (e) { }
            if (val && mapInstance && mapInstance.getZoom() >= (markerSettings.osmZoom || 16)) doAreaSearch();
        };

        const handleMapMoveEnd = () => {
            if (isHoveringList.value || !areaAutoSearch.value || _hoverPanSuppressed) return;
            if (mapInstance && mapInstance.getZoom() < (markerSettings.osmZoom || 16)) return;
            clearTimeout(_areaSearchTimer);
            _areaSearchTimer = setTimeout(() => {
                if (!_hoverPanSuppressed && areaAutoSearch.value && mapInstance && mapInstance.getZoom() >= (markerSettings.osmZoom || 16)) doAreaSearch();
            }, 800);
        };

        const locateMe = () => {
            if (mapInstance) locateUserOnMap(mapInstance);
        };
        const zoomIn = () => { if (mapInstance) mapInstance.zoomIn(); };
        const zoomOut = () => { if (mapInstance) mapInstance.zoomOut(); };

        // --- Dark mode watcher ---
        watch(() => markerSettings.themeMode, (newVal) => {
            if (newVal === 'dark') document.body.classList.add('dark-mode');
            else document.body.classList.remove('dark-mode');
        }, { immediate: true });

        // --- Lifecycle ---
        onMounted(() => {
            window.addEventListener('resize', () => {
                windowWidth.value = window.innerWidth;
            });
            loadSettings();

            const initRes = initMapInstance(() => markerSettings, handleMapMoveEnd, openClusterList);
            mapInstance = initRes.map;
            markerClusterGroup = initRes.markerClusterGroup;
            markerGroup = initRes.markerGroup;

            mapInstance.on('zoomend', () => {
                if (markerSettings.displayLogic !== 'all' && txData.value.length > 0) {
                    clearTimeout(window._replotTimer);
                    window._replotTimer = setTimeout(() => { plotMarkersOnMap(txData.value, markerSettings, mapInstance, markerClusterGroup, false, openClusterList); }, 100);
                }
            });

            addLegendToMap(mapInstance, getLegendHtml, updateAreaAutoSearch);

            document.addEventListener('keydown', e => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
                if (e.key === '/' || e.key === 's') {
                    const si = document.getElementById('searchInput');
                    if (si) { si.focus(); e.preventDefault(); }
                }
            });

            document.addEventListener('click', e => {
                if (showFilters.value) {
                    const dd = document.querySelector('.filter-dropdown');
                    const btn = document.querySelector('.nav-filter-btn');
                    if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
                        showFilters.value = false;
                    }
                }
                if (showAcList.value) {
                    const acWrap = document.querySelector('.autocomplete-wrap');
                    if (acWrap && !acWrap.contains(e.target)) {
                        hideAcList();
                    }
                }
            });

            if (windowWidth.value <= 768) {
                mapInstance.on('click', () => {
                    sidebarShowMobile.value = false;
                    sidebarCollapsed.value = true;
                });
            }
        });

        return {
            searchKeyword, showAcList, acResults, acIdx, selectedCommunity, searchedCommunityName, searchType,
            sidebarCollapsed, sidebarShowMobile, isHoveringList, showSettings, markerSettings,
            unitThresholdsMin, unitThresholdsMax, totalThresholdsMin, totalThresholdsMax,
            showFilters, filters, quickFilterActive, sortOptions, currentSort, sortDirection, limitSelect,
            isLoading, searchMessage, summary, collapsedCommunities, hoveredCommunity,
            resultGroups, noComItems, activeCardIdx, clusterListItems, clusterGroups,
            hamburgerIcon, hasActiveFilters, summaryHtml,

            toggleSidebar, toggleSettings, toggleFilters, clearFilters, applyFiltersAndSearch, quickFilter,
            handleSearchKeydown, onSearchInput, selectCommunity, clearSelectedCommunity, doSearch, rerunSearch,
            setSort, toggleCommunity, selectTx, hoverTx, unhoverTx, hoverCommunity, unhoverCommunity,
            closeClusterList, onBubbleModeChange, updateThresh, applySettings, getBivariateMatrixPreview,
            locateMe, zoomIn, zoomOut,

            fmtWan, fmtArea, fmtUnitPrice, fmtAvgArea, fmtAvgUnitWan, formatDateStr, getMatchTagClass, getPriceClass, getColorDotSvg
        };
    }
}).mount('#app');