/* KruBoard Frontend - Updated with Fetch API & Cache Support */

const APP_CONFIG = {
  scriptUrl: 'https://script.google.com/macros/s/AKfycbxD9lO5R_xFFKPp0e0llgoKtbXkr0upnZd3_GU8L0Ze308kITEENaPjK1PvvfkgO8iy/exec',
  liffId: '2006490627-3NpRPl0G',
  requestTimeout: 30000,  // 30 seconds
  retryAttempts: 2,
  retryDelay: 1000  // 1 second
};

const state = {
  isLoggedIn: false,
  profile: null,
  activePage: 'homePage',
  upcomingDays: 7,
  tasks: [],
  userStats: [],
  dashboard: null,
  personalStats: null,
  currentUser: null,
  notifications: [],
  activeUsers: [],
  filteredActiveUsers: [],
  selectedAssignees: [],
  assigneeSearchTerm: '',
  filteredTasks: [],
  taskFilters: { status:'all', search:'' },
  taskPagination: { page:1, pageSize:10, totalPages:1 },
  isAdmin: false,
  apiKey: localStorage.getItem('kruboard_api_key') || '',
  cacheStatus: { dashboard: null, userStats: null, upcoming: null }
};

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

const CLIENT_CACHE_KEYS = {
  dashboard: 'kruboard_cache_dashboard_v1',
  upcoming: 'kruboard_cache_upcoming_v1'
};

const CLIENT_CACHE_TTL = {
  dashboard: 2 * 60 * 1000, // 2 minutes
  upcoming: 60 * 1000        // 1 minute
};

// Element cache
const els = {
  navItems: [],
  pages: {},
  homePage: null,
  tasksPage: null,
  teachersPage: null,
  profilePage: null,
  headerTotals: {
    totalTasks: document.getElementById('headerTotalTasks'),
    upcomingTasks: document.getElementById('headerUpcomingTasks'),
    totalUsers: document.getElementById('headerTotalUsers'),
    completionRate: document.getElementById('headerCompletionRate'),
    myTasks: document.getElementById('headerMyTasks'),
    myUpcoming: document.getElementById('headerMyUpcoming')
  },
  stats: {
    completed: document.getElementById('completedCount'),
    pending: document.getElementById('pendingCount'),
    month: document.getElementById('monthTaskCount'),
    completionRate: document.getElementById('completionRate')
  },
  statsPersonal: {
    container: document.getElementById('personalStatsSection'),
    completed: document.getElementById('myCompletedCount'),
    pending: document.getElementById('myPendingCount'),
    month: document.getElementById('myMonthTaskCount'),
    upcoming: document.getElementById('myUpcomingCount')
  },
  notificationCount: document.getElementById('notificationCount'),
  taskCardsContainer: document.getElementById('taskCardsContainer'),
  allTasksContainer: document.getElementById('allTasksContainer'),
  userStatsContainer: document.getElementById('userStatsContainer'),
  loadingToast: document.getElementById('loadingToast'),
  loadingText: null,
  refreshBtn: document.getElementById('refreshBtn'),
  fabBtn: document.getElementById('fabBtn'),
  timeFilters: Array.from(document.querySelectorAll('.time-filter')),
  navProfileAvatar: document.getElementById('navProfileAvatar'),
  navProfileIcon: document.getElementById('navProfileIcon'),
  nav: Array.from(document.querySelectorAll('.nav-item')),
  notificationBtn: document.getElementById('notificationBtn'),
  notificationsPanel: document.getElementById('notificationsPanel'),
  notificationsBackdrop: document.getElementById('notificationsBackdrop'),
  notificationsClose: document.getElementById('notificationsClose'),
  notificationsList: document.getElementById('notificationsList'),
  notificationsFooter: document.getElementById('notificationsFooter'),
  taskSearchInput: document.getElementById('taskSearchInput'),
  taskStatusFilter: document.getElementById('taskStatusFilter'),
  taskPaginationPrev: document.getElementById('taskPaginationPrev'),
  taskPaginationNext: document.getElementById('taskPaginationNext'),
  taskPaginationInfo: document.getElementById('taskPaginationInfo'),
  taskPaginationWrapper: document.getElementById('taskPagination'),
  addTaskBtn: document.getElementById('addTaskBtn'),
  taskModal: null,
  modalLoading: null,
  taskForm: null,
  closeModalBtn: null,
  cancelModalBtn: null,
  submitTaskBtn: null,
  taskNameInput: null,
  taskAssigneeSearch: null,
  taskAssigneeOptions: null,
  taskAssigneeSelected: null,
  taskDueDateInput: null,
  taskNotesInput: null,
  quickDueButtons: []
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init(){
  cachePages();
  bindUI();
  initModalElements();
  updateProfileNavAvatar();
  
  // Add loading text element
  if (els.loadingToast){
    const existing = els.loadingToast.querySelector('span:last-child');
    els.loadingText = existing || document.createElement('span');
  }
  
  showLoading(true, 'กำลังเตรียมข้อมูล...');
  
  initializeLiff()
    .catch(err=>{
      console.error('LIFF init failed:', err);
      renderLoginBanner();
      renderProfilePage();
    })
    .finally(()=>{
      loadPublicData()
        .then(()=> state.isLoggedIn ? loadSecureData() : null)
        .catch(err=>{
          handleDataError(err, 'โหลดข้อมูลล้มเหลว กรุณาลองใหม่');
        })
        .finally(()=> showLoading(false));
    });
}

/** =========================================================
 * MODERN FETCH API - Replaces JSONP
 * ======================================================= **/
async function apiRequest(action, params = {}, options = {}) {
  const {
    timeout = APP_CONFIG.requestTimeout,
    retryCount = 0,
    maxRetries = APP_CONFIG.retryAttempts,
  } = options;

  const payload = { action, ...params };
  if (state.profile?.idToken) payload.idToken = state.profile.idToken;
  if (state.apiKey && (action.includes('sync') || action.includes('analyze'))) {
    payload.pass = state.apiKey;
  }

  // --- 1) Try Fetch first (works if CORS enabled) ---
  try {
    const controller = new AbortController();
    const t = setTimeout(()=> controller.abort(new Error('Request timeout')), timeout);
    const url = `${APP_CONFIG.scriptUrl}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
      credentials: 'omit',
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data !== 'object') throw new Error('Invalid JSON');
    if (data.success === false && retryCount < maxRetries) {
      await new Promise(r => setTimeout(r, APP_CONFIG.retryDelay * Math.pow(2, retryCount)));
      return apiRequest(action, params, { ...options, retryCount: retryCount + 1 });
    }
    return data;
  } catch (e) {
    // On CORS/HTTP/timeout errors, fallback to JSONP
  }

  // --- 2) Fallback: JSONP (with retry on script.onerror) ---
  return new Promise((resolve, reject) => {
    const callbackName = `callback_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    let script;

    const tidyUp = () => {
      if (script && script.parentNode) script.parentNode.removeChild(script);
      script = null;
      try { delete window[callbackName]; } catch(_){}
    };

    const timeoutId = setTimeout(() => {
      tidyUp();
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      reject(err);
    }, timeout);

    window[callbackName] = (data) => {
      clearTimeout(timeoutId);
      tidyUp();
      if (!data || typeof data !== 'object') {
        reject(new Error('Invalid JSONP payload'));
        return;
      }
      if (data.success === false && retryCount < maxRetries) {
        setTimeout(() => {
          apiRequest(action, params, { ...options, retryCount: retryCount + 1 })
            .then(resolve).catch(reject);
        }, APP_CONFIG.retryDelay * Math.pow(2, retryCount));
      } else {
        resolve(data);
      }
    };

    const queryParams = new URLSearchParams({ ...payload, callback: callbackName });
    script = document.createElement('script');
    script.async = true;
    script.dataset.jsonp = callbackName;
    script.src = `${APP_CONFIG.scriptUrl}?${queryParams}`;
    script.onerror = () => {
      clearTimeout(timeoutId);
      tidyUp();
      if (retryCount < maxRetries) {
        setTimeout(() => {
          apiRequest(action, params, { ...options, retryCount: retryCount + 1 })
            .then(resolve).catch(reject);
        }, APP_CONFIG.retryDelay * Math.pow(2, retryCount));
      } else {
        reject(new Error('Script loading failed'));
      }
    };
    document.head.appendChild(script);
  });
}


/** =========================================================
 * FAST CACHED ENDPOINTS
 * ======================================================= **/

async function loadPublicData(){
  const cachedDashboard = readClientCache('dashboard');
  if (cachedDashboard){
    state.cacheStatus.dashboard = 'cached-local';
    const decorated = {
      ...cachedDashboard,
      cached: true,
      cacheSource: cachedDashboard.cacheSource || 'local-cache'
    };
    renderDashboard(decorated);
  }

  const cachedUpcoming = readClientCache('upcoming');
  if (cachedUpcoming){
    let sourceList = [];
    let scopeMatches = true;
    if (Array.isArray(cachedUpcoming)){
      sourceList = cachedUpcoming;
    }else if (cachedUpcoming && typeof cachedUpcoming === 'object'){
      sourceList = Array.isArray(cachedUpcoming.list) ? cachedUpcoming.list : [];
      const expectedScope = state.isLoggedIn ? 'mine' : 'public';
      if (cachedUpcoming.scope && cachedUpcoming.scope !== expectedScope){
        scopeMatches = false;
      }
    }
    if (scopeMatches && sourceList.length){
      applyUpcomingData(sourceList, 'local-cache');
    }
  }
  showLoading(true, 'โหลดแดชบอร์ด...');
  
  try{
    const dashboardPromise = fetchDashboardCached().then(res=>{
      if (!res || !res.data) return null;
      const decorated = {
        ...res.data,
        cached: Boolean(res.cached || res.data.cached),
        cacheSource: res.cached ? 'server-cache' : 'network'
      };
      writeClientCache('dashboard', decorated);
      return { decorated, cached: Boolean(res.cached) };
    });
    const upcomingPromise = loadUpcomingTasks();
    
    const [dashboard] = await Promise.all([dashboardPromise, upcomingPromise]);
    
    if (dashboard && dashboard.decorated){
      state.cacheStatus.dashboard = dashboard.cached ? 'cached' : 'computed';
      renderDashboard(dashboard.decorated);
    }
  }catch(error){
    console.warn('Fast load failed, trying standard endpoint:', error.message);
    try{
      const dashboard = await fetchDashboardStats();
      const decorated = {
        ...dashboard,
        cached: Boolean(dashboard.cached),
        cacheSource: dashboard.cached ? 'server-cache' : 'network'
      };
      writeClientCache('dashboard', decorated);
      state.cacheStatus.dashboard = decorated.cached ? 'cached' : 'computed';
      renderDashboard(decorated);
    }catch(err){
      handleDataError(err, 'โหลดแดชบอร์ดล้มเหลว');
    }
  }
}

