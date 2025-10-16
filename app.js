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
  upcomingDays: 7,
  tasks: [],
  userStats: [],
  dashboard: null,
  personalStats: null,
  currentUser: null,
  notifications: [],
  filteredTasks: [],
  taskFilters: { status:'all', search:'' },
  taskPagination: { page:1, pageSize:10, totalPages:1 },
  isAdmin: false,
  apiKey: localStorage.getItem('kruboard_api_key') || '',
  cacheStatus: { dashboard: null, userStats: null, upcoming: null },
  activePage: 'homePage',
  currentEditingTask: null,
  workloadSnapshot: [],
  notificationsOpen: false
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
  taskAssigneeInput: null,
  taskDueDateInput: null,
  taskNotesInput: null,
  quickDueButtons: [],
  notificationsPanel: document.getElementById('notificationsPanel'),
  notificationsList: document.getElementById('notificationsList'),
  notificationsClose: document.getElementById('notificationsClose'),
  notificationsBackdrop: document.getElementById('notificationsBackdrop'),
  notificationsFooter: document.getElementById('notificationsFooter'),
  workloadContainer: document.getElementById('workloadHighlights'),
  workloadEmpty: document.getElementById('workloadEmptyState'),
  workloadList: document.getElementById('workloadList'),
  workloadRefreshBtn: document.getElementById('workloadRefreshBtn'),
  taskModalTitle: null,
  taskModalDescription: null
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init(){
  cachePages();
  bindUI();
  initModalElements();
  initNotificationPanel();
  updateProfileNavAvatar();
  updateFabVisibility();
  
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

// Replace apiRequest Fetch implementation with JSONP
async function apiRequest(action, params = {}, options = {}) {
  const { timeout = APP_CONFIG.requestTimeout, retryCount = 0, maxRetries = APP_CONFIG.retryAttempts } = options;
  
  const payload = { action, ...params };
  if (state.profile?.idToken) payload.idToken = state.profile.idToken;
  if (state.apiKey && (action.includes('sync') || action.includes('analyze'))) {
    payload.pass = state.apiKey;
  }

  return new Promise((resolve, reject) => {
    const callbackName = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    let script;

    const tidyUp = () => {
      if (script && script.parentNode){
        script.parentNode.removeChild(script);
      }
      script = null;
      delete window[callbackName];
    };
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      tidyUp();
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      reject(err);
    }, timeout);

    // Global callback
    window[callbackName] = (data) => {
      clearTimeout(timeoutId);
      tidyUp();
      
      if (!data.success && retryCount < maxRetries) {
        console.warn(`Request failed, retrying... (${retryCount + 1}/${maxRetries})`);
        setTimeout(() => {
          apiRequest(action, params, { ...options, retryCount: retryCount + 1 })
            .then(resolve)
            .catch(reject);
        }, APP_CONFIG.retryDelay * Math.pow(2, retryCount));
      } else {
        resolve(data);
      }
    };

    // Create script tag
    script = document.createElement('script');
    script.async = true;
    script.dataset.jsonp = callbackName;
    const queryParams = new URLSearchParams({ 
      ...payload, 
      callback: callbackName 
    });
    script.src = `${APP_CONFIG.scriptUrl}?${queryParams}`;
    script.onerror = () => {
      clearTimeout(timeoutId);
      tidyUp();
      reject(new Error('Script loading failed'));
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
  renderUpcomingTasks(data);
  if (state.notificationsOpen){
    renderNotificationsList(state.notifications);
  }
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
    await loadWorkloadSnapshot();
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
    const sourceLabel = task.source === 'WEB' ? '(สร้างในเว็บ)' : '';
    const buttonClass = isCompleted
      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
      : 'bg-blue-600 hover:bg-blue-700 text-white';
    const buttonLabel = isCompleted ? 'อัปเดตแล้ว' : 'ทำเครื่องหมายว่าสำเร็จ';
    const disabledAttr = isCompleted ? 'disabled' : '';
    const normalizedId = String(task.id || '').trim();
    const currentEmail = String(state.currentUser?.email || '').trim().toLowerCase();
    const currentLine = String(state.currentUser?.lineUID || '').trim();
    const taskEmail = String(task.assigneeEmail || '').trim().toLowerCase();
    const taskLine = String(task.lineUID || '').trim();
    const isOwner = (currentEmail && taskEmail && currentEmail === taskEmail) || (currentLine && taskLine && currentLine === taskLine);
    const isWebSource = String(task.source || '').trim().toUpperCase() === 'WEB' || normalizedId.startsWith('WEB');
    const canEdit = state.isAdmin || (isWebSource && isOwner);
    const canDelete = state.isAdmin || (isWebSource && isOwner);
    const noteHtml = task.notes ? escapeHtml(task.notes).replace(/\n/g, '<br>') : '';

    return `
      <div class="task-card bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h3 class="text-base font-semibold text-gray-800">
              ${escapeHtml(task.name)}
            </h3>
            <p class="text-xs text-gray-400 mt-1">${sourceLabel}</p>
            <p class="text-sm text-gray-500 mt-1">${escapeHtml(task.assignee || 'ยังไม่ระบุผู้รับผิดชอบ')}</p>
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
              <a href="${escapeAttr(task.link)}" target="_blank" class="text-blue-600 hover:underline">เปิด ${task.source}</a>
            </div>
          ` : ''}
        </div>
        ${task.notes ? `
          <div class="mt-3 text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3">
            <div class="flex items-center gap-2 text-xs font-semibold text-slate-500 uppercase">
              <span class="material-icons text-slate-400 text-base">sticky_note_2</span>
              หมายเหตุ
            </div>
            <p class="mt-1 leading-relaxed">${noteHtml}</p>
          </div>
        ` : ''}
        <div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <button class="flex-1 ${buttonClass} py-2 rounded-lg text-sm font-medium flex items-center justify-center space-x-2 transition" data-action="update-status" data-task-id="${escapeAttr(normalizedId)}" ${disabledAttr}>
            <span class="material-icons text-base">${isCompleted ? 'task_alt' : 'done'}</span>
            <span>${buttonLabel}</span>
          </button>
          ${(canEdit || canDelete) ? `
            <div class="flex gap-2">
              ${canEdit ? `
                <button type="button" class="px-3 py-2 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50 text-sm font-medium transition flex items-center space-x-1" data-action="edit-task" data-task-id="${escapeAttr(normalizedId)}">
                  <span class="material-icons text-base">edit</span>
                  <span>แก้ไข</span>
                </button>
              ` : ''}
              ${canDelete ? `
                <button type="button" class="px-3 py-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-sm font-medium transition flex items-center space-x-1" data-action="delete-task" data-task-id="${escapeAttr(normalizedId)}">
                  <span class="material-icons text-base">delete</span>
                  <span>ลบ</span>
                </button>
              ` : ''}
            </div>
          ` : ''}
        </div>
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

async function loadWorkloadSnapshot(){
  if (!state.isLoggedIn){
    renderWorkloadSnapshot([]);
    return [];
  }
  if (els.workloadRefreshBtn) els.workloadRefreshBtn.disabled = true;
  try{
    const res = await apiRequest('workload_snapshot', { limit: 10 });
    if (!res || res.success === false){
      throw new Error(res?.message || 'workload snapshot error');
    }
    const data = Array.isArray(res.data) ? res.data : [];
    state.workloadSnapshot = data;
    renderWorkloadSnapshot(data);
    return data;
  }catch(err){
    console.warn('workload snapshot error', err);
    state.workloadSnapshot = [];
    renderWorkloadSnapshot([]);
    return [];
  }finally{
    if (els.workloadRefreshBtn) els.workloadRefreshBtn.disabled = false;
  }
}

function renderWorkloadSnapshot(list){
  if (!els.workloadContainer) return;
  if (!state.isLoggedIn){
    els.workloadContainer.classList.add('hidden');
    return;
  }
  const items = Array.isArray(list) ? list : [];
  els.workloadContainer.classList.remove('hidden');
  if (!items.length){
    if (els.workloadEmpty) els.workloadEmpty.textContent = 'ไม่มีข้อมูลภาระงานล่าสุด';
    if (els.workloadEmpty) els.workloadEmpty.classList.remove('hidden');
    if (els.workloadList) {
      els.workloadList.innerHTML = '';
      els.workloadList.classList.add('hidden');
    }
    return;
  }
  if (els.workloadEmpty) els.workloadEmpty.classList.add('hidden');
  if (!els.workloadList) return;
  const html = items.map((row, index)=>{
    const assignee = row['Assignee'] || row['Email'] || 'ไม่ระบุ';
    const weekScore = Number(row['Week Score'] || row['Week Tasks'] || 0);
    const risk = row['Workload Risk'] || '';
    const badge = getRiskBadgeClass_(risk);
    return `
      <div class="border border-blue-100 bg-blue-50/40 rounded-xl p-3 flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${badge}">${escapeHtml(risk || 'ไม่ระบุ')}</span>
            <span class="text-xs text-gray-400">อันดับ ${index + 1}</span>
          </div>
          <p class="text-sm font-semibold text-gray-800 mt-1">${escapeHtml(assignee)}</p>
          <p class="text-xs text-gray-500">รวมงานทั้งหมด ${escapeHtml(String(row['Total Tasks'] || 0))} งาน</p>
        </div>
        <div class="text-right">
          <p class="text-xl font-bold text-blue-600">${weekScore.toFixed(1)}</p>
          <p class="text-xs text-gray-400">คะแนนสัปดาห์นี้</p>
        </div>
      </div>
    `;
  }).join('');
  els.workloadList.innerHTML = html;
  els.workloadList.classList.remove('hidden');
}

function getRiskBadgeClass_(risk){
  const text = String(risk || '').toLowerCase();
  if (!text) return 'bg-slate-100 text-slate-600';
  if (/(วิกฤต|critical)/.test(text)) return 'bg-rose-100 text-rose-600';
  if (/(เสี่ยงสูง|high)/.test(text)) return 'bg-red-100 text-red-600';
  if (/(เฝ้าระวัง|watch)/.test(text)) return 'bg-amber-100 text-amber-600';
  return 'bg-emerald-100 text-emerald-600';
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
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">
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
    window.addEventListener('scroll', updateFabVisibility);
  }

  if (els.workloadRefreshBtn){
    els.workloadRefreshBtn.addEventListener('click', ()=> loadWorkloadSnapshot());
  }

  if (els.notificationBtn){
    els.notificationBtn.addEventListener('click', showNotifications);
  }

  if (els.allTasksContainer){
    els.allTasksContainer.addEventListener('click', evt=>{
      const target = evt.target.closest('[data-action]');
      if (!target) return;
      const taskId = target.dataset.taskId;
      if (!taskId) return;
      const action = target.dataset.action;
      if (action === 'update-status'){
        handleUpdateStatus(taskId);
      }else if (action === 'edit-task'){
        openEditTaskModal(taskId);
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
    els.addTaskBtn.addEventListener('click', openTaskModal);
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
  els.taskAssigneeInput = document.getElementById('taskAssignee');
  els.taskDueDateInput = document.getElementById('taskDueDate');
  els.taskNotesInput = document.getElementById('taskNotes');
  els.taskModalTitle = document.getElementById('taskModalTitle');
  els.taskModalDescription = document.getElementById('taskModalDescription');
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
  
  if (els.closeModalBtn) els.closeModalBtn.addEventListener('click', closeTaskModal);
  if (els.cancelModalBtn) els.cancelModalBtn.addEventListener('click', closeTaskModal);
  if (els.taskForm) els.taskForm.addEventListener('submit', handleTaskFormSubmit);
  if (els.taskModal){
    els.taskModal.addEventListener('click', (evt)=>{
      if (evt.target === els.taskModal) closeTaskModal();
    });
  }
  updateQuickDueActive(null);
}

function openTaskModal(mode = 'create', task = null){
  if (!els.taskModal) return;
  if (state.activePage !== 'tasksPage'){
    switchPage('tasksPage');
    setTimeout(()=> openTaskModal(mode, task), 120);
    return;
  }
  if (mode === 'edit' && task){
    configureTaskModalForEdit(task);
  }else{
    configureTaskModalForCreate();
  }
  if (els.taskDueDateInput){
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    els.taskDueDateInput.min = `${yyyy}-${mm}-${dd}`;
  }
  document.body.classList.add('modal-open');\n  els.taskModal.classList.remove('hidden');\n  updateFabVisibility();\n  if (els.taskNameInput) els.taskNameInput.focus();\n}\n
function configureTaskModalForCreate(){
  state.currentEditingTask = null;
  if (els.taskForm){
    els.taskForm.reset();
    els.taskForm.dataset.mode = 'create';
  }
  updateQuickDueActive(null);
  if (els.taskDueDateInput) els.taskDueDateInput.value = '';
  if (els.taskAssigneeInput) els.taskAssigneeInput.value = '';
  if (els.taskNotesInput) els.taskNotesInput.value = '';
  if (els.taskModalTitle) els.taskModalTitle.textContent = 'เพิ่มงานใหม่';
  if (els.taskModalDescription) els.taskModalDescription.textContent = 'กรอกข้อมูลให้ครบเพื่อให้ทีมติดตามงานได้รวดเร็ว';
  if (els.submitTaskBtn){
    els.submitTaskBtn.innerHTML = '<span class="material-icons text-base">add_task</span><span>บันทึกงาน</span>';
  }
}

function configureTaskModalForEdit(task){
  state.currentEditingTask = task;
  if (els.taskForm){
    els.taskForm.dataset.mode = 'edit';
  }
  if (els.taskNameInput) els.taskNameInput.value = task.name || '';
  if (els.taskAssigneeInput) els.taskAssigneeInput.value = task.assigneeEmail || '';
  if (els.taskDueDateInput) els.taskDueDateInput.value = (task.dueDate && task.dueDate !== 'No Due Date') ? task.dueDate : '';
  if (els.taskNotesInput) els.taskNotesInput.value = task.notes || '';
  updateQuickDueActive(null);
  highlightQuickDueForDate(task.dueDate);
  if (els.taskModalTitle) els.taskModalTitle.textContent = 'แก้ไขงาน';
  if (els.taskModalDescription) els.taskModalDescription.textContent = 'ปรับรายละเอียดงานและบันทึกเพื่ออัปเดตข้อมูล';
  if (els.submitTaskBtn){
    els.submitTaskBtn.innerHTML = '<span class="material-icons text-base">save</span><span>บันทึกการแก้ไข</span>';
  }
}

function highlightQuickDueForDate(dateValue){
  if (!Array.isArray(els.quickDueButtons) || !els.taskDueDateInput) return;
  if (!dateValue || dateValue === 'No Due Date'){
    updateQuickDueActive(null);
    return;
  }
  const target = new Date(`${dateValue}T00:00:00`);
  if (Number.isNaN(target.getTime())){
    updateQuickDueActive(null);
    return;
  }
  const today = new Date();
  today.setHours(0,0,0,0);
  const diff = Math.round((target - today) / (24 * 60 * 60 * 1000));
  const btn = els.quickDueButtons.find(el => Number(el.dataset.quickDue) === diff);
  updateQuickDueActive(btn || null);
}

function closeTaskModal(){
  if (els.taskModal) els.taskModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  updateQuickDueActive(null);
  state.currentEditingTask = null;
  if (els.taskForm){
    delete els.taskForm.dataset.mode;
  }
  updateFabVisibility();
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

function initNotificationPanel(){
  if (els.notificationsClose){
    els.notificationsClose.addEventListener('click', closeNotificationsPanel);
  }
  if (els.notificationsBackdrop){
    els.notificationsBackdrop.addEventListener('click', closeNotificationsPanel);
  }
  document.addEventListener('keydown', evt=>{
    if (evt.key === 'Escape' && state.notificationsOpen){
      closeNotificationsPanel();
    }
  });
}

function showNotifications(){
  if (!state.isLoggedIn){
    toastInfo('ต้องเข้าสู่ระบบเพื่อดูการแจ้งเตือน');
    return;
  }
  renderNotificationsList(state.notifications);
  openNotificationsPanel();
}

function renderNotificationsList(list){
  if (!els.notificationsList) return;
  const notifications = Array.isArray(list) ? list.slice(0, 20) : [];
  if (!notifications.length){
    els.notificationsList.innerHTML = '<div class="notification-item text-center text-sm text-gray-500">ยังไม่มีการแจ้งเตือน</div>';
  }else{
    const html = notifications.map(task=>{
      const thaiDate = formatThaiDate(task.dueDate);
      const meta = formatDueMeta_(task.dueDate);
      const assignee = task.assignee || 'ไม่ระบุ';
      return `
        <div class="notification-item">
          <div class="font-medium text-gray-800">${escapeHtml(task.name)}</div>
          <div class="meta">
            <span class="material-icons text-xs text-blue-400">event</span>
            <span>${escapeHtml(thaiDate)}</span>
            ${meta ? `<span>${escapeHtml(meta)}</span>` : ''}
          </div>
          <div class="meta">
            <span class="material-icons text-xs text-emerald-400">person</span>
            <span>${escapeHtml(assignee)}</span>
          </div>
        </div>
      `;
    }).join('');
    els.notificationsList.innerHTML = html;
  }
  if (els.notificationsFooter){
    const total = state.notifications.length || 0;
    els.notificationsFooter.textContent = total ? `ทั้งหมด ${total} รายการ` : 'ไม่มีข้อมูลแจ้งเตือน';
  }
}

function openNotificationsPanel(){
  if (!els.notificationsPanel) return;
  els.notificationsPanel.classList.remove('hidden');
  document.body.classList.add('notifications-open');
  state.notificationsOpen = true;
  updateFabVisibility();
}

function closeNotificationsPanel(){
  if (!els.notificationsPanel) return;
  els.notificationsPanel.classList.add('hidden');
  document.body.classList.remove('notifications-open');
  state.notificationsOpen = false;
  updateFabVisibility();
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

function showModalLoading(show){
  if (els.modalLoading) els.modalLoading.classList.toggle('hidden', !show);
}

async function handleTaskFormSubmit(evt){
  evt.preventDefault();
  
  if (!state.isLoggedIn){
    toastInfo('ต้องเข้าสู่ระบบ');
    return;
  }
  
  const mode = els.taskForm?.dataset.mode === 'edit' && state.currentEditingTask ? 'edit' : 'create';
  const name = (els.taskNameInput?.value || '').trim();
  const assigneeEmail = (els.taskAssigneeInput?.value || '').trim();
  const dueDate = (els.taskDueDateInput?.value || '').trim();
  const notes = (els.taskNotesInput?.value || '').trim();
  
  if (!name){
    toastInfo('กรุณากรอกชื่อภารกิจ');
    return;
  }
  
  const editingTaskId = state.currentEditingTask ? state.currentEditingTask.id : null;
  showModalLoading(true);
  closeTaskModal();
  
  try{
    if (mode === 'edit' && editingTaskId){
      const res = await apiRequest('web_update_task', {
        taskId: editingTaskId,
        name,
        assigneeEmail,
        dueDate,
        notes
      }, { maxRetries: 2 });
      if (!res || res.success === false){
        throw new Error(res?.message || 'update task error');
      }
      toastInfo('อัปเดตงานเรียบร้อย');
    }else{
      const res = await apiRequest('web_create_task', {
        name,
        assigneeEmail,
        dueDate,
        notes
      }, { maxRetries: 2 });
      if (!res || res.success === false){
        throw new Error(res?.message || 'create task error');
      }
      toastInfo('เพิ่มงานสำเร็จ');
    }
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'ไม่สามารถบันทึกงานได้');
  }finally{
    showModalLoading(false);
  }
}
function openEditTaskModal(taskId){
  if (!state.isLoggedIn){
    toastInfo('ต้องเข้าสู่ระบบ');
    return;
  }
  const normalizedId = String(taskId || '').trim().toUpperCase();
  const task = state.tasks.find(row => String(row.id || '').trim().toUpperCase() === normalizedId);
  if (!task){
    toastInfo('ไม่พบงานที่ต้องการแก้ไข');
    return;
  }
  const currentEmail = String(state.currentUser?.email || '').trim().toLowerCase();
  const currentLine = String(state.currentUser?.lineUID || '').trim();
  const taskEmail = String(task.assigneeEmail || '').trim().toLowerCase();
  const taskLine = String(task.lineUID || '').trim();
  const owns = (currentEmail && taskEmail && currentEmail === taskEmail) || (currentLine && taskLine && currentLine === taskLine);
  const isWebSource = String(task.source || '').trim().toUpperCase() === 'WEB' || normalizedId.startsWith('WEB');
  if (!state.isAdmin && !(isWebSource && owns)){
    toastInfo('ไม่มีสิทธิ์แก้ไขงานนี้');
    return;
  }
  openTaskModal('edit', task);
}
async function handleDeleteTask(taskId){
  if (!state.isLoggedIn){
    toastInfo('ต้องเข้าสู่ระบบ');
    return;
  }
  const confirmed = confirm('ยืนยันลบงานนี้หรือไม่?\n\nการลบจะไม่สามารถกู้คืนได้');
  if (!confirmed) return;
  showLoading(true, 'กำลังลบงาน...');
  try{
    const res = await apiRequest('web_delete_task', { taskId }, { maxRetries: 1 });
    if (!res || res.success === false){
      throw new Error(res?.message || 'delete task error');
    }
    toastInfo('ลบงานเรียบร้อย');
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'ไม่สามารถลบงานได้');
  }finally{
    showLoading(false);
  }
}
async function handleUpdateStatus(taskId){
  if (!state.isLoggedIn){
    toastInfo('ต้องเข้าสู่ระบบก่อน');
    return;
  }
  
  const task = state.tasks.find(t => String(t.id).toUpperCase() === String(taskId).toUpperCase());
  if (!task){
    toastInfo('ไม่พบงานที่เลือก');
    return;
  }
  if (task.completed === 'Yes'){
    toastInfo('งานนี้ทำเสร็จแล้ว');
    return;
  }
  
  const currentStatus = task?.status || (task?.completed === 'Yes' ? 'เสร็จสมบูรณ์' : 'รอดำเนินการ');
  const confirmDone = confirm(`ยืนยันทำเครื่องหมายว่างาน "${task.name}" เสร็จสมบูรณ์หรือไม่?\nสถานะปัจจุบัน: ${currentStatus}`);
  if (!confirmDone) return;
  
  showLoading(true, 'กำลังอัปเดต...');
  
  try{
    const res = await apiRequest('web_update_status', {
      taskId,
      status: 'เสร็จสมบูรณ์'
    }, { maxRetries: 2 });
    
    if (!res || res.success === false){
      throw new Error(res?.message || 'update failed');
    }
    
    toastInfo('✓ อัปเดตสถานะเรียบร้อย');
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'อัปเดตสถานะไม่สำเร็จ');
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
        <p class="text-sm text-gray-500">ล็อกอินเพื่อดูรายละเอียดงานและอัปเดตสถานะ</p>
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
          <div class="w-24 h-24 mx-auto bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-3xl font-bold">
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
      <div class="flex items-center space-x-4 mb-6">
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
          <div class="flex items-center space-x-3">
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
    const applyVisible = ()=>{
      avatar.classList.remove('hidden');
      icon.classList.add('hidden');
    };
    if (avatar.dataset.currentSrc !== picture){
      avatar.classList.add('hidden');
      icon.classList.remove('hidden');
      avatar.onload = applyVisible;
      avatar.onerror = ()=>{
        delete avatar.dataset.currentSrc;
        avatar.removeAttribute('src');
        avatar.classList.add('hidden');
        icon.classList.remove('hidden');
      };
      avatar.dataset.currentSrc = picture;
      avatar.src = picture;
    }else{
      applyVisible();
    }
    avatar.alt = displayName;
    avatar.loading = 'lazy';
  } else {
    delete avatar.dataset.currentSrc;
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
  Object.values(els.pages).forEach(page=>{
    page.classList.toggle('active', page.id === pageId);
  });
  els.navItems.forEach(item=>{
    const match = item.getAttribute('data-page') === pageId;
    item.classList.toggle('active', match);
  });
  state.activePage = pageId;
  updateFabVisibility();
}

function updateFabVisibility(){
  if (!els.fabBtn) return;
  const overlayActive = document.body.classList.contains('modal-open') || state.notificationsOpen;
  const shouldShow = !overlayActive && state.activePage === 'homePage' && window.scrollY > 300;
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
