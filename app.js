import { doSearchApi, doAreaSearchApi, fetchAcResults } from "./api.js";
import {
  updateMapHighlight,
  initMap,
  updateMapData,
  applyLayers,
  applyClusterLayers,
  setMapHandlers,
  getHoverPanSuppressed,
  setHoverPanSuppressed,
  map
} from "./map.js";

const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

const app = createApp({
  setup() {
    const API_BASE = 'https://volodos.cs.nthu.edu.tw:5001';

    // Global State
    const transactions = ref([]);
    const activeCardIdx = ref(-1);
    const searchKeyword = ref('');
    const loading = ref(false);
    const errorMsg = ref('');
    const emptyMsg = ref('');

    // UI State
    const ui = reactive({
      sidebarCollapsed: false,
      sidebarHovered: false,
      settingsVisible: false,
      filterVisible: false,
      acVisible: false,
      acResults: [],
      acIdx: -1,
      selectedCommunity: null,
      communityName: '',
      summary: null,
      communitySummaries: {},
      collapsedCommunities: {},
      isAreaSearch: false,
      clusterItems: [],
      showingClusterList: false
    });

    // Settings
    const markerSettings = reactive({
      bubbleMode: 'dual_ring',
      outerMode: 'unit_price',
      innerMode: 'total_price',
      contentMode: 'recent2yr',
      unitThresholds: [20, 45, 70],
      totalThresholds: [500, 1750, 3000],
      displayLogic: 'auto',
      osmZoom: 16,
      showLotAddr: false,
      yearFormat: 'roc',
      useExactLocation: false,
      autoThresh14: 8000,
      autoThresh15: 5000,
      autoThresh16: 2000,
      autoThresh17: 0,
      areaUnit: 'ping',
      themeMode: 'light',
      bivUnitQ: [25, 40, 60],
      bivTotalQ: [800, 1500, 2500]
    });

    const areaAutoSearch = ref(true);
    const windowWidth = ref(window.innerWidth);
    window.addEventListener('resize', () => { windowWidth.value = window.innerWidth; });

    // Filters
    const filters = reactive({
      fBuildType: '',
      fRooms: '',
      fPing: '',
      fRatio: '',
      fUnitPrice: '',
      fPrice: '',
      fYear: '',
      fExcludeSpecial: false,
      limitSelect: 2500,
      currentSort: 'date',
      sortDirection: 'desc'
    });

    // We will progressively add functions here

    const toggleSidebar = () => {
      ui.sidebarCollapsed = !ui.sidebarCollapsed;
      if (window.innerWidth <= 768 && !ui.sidebarCollapsed) {
        ui.filterVisible = false; // ensure filter is closed
      }
    };

    const toggleSettings = () => {
      ui.settingsVisible = !ui.settingsVisible;
    };

    const toggleFilters = () => {
      ui.filterVisible = !ui.filterVisible;
    };

    const onSearchInput = () => {
      ui.selectedCommunity = null;
      if (searchKeyword.value.length < 2) {
        ui.acVisible = false;
        return;
      }
      if (window._acTimer) clearTimeout(window._acTimer);
      window._acTimer = setTimeout(async () => {
        ui.acResults = await fetchAcResults(searchKeyword.value);
        if (ui.acResults.length > 0) {
           ui.acIdx = -1;
           ui.acVisible = true;
        } else {
           ui.acVisible = false;
        }
      }, 250);
    };

    const handleSearchKeydown = (e) => {
      if (ui.acVisible && ui.acResults.length > 0) {
        if (e.key === 'ArrowDown') { e.preventDefault(); ui.acIdx = Math.min(ui.acIdx + 1, ui.acResults.length - 1); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); ui.acIdx = Math.max(ui.acIdx - 1, -1); return; }
        if (e.key === 'Enter' && ui.acIdx >= 0) { e.preventDefault(); selectCommunity(ui.acResults[ui.acIdx].name); return; }
      }
      if (e.key === 'Escape') { ui.acVisible = false; return; }
      if (e.key === 'Enter') doSearch();
    };

    const selectCommunity = (name) => {
      ui.selectedCommunity = name;
      searchKeyword.value = name;
      ui.acVisible = false;
      doSearch();
    };

    const clearSelectedCommunity = () => {
      ui.selectedCommunity = null;
      searchKeyword.value = '';
      ui.isAreaSearch = false;
    };

    const clearFilters = () => {
      filters.fBuildType = '';
      filters.fRooms = '';
      filters.fPing = '';
      filters.fRatio = '';
      filters.fUnitPrice = '';
      filters.fPrice = '';
      filters.fYear = '';
      filters.fExcludeSpecial = false;
    };

    const getFilterParams = () => {
      let p = '';
      if (filters.fBuildType) p += `&building_type=${encodeURIComponent(filters.fBuildType)}`;
      if (filters.fRooms) p += `&rooms=${encodeURIComponent(filters.fRooms)}`;
      if (filters.fPing) p += `&ping=${encodeURIComponent(filters.fPing)}`;
      if (filters.fRatio) p += `&public_ratio=${encodeURIComponent(filters.fRatio)}`;
      if (filters.fUnitPrice) p += `&unit_price=${encodeURIComponent(filters.fUnitPrice)}`;
      if (filters.fPrice) p += `&price=${encodeURIComponent(filters.fPrice)}`;
      if (filters.fYear) p += `&year=${encodeURIComponent(filters.fYear)}`;
      if (filters.fExcludeSpecial) p += `&exclude_special=1`;
      return p;
    };

    const handleSearchResult = (data, fitBounds = true) => {
      loading.value = false;
      ui.showingClusterList = false;
      ui.communityName = ui.selectedCommunity || searchKeyword.value;

      let txs = data.transactions || [];
      // Assign unique ID if missing
      txs.forEach((tx, idx) => {
        if (!tx.id) tx.id = `temp_id_${idx}`;
        tx.origIdx = idx;
      });

      transactions.value = txs;

      // Filter lot address
      if (!markerSettings.showLotAddr) {
        transactions.value = transactions.value.filter(tx => !(/^\S*段\S*地號/.test(tx.address_raw || tx.address || '') || /段\d+地號/.test(tx.address_raw || tx.address || '')));
      }

      if (transactions.value.length === 0) {
        emptyMsg.value = '😢 沒有找到符合條件的資料';
        ui.summary = null;
        updateMapData([], fitBounds, markerSettings);
        return;
      }

      emptyMsg.value = '';
      ui.summary = data.summary || {};
      ui.communitySummaries = data.community_summaries || {};
      ui.isAreaSearch = data.search_type === 'area';

      // Compute collapsed state
      ui.collapsedCommunities = {};
      if (ui.isAreaSearch) {
        const cNames = [...new Set(transactions.value.map(tx => tx.community_name).filter(Boolean))];
        cNames.forEach(cn => { ui.collapsedCommunities[cn] = true; });
      }

      // Sort data
      sortData(filters.currentSort);

      // Render to map
      updateMapData(transactions.value, fitBounds, markerSettings);

      if (window.innerWidth <= 768) ui.sidebarCollapsed = false;
    };

    const getLocationMode = () => {
      const z = map ? map.getZoom() : 15;
      return z >= markerSettings.osmZoom ? 'osm' : 'db';
    };

    const doSearch = async () => {
      if (window._acTimer) clearTimeout(window._acTimer);
      const kw = searchKeyword.value.trim();
      if (!kw && !getFilterParams() && !ui.selectedCommunity) { alert('請輸入搜尋關鍵字或選擇篩選條件'); return; }

      if (!kw && !ui.selectedCommunity) {
        doAreaSearch();
        return;
      }

      ui.acVisible = false;
      ui.lastSearchType = 'keyword';
      loading.value = true;
      emptyMsg.value = '';
      transactions.value = [];

      const res = await doSearchApi(kw, filters.limitSelect, getLocationMode(), getFilterParams(), ui.selectedCommunity);
      if (res.success) {
        handleSearchResult(res);
      } else {
        loading.value = false;
        emptyMsg.value = res.error;
      }
    };

    const doAreaSearch = async () => {
      if (!map) return;
      const bounds = map.getBounds();
      ui.lastSearchType = 'area';
      loading.value = true;
      emptyMsg.value = '';
      transactions.value = [];

      const res = await doAreaSearchApi(bounds, filters.limitSelect, getLocationMode(), getFilterParams());
      if (res.aborted) return;

      if (res.success) {
        if (!res.transactions || res.transactions.length === 0) {
           loading.value = false;
           emptyMsg.value = '😢 此區域沒有成交紀錄<br><span style="font-size:12px">試試放大地圖或移動到其他區域</span>';
           ui.summary = null;
           updateMapData([], false, markerSettings);
           return;
        }
        handleSearchResult(res, false);
      } else {
        loading.value = false;
        emptyMsg.value = res.error;
      }
    };

    const sortData = (sortType) => {
      const dir = filters.sortDirection === 'asc' ? 1 : -1;
      const sorters = {
        date: (a, b) => dir * ((b.date_raw || '').localeCompare(a.date_raw || '')),
        price: (a, b) => dir * ((b.price || 0) - (a.price || 0)),
        unit_price: (a, b) => dir * ((b.unit_price_ping || 0) - (a.unit_price_ping || 0)),
        ping: (a, b) => dir * ((b.area_ping || 0) - (a.area_ping || 0)),
        public_ratio: (a, b) => dir * ((a.public_ratio || 999) - (b.public_ratio || 999)),
        community: (a, b) => {
          const ca = a.community_name || '', cb = b.community_name || '';
          if (ca && !cb) return -1; if (!ca && cb) return 1;
          if (ca !== cb) return dir * ca.localeCompare(cb);
          return dir * ((b.date_raw || '').localeCompare(a.date_raw || ''));
        }
      };
      if (sorters[sortType]) {
        transactions.value.sort(sorters[sortType]);
      }
    };

    const setSort = (newSort) => {
      if (filters.currentSort === newSort) {
        filters.sortDirection = filters.sortDirection === 'desc' ? 'asc' : 'desc';
      } else {
        filters.currentSort = newSort;
        filters.sortDirection = 'desc';
      }
      if (transactions.value.length > 0) {
        sortData(filters.currentSort);
      }
    };

    const rerunSearch = () => {
      if (ui.lastSearchType === 'area') doAreaSearch();
      else if (ui.lastSearchType === 'keyword') doSearch();
    };

    const quickFilter = (mode) => {
      const nowYear = new Date().getFullYear() - 1911;
      if (mode === '1yr') {
        filters.fYear = `${nowYear - 1}-${nowYear}`;
        ui.qfMode = '1yr';
      } else if (mode === '2yr') {
        filters.fYear = `${nowYear - 2}-${nowYear}`;
        ui.qfMode = '2yr';
      } else if (mode === 'nospecial') {
        filters.fExcludeSpecial = !filters.fExcludeSpecial;
        ui.qfMode = filters.fExcludeSpecial ? 'nospecial' : '';
      } else if (mode === 'clear') {
        clearFilters();
        ui.qfMode = '';
        if (transactions.value.length > 0) rerunSearch();
        return;
      }
      if (transactions.value.length > 0) rerunSearch();
    };

    // Formatters for templates
    const PING_TO_SQM = 3.305785;
    const fmtWan = (v) => { if (!v || v <= 0) return '-'; const w = v / 10000; return w >= 10000 ? (w / 10000).toFixed(1) + '億' : Math.round(w) + '萬'; };
    const fmtUnitPrice = (up) => {
      if (markerSettings.areaUnit === 'sqm') {
        if (up <= 0) return '-';
        return Math.round(up / PING_TO_SQM / 10000) + '萬/m²';
      }
      return up > 0 ? Math.round(up / 10000) + '萬/坪' : '-';
    };
    const fmtAvgUnitWan = (up) => {
      if (markerSettings.areaUnit === 'sqm') {
        if (up <= 0) return '-';
        return (up / PING_TO_SQM / 10000).toFixed(1) + '萬/m²';
      }
      return up > 0 ? (up / 10000).toFixed(1) + '萬/坪' : '-';
    };
    const fmtAvgArea = (ping) => {
      if (markerSettings.areaUnit === 'sqm') {
        const m2 = ping > 0 ? ping * PING_TO_SQM : 0;
        return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
      }
      return ping > 0 ? ping.toFixed(1) + '坪' : '-';
    };

    // Grouping computation
    const resultGroups = computed(() => {
      const groupsMap = {};
      const noComItems = [];
      const groups = [];

      transactions.value.forEach((tx, i) => {
        const cn = tx.community_name || '';
        if (cn) {
          if (!(cn in groupsMap)) {
            groupsMap[cn] = groups.length;
            groups.push({ name: cn, items: [], stats: null });
          }
          groups[groupsMap[cn]].items.push({ tx, origIdx: i });
        } else {
          noComItems.push({ tx, origIdx: i });
        }
      });

      groups.forEach(g => {
        g.stats = ui.communitySummaries[g.name] || computeLocalStats(g.items);
      });

      return groups;
    });

    const computeLocalStats = (items) => {
      if (!items || items.length === 0) return null;
      let prices = [], ups = [], pings = [], ratios = [];
      items.forEach(({ tx }) => { if (tx.price > 0) prices.push(tx.price); if (tx.unit_price_ping > 0) ups.push(tx.unit_price_ping); if (tx.area_ping > 0) pings.push(tx.area_ping); if (tx.public_ratio > 0) ratios.push(tx.public_ratio); });
      const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
      return { count: items.length, avg_price: Math.round(avg(prices)), avg_unit_price_ping: avg(ups), avg_ping: avg(pings), avg_ratio: avg(ratios) };
    };

    const noComItems = computed(() => {
      return transactions.value.filter(tx => !tx.community_name).map((tx, i) => ({ tx, origIdx: i }));
    });

    const clusterGroups = computed(() => {
      const groups = {};
      ui.clusterItems.forEach(tx => {
        const cn = tx.community_name || '其他';
        if (!groups[cn]) groups[cn] = [];
        groups[cn].push(tx);
      });
      return groups;
    });

    const toggleCommunity = (name) => {
      ui.collapsedCommunities[name] = !ui.collapsedCommunities[name];
    };

    const hoverCommunity = (name) => { updateMapHighlight(transactions.value.filter(t => t.community_name === name || (name.name && t.community_name === name.name)).map(t => t.id));
      // Logic for map hovering
    };

    const unhoverCommunity = () => { updateMapHighlight(null);
    };

    const selectTx = (tx) => {
      activeCardIdx.value = tx.id;
      if (tx.lat && tx.lng && map) {
        setHoverPanSuppressed(true);
        map.flyTo({ center: [tx.lng, tx.lat], zoom: 17 });
        setTimeout(() => { setHoverPanSuppressed(false); }, 800);
      }
    };

    const hoverTx = (tx) => { updateMapHighlight([tx.id]);
      // Find on map
    };

    const unhoverTx = () => { updateMapHighlight(null);
    };

    const closeClusterList = () => {
      ui.showingClusterList = false;
      if (window.innerWidth <= 768) ui.sidebarCollapsed = false;
    };

    // Watchers for Settings
    watch(markerSettings, (newSettings) => {
      localStorage.setItem('markerSettings', JSON.stringify(newSettings));
      if (newSettings.themeMode === 'dark') {
        document.body.classList.add('dark-mode');
      } else {
        document.body.classList.remove('dark-mode');
      }

      // Update Map Layers
      if (map && map.getStyle()) {
        applyLayers(newSettings);
        applyClusterLayers(newSettings);
      }
    }, { deep: true });

    onMounted(() => {
      // Load Settings from LocalStorage
      try {
        const saved = localStorage.getItem('markerSettings');
        if (saved) {
          Object.assign(markerSettings, JSON.parse(saved));
        }
        const savedArea = localStorage.getItem('areaAutoSearch');
        if (savedArea !== null) {
          areaAutoSearch.value = savedArea === '1';
        }
      } catch (e) {}

      // Init MapLibre
      initMap();

      // Setup Map Handlers
      setMapHandlers({
        onMapMoveEnd: () => {
          if (ui.sidebarHovered || !areaAutoSearch.value || getHoverPanSuppressed()) return;
          if (map.getZoom() < markerSettings.osmZoom) return;

          if (window._areaSearchTimer) clearTimeout(window._areaSearchTimer);
          window._areaSearchTimer = setTimeout(() => {
            if (!getHoverPanSuppressed() && areaAutoSearch.value && map.getZoom() >= markerSettings.osmZoom) {
              doAreaSearch();
            }
          }, 800);
        },
        onMapZoomEnd: () => {},
        onMapClick: () => {
          if (window.innerWidth <= 768) {
             ui.sidebarCollapsed = true;
          }
        },
        onMarkerHover: (data) => {
          if (!data) {
             updateMapHighlight(null);
             activeCardIdx.value = -1;
             return;
          }
          if (data.isCluster) {
             // hover cluster
          } else {
             // hover point
             activeCardIdx.value = data.id || data.origIdx;
             updateMapHighlight([data.id || data.origIdx]);

             // Scroll to item in list
             const el = document.getElementById(`tx-item-${activeCardIdx.value}`);
             if (el && !ui.sidebarHovered) {
                el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
             }
          }
        },
        onMarkerClick: (type, data) => {
          if (type === 'cluster') {
             // Show cluster list
             // Match MapLibre features properties to Vue `transactions` elements
             const leafIds = data.map(d => d.id || d.origIdx);
             ui.clusterItems = transactions.value.filter(tx => leafIds.includes(tx.id || tx.origIdx));
             ui.showingClusterList = true;
             if (window.innerWidth <= 768) ui.sidebarCollapsed = false;
          } else if (type === 'point') {
             // Select point
             activeCardIdx.value = data.id || data.origIdx;
             if (window.innerWidth <= 768) ui.sidebarCollapsed = false;
          }
        }
      });
    });

    Vue.provide("markerSettings", markerSettings);

    return {
      transactions, activeCardIdx, searchKeyword, loading, errorMsg, emptyMsg,
      ui, markerSettings, areaAutoSearch, filters, windowWidth,
      toggleSidebar, toggleSettings, toggleFilters, onSearchInput, handleSearchKeydown,
      selectCommunity, clearSelectedCommunity, clearFilters, doSearch, doAreaSearch,
      locateMe: async () => {
        if (!navigator.geolocation) {
          alert("您的瀏覽器不支援地理位置功能");
          return;
        }

        // Handle iOS Safari specific permission
        if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
          try {
            const permissionState = await DeviceOrientationEvent.requestPermission();
            if (permissionState !== 'granted') {
              console.warn('Device orientation permission not granted');
            }
          } catch (e) {
            console.error('Error requesting orientation permission:', e);
          }
        }

        loading.value = true;
        navigator.geolocation.getCurrentPosition(
          (position) => {
            loading.value = false;
            if (map) {
               setHoverPanSuppressed(true);
               map.flyTo({
                  center: [position.coords.longitude, position.coords.latitude],
                  zoom: 16
               });
               setTimeout(() => { setHoverPanSuppressed(false); }, 800);
            }
          },
          (error) => {
            loading.value = false;
            let msg = '無法取得您的位置';
            if (error.code === 1) msg = '您拒絕了定位權限，請在瀏覽器設定中允許';
            if (error.code === 2) msg = '位置資訊無法使用 (網路或GPS錯誤)';
            if (error.code === 3) msg = '取得位置逾時';
            alert(msg);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      },
      zoomIn: () => { map.zoomIn() }, zoomOut: () => { map.zoomOut() },
      setSort, rerunSearch, quickFilter, fmtWan, fmtAvgUnitWan, fmtUnitPrice, fmtAvgArea,
      resultGroups, noComItems, clusterGroups, toggleCommunity, hoverCommunity, unhoverCommunity,
      selectTx, hoverTx, unhoverTx, closeClusterList
    };
  }
});