async function fetchDashboardCached(){
  return apiRequest('dashboard_cached', {}, { 
    maxRetries: 1,
    timeout: 10000  // Fast timeout for cache
  });
}

async function fetchDashboardStats(){
  return apiRequest('dashboard', {}, { 
    maxRetries: 2,
    timeout: 15000
  });
}

async function loadUpcomingTasks(){
  const payload = {
    action: 'upcoming',
    days: state.upcomingDays
  };

  if (state.isLoggedIn){
    payload.scope = 'mine';
  }

  try{
    const res = await apiRequest('upcoming', payload);
    
    if (!res || res.success === false){
      throw new Error(res?.message || 'upcoming error');
    }

    const data = Array.isArray(res.data) ? res.data : [];
    applyUpcomingData(data, res.cached ? 'server-cache' : 'network');
    writeClientCache('upcoming', {
      list: data,
      scope: state.isLoggedIn ? 'mine' : 'public'
    });
    return data;
  }catch(err){
    console.error('Upcoming error:', err);
    applyUpcomingData([], 'error');
    return [];
  }
}

function applyUpcomingData(list, source){
  const data = Array.isArray(list) ? list : [];
  const personal = state.isLoggedIn;
  state.cacheStatus.upcoming = source || null;
  state.notifications = personal ? data : [];
  setText(els.notificationCount, personal ? (data.length || 0) : 0);
  renderNotificationsPanel();
  renderUpcomingTasks(data);
}

function readClientCache(key){
  const storageKey = CLIENT_CACHE_KEYS[key];
  if (!storageKey || typeof localStorage === 'undefined') return null;
  try{
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const ttl = CLIENT_CACHE_TTL[key] || 0;
    const storedAt = Number(parsed.storedAt || 0);
    if (ttl && (!storedAt || (Date.now() - storedAt) > ttl)){
      localStorage.removeItem(storageKey);
      return null;
    }
    return parsed.data;
  }catch(err){
    console.warn('Client cache read failed:', err);
    try{ localStorage.removeItem(storageKey); }catch(_){}
    return null;
  }
}

function writeClientCache(key, data){
  const storageKey = CLIENT_CACHE_KEYS[key];
  if (!storageKey || typeof localStorage === 'undefined') return;
  try{
    const payload = JSON.stringify({ storedAt: Date.now(), data });
    localStorage.setItem(storageKey, payload);
  }catch(err){
    if (err && (err.name === 'QuotaExceededError' || err.code === 22)){
      try{ localStorage.removeItem(storageKey); }catch(_){}
    }
    console.warn('Client cache write failed:', err);
  }
}

async function loadSecureData(){
  showLoading(true, 'โหลดข้อมูลของคุณ...');

  try{
    const [tasksResult, statsPromise] = await Promise.all([
      apiRequest('tasks', { scope: 'mine' }, { maxRetries: 2 }),
      fetchUserStatsCached().catch(err => {
        console.warn('User stats cache failed, using standard:', err.message);
        return apiRequest('user_stats', {}, { maxRetries: 2 });
      })
    ]);

    if (!tasksResult || tasksResult.success === false){
      throw new Error(tasksResult?.message || 'tasks error');
    }

    state.tasks = tasksResult.data || [];
    if (tasksResult.currentUser){
      state.currentUser = tasksResult.currentUser;
      state.isAdmin = String(state.currentUser.level || '').trim().toLowerCase() === 'admin';
    }
    updateProfileNavAvatar();

    const stats = statsPromise.data || [];
    state.userStats = Array.isArray(stats) ? stats : [];
    state.cacheStatus.userStats = statsPromise.cached ? 'cached' : 'computed';

    renderTasks(state.tasks);
    renderUserStats(state.userStats);
    updateAdminUI();
    addSyncButton();
    addAdminOptions();
  }catch(err){
    handleDataError(err, 'ไม่สามารถโหลดข้อมูลแบบละเอียดได้');
  }finally{
    showLoading(false);
  }
}

async function fetchUserStatsCached(){
  return apiRequest('user_stats_cached', {}, { 
    maxRetries: 1,
    timeout: 20000
  });
}

/** =========================================================
 * UI RENDERING FUNCTIONS
 * ======================================================= **/

function renderDashboard(data){
  if (!data) return;
  
  state.dashboard = data;
  const summary = data.summary || {};
  
  setText(els.headerTotals.totalTasks, summary.totalTasks || 0);
  setText(els.headerTotals.upcomingTasks, summary.upcomingTasks || 0);
  setText(els.headerTotals.totalUsers, summary.uniqueAssignees || 0);
  const completion = summary.completionRate != null ? `${summary.completionRate}%` : '0%';
  setText(els.headerTotals.completionRate, completion);
  
  setText(els.stats.completed, summary.completedTasks || 0);
  setText(els.stats.pending, summary.pendingTasks || 0);
  setText(els.stats.month, summary.currentMonthTasks || 0);
  setText(els.stats.completionRate, completion);

  state.personalStats = data.personal || null;
  if (data.currentUser){
    state.currentUser = data.currentUser;
  }
  updateProfileNavAvatar();
  state.isAdmin = state.currentUser ? String(state.currentUser.level || '').trim().toLowerCase() === 'admin' : state.isAdmin;
  
  updateAdminUI();

  if (els.statsPersonal.container){
    if (state.personalStats){
      els.statsPersonal.container.classList.remove('hidden');
      setText(els.headerTotals.myTasks, state.personalStats.totalTasks || 0);
      setText(els.headerTotals.myUpcoming, state.personalStats.upcomingTasks || 0);
      setText(els.statsPersonal.completed, state.personalStats.completedTasks || 0);
      setText(els.statsPersonal.pending, state.personalStats.pendingTasks || 0);
      setText(els.statsPersonal.month, state.personalStats.currentMonthTasks || 0);
      setText(els.statsPersonal.upcoming, state.personalStats.upcomingTasks || 0);
    } else {
      els.statsPersonal.container.classList.add('hidden');
    }
  }

  // Show cache status badge
  if (data.cached){
    const badge = document.querySelector('#dashboardCacheStatus');
    if (badge){
      badge.textContent = '⚡ Cached';
      badge.classList.add('text-xs', 'text-green-600', 'font-semibold');
    }
  }
}

function renderUpcomingTasks(list){
  if (!els.taskCardsContainer) return;
  
  if (!state.isLoggedIn){
    els.taskCardsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-dashed border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบผ่าน LINE เพื่อดูรายละเอียดงานที่กำลังจะถึง
      </div>
    `;
    return;
  }

  if (!list.length){
    els.taskCardsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่พบงานที่กำลังจะถึงในช่วง ${state.upcomingDays} วัน
      </div>
    `;
    return;
  }

  const html = list.map(task=>{
    const thaiDate = formatThaiDate(task.dueDate);
    return `
      <div class="task-card bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div class="flex justify-between items-start">
          <h3 class="text-base font-semibold text-gray-800">${escapeHtml(task.name)}</h3>
          <span class="text-xs font-medium px-2 py-1 rounded-full ${task.daysUntilDue==='0' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}">
            ${task.daysUntilDue==='0' ? 'วันนี้' : `อีก ${task.daysUntilDue} วัน`}
          </span>
        </div>
        <p class="text-sm text-gray-500 mt-1">${escapeHtml(task.assignee)}</p>
        <div class="flex items-center justify-between mt-3 text-sm text-gray-600">
          <span class="flex items-center space-x-1">
            <span class="material-icons text-base text-blue-500">event</span>
            <span>${escapeHtml(thaiDate)}</span>
          </span>
          <span class="flex items-center space-x-1">
            <span class="material-icons text-base text-green-500">flag</span>
            <span>${escapeHtml(task.status || task.completed || '')}</span>
          </span>
        </div>
      </div>
    `;
  }).join('');
  
  els.taskCardsContainer.innerHTML = html;
}

