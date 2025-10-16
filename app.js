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
  cacheStatus: { dashboard: null, userStats: null }
};

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

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
  taskNotesInput: null
};

// Initialize
document.addEventListener('DOMContentLoaded', init);

function init(){
  cachePages();
  bindUI();
  initModalElements();
  
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
    
    // Set timeout
    const timeoutId = setTimeout(() => {
      delete window[callbackName];
      const err = new Error('Request timeout');
      err.name = 'AbortError';
      reject(err);
    }, timeout);

    // Global callback
    window[callbackName] = (data) => {
      clearTimeout(timeoutId);
      delete window[callbackName];
      
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
    const script = document.createElement('script');
    const queryParams = new URLSearchParams({ 
      ...payload, 
      callback: callbackName 
    });
    script.src = `${APP_CONFIG.scriptUrl}?${queryParams}`;
    script.onerror = () => {
      delete window[callbackName];
      clearTimeout(timeoutId);
      reject(new Error('Script loading failed'));
    };
    document.head.appendChild(script);
  });
}

/** =========================================================
 * FAST CACHED ENDPOINTS
 * ======================================================= **/

async function loadPublicData(){
  showLoading(true, 'โหลดแดชบอร์ด...');
  
  try{
    const dashboardPromise = fetchDashboardCached();
    const upcomingPromise = loadUpcomingTasks();
    
    const [dashboard] = await Promise.all([dashboardPromise, upcomingPromise]);
    
    if (dashboard){
      state.cacheStatus.dashboard = dashboard.cached ? 'cached' : 'computed';
      renderDashboard(dashboard.data);
    }
  }catch(error){
    console.warn('Fast load failed, trying standard endpoint:', error.message);
    try{
      const dashboard = await fetchDashboardStats();
      renderDashboard(dashboard);
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
    const personal = state.isLoggedIn;
    state.notifications = personal ? data : [];
    setText(els.notificationCount, personal ? (data.length || 0) : 0);
    renderUpcomingTasks(data);
    return data;
  }catch(err){
    console.error('Upcoming error:', err);
    renderUpcomingTasks([]);
    return [];
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
    window.addEventListener('scroll', ()=>{
      const shouldShow = window.scrollY > 300;
      els.fabBtn.classList.toggle('hidden', !shouldShow);
    });
  }

  if (els.notificationBtn){
    els.notificationBtn.addEventListener('click', showNotifications);
  }

  if (els.allTasksContainer){
    els.allTasksContainer.addEventListener('click', evt=>{
      const button = evt.target.closest('[data-action="update-status"]');
      if (!button) return;
      const taskId = button.dataset.taskId;
      handleUpdateStatus(taskId);
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
  
  if (els.closeModalBtn) els.closeModalBtn.addEventListener('click', closeTaskModal);
  if (els.cancelModalBtn) els.cancelModalBtn.addEventListener('click', closeTaskModal);
  if (els.taskForm) els.taskForm.addEventListener('submit', handleTaskFormSubmit);
  if (els.taskModal){
    els.taskModal.addEventListener('click', (evt)=>{
      if (evt.target === els.taskModal) closeTaskModal();
    });
  }
}

function openTaskModal(){
  if (!els.taskModal) return;
  els.taskModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (els.taskForm) els.taskForm.reset();
  if (els.taskDueDateInput){
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    els.taskDueDateInput.min = `${yyyy}-${mm}-${dd}`;
  }
}

function closeTaskModal(){
  if (els.taskModal) els.taskModal.classList.add('hidden');
  document.body.style.overflow = '';
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
  
  const name = (els.taskNameInput?.value || '').trim();
  const assigneeEmail = (els.taskAssigneeInput?.value || '').trim();
  const dueDate = (els.taskDueDateInput?.value || '').trim();
  const notes = (els.taskNotesInput?.value || '').trim();
  
  if (!name){
    toastInfo('กรุณากรอกชื่องาน');
    return;
  }
  
  showModalLoading(true);
  closeTaskModal();
  
  try{
    const res = await apiRequest('web_create_task', {
      name,
      assigneeEmail,
      dueDate,
      notes
    }, { maxRetries: 2 });
    
    if (!res || res.success === false){
      throw new Error(res?.message || 'create task error');
    }
    
    toastInfo('✓ เพิ่มงานใหม่สำเร็จ');
    await Promise.all([loadSecureData(), loadPublicData()]);
  }catch(err){
    handleDataError(err, 'ไม่สามารถเพิ่มงานใหม่ได้');
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
      adminSection.className = 'bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-300 rounded-2xl shadow-md p-6 mb-4';
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
  if (!state.notifications.length){
    toastInfo('ยังไม่มีการแจ้งเตือนใหม่');
    return;
  }
  const lines = state.notifications.slice(0, 5).map(task=>{
    const thaiDate = formatThaiDate(task.dueDate);
    const meta = formatDueMeta_(task.dueDate);
    return `• ${task.name} (${thaiDate}${meta ? ' '+meta : ''})`;
  });
  const remaining = state.notifications.length - lines.length;
  const message = lines.join('\n') + (remaining > 0 ? `\n… และอีก ${remaining} งาน` : '');
  alert(`งานที่กำลังจะถึงกำหนด:\n${message}`);
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
  els.profilePage.innerHTML = `
    <div class="bg-white rounded-2xl shadow-md p-6 mb-4">
      <div class="flex items-center space-x-4 mb-6">
        <img src="${escapeAttr(profile.pictureUrl || 'https://via.placeholder.com/100x100.png?text=LINE')}" alt="avatar" class="w-20 h-20 rounded-full object-cover border-4 border-blue-100">
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