// We need to define a Vue component for TxCard
app.component('tx-card', {
  props: ['tx', 'isActive'],
  setup(props) {
    // Utility functions inherited from parent scope are not automatically available in components,
    // so we provide them here.
    const PING_TO_SQM = 3.305785;
    const settings = Vue.inject('markerSettings');

    const fmtWan = (v) => { if (!v || v <= 0) return '-'; const w = v / 10000; return w >= 10000 ? (w / 10000).toFixed(1) + '億' : Math.round(w) + '萬'; };
    const fmtUnitPrice = (up) => {
      if (settings.areaUnit === 'sqm') {
        if (up <= 0) return '-';
        return Math.round(up / PING_TO_SQM / 10000) + '萬/m²';
      }
      return up > 0 ? Math.round(up / 10000) + '萬/坪' : '-';
    };
    const fmtArea = (sqm, ping) => {
      if (settings.areaUnit === 'sqm') {
        const m2 = sqm > 0 ? sqm : (ping > 0 ? ping * PING_TO_SQM : 0);
        return m2 > 0 ? m2.toFixed(1) + ' m²' : '-';
      }
      return ping > 0 ? ping.toFixed(1) + '坪' : (sqm > 0 ? (sqm / PING_TO_SQM).toFixed(1) + '坪' : '-');
    };
    const formatDateStr = (raw) => {
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
    };

    // Logic to calculate color dot based on markerSettings
    const colorDotStyle = computed(() => {
        const getColor = (mode, val) => {
            const th = mode === 'total_price' ? settings.totalThresholds : settings.unitThresholds;
            const v = val / 10000;
            if (v <= 0) return '#aaaaaa';
            if (v <= th[0]) return 'hsl(155, 55%, 38%)';
            if (v >= th[2]) return 'hsl(0, 65%, 48%)';
            // Simple interpolation for UI dot
            const ratio = (v - th[0]) / (th[2] - th[0]);
            // Hue from 155 to 0
            const h = 155 - (155 * ratio);
            // Saturation from 55 to 65
            const s = 55 + (10 * ratio);
            // Lightness from 38 to 48
            const l = 38 + (10 * ratio);
            return `hsl(${h}, ${s}%, ${l}%)`;
        };

        if (settings.bubbleMode === 'bivariate') {
             // simplified bivariate mapping
             return { backgroundColor: '#7a8dba' }; // Default generic color
        }

        const outColor = getColor(settings.outerMode, settings.outerMode === 'total_price' ? props.tx.price : props.tx.unit_price_ping);
        const inColor = getColor(settings.innerMode, settings.innerMode === 'total_price' ? props.tx.price : props.tx.unit_price_ping);

        return {
           width: '12px', height: '12px', borderRadius: '50%', flexShrink: 0,
           background: inColor,
           border: `3px solid ${outColor}`,
           boxSizing: 'content-box'
        };
    });

    return { fmtWan, fmtUnitPrice, fmtArea, formatDateStr, colorDotStyle };
  },
  template: `
    <div class="tx-card" :class="{ active: isActive, special: tx.is_special }" @click="$emit('click')" @mouseenter="$emit('mouseenter')" @mouseleave="$emit('mouseleave')">
      <div class="tx-color-dot" :style="colorDotStyle"></div>
      <div class="tx-price-col">
        <div class="tx-price">{{ fmtWan(tx.price) }}</div>
        <div class="tx-unit">{{ fmtUnitPrice(tx.unit_price_ping) }}</div>
      </div>
      <div class="tx-addr" :title="tx.address">{{ tx.address }} <span v-if="tx.is_special" class="special-badge">特殊</span></div>
      <div class="tx-community-row" v-if="tx.community_name">
        <span class="tx-community-tag" :title="tx.community_name">{{ tx.community_name }}</span>
      </div>
      <div class="tx-detail-row">
        <span>📅 {{ formatDateStr(tx.date_raw) }}</span>
        <span>📐 {{ fmtArea(tx.area_sqm, tx.area_ping) }}</span>
        <span>🏠 {{ tx.rooms || 0 }}房{{ tx.halls || 0 }}廳{{ tx.baths || 0 }}衛</span>
        <span v-if="tx.floor">🏢 {{ tx.floor }}F/{{ tx.total_floors }}F</span>
        <span v-if="tx.public_ratio > 0" class="tag">公設{{ tx.public_ratio }}%</span>
        <span v-if="tx.building_type" class="tag">{{ tx.building_type }}</span>
        <span v-if="tx.has_parking" class="tx-parking-tag">🚗 含車位{{ tx.parking_price > 0 ? ' ' + fmtWan(tx.parking_price) : '' }}</span>
        <span v-if="tx.note" style="color:var(--text3);font-size:10px">📝 {{ tx.note.length > 30 ? tx.note.substring(0, 30) + '…' : tx.note }}</span>
      </div>
    </div>
  `
});
app.mount('#app');