function renderTasks(tasks){
  if (!els.allTasksContainer) return;
  
  if (!state.isLoggedIn){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูรายการงานทั้งหมด
      </div>
    `;
    return;
  }

  state.tasks = Array.isArray(tasks) ? tasks.slice() : [];
  state.taskFilters = state.taskFilters || { status:'all', search:'' };
  state.taskPagination = state.taskPagination || { page:1, pageSize:10, totalPages:1 };
  state.taskPagination.page = 1;
  applyTaskFilters();
}

function applyTaskFilters(){
  if (!els.allTasksContainer) return;
  
  if (!state.isLoggedIn){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูรายการงานทั้งหมด
      </div>
    `;
    return;
  }

  const tasks = state.tasks || [];
  const search = String(state.taskFilters.search || '').trim().toLowerCase();
  const status = String(state.taskFilters.status || 'all').toLowerCase();

  const filtered = tasks.filter(task=>{
    const isCompleted = task.completed === 'Yes';
    if (status === 'completed' && !isCompleted) return false;
    if (status === 'pending' && isCompleted) return false;
    if (!search) return true;
    
    const haystack = [
      task.name,
      task.assignee,
      task.status,
      task.dueDate,
      task.dueDateThai
    ].map(value=> String(value || '').toLowerCase());
    
    return haystack.some(text => text.includes(search));
  });

  filtered.sort((a,b)=>{
    const da = parseTaskDue_(a.dueDate);
    const db = parseTaskDue_(b.dueDate);
    if (db === da) return String(a.name || '').localeCompare(String(b.name || ''));
    return db - da;
  });

  state.filteredTasks = filtered;
  const totalPages = Math.max(1, Math.ceil(filtered.length / state.taskPagination.pageSize));
  state.taskPagination.totalPages = totalPages;
  if (state.taskPagination.page > totalPages){
    state.taskPagination.page = totalPages;
  }
  
  renderTaskList();
  renderTaskPagination();
}

function renderTaskList(){
  if (!els.allTasksContainer) return;
  
  if (!state.isLoggedIn){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูรายการงานทั้งหมด
      </div>
    `;
    return;
  }

  if (!state.filteredTasks.length){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่พบงานที่ตรงกับเงื่อนไขการค้นหา
      </div>
    `;
    return;
  }

  const start = (state.taskPagination.page - 1) * state.taskPagination.pageSize;
  const end = start + state.taskPagination.pageSize;
  const items = state.filteredTasks.slice(start, end);

  const html = items.map(task=>{
    const isCompleted = task.completed === 'Yes';
    const statusLabel = task.status || (isCompleted ? 'เสร็จสมบูรณ์' : 'รอดำเนินการ');
    const statusClass = isCompleted ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600';
    const thaiDate = formatThaiDate(task.dueDate);
    const dueMeta = formatDueMeta_(task.dueDate);
    const sourceLabel = task.source === 'WEB' ? '(จากเว็บ)' : '';
    const buttonClass = isCompleted
      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
      : 'bg-blue-600 hover:bg-blue-700 text-white';
    const buttonLabel = isCompleted ? 'เสร็จสมบูรณ์แล้ว' : 'ทำเครื่องหมายว่าเสร็จ';
    const disabledAttr = isCompleted ? 'disabled' : '';
    const canManage = canManageTask(task);
    const showCrud = canManage && String(task.source || '').toUpperCase() === 'WEB';

    return `
      <div class="task-card bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h3 class="text-base font-semibold text-gray-800">${escapeHtml(task.name)}</h3>
            <p class="text-xs text-gray-400 mt-1">${sourceLabel}</p>
            <p class="text-sm text-gray-500 mt-1">${escapeHtml(task.assignee || 'ไม่มีผู้รับผิดชอบ')}</p>
          </div>
          <span class="text-xs font-medium px-2 py-1 rounded-full ${statusClass}">
            ${escapeHtml(statusLabel)}
          </span>
        </div>
        <div class="mt-3 text-sm text-gray-600 space-y-1">
          <div class="flex items-center space-x-2">
            <span class="material-icons text-base text-blue-500">event</span>
            <span>${escapeHtml(thaiDate)}</span>
            <span class="text-xs text-gray-400">${escapeHtml(dueMeta)}</span>
          </div>
          ${task.link ? `
            <div class="flex items-center space-x-2 text-xs text-gray-500">
              <span class="material-icons text-base text-purple-500">link</span>
              <a href="${escapeAttr(task.link)}" target="_blank" class="text-blue-600 hover:underline">เปิดใน ${task.source}</a>
            </div>
          ` : ''}
        </div>
        ${showCrud ? `
        <div class="mt-3 flex items-center gap-2 text-xs">
          <button type="button" class="px-3 py-1 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition flex items-center gap-1" data-action="edit-task" data-task-id="${escapeAttr(task.id)}">
            <span class="material-icons text-sm">edit</span>
            <span>แก้ไข</span>
          </button>
          <button type="button" class="px-3 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition flex items-center gap-1" data-action="delete-task" data-task-id="${escapeAttr(task.id)}">
            <span class="material-icons text-sm">delete</span>
            <span>ลบ</span>
          </button>
        </div>
        ` : ''}
        <button class="mt-4 w-full ${buttonClass} py-2 rounded-lg text-sm font-medium flex items-center justify-center space-x-2 transition" data-action="update-status" data-task-id="${escapeAttr(task.id)}" ${disabledAttr}>
          <span class="material-icons text-base">${isCompleted ? 'task_alt' : 'done'}</span>
          <span>${buttonLabel}</span>
        </button>
      </div>
    `;
  }).join('');

  els.allTasksContainer.innerHTML = html;
}

function renderTaskPagination(){
  if (!els.taskPaginationInfo) return;
  
  const wrapper = els.taskPaginationWrapper;
  if (wrapper){
    const shouldHide = !state.isLoggedIn || state.filteredTasks.length <= state.taskPagination.pageSize;
    wrapper.classList.toggle('hidden', shouldHide);
  }

  if (!state.filteredTasks.length){
    els.taskPaginationInfo.textContent = 'ไม่มีงาน';
    if (els.taskPaginationPrev) els.taskPaginationPrev.disabled = true;
    if (els.taskPaginationNext) els.taskPaginationNext.disabled = true;
    return;
  }

  const totalPages = state.taskPagination.totalPages || 1;
  const currentPage = state.taskPagination.page || 1;
  els.taskPaginationInfo.textContent = `หน้า ${currentPage}/${totalPages}`;
  if (els.taskPaginationPrev) els.taskPaginationPrev.disabled = currentPage <= 1;
  if (els.taskPaginationNext) els.taskPaginationNext.disabled = currentPage >= totalPages;
}

function renderUserStats(stats){
  if (!els.userStatsContainer) return;
  
  if (!state.isLoggedIn){
    els.userStatsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูสถิติรายบุคคล
      </div>
    `;
    return;
  }

  const activeStats = stats.filter(row => row.totalTasks > 0);

  if (!activeStats.length){
    els.userStatsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่มีสถิติผู้ใช้ที่ Active
      </div>
    `;
    return;
  }

  const html = activeStats.map((row, index)=>{
    const completionClass = row.completionRate >= 80 ? 'text-green-600' : 
                           row.completionRate >= 50 ? 'text-yellow-600' : 'text-red-600';
    return `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items<center justify-center text-white font-bold">
            ${index+1}
          </div>
          <div>
            <p class="text-sm font-semibold text-gray-800">${escapeHtml(row.assignee || 'ไม่ทราบชื่อ')}</p>
            <p class="text-xs text-gray-500">${escapeHtml(row.email || 'ไม่มีอีเมล')}</p>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row sm:space-x-4 text-xs text-gray-600 text-right sm:text-left">
          <span>งานทั้งหมด: <strong class="text-blue-600">${row.totalTasks || 0}</strong></span>
          <span>เสร็จแล้ว: <strong class="text-green-600">${row.completedTasks || 0}</strong></span>
          <span>รอดำเนินการ: <strong class="text-yellow-600">${row.pendingTasks || 0}</strong></span>
          <span>ความสำเร็จ: <strong class="${completionClass}">${row.completionRate || 0}%</strong></span>
        </div>
      </div>
    `;
  }).join('');

  els.userStatsContainer.innerHTML = html;
}

// [Continue with remaining functions: cachePages, bindUI, initModalElements, openTaskModal, closeTaskModal, handleTaskFormSubmit, etc.]
// [All event handlers, modal functions, and utility functions remain the same as before, but updated to use apiRequest instead of jsonpRequest]

function cachePages(){
  const pages = Array.from(document.querySelectorAll('.page'));
  pages.forEach(page => {
    els.pages[page.id] = page;
  });
  const active = pages.find(page => page.classList.contains('active'));
  if (active) state.activePage = active.id;
  els.homePage = els.pages.homePage;
  els.tasksPage = els.pages.tasksPage;
  els.teachersPage = els.pages.teachersPage;
  els.profilePage = els.pages.profilePage;
  els.navItems = els.nav;
}

function bindUI(){
  els.navItems.forEach(item=>{
    item.addEventListener('click', evt=>{
      evt.preventDefault();
      const pageId = item.getAttribute('data-page');
      if (!state.isLoggedIn && pageId !== 'homePage'){
        toastInfo('กรุณาเข้าสู่ระบบผ่าน LINE เพื่อดูรายละเอียด');
        return;
      }
      switchPage(pageId);
      updateFabVisibility();
      
      if (pageId === 'tasksPage'){
        setTimeout(addSyncButton, 100);
      }
      if (pageId === 'profilePage'){
        setTimeout(addAdminOptions, 100);
      }
    });
  });

  if (els.refreshBtn){
    els.refreshBtn.addEventListener('click', ()=>{
      showLoading(true, 'กำลังรีเฟรช...');
      const target = state.isLoggedIn ? loadSecureData() : Promise.resolve();
      Promise.all([loadPublicData(), target])
        .catch(err=>{
          console.error('Refresh error:', err);
          toastError('รีเฟรชข้อมูลไม่สำเร็จ');
        })
        .finally(()=> showLoading(false));
    });
  }

  els.timeFilters.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const days = Number(btn.dataset.days || '7');
      state.upcomingDays = days;
      els.timeFilters.forEach(b=>b.classList.remove('active','bg-blue-600','text-white'));
      btn.classList.add('active','bg-blue-600','text-white');
      showLoading(true, 'กำลังโหลดงาน...');
      loadUpcomingTasks().finally(()=> showLoading(false));
    });
  });

  if (els.fabBtn){
    els.fabBtn.addEventListener('click', ()=> window.scrollTo({ top:0, behavior:'smooth' }));
    window.addEventListener('scroll', ()=> updateFabVisibility());
    updateFabVisibility();
  }

  if (els.notificationBtn){
    els.notificationBtn.addEventListener('click', showNotifications);
  }
  if (els.notificationsClose){
    els.notificationsClose.addEventListener('click', closeNotificationsPanel);
  }
  if (els.notificationsBackdrop){
    els.notificationsBackdrop.addEventListener('click', closeNotificationsPanel);
  }

  document.addEventListener('keydown', evt => {
    if (evt.key === 'Escape'){
      if (document.body.classList.contains('modal-open')){
        closeTaskModal();
        return;
      }
      if (document.body.classList.contains('notifications-open')){
        closeNotificationsPanel();
      }
    }
  });

  if (els.allTasksContainer){
    els.allTasksContainer.addEventListener('click', evt=>{
      const button = evt.target.closest('[data-action]');
      if (!button) return;
      const taskId = button.dataset.taskId;
      const action = button.dataset.action;
      if (!taskId || !action) return;
      if (action === 'update-status'){
        handleUpdateStatus(taskId);
      }else if (action === 'edit-task'){
        handleEditTask(taskId);
      }else if (action === 'delete-task'){
        handleDeleteTask(taskId);
      }
    });
  }

  if (els.taskSearchInput){
    els.taskSearchInput.addEventListener('input', ()=>{
      state.taskFilters.search = els.taskSearchInput.value.trim();
      state.taskPagination.page = 1;
      applyTaskFilters();
    });
  }

  if (els.taskStatusFilter){
    els.taskStatusFilter.addEventListener('change', ()=>{
      state.taskFilters.status = els.taskStatusFilter.value;
      state.taskPagination.page = 1;
      applyTaskFilters();
    });
  }

  if (els.taskPaginationPrev){
    els.taskPaginationPrev.addEventListener('click', ()=>{
      if (state.taskPagination.page > 1){
        state.taskPagination.page -= 1;
        renderTaskList();
        renderTaskPagination();
      }
    });
  }

  if (els.taskPaginationNext){
    els.taskPaginationNext.addEventListener('click', ()=>{
      if (state.taskPagination.page < state.taskPagination.totalPages){
        state.taskPagination.page += 1;
        renderTaskList();
        renderTaskPagination();
      }
    });
  }

  if (els.addTaskBtn){
    els.addTaskBtn.addEventListener('click', ()=> openTaskModal());
  }
}

function initModalElements(){
  els.taskModal = document.getElementById('taskModal');
  els.modalLoading = document.getElementById('modalLoading');
  els.taskForm = document.getElementById('taskForm');
  els.closeModalBtn = document.getElementById('closeModalBtn');
  els.cancelModalBtn = document.getElementById('cancelModalBtn');
  els.submitTaskBtn = document.getElementById('submitTaskBtn');
  els.taskNameInput = document.getElementById('taskName');
  els.taskAssigneeSearch = document.getElementById('taskAssigneeSearch');
  els.taskAssigneeOptions = document.getElementById('taskAssigneeOptions');
  els.taskAssigneeSelected = document.getElementById('taskAssigneeSelected');
  els.taskDueDateInput = document.getElementById('taskDueDate');
  els.taskNotesInput = document.getElementById('taskNotes');
  els.quickDueButtons = Array.from(document.querySelectorAll('[data-quick-due]'));
  if (els.taskDueDateInput){
    els.taskDueDateInput.addEventListener('input', ()=> updateQuickDueActive(null));
  }

  if (els.quickDueButtons.length){
    els.quickDueButtons.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const days = Number(btn.dataset.quickDue || '0');
        applyQuickDueSelection(btn, days);
      });
    });
  }

  if (els.taskAssigneeSearch){
    els.taskAssigneeSearch.addEventListener('input', handleAssigneeSearchInput);
  }
  if (els.taskAssigneeOptions){
    els.taskAssigneeOptions.addEventListener('click', handleAssigneeOptionClick);
  }
  if (els.taskAssigneeSelected){
    els.taskAssigneeSelected.addEventListener('click', handleAssigneeChipClick);
  }

  if (els.closeModalBtn) els.closeModalBtn.addEventListener('click', closeTaskModal);
  if (els.cancelModalBtn) els.cancelModalBtn.addEventListener('click', closeTaskModal);
  if (els.taskForm) els.taskForm.addEventListener('submit', handleTaskFormSubmit);
  if (els.taskModal){
    els.taskModal.addEventListener('animationend', ()=> updateFabVisibility());
    els.taskModal.addEventListener('click', evt=>{
      if (evt.target === els.taskModal){
        closeTaskModal();
      }
    });
  }
  updateQuickDueActive(null);
  updateAssigneeChips();
}

function openTaskModal(task){
  if (!els.taskModal) return;
  const isEditing = !!task;
  state.editingTask = task || null;

  if (els.taskForm) els.taskForm.reset();
  updateQuickDueActive(null);

  const titleEl = els.taskModalTitle;
  const descEl = els.taskModalDescription;
  const submitLabel = els.submitTaskBtn?.querySelector('span:last-child');
  if (titleEl) titleEl.textContent = isEditing ? 'แก้ไขงาน' : 'เพิ่มงานใหม่';
  if (descEl) descEl.textContent = isEditing
    ? 'ปรับปรุงรายละเอียดงานและบันทึกการแก้ไขของคุณ'
    : 'กรอกข้อมูลให้ครบถ้วนเพื่อสร้างงานและแจ้งผู้รับผิดชอบ';
  if (submitLabel) submitLabel.textContent = isEditing ? 'บันทึกการแก้ไข' : 'บันทึกงาน';

  const applyEditSelection = () => {
    const email = String(task?.assigneeEmail || '').trim().toLowerCase();
    state.assigneeSearchTerm = '';
    state.selectedAssignees = email ? [email] : [];
    if (els.taskAssigneeSearch) els.taskAssigneeSearch.value = '';
    if (state.activeUsers.length){
      renderAssigneeOptions(state.activeUsers);
    } else {
      setAssigneeStatus(email ? 'กำลังโหลดรายชื่อผู้รับผิดชอบ...' : 'ยังไม่มีรายชื่อผู้รับผิดชอบ');
    }
    updateAssigneeChips();
  };

  if (isEditing){
    if (els.taskNameInput) els.taskNameInput.value = task?.name || '';
    if (els.taskDueDateInput){
      const value = task?.dueDate && task.dueDate !== 'No Due Date' ? task.dueDate : '';
      els.taskDueDateInput.value = value || '';
    }
    if (els.taskNotesInput) els.taskNotesInput.value = task?.notes || '';
    state.assigneeSearchTerm = '';
    state.selectedAssignees = [];
    updateAssigneeChips();
  } else {
    resetAssigneeSelection();
    if (els.taskNameInput) els.taskNameInput.value = '';
    if (els.taskDueDateInput) els.taskDueDateInput.value = '';
    if (els.taskNotesInput) els.taskNotesInput.value = '';
  }

  if (els.taskDueDateInput){
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    els.taskDueDateInput.min = `${yyyy}-${mm}-${dd}`;
  }
  document.body.classList.add('modal-open');
  els.taskModal.classList.remove('hidden');
  requestAnimationFrame(()=>{
    if (els.taskModal) els.taskModal.classList.add('active');
  });
  updateFabVisibility();
  ensureActiveUsers().then(()=>{
    if (isEditing){
      applyEditSelection();
    }else{
      renderAssigneeOptions(state.activeUsers);
    }
  }).catch(()=>{});
  if (isEditing){
    applyEditSelection();
  }
  if (els.taskNameInput){
    setTimeout(()=>{
      try{
        els.taskNameInput.focus({ preventScroll:true });
      }catch(_){
        els.taskNameInput.focus();
      }
    }, 120);
  }
}

function closeTaskModal(){
  if (!els.taskModal) return;
  els.taskModal.classList.remove('active');
  document.body.classList.remove('modal-open');
  state.editingTask = null;
  updateFabVisibility();
  setTimeout(()=>{
    if (els.taskModal && !els.taskModal.classList.contains('active')){
      els.taskModal.classList.add('hidden');
    }
  }, 220);
  updateQuickDueActive(null);
}

function applyQuickDueSelection(targetBtn, offsetDays){
  if (!els.taskDueDateInput) return;
  const base = new Date();
  base.setHours(0,0,0,0);
  const days = Number(offsetDays) || 0;
  base.setDate(base.getDate() + days);
  const iso = base.toISOString().slice(0,10);
  els.taskDueDateInput.value = iso;
  updateQuickDueActive(targetBtn);
}

function updateQuickDueActive(activeBtn){
  if (!Array.isArray(els.quickDueButtons)) return;
  els.quickDueButtons.forEach(btn=>{
    if (btn === activeBtn){
      btn.classList.add('active');
      btn.setAttribute('aria-pressed', 'true');
    }else{
      btn.classList.remove('active');
      btn.setAttribute('aria-pressed', 'false');
    }
  });
}

function handleAssigneeSearchInput(){
  state.assigneeSearchTerm = (els.taskAssigneeSearch?.value || '').trim().toLowerCase();
  if (!state.activeUsers.length){
    renderAssigneeOptions([]);
    return;
  }
  const filtered = filterActiveUsersByTerm_(state.activeUsers, state.assigneeSearchTerm);
  renderAssigneeOptions(filtered);
}

function handleAssigneeOptionClick(evt){
  const checkbox = evt.target.closest('input[type="checkbox"]');
  if (checkbox){
    const email = String(checkbox.dataset.email || checkbox.value || '').trim().toLowerCase();
    toggleAssigneeSelection(email, checkbox.checked);
    return;
  }
  const option = evt.target.closest('.assignee-option');
  if (!option) return;
  const input = option.querySelector('input[type="checkbox"]');
  if (!input) return;
  const email = String(input.dataset.email || input.value || '').trim().toLowerCase();
  const nextState = !input.checked;
  input.checked = nextState;
  toggleAssigneeSelection(email, nextState);
}

function handleAssigneeChipClick(evt){
  const button = evt.target.closest('[data-remove-email]');
  if (!button) return;
  const email = String(button.dataset.removeEmail || '').trim().toLowerCase();
  toggleAssigneeSelection(email, false);
}

function toggleAssigneeSelection(email, forceValue){
  if (!email) return;
  const normalized = email.toLowerCase();
  const selected = state.selectedAssignees || [];
  const index = selected.indexOf(normalized);
  const exists = index >= 0;
  const shouldAdd = forceValue === true || (forceValue !== false && !exists);
  if (state.editingTask){
    state.selectedAssignees = shouldAdd ? [normalized] : [];
    updateAssigneeOptionsActive();
    updateAssigneeChips();
    return;
  }
  if (shouldAdd && !exists){
    selected.push(normalized);
  }else if (!shouldAdd && exists){
    selected.splice(index, 1);
  }
  state.selectedAssignees = selected;
  updateAssigneeOptionsActive();
  updateAssigneeChips();
}

function updateAssigneeOptionsActive(){
  if (!els.taskAssigneeOptions) return;
  const nodes = els.taskAssigneeOptions.querySelectorAll('.assignee-option');
  nodes.forEach(node=>{
    const email = String(node.dataset.email || '').toLowerCase();
    const isSelected = state.selectedAssignees.includes(email);
    node.classList.toggle('active', isSelected);
    const checkbox = node.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = isSelected;
  });
}

function updateAssigneeChips(){
  if (!els.taskAssigneeSelected) return;
  const selected = state.selectedAssignees || [];
  if (!selected.length){
    els.taskAssigneeSelected.innerHTML = '<span class="text-xs text-gray-400">ยังไม่ได้เลือก</span>';
    return;
  }
  const chips = selected.map(email=>{
    const label = escapeHtml(getAssigneeLabel(email));
    return `<span class="assignee-chip" data-chip-email="${escapeAttr(email)}">${label}<button type="button" aria-label="ลบ ${label}" data-remove-email="${escapeAttr(email)}"><span class="material-icons" style="font-size:16px;">close</span></button></span>`;
  }).join('');
  els.taskAssigneeSelected.innerHTML = chips;
}

function renderAssigneeOptions(list){
  if (!els.taskAssigneeOptions) return;
  const users = Array.isArray(list) ? list : [];
  state.filteredActiveUsers = users;
  if (!users.length){
    const message = state.activeUsers.length
      ? 'ไม่พบรายชื่อที่ตรงกับการค้นหา'
      : 'ยังไม่มีรายชื่อผู้รับผิดชอบ';
    setAssigneeStatus(message);
    return;
  }
  const html = users.map(user=>{
    const email = user.email || '';
    const isSelected = state.selectedAssignees.includes(email);
    const detail = [user.role, user.department].filter(Boolean).join(' • ');
    const meta = detail ? `<span class="text-xs text-gray-400">${escapeHtml(detail)}</span>` : '';
    return `
      <div class="assignee-option${isSelected ? ' active' : ''}" data-email="${escapeAttr(email)}">
        <label>
          <input type="checkbox" data-email="${escapeAttr(email)}" ${isSelected ? 'checked' : ''}>
          <div class="assignee-meta">
            <span>${escapeHtml(user.name || email)}</span>
            <span>${escapeHtml(email)}</span>
          </div>
        </label>
        ${meta}
      </div>
    `;
  }).join('');
  els.taskAssigneeOptions.innerHTML = html;
  updateAssigneeOptionsActive();
}

function setAssigneeStatus(message){
  if (!els.taskAssigneeOptions) return;
  els.taskAssigneeOptions.innerHTML = `<div class="assignee-empty">${escapeHtml(message || '')}</div>`;
}

let activeUsersPromise = null;
async function ensureActiveUsers(forceReload){
  if (!state.isLoggedIn){
    setAssigneeStatus('ต้องเข้าสู่ระบบเพื่อเลือกผู้รับผิดชอบ');
    return [];
  }
  if (!forceReload && state.activeUsers.length){
    const filtered = filterActiveUsersByTerm_(state.activeUsers, state.assigneeSearchTerm);
    renderAssigneeOptions(filtered);
    return state.activeUsers;
  }
  if (activeUsersPromise && !forceReload) return activeUsersPromise;
  setAssigneeStatus('กำลังโหลดรายชื่อผู้รับผิดชอบ...');
  activeUsersPromise = apiRequest('users_active', {}, { maxRetries: 1 })
    .then(res=>{
      if (!res || res.success === false){
        throw new Error(res?.message || 'active users error');
      }
      const users = normalizeActiveUsers_(Array.isArray(res.data) ? res.data : []);
      state.activeUsers = users;
      const filtered = filterActiveUsersByTerm_(users, state.assigneeSearchTerm);
      renderAssigneeOptions(filtered);
      return users;
    })
    .catch(err=>{
      console.error('Active users load failed', err);
      setAssigneeStatus('ไม่สามารถโหลดรายชื่อผู้รับผิดชอบได้');
      return [];
    })
    .finally(()=>{ activeUsersPromise = null; });
  return activeUsersPromise;
}

function resetAssigneeSelection(){
  state.assigneeSearchTerm = '';
  const selected = [];
  const currentEmail = String(state.currentUser?.email || '').trim().toLowerCase();
  if (currentEmail) selected.push(currentEmail);
  state.selectedAssignees = selected;
  if (els.taskAssigneeSearch) els.taskAssigneeSearch.value = '';
  if (state.activeUsers.length){
    renderAssigneeOptions(state.activeUsers);
  }else{
    setAssigneeStatus('กำลังโหลดรายชื่อผู้รับผิดชอบ...');
  }
  updateAssigneeChips();
}

function getAssigneeLabel(email){
  const normalized = String(email || '').toLowerCase();
  const match = state.activeUsers.find(user => user.email === normalized);
  return match?.name || normalized;
}

function normalizeActiveUsers_(list){
  const seen = {};
  return list.reduce((acc, raw)=>{
    const email = String(raw.email || '').trim().toLowerCase();
    if (!email || seen[email]) return acc;
    seen[email] = true;
    acc.push({
      email,
      name: raw.name || raw.displayName || raw.user || email,
      role: raw.role || raw.level || raw.position || '',
      department: raw.department || raw.group || ''
    });
    return acc;
  }, []);
}

function filterActiveUsersByTerm_(users, term){
  if (!Array.isArray(users)) return [];
  const lower = String(term || '').toLowerCase();
  if (!lower) return users.slice();
  return users.filter(user=>{
    const name = (user.name || '').toLowerCase();
    const email = user.email || '';
    const role = (user.role || '').toLowerCase();
    const dept = (user.department || '').toLowerCase();
    return name.includes(lower) || email.includes(lower) || role.includes(lower) || dept.includes(lower);
  });
}

function showModalLoading(show){
  if (els.modalLoading) els.modalLoading.classList.toggle('hidden', !show);
}

async function handleTaskFormSubmit(evt){
  evt.preventDefault();
  
  if (!state.isLoggedIn){
    toastInfo('กรุณาเข้าสู่ระบบก่อน');
    return;
  }
  
  const editingTask = state.editingTask ? { ...state.editingTask } : null;
  const isEditing = !!editingTask;
  const editingTaskId = editingTask ? (editingTask.id || editingTask.gid || editingTask.taskId || editingTask.TaskId || null) : null;
  const originalAssignee = editingTask ? String(editingTask.assigneeEmail || '').trim().toLowerCase() : '';

  const name = (els.taskNameInput?.value || '').trim();
  const dueDate = (els.taskDueDateInput?.value || '').trim();
  if (!validateDateFormat_(dueDate)){
    toastError('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
    return;
  }

  let notes = (els.taskNotesInput?.value || '').trim();
  if (isEditing && !notes && editingTask && editingTask.notes){
    notes = String(editingTask.notes);
  }

  const selectedAssignees = Array.isArray(state.selectedAssignees)
    ? state.selectedAssignees.filter(Boolean)
    : [];
  const primaryAssignee = selectedAssignees[0] || originalAssignee || '';
  
  if (!name){
    toastInfo('กรุณากรอกชื่องาน');
    return;
  }
  if (isEditing && !editingTaskId){
    toastError('ไม่พบข้อมูลงานสำหรับแก้ไข');
    return;
  }
  
  showModalLoading(true);
  closeTaskModal();
  
  try{
    if (isEditing){
      const updatePayload = {
        taskId: editingTaskId,
        name,
        assigneeEmail: primaryAssignee,
        dueDate,
        notes
      };
      const res = await apiRequest('web_update_task', updatePayload, { maxRetries: 2 });
      if (!res || res.success === false){
        throw new Error(res?.message || 'update task error');
      }
      toastInfo('Task updated successfully');
    }else{
      const createPayload = {
        name,
        assigneeEmail: primaryAssignee,
        dueDate,
        notes
      };
      if (selectedAssignees.length){
        createPayload.assignees = JSON.stringify(selectedAssignees);
      }
      const res = await apiRequest('web_create_task', createPayload, { maxRetries: 2 });
      if (!res || res.success === false){
        throw new Error(res?.message || 'create task error');
      }
      toastInfo('New task created');
    }
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, isEditing ? 'ไม่สามารถอัปเดตงานได้' : 'ไม่สามารถเพิ่มงานใหม่ได้');
  }finally{
    showModalLoading(false);
  }
}

function addSyncButton(){
  const tasksPage = els.tasksPage;
  if (!tasksPage) return;
  
  let syncSection = document.getElementById('syncAdminSection');
  if (!syncSection && state.isAdmin && state.apiKey){
    syncSection = document.createElement('div');
    syncSection.id = 'syncAdminSection';
    syncSection.className = 'bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-300 rounded-xl p-4 mb-4 flex items-center justify-between';
    syncSection.innerHTML = `
      <div class="flex items-center space-x-3">
        <span class="material-icons text-blue-600 text-2xl">cloud_sync</span>
        <div>
          <h3 class="font-semibold text-gray-800">ตัวเลือกผู้ดูแลระบบ</h3>
          <p class="text-xs text-gray-600">ซิงค์จาก Asana หรือวิเคราะห์ภาระงาน</p>
        </div>
      </div>
      <div class="flex space-x-2">
        <button id="btnSyncRecent" class="flex items-center space-x-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 transition">
          <span class="material-icons text-sm">sync</span>
          <span>ซิงค์ (14 วัน)</span>
        </button>
        <button id="btnAnalyzeRisk" class="flex items-center space-x-1 bg-purple-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-purple-700 transition">
          <span class="material-icons text-sm">analytics</span>
          <span>วิเคราะห์</span>
        </button>
      </div>
    `;
    
    const firstChild = tasksPage.firstChild;
    if (firstChild){
      tasksPage.insertBefore(syncSection, firstChild);
    } else {
      tasksPage.appendChild(syncSection);
    }
    
    const btnSync = document.getElementById('btnSyncRecent');
    if (btnSync) btnSync.addEventListener('click', handleAdminSync);
    
    const btnAnalyze = document.getElementById('btnAnalyzeRisk');
    if (btnAnalyze) btnAnalyze.addEventListener('click', handleAdminAnalyze);
  }
}

async function handleAdminSync(){
  if (!state.isAdmin || !state.apiKey){
    toastInfo('ต้องเป็นผู้ดูแลระบบและมี API Key');
    return;
  }
  
  const confirmed = confirm('ซิงค์งานล่าสุด 14 วันจาก Asana?\n\nสิ่งนี้อาจใช้เวลาสักครู่...');
  if (!confirmed) return;
  
  showLoading(true, 'กำลังซิงค์ Asana...');
  
  try{
    const res = await apiRequest('sync_asana_recent_v2', {
      days: 14,
      force: true
    }, { maxRetries: 1, timeout: 60000 });
    
    if (!res || res.success === false){
      throw new Error(res?.message || 'sync failed');
    }
    
    const msg = `✓ ซิงค์สำเร็จ\n━━━━━━━━━\nทั้งหมด: ${res.total}\nสร้างใหม่: ${res.created}\nอัปเดต: ${res.updated}`;
    toastInfo(msg);
    
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'ซิงค์ไม่สำเร็จ');
  }finally{
    showLoading(false);
  }
}

async function handleAdminAnalyze(){
  if (!state.isAdmin || !state.apiKey){
    toastInfo('ต้องเป็นผู้ดูแลระบบและมี API Key');
    return;
  }
  
  const confirmed = confirm('วิเคราะห์ภาระงานและความเสี่ยง?\n\nสิ่งนี้จะอัปเดตชีต Workload');
  if (!confirmed) return;
  
  showLoading(true, 'กำลังวิเคราะห์...');
  
  try{
    const res = await apiRequest('analyze_workload_risk_v2', {}, { maxRetries: 1, timeout: 60000 });
    
    if (!res || res.success === false){
      throw new Error(res?.message || 'analyze failed');
    }
    
    const msg = `✓ วิเคราะห์สำเร็จ\n━━━━━━━━━\nคน: ${res.totalPeople}\nงานทั้งหมด: ${res.totalTasksAll}\nสัปดาห์นี้: ${res.totalTasksWeek}\n\n✓ ชีต Workload อัปเดตแล้ว`;
    toastInfo(msg);
  }catch(err){
    handleDataError(err, 'วิเคราะห์ไม่สำเร็จ');
  }finally{
    showLoading(false);
  }
}

function addAdminOptions(){
  const profilePage = els.profilePage;
  if (!profilePage) return;
  
  if (state.isLoggedIn && state.isAdmin && state.apiKey){
    let adminSection = document.getElementById('adminActionsSection');
    if (!adminSection){
      adminSection = document.createElement('div');
      adminSection.id = 'adminActionsSection';
      adminSection.className = 'bg-gradient-to-r from.yellow-50 to-orange-50 border border-yellow-300 rounded-2xl shadow-md p-6 mb-4';
      adminSection.innerHTML = `
        <h3 class="text-lg font-bold text-gray-800 mb-4 flex items-center">
          <span class="material-icons text-orange-600 mr-2">admin_panel_settings</span>
          เครื่องมือผู้ดูแลระบบ
        </h3>
        <div class="space-y-2">
          <button class="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 rounded-lg transition border border-gray-200" id="btnAdminSync2">
            <div class="flex items-center space-x-3">
              <span class="material-icons text-blue-600">cloud_download</span>
              <div class="text-left">
                <p class="text-gray-800 font-medium">ซิงค์ Asana</p>
                <p class="text-xs text-gray-500">อัปเดตงานล่าสุด 14 วัน</p>
              </div>
            </div>
            <span class="material-icons text-gray-400">chevron_right</span>
          </button>
          <button class="w-full flex items-center justify-between p-4 bg-white hover:bg-gray-50 rounded-lg transition border border-gray-200" id="btnAdminAnalyze2">
            <div class="flex items-center space-x-3">
              <span class="material-icons text-purple-600">assessment</span>
              <div class="text-left">
                <p class="text-gray-800 font-medium">วิเคราะห์ภาระงาน</p>
                <p class="text-xs text-gray-500">วิเคราะห์ความเสี่ยงและคะแนน</p>
              </div>
            </div>
            <span class="material-icons text-gray-400">chevron_right</span>
          </button>
        </div>
      `;
      
      const profileContent = profilePage.querySelector('.bg-white.rounded-2xl');
      if (profileContent && profileContent.nextSibling){
        profilePage.insertBefore(adminSection, profileContent.nextSibling);
      }
      
      const btnSync2 = document.getElementById('btnAdminSync2');
      if (btnSync2) btnSync2.addEventListener('click', handleAdminSync);
      
      const btnAnalyze2 = document.getElementById('btnAdminAnalyze2');
      if (btnAnalyze2) btnAnalyze2.addEventListener('click', handleAdminAnalyze);
    }
  }
}

function updateAdminUI(){
  if (els.addTaskBtn){
    if (state.isLoggedIn){
      els.addTaskBtn.classList.remove('hidden');
    } else {
      els.addTaskBtn.classList.add('hidden');
    }
  }
}

function showNotifications(){
  if (!state.isLoggedIn){
    toastInfo('กรุณาเข้าสู่ระบบเพื่อดูการแจ้งเตือน');
    return;
  }
  renderNotificationsPanel();
  openNotificationsPanel();
}

function renderNotificationsPanel(){
  if (!els.notificationsList) return;
  const notifications = Array.isArray(state.notifications) ? state.notifications : [];
  if (!notifications.length){
    els.notificationsList.innerHTML = '<div class="notification-empty">ยังไม่มีงานที่ใกล้ครบกำหนด</div>';
    if (els.notificationsFooter){
      els.notificationsFooter.textContent = 'เราจะแจ้งเตือนทันทีที่มีงานที่ใกล้ครบกำหนด';
    }
    return;
  }
  const limit = Math.min(7, notifications.length);
  const items = notifications.slice(0, limit).map(task=>{
    const dueDateLabel = formatThaiDate(task.dueDate);
    const dueMeta = formatDueMeta_(task.dueDate);
    const assignee = task.assignee || task.assigneeName || task.assigneeEmail || 'ไม่ระบุผู้รับผิดชอบ';
    const taskId = task.id || task.gid || '';
    const dueMarkup = dueMeta ? `<span class="notification-due"><span class="material-icons text-blue-500 text-sm align-middle">schedule</span>${escapeHtml(dueMeta)}</span>` : '';
    return `
      <div class="notification-item" data-task-id="${escapeAttr(taskId)}">
        <strong>${escapeHtml(task.name || 'งานไม่ระบุ')}</strong>
        <div class="meta">
          <span><span class="material-icons text-blue-500 text-sm align-middle">event</span>${escapeHtml(dueDateLabel)}</span>
          ${dueMarkup}
        </div>
        <div class="meta">
          <span><span class="material-icons text-amber-500 text-sm align.middle">person</span>${escapeHtml(assignee)}</span>
        </div>
      </div>
    `;
  }).join('');
  els.notificationsList.innerHTML = items;
  if (els.notificationsFooter){
    if (notifications.length > limit){
      els.notificationsFooter.textContent = `แสดง ${limit} จาก ${notifications.length} งานที่ใกล้ครบกำหนด`;
    }else{
      els.notificationsFooter.textContent = `รวมทั้งหมด ${notifications.length} งานที่ใกล้ครบกำหนด`;
    }
  }
}

function openNotificationsPanel(){
  if (!els.notificationsPanel) return;
  els.notificationsPanel.classList.remove('hidden');
  requestAnimationFrame(()=>{
    if (els.notificationsPanel) els.notificationsPanel.classList.add('active');
  });
  document.body.classList.add('notifications-open');
  updateFabVisibility();
}

function closeNotificationsPanel(){
  if (!els.notificationsPanel || els.notificationsPanel.classList.contains('hidden')) return;
  els.notificationsPanel.classList.remove('active');
  document.body.classList.remove('notifications-open');
  updateFabVisibility();
  setTimeout(()=>{
    if (els.notificationsPanel && !els.notificationsPanel.classList.contains('active')){
      els.notificationsPanel.classList.add('hidden');
    }
  }, 220);
}

function findTaskById(taskId){
  return state.tasks.find(task => String(task.id).toUpperCase() === String(taskId).toUpperCase());
}

function canManageTask(task){
  if (!task || !state.currentUser) return false;
  if (state.isAdmin) return true;
  const currentEmail = String(state.currentUser.email || '').trim().toLowerCase();
  const taskEmail = String(task.assigneeEmail || '').trim().toLowerCase();
  if (currentEmail && taskEmail && currentEmail === taskEmail) return true;
  const createdBy = String(task.createdBy || '').trim();
  const currentName = String(state.currentUser.name || '').trim();
  if (createdBy && currentName && createdBy === currentName) return true;
  return false;
}

function handleEditTask(taskId){
  if (!state.isLoggedIn){
    toastInfo('กรุณาเข้าสู่ระบบก่อน');
    return;
  }
  const task = findTaskById(taskId);
  if (!task){
    toastInfo('ไม่พบบันทึกงานที่เลือก');
    return;
  }
  if (!canManageTask(task)){
    toastError('You do not have permission to edit this task');
    return;
  }
  openTaskModal(task);
}

async function handleDeleteTask(taskId){
  if (!state.isLoggedIn){
    toastInfo('กรุณาเข้าสู่ระบบก่อน');
    return;
  }
  const task = findTaskById(taskId);
  if (!task){
    toastInfo('ไม่พบบันทึกงานที่เลือก');
    return;
  }
  if (!canManageTask(task)){
    toastError('You do not have permission to delete this task');
    return;
  }
  const confirmDelete = confirm('Delete task "' + task.name + '"?');
  if (!confirmDelete) return;

  showLoading(true, 'Deleting task...');
  try{
    const res = await apiRequest('web_delete_task', { taskId }, { maxRetries: 2 });
    if (!res || res.success === false){
      throw new Error(res?.message || 'delete task error');
    }
    toastInfo('Task deleted successfully');
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'Unable to delete task');
  }finally{
    showLoading(false);
  }
}

async function initializeLiff(){
  try{
    await ensureLiffSdk();
  }catch(err){
    console.warn('LIFF SDK not loaded. Login disabled.', err);
    throw err;
  }
  try{
    await liff.init({ liffId: APP_CONFIG.liffId });
    state.isLoggedIn = liff.isLoggedIn();
    if (state.isLoggedIn){
      const profile = await liff.getProfile();
      const idToken = liff.getIDToken ? liff.getIDToken() : '';
      const decoded = liff.getDecodedIDToken ? liff.getDecodedIDToken() : null;
      state.profile = {
        name: profile?.displayName || '',
        pictureUrl: profile?.pictureUrl || '',
        userId: profile?.userId || '',
        statusMessage: profile?.statusMessage || '',
        email: decoded?.email || '',
        idToken
      };
    } else {
      renderLoginBanner();
    }
    renderProfilePage();
  }catch(err){
    console.error('LIFF init error:', err);
    throw err;
  }
}

function renderLoginBanner(){
  if (!els.homePage) return;
  let banner = document.getElementById('loginBanner');
  if (!banner){
    banner = document.createElement('div');
    banner.id = 'loginBanner';
    banner.className = 'bg-white border border-blue-200 rounded-xl p-4 mb-4 shadow-sm';
    els.homePage.insertBefore(banner, els.homePage.firstChild);
  }
  banner.innerHTML = `
    <div class="flex items-center justify-between space-x-3">
      <div>
        <h2 class="text-base font-semibold text-gray-800">เข้าสู่ระบบผ่าน LINE</h2>
        <p class="text.sm text-gray-500">ล็อกอินเพื่อดูรายละเอียดงานและอัปเดตสถานะ</p>
      </div>
      <button class="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2" id="loginWithLineBtn">
        <span class="material-icons text-base">chat</span>
        <span>เข้าสู่ระบบ</span>
      </button>
    </div>
  `;
  const loginBtn = document.getElementById('loginWithLineBtn');
  if (loginBtn){
    loginBtn.addEventListener('click', ()=>{
      if (typeof liff === 'undefined'){
        toastError('ไม่พบ LIFF SDK');
        return;
      }
      liff.login({ redirectUri: window.location.href });
    });
  }
}

function renderProfilePage(){
  if (state.isLoggedIn){
    const banner = document.getElementById('loginBanner');
    if (banner && banner.parentNode){
      banner.parentNode.removeChild(banner);
    }
  }
  if (!els.profilePage) return;
  updateProfileNavAvatar();
  if (!state.isLoggedIn || !state.profile){
    els.profilePage.innerHTML = `
      <div class="bg-white rounded-2xl shadow-md p-6 mb-4">
        <div class="text-center">
          <div class="w-24 h-24 mx-auto bg-gradient.to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-3xl font-bold">
            KB
          </div>
          <h2 class="text-xl font-bold text-gray-800 mt-4">KruBoard</h2>
          <p class="text-sm text-gray-500 mt-1">เข้าสู่ระบบด้วย LINE เพื่อจัดการงาน</p>
          <button class="mt-6 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 mx-auto" id="profileLoginBtn">
            <span class="material-icons text-base">chat</span>
            <span>เข้าสู่ระบบผ่าน LINE</span>
          </button>
        </div>
      </div>
    `;
    const loginBtn = document.getElementById('profileLoginBtn');
    if (loginBtn){
      loginBtn.addEventListener('click', ()=>{
        if (typeof liff === 'undefined'){
          toastError('ไม่พบ LIFF SDK');
          return;
        }
        liff.login({ redirectUri: window.location.href });
      });
    }
    return;
  }
  const profile = state.profile;
  const userRecord = state.currentUser || {};
  const roleLabel = userRecord.level ? String(userRecord.level) : (state.isAdmin ? 'Admin' : 'Teacher');
  const lineUidLabel = userRecord.lineUID ? `LINE UID: ${userRecord.lineUID}` : '';
  const avatarSrc = profile.pictureUrl || userRecord.linePictureUrl || userRecord.lineAvatarThumb || userRecord.picture || 'https://via.placeholder.com/100x100.png?text=LINE';
  els.profilePage.innerHTML = `
    <div class="bg-white rounded-2xl shadow-md p-6 mb-4">
      <div class="flex items.center space-x-4 mb-6">
        <img src="${escapeAttr(avatarSrc)}" alt="avatar" class="w-20 h-20 rounded-full object-cover border-4 border-blue-100">
        <div>
          <h2 class="text-xl font-bold text-gray-800">${escapeHtml(profile.name || 'ผู้ใช้งาน')}</h2>
          <p class="text-xs text-gray-500">${escapeHtml(profile.email || profile.userId || '')}</p>
          <p class="text-xs text-emerald-600 font-semibold mt-1">บทบาท: ${escapeHtml(roleLabel)}</p>
          ${lineUidLabel ? `<p class="text-xs text-gray-400">${escapeHtml(lineUidLabel)}</p>` : ''}
          <p class="text-xs text-gray-400 mt-1">${escapeHtml(profile.statusMessage || '')}</p>
        </div>
      </div>
      <div class="space-y-3">
        <button class="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg transition" id="btnSetApiKey">
          <div class="flex items-center space-x-3">
            <span class="material-icons text-gray-600">vpn_key</span>
            <span class="text-gray-800">ตั้งค่า API Key (ผู้ดูแลระบบ)</span>
          </div>
          <span class="material-icons text-gray-400">chevron_right</span>
        </button>
        <button class="w-full flex items-center justify-between p-4 hover:bg-gray-50 rounded-lg transition" id="btnRefreshData">
          <div class="flex items.center space-x-3">
            <span class="material-icons text-gray-600">sync</span>
            <span class="text-gray-800">รีเฟรชข้อมูล</span>
          </div>
          <span class="material-icons text-gray-400">chevron_right</span>
        </button>
      </div>
    </div>
    <button class="w-full bg-red-50 text-red-600 p-4 rounded-xl font-medium hover:bg-red-100 transition flex items-center justify-center space-x-2" id="logoutBtn">
      <span class="material-icons">logout</span>
      <span>ออกจากระบบ</span>
    </button>
  `;
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn){
    logoutBtn.addEventListener('click', ()=>{
      if (typeof liff === 'undefined'){
        toastError('ไม่พบ LIFF SDK');
        return;
      }
      liff.logout();
      localStorage.removeItem('kruboard_api_key');
      state.apiKey = '';
      window.location.reload();
    });
  }
  const btnSetApiKey = document.getElementById('btnSetApiKey');
  if (btnSetApiKey){
    if (!state.isAdmin){
      btnSetApiKey.classList.add('hidden');
    }else{
      btnSetApiKey.classList.remove('hidden');
    }
    btnSetApiKey.addEventListener('click', ()=>{
      const current = state.apiKey ? '*** ตั้งค่าแล้ว ***' : 'ยังไม่ได้ตั้งค่า';
      const input = prompt(`กรอกรหัส API KEY สำหรับแก้ไขสถานะ\nสถานะปัจจุบัน: ${current}`);
      if (input !== null){
        const trimmed = input.trim();
        if (trimmed){
          state.apiKey = trimmed;
          localStorage.setItem('kruboard_api_key', trimmed);
          toastInfo('✓ บันทึก API Key สำเร็จ');
        } else {
          state.apiKey = '';
          localStorage.removeItem('kruboard_api_key');
          toastInfo('✓ ลบ API Key แล้ว');
        }
      }
    });
  }
  const btnRefreshData = document.getElementById('btnRefreshData');
  if (btnRefreshData){
    btnRefreshData.addEventListener('click', ()=>{
      showLoading(true, 'กำลังรีเฟรช...');
      loadSecureData().finally(()=> showLoading(false));
    });
  }
  updateAdminUI();
  addAdminOptions();
}

function updateProfileNavAvatar(){
  const avatar = els.navProfileAvatar;
  const icon = els.navProfileIcon;
  if (!avatar || !icon) return;

  const picture = state.profile?.pictureUrl
    || state.currentUser?.linePictureUrl
    || state.currentUser?.lineAvatarThumb
    || state.currentUser?.picture
    || '';
  const displayName = state.profile?.name || state.currentUser?.name || 'Profile';

  if (picture){
    avatar.src = escapeAttr(picture);
    avatar.alt = escapeAttr(displayName);
    avatar.loading = 'lazy';
    avatar.classList.remove('hidden');
    icon.classList.add('hidden');
  } else {
    avatar.removeAttribute('src');
    avatar.removeAttribute('loading');
    avatar.classList.add('hidden');
    icon.classList.remove('hidden');
  }
}

function ensureLiffSdk(){
  if (typeof liff !== 'undefined') return Promise.resolve();
  if (document.getElementById('liff-sdk')){
    return waitForLiffInstance(3000);
  }
  return new Promise((resolve, reject)=>{
    const script = document.createElement('script');
    script.id = 'liff-sdk';
    script.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    script.async = true;
    script.onload = ()=> waitForLiffInstance(0).then(resolve).catch(reject);
    script.onerror = ()=> reject(new Error('โหลด LIFF SDK ไม่สำเร็จ'));
    document.head.appendChild(script);
  });
}

function waitForLiffInstance(timeoutMs){
  const deadline = Date.now() + (timeoutMs || 0);
  return new Promise((resolve, reject)=>{
    (function poll(){
      if (typeof liff !== 'undefined'){
        resolve();
        return;
      }
      if (Date.now() > deadline){
        reject(new Error('LIFF SDK not available'));
        return;
      }
      setTimeout(poll, 100);
    })();
  });
}

function switchPage(pageId){
  state.activePage = pageId;
  Object.values(els.pages).forEach(page=>{
    page.classList.toggle('active', page.id === pageId);
  });
  els.navItems.forEach(item=>{
    const match = item.getAttribute('data-page') === pageId;
    item.classList.toggle('active', match);
  });
  updateFabVisibility();
}

function updateFabVisibility(){
  if (!els.fabBtn) return;
  const isTasksPage = state.activePage === 'tasksPage';
  const modalOpen = document.body.classList.contains('modal-open');
  const notificationsOpen = document.body.classList.contains('notifications-open');
  let shouldShow = isTasksPage && !modalOpen && !notificationsOpen && window.scrollY > 200;
  if (shouldShow && els.taskPaginationWrapper){
    const rect = els.taskPaginationWrapper.getBoundingClientRect();
    if (rect.top < window.innerHeight - 140){
      shouldShow = false;
    }
  }
  els.fabBtn.classList.toggle('hidden', !shouldShow);
}

function showLoading(show, text = 'กำลังโหลดข้อมูล...'){
  if (!els.loadingToast) return;
  els.loadingToast.classList.toggle('hidden', !show);
  if (els.loadingText && text){
    els.loadingText.textContent = text;
  }
}

function toastError(message){
  console.warn(message);
  alert(message);
}

function toastInfo(message){
  console.info(message);
  alert(message);
}

function handleDataError(err, fallbackMessage){
  console.error('Data error:', err);
  if (err?.message?.includes('timeout') || err?.message?.includes('Abort')){
    toastError('⏱️ หมดเวลารอ Server กรุณาลองใหม่');
  } else if (err?.message?.includes('HTTP')){
    toastError('❌ ไม่สามารถเชื่อมต่อ Apps Script ได้ กรุณาตรวจสอบ URL และสิทธิ์');
  } else {
    toastError(fallbackMessage);
  }
}

function parseTaskDue_(value){
  if (!value || value === 'No Due Date') return 0;
  const iso = `${value}T00:00:00+07:00`;
  const date = new Date(iso);
  if (isNaN(date)) return 0;
  return date.getTime();
}

function formatThaiDate(dateString){
  if (!dateString || dateString === 'No Due Date') return 'ไม่มีวันครบกำหนด';
  let date;
  if (dateString instanceof Date){
    date = dateString;
  } else {
    date = new Date(dateString + 'T00:00:00+07:00');
  }
  if (isNaN(date)) return dateString;
  const day = date.getDate();
  const month = THAI_MONTHS[date.getMonth()];
  const year = date.getFullYear() + 543;
  return `${day} ${month} ${year}`;
}

function formatDueMeta_(dueDate){
  if (!dueDate || dueDate === 'No Due Date') return '';
  const iso = `${dueDate}T00:00:00+07:00`;
  const due = new Date(iso);
  if (isNaN(due)) return '';
  const today = new Date();
  today.setHours(0,0,0,0);
  due.setHours(0,0,0,0);
  const diff = Math.round((due - today)/(24*60*60*1000));
  
  if (diff === 0) return '(ครบกำหนดวันนี้)';
  if (diff === 1) return '(พรุ่งนี้)';
  if (diff === -1) return '(เมื่อวาน)';
  if (diff > 0) return `(อีก ${diff} วัน)`;
  return `(เกินกำหนด ${Math.abs(diff)} วัน)`;
}

function setText(el, value){
  if (!el) return;
  el.textContent = value;
}

function escapeHtml(value){
  if (value == null) return '';
  return String(value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function escapeAttr(value){
  if (value == null) return '';
  return String(value).replace(/"/g, '&quot;');
}

// /**
//  * Validate a date string in YYYY-MM-DD format and ensure it is a real calendar date.
//  * Returns true if valid, false otherwise.
//  */
// function validateDateFormat_(value){
//   if (!value) return true; // allow empty -> "No Due Date"
//   const re = /^\d{4}-\d{2}-\d{2}$/;
//   if (!re.test(value)) return false;
//   const parts = value.split('-').map(n => parseInt(n, 10));
//   const y = parts[0], m = parts[1], d = parts[2];
//   const dt = new Date(Date.UTC(y, m - 1, d));
//   return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
// }

/**
 * เพิ่มฟังชั่นเหล่านี้ท้ายสุดของ app.js
 * (ใกล้บรรทัดสุดท้ายของไฟล์)
 */

/**
 * ตรวจสอบรูปแบบวันที่ (YYYY-MM-DD) และคืน ISO string หรือ null
 */
function validateDateFormat_(value){
  if (!value) return null;
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(value)) return null;
  const parts = value.split('-').map(n => parseInt(n, 10));
  const y = parts[0], m = parts[1], d = parts[2];
  const dt = new Date(Date.UTC(y, m - 1, d));
  const valid = dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
  return valid ? value : null;
}

/**
 * แปลงวันที่ YYYY-MM-DD เป็นรูปแบบไทย
 */
function convertDateToThai_(dateString){
  if (!dateString || dateString === 'No Due Date') return 'No Due Date';
  let date;
  if (dateString instanceof Date){
    date = dateString;
  } else {
    date = new Date(dateString + 'T00:00:00+07:00');
  }
  if (isNaN(date)) return dateString;
  const day = date.getDate();
  const month = THAI_MONTHS[date.getMonth()];
  const year = date.getFullYear() + 543;
  return `${day} ${month} ${year}`;
}

/**
 * ปรับรหัสงานให้ uppercase
 */
function normalizeTaskId_(taskId){
  return String(taskId || '').trim().toUpperCase();
}

/**
 * Generate Web Task ID ที่ unique
 */
function generateWebTaskId_(){
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return 'WEB' + timestamp + random;
}

/**
 * ล้างข้อความ status
 */
function sanitizeStatus_(status){
  return String(status || '').trim();
}

/**
 * อ่าน Lookup Users (email → user record)
 * ต้องมี state.userStats หรือจากฟังชั่นอื่น
 */
function getUserLookup_(){
  const lookup = {
    recordByEmail: {},
    recordByLine: {}
  };
  
  if (Array.isArray(state.userStats)){
    state.userStats.forEach(user => {
      const email = String(user.email || user.Email || '').toLowerCase();
      const line = String(user.lineUID || user['LINE UID'] || '');
      if (email){
        lookup.recordByEmail[email] = {
          email,
          name: user.name || user.Name || email,
          level: user.level || user.Level || '',
          lineUID: line
        };
      }
      if (line){
        lookup.recordByLine[line] = lookup.recordByEmail[email] || { email, name: user.name || email };
      }
    });
  }
  
  return lookup;
}

/**
 * Sanitize callback name (สำหรับ JSONP)
 */
function sanitizeCallback_(name){
  const s = String(name || '').trim();
  return s.replace(/[^\w.$]/g, '');
}

/**
 * Escape HTML entities (ป้องกัน XSS)
 */
function escapeHtml(value){
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape HTML attributes
 */
function escapeAttr(value){
  if (value == null) return '';
  return String(value).replace(/"/g, '&quot;');
}

