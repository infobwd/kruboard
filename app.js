/* KruBoard front-end — work with new backend endpoints
   - Reads API base & LIFF ID from HTML <meta>
   - Uses actions: dashboard_overview, my_stats, tasks_recent30
   - No create/update task calls (read-only UI)
*/

const APP_CONFIG = (() => {
  const api = document.querySelector('meta[name="kru-api-base"]')?.content?.trim();
  const liffId = document.querySelector('meta[name="kru-liff-id"]')?.content?.trim();
  return {
    scriptUrl: api || 'https://script.google.com/macros/s/AKfycbxD9lO5R_xFFKPp0e0llgoKtbXkr0upnZd3_GU8L0Ze308kITEENaPjK1PvvfkgO8iy/exec',
    liffId: liffId || '2006490627-3NpRPl0G'
  };
})();

const state = {
  isLoggedIn: false,
  profile: null,
  upcomingDays: 7,            // UI filter (7/15/30) — เราจะโหลด 30 วันจาก backend แล้วกรองฝั่ง front
  tasks: [],                  // รายการงานของฉัน (จาก my_stats)
  userStats: [],              // (ถ้า backend ยังไม่มี endpoint user_stats จะเว้นว่างไว้)
  dashboard: null,            // dashboard_overview (summary + personal)
  personalStats: null,        // ยกออกจาก dashboard.personal อีกทีเพื่อสะดวกอัปเดต UI
  currentUser: null,          // ข้อมูลผู้ใช้ (ระดับสิทธิ์ ฯลฯ) ถ้ามี
  notifications: [],          // ใช้โชว์ badge ใน bell = งานที่จะถึงกำหนด (อิงจาก tasks_recent30 + filter ตาม days)
  filteredTasks: [],
  taskFilters: { status:'all', search:'' },
  taskPagination: { page:1, pageSize:10, totalPages:1 },
  isAdmin: false
};

// Thai months for date formatting
const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'
];

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
  // Modal elements (ยังไม่ใช้ เพราะ backend read-only)
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

document.addEventListener('DOMContentLoaded', init);

function init(){
  cachePages();
  bindUI();
  initModalElements(); // ยังไม่ใช้ แต่คงไว้ให้โค้ดไม่พัง
  showLoading(true);
  initializeLiff()
    .catch(err=>{
      console.error('LIFF init failed:', err);
      renderLoginBanner();
      renderProfilePage();
    })
    .finally(()=>{
      loadPublicData()
        .then(()=> state.isLoggedIn ? loadSecureData() : null)
        .catch(err=> handleDataError(err, 'โหลดข้อมูลล้มเหลว กรุณาลองใหม่'))
        .finally(()=> showLoading(false));
    });
}

/* ---------- Modal (not used now) ---------- */
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
  if (els.taskForm) els.taskForm.addEventListener('submit', e=>{ e.preventDefault(); toastInfo('ยังไม่รองรับการเพิ่มงาน'); });
  if (els.taskModal){
    els.taskModal.addEventListener('click', (evt)=>{ if (evt.target === els.taskModal) closeTaskModal(); });
  }
}
function openTaskModal(){ /* not used */ }
function closeTaskModal(){ if (els.taskModal) els.taskModal.classList.add('hidden'); document.body.style.overflow=''; }
function showModalLoading(show){ if (els.modalLoading) els.modalLoading.classList.toggle('hidden', !show); }

/* ---------- Date helpers ---------- */
function formatThaiDate(dateString){
  if (!dateString || dateString === 'No Due Date') return 'ไม่มีวันครบกำหนด';
  const d = new Date(dateString+'T00:00:00+07:00');
  if (isNaN(d)) return dateString;
  return `${d.getDate()} ${THAI_MONTHS[d.getMonth()]} ${d.getFullYear()+543}`;
}
function formatDueMeta_(dueDate){
  if (!dueDate || dueDate === 'No Due Date') return '';
  const due = new Date(dueDate+'T00:00:00+07:00');
  if (isNaN(due)) return '';
  const today = new Date(); today.setHours(0,0,0,0);
  due.setHours(0,0,0,0);
  const diff = Math.round((due - today)/(24*60*60*1000));
  if (diff === 0) return '(ครบกำหนดวันนี้)';
  if (diff === 1) return '(พรุ่งนี้)';
  if (diff === -1) return '(เมื่อวาน)';
  if (diff > 0) return `(อีก ${diff} วัน)`;
  return `(เกินกำหนด ${Math.abs(diff)} วัน)`;
}

/* ---------- Bootstrap / UI ---------- */
function cachePages(){
  const pages = Array.from(document.querySelectorAll('.page'));
  pages.forEach(p=> els.pages[p.id]=p);
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
    });
  });

  if (els.refreshBtn){
    els.refreshBtn.addEventListener('click', ()=>{
      showLoading(true);
      const target = state.isLoggedIn ? loadSecureData() : Promise.resolve();
      Promise.all([loadPublicData(), target])
        .catch(()=> toastError('รีเฟรชข้อมูลไม่สำเร็จ'))
        .finally(()=> showLoading(false));
    });
  }

  els.timeFilters.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      els.timeFilters.forEach(b=> b.classList.remove('active','bg-blue-600','text-white'));
      btn.classList.add('active','bg-blue-600','text-white');
      state.upcomingDays = Number(btn.dataset.days||'7');
      loadUpcomingTasks(); // เราโหลด 30 วันมาทิ้งไว้ใน cache แล้วกรองตาม days อีกที
    });
  });

  if (els.fabBtn){
    els.fabBtn.addEventListener('click', ()=> window.scrollTo({ top:0, behavior:'smooth' }));
    window.addEventListener('scroll', ()=>{
      els.fabBtn.classList.toggle('hidden', window.scrollY <= 300);
    });
  }

  if (els.notificationBtn){
    els.notificationBtn.addEventListener('click', showNotifications);
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
      if (state.taskPagination.page>1){
        state.taskPagination.page--;
        renderTaskList(); renderTaskPagination();
      }
    });
  }
  if (els.taskPaginationNext){
    els.taskPaginationNext.addEventListener('click', ()=>{
      if (state.taskPagination.page<state.taskPagination.totalPages){
        state.taskPagination.page++;
        renderTaskList(); renderTaskPagination();
      }
    });
  }

  if (els.addTaskBtn){
    els.addTaskBtn.classList.add('hidden'); // read-only
  }
}

/* ---------- LIFF ---------- */
function ensureLiffSdk(){
  if (typeof liff !== 'undefined') return Promise.resolve();
  if (document.getElementById('liff-sdk')) return waitForLiffInstance(3000);
  return new Promise((resolve, reject)=>{
    const s=document.createElement('script');
    s.id='liff-sdk'; s.src='https://static.line-scdn.net/liff/edge/2/sdk.js'; s.async=true;
    s.onload=()=> waitForLiffInstance(0).then(resolve).catch(reject);
    s.onerror=()=> reject(new Error('โหลด LIFF SDK ไม่สำเร็จ'));
    document.head.appendChild(s);
  });
}
function waitForLiffInstance(timeoutMs){
  const deadline=Date.now()+(timeoutMs||0);
  return new Promise((resolve,reject)=>{
    (function poll(){
      if (typeof liff!=='undefined'){ resolve(); return; }
      if (Date.now()>deadline){ reject(new Error('LIFF SDK not available')); return; }
      setTimeout(poll,100);
    })();
  });
}
async function initializeLiff(){
  try{ await ensureLiffSdk(); }catch(err){ throw err; }
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
    }else{
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
  let banner=document.getElementById('loginBanner');
  if (!banner){
    banner=document.createElement('div');
    banner.id='loginBanner';
    banner.className='bg-white border border-blue-200 rounded-xl p-4 mb-4 shadow-sm';
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
  document.getElementById('loginWithLineBtn')?.addEventListener('click', ()=>{
    if (typeof liff==='undefined'){ toastError('ไม่พบ LIFF SDK'); return; }
    liff.login({ redirectUri: window.location.href });
  });
}

/* ---------- Data loading ---------- */
async function loadPublicData(){
  const dashboardPromise = fetchDashboardStats();     // action=dashboard_overview
  const upcomingPromise  = loadUpcomingTasks();       // action=tasks_recent30 (แล้วกรอง)
  const dash = await dashboardPromise;
  renderDashboard(dash);
  await upcomingPromise;
}
function loadSecureData(){
  return fetchMyStats() // action=my_stats → รวม stats ส่วนตัว + tasks ของฉัน (ใช้แทน tasks endpoint)
    .then((my)=>{
      // อัปเดต tasks + personal stats
      state.tasks = Array.isArray(my.tasks) ? my.tasks : [];
      state.personalStats = my.personal || null;
      state.currentUser = my.currentUser || state.currentUser || null;
      state.isAdmin = (String(state.currentUser?.level||'').toLowerCase()==='admin');
      renderTasks(state.tasks);
      renderProfilePage();
    })
    .catch(err=> handleDataError(err,'ไม่สามารถโหลดข้อมูลของฉันได้'));
}

/* ----- API calls (JSONP) ----- */
function fetchDashboardStats(){
  const params = { action:'dashboard_overview' };
  if (state.isLoggedIn && state.profile?.idToken) params.idToken = state.profile.idToken;
  return jsonpRequest(params).then(res=>{
    if (!res || res.success===false) throw new Error(res?.message || 'dashboard_overview error');
    return res.data || {};
  });
}
function loadUpcomingTasks(){
  // backend จะคืนรายการ “30 วันปัจจุบัน” เราจำไว้ แล้วกรองตาม UI days (7/15/30)
  const params = { action:'tasks_recent30' };
  if (state.isLoggedIn && state.profile?.idToken) params.idToken = state.profile.idToken; // ถ้าฝั่งหลังกรอง “ของฉัน”
  return jsonpRequest(params)
    .then(res=>{
      if (!res || res.success===false) throw new Error(res?.message || 'tasks_recent30 error');
      const all = Array.isArray(res.data) ? res.data : [];
      const filtered = filterByDays_(all, state.upcomingDays);
      state.notifications = state.isLoggedIn ? filtered : [];
      setText(els.notificationCount, state.isLoggedIn ? (filtered.length||0) : 0);
      renderUpcomingTasks(filtered);
      return filtered;
    })
    .catch(err=>{
      console.error('Upcoming error:', err);
      renderUpcomingTasks([]);
      return [];
    });
}
// ดึงข้อมูล "ของฉัน" (ใช้แทน tasks และ personal stats)
function fetchMyStats(){
  if (!state.isLoggedIn || !state.profile?.idToken){
    return Promise.resolve({ tasks:[], personal:null, currentUser:null });
  }
  return jsonpRequest({ action:'my_stats', idToken: state.profile.idToken })
    .then(res=>{
      if (!res || res.success===false) throw new Error(res?.message || 'my_stats error');
      return {
        tasks: Array.isArray(res.data?.tasks) ? res.data.tasks : [],
        personal: res.data?.personal || null,
        currentUser: res.currentUser || res.data?.currentUser || null
      };
    });
}

/* ---------- Rendering ---------- */
function renderDashboard(data){
  state.dashboard = data || null;
  const summary = data?.summary || {};
  setText(els.headerTotals.totalTasks, summary.totalTasks || 0);
  setText(els.headerTotals.upcomingTasks, summary.upcomingTasks || 0);
  setText(els.headerTotals.totalUsers, summary.uniqueAssignees || 0);
  const completion = summary.completionRate != null ? `${summary.completionRate}%` : '0%';
  setText(els.headerTotals.completionRate, completion);
  setText(els.stats.completed, summary.completedTasks || 0);
  setText(els.stats.pending, summary.pendingTasks || 0);
  setText(els.stats.month, summary.currentMonthTasks || 0);
  setText(els.stats.completionRate, completion);

  // personal (ถ้ามีใน dashboard_overview)
  state.personalStats = data?.personal || state.personalStats;
  if (data?.currentUser) state.currentUser = data.currentUser;
  state.isAdmin = state.currentUser ? String(state.currentUser.level||'').toLowerCase()==='admin' : state.isAdmin;

  if (els.statsPersonal.container){
    if (state.personalStats){
      els.statsPersonal.container.classList.remove('hidden');
      setText(els.headerTotals.myTasks, state.personalStats.totalTasks || 0);
      setText(els.headerTotals.myUpcoming, state.personalStats.upcomingTasks || 0);
      setText(els.statsPersonal.completed, state.personalStats.completedTasks || 0);
      setText(els.statsPersonal.pending, state.personalStats.pendingTasks || 0);
      setText(els.statsPersonal.month, state.personalStats.currentMonthTasks || 0);
      setText(els.statsPersonal.upcoming, state.personalStats.upcomingTasks || 0);
    }else{
      els.statsPersonal.container.classList.add('hidden');
      setText(els.headerTotals.myTasks, state.isLoggedIn ? '0' : '-');
      setText(els.headerTotals.myUpcoming, state.isLoggedIn ? '0' : '-');
    }
  }
}

function renderUpcomingTasks(list){
  if (!els.taskCardsContainer) return;
  if (!state.isLoggedIn){
    els.taskCardsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-dashed border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบผ่าน LINE เพื่อดูรายละเอียดงานที่กำลังจะถึง
      </div>`;
    setText(els.headerTotals.myUpcoming, '-');
    return;
  }
  setText(els.headerTotals.myUpcoming, list.length || 0);
  if (!list.length){
    els.taskCardsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่พบงานที่กำลังจะถึงในช่วง ${state.upcomingDays} วัน
      </div>`;
    return;
  }
  els.taskCardsContainer.innerHTML = list.map(task=>{
    const thaiDate = formatThaiDate(task.dueDate);
    const days = String(task.daysUntilDue ?? '').trim();
    const badge = (days==='0') ? {cls:'bg-red-100 text-red-600', txt:'วันนี้'} : {cls:'bg-blue-100 text-blue-600', txt:`อีก ${days} วัน`};
    return `
      <div class="task-card bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div class="flex justify-between items-start">
          <h3 class="text-base font-semibold text-gray-800">${escapeHtml(task.name)}</h3>
          <span class="text-xs font-medium px-2 py-1 rounded-full ${badge.cls}">${badge.txt}</span>
        </div>
        <p class="text-sm text-gray-500 mt-1">${escapeHtml(task.assignee || '')}</p>
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
      </div>`;
  }).join('');
}

function renderTasks(tasks){
  if (!els.allTasksContainer) return;
  if (!state.isLoggedIn){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูรายการงานทั้งหมด
      </div>`;
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
      </div>`;
    return;
  }
  const tasks = state.tasks || [];
  const search = String(state.taskFilters.search||'').toLowerCase();
  const status = String(state.taskFilters.status||'all').toLowerCase();

  const filtered = tasks.filter(t=>{
    const isCompleted = t.completed==='Yes';
    if (status==='completed' && !isCompleted) return false;
    if (status==='pending' && isCompleted) return false;
    if (!search) return true;
    const hay = [t.name,t.assignee,t.status,t.dueDate,t.dueDateThai].map(x=> String(x||'').toLowerCase());
    return hay.some(v=> v.includes(search));
  }).sort((a,b)=>{
    const da = parseTaskDue_(a.dueDate), db = parseTaskDue_(b.dueDate);
    if (db===da) return String(a.name||'').localeCompare(String(b.name||''));
    return db - da;
  });

  state.filteredTasks = filtered;
  const totalPages = Math.max(1, Math.ceil(filtered.length/state.taskPagination.pageSize));
  state.taskPagination.totalPages = totalPages;
  if (state.taskPagination.page>totalPages) state.taskPagination.page = totalPages;
  renderTaskList(); renderTaskPagination();
}
function renderTaskList(){
  if (!els.allTasksContainer) return;
  if (!state.filteredTasks.length){
    els.allTasksContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่พบงานที่ตรงกับเงื่อนไขการค้นหา
      </div>`;
    return;
  }
  const start=(state.taskPagination.page-1)*state.taskPagination.pageSize;
  const end=start+state.taskPagination.pageSize;
  const items=state.filteredTasks.slice(start,end);
  els.allTasksContainer.innerHTML = items.map(task=>{
    const isCompleted = task.completed==='Yes';
    const statusLabel = task.status || (isCompleted ? 'เสร็จสมบูรณ์' : 'รอดำเนินการ');
    const statusClass = isCompleted ? 'bg-green-100 text-green-600' : 'bg-yellow-100 text-yellow-600';
    const thaiDate = formatThaiDate(task.dueDate);
    const dueMeta = formatDueMeta_(task.dueDate);
    return `
      <div class="task-card bg-white rounded-xl p-4 shadow-sm border border-gray-100">
        <div class="flex justify-between items-start">
          <div>
            <h3 class="text-base font-semibold text-gray-800">${escapeHtml(task.name)}</h3>
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
          <div class="flex items-center space-x-2 text-xs text-gray-500">
            <span class="material-icons text-base text-purple-500">link</span>
            <a href="${escapeAttr(task.link)}" target="_blank" class="text-blue-600 hover:underline">เปิดใน Asana</a>
          </div>
        </div>
      </div>`;
  }).join('');
}
function renderTaskPagination(){
  const w=els.taskPaginationWrapper;
  if (w){
    const hide = state.filteredTasks.length <= state.taskPagination.pageSize;
    w.classList.toggle('hidden', hide);
  }
  if (!state.filteredTasks.length){
    els.taskPaginationInfo.textContent='ไม่มีงาน';
    if (els.taskPaginationPrev) els.taskPaginationPrev.disabled=true;
    if (els.taskPaginationNext) els.taskPaginationNext.disabled=true;
    return;
  }
  const total = state.taskPagination.totalPages||1;
  const page = state.taskPagination.page||1;
  els.taskPaginationInfo.textContent = `หน้า ${page}/${total}`;
  if (els.taskPaginationPrev) els.taskPaginationPrev.disabled = page<=1;
  if (els.taskPaginationNext) els.taskPaginationNext.disabled = page>=total;
}
function renderUserStats(stats){
  // ถ้ายังไม่มี endpoint รวมสถิติครูทั้งหมด ให้แสดง “ต้องล็อกอิน” ไว้ก่อน
  if (!els.userStatsContainer) return;
  if (!state.isLoggedIn){
    els.userStatsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-blue-200 text-center text-sm text-gray-500">
        เข้าสู่ระบบเพื่อดูสถิติรายบุคคล
      </div>`;
    return;
  }
  const active = Array.isArray(stats) ? stats.filter(r=> (r.totalTasks||0)>0 ) : [];
  if (!active.length){
    els.userStatsContainer.innerHTML = `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-200 text-center text-sm text-gray-500">
        ไม่มีสถิติผู้ใช้ที่ Active
      </div>`;
    return;
  }
  els.userStatsContainer.innerHTML = active.map((row,i)=>{
    const cls = row.completionRate>=80 ? 'text-green-600' : row.completionRate>=50 ? 'text-yellow-600' : 'text-red-600';
    return `
      <div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white font-bold">${i+1}</div>
          <div>
            <p class="text-sm font-semibold text-gray-800">${escapeHtml(row.assignee || 'ไม่ทราบชื่อ')}</p>
            <p class="text-xs text-gray-500">${escapeHtml(row.email || 'ไม่มีอีเมล')}</p>
          </div>
        </div>
        <div class="flex flex-col sm:flex-row sm:space-x-4 text-xs text-gray-600 text-right sm:text-left">
          <span>งานทั้งหมด: <strong class="text-blue-600">${row.totalTasks||0}</strong></span>
          <span>เสร็จแล้ว: <strong class="text-green-600">${row.completedTasks||0}</strong></span>
          <span>รอดำเนินการ: <strong class="text-yellow-600">${row.pendingTasks||0}</strong></span>
          <span>ความสำเร็จ: <strong class="${cls}">${row.completionRate||0}%</strong></span>
        </div>
      </div>`;
  }).join('');
}
function renderProfilePage(){
  if (state.isLoggedIn){
    const banner=document.getElementById('loginBanner');
    if (banner?.parentNode) banner.parentNode.removeChild(banner);
  }
  if (!els.profilePage) return;
  if (!state.isLoggedIn || !state.profile){
    els.profilePage.innerHTML = `
      <div class="bg-white rounded-2xl shadow-md p-6 mb-4">
        <div class="text-center">
          <div class="w-24 h-24 mx-auto bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white text-3xl font-bold">KB</div>
          <h2 class="text-xl font-bold text-gray-800 mt-4">KruBoard</h2>
          <p class="text-sm text-gray-500 mt-1">เข้าสู่ระบบด้วย LINE เพื่อจัดการงาน</p>
          <button class="mt-6 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 mx-auto" id="profileLoginBtn">
            <span class="material-icons text-base">chat</span>
            <span>เข้าสู่ระบบผ่าน LINE</span>
          </button>
        </div>
      </div>`;
    document.getElementById('profileLoginBtn')?.addEventListener('click', ()=>{
      if (typeof liff==='undefined'){ toastError('ไม่พบ LIFF SDK'); return; }
      liff.login({ redirectUri: window.location.href });
    });
    return;
  }
  const p=state.profile;
  const userRecord=state.currentUser||{};
  const roleLabel = userRecord.level ? String(userRecord.level) : (state.isAdmin?'Admin':'Teacher');
  const lineUidLabel = userRecord.lineUID ? `LINE UID: ${userRecord.lineUID}` : '';
  els.profilePage.innerHTML = `
    <div class="bg-white rounded-2xl shadow-md p-6 mb-4">
      <div class="flex items-center space-x-4 mb-6">
        <img src="${escapeAttr(p.pictureUrl || 'https://via.placeholder.com/100x100.png?text=LINE')}" alt="avatar" class="w-20 h-20 rounded-full object-cover border-4 border-blue-100">
        <div>
          <h2 class="text-xl font-bold text-gray-800">${escapeHtml(p.name || 'ผู้ใช้งาน')}</h2>
          <p class="text-xs text-gray-500">${escapeHtml(p.email || p.userId || '')}</p>
          <p class="text-xs text-emerald-600 font-semibold mt-1">บทบาท: ${escapeHtml(roleLabel)}</p>
          ${lineUidLabel ? `<p class="text-xs text-gray-400">${escapeHtml(lineUidLabel)}</p>` : ''}
          <p class="text-xs text-gray-400 mt-1">${escapeHtml(p.statusMessage || '')}</p>
        </div>
      </div>
      <div class="space-y-3">
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
    </button>`;
  document.getElementById('logoutBtn')?.addEventListener('click', ()=>{
    if (typeof liff==='undefined'){ toastError('ไม่พบ LIFF SDK'); return; }
    liff.logout(); window.location.reload();
  });
  document.getElementById('btnRefreshData')?.addEventListener('click', ()=>{
    showLoading(true);
    loadSecureData().finally(()=> showLoading(false));
  });
}

/* ---------- Helpers ---------- */
function showNotifications(){
  if (!state.isLoggedIn){ toastInfo('กรุณาเข้าสู่ระบบเพื่อดูการแจ้งเตือน'); return; }
  if (!state.notifications.length){ toastInfo('ยังไม่มีการแจ้งเตือนใหม่'); return; }
  const lines = state.notifications.slice(0,5).map(t=>{
    const d=formatThaiDate(t.dueDate), meta=formatDueMeta_(t.dueDate);
    return `• ${t.name} (${d}${meta ? ' '+meta : ''})`;
  });
  const rest = state.notifications.length - lines.length;
  alert(`งานที่กำลังจะถึงกำหนด:\n${lines.join('\n')}${rest>0?`\n… และอีก ${rest} งาน`:''}`);
}
function filterByDays_(tasks, days){
  // backend ส่งมา 30 วันล่วงหน้าแล้ว แต่กันเหนียวกรองอีกชั้นตาม state.upcomingDays
  const today = new Date(); today.setHours(0,0,0,0);
  const end = new Date(today.getTime() + (Math.max(1,days)*24*60*60*1000));
  return (tasks||[]).filter(t=>{
    if (!t?.dueDate || t.dueDate==='No Due Date') return false;
    const d = new Date(t.dueDate+'T00:00:00+07:00');
    if (isNaN(d)) return false;
    return d>=today && d<=end;
  }).map(t=>{
    const due = new Date(t.dueDate+'T00:00:00+07:00'); due.setHours(0,0,0,0);
    const diff = Math.round((due - today)/(24*60*60*1000));
    return Object.assign({}, t, { daysUntilDue: String(diff) });
  }).sort((a,b)=> Number(a.daysUntilDue) - Number(b.daysUntilDue));
}
function parseTaskDue_(v){
  if (!v || v==='No Due Date') return 0;
  const d=new Date(v+'T00:00:00+07:00');
  return isNaN(d) ? 0 : d.getTime();
}

/* ---------- JSONP core ---------- */
function jsonpRequest(params, retryCount=0){
  const maxRetries=2, baseTimeout=30000;
  return new Promise((resolve,reject)=>{
    const cb=`jsonp_cb_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    const query=new URLSearchParams({ ...(params||{}), callback:cb });
    const s=document.createElement('script');
    s.src = `${APP_CONFIG.scriptUrl}?${query.toString()}`;
    let timeoutId=null, resolved=false;
    const timeout = baseTimeout * Math.pow(1.5, retryCount);
    timeoutId = setTimeout(()=>{
      if (!resolved){
        cleanup();
        if (retryCount<maxRetries){
          jsonpRequest(params, retryCount+1).then(resolve).catch(reject);
        }else{
          const e=new Error('JSONP timeout after retries'); e.code='JSONP_NETWORK'; reject(e);
        }
      }
    }, timeout);
    function cleanup(){
      if (timeoutId){ clearTimeout(timeoutId); timeoutId=null; }
      setTimeout(()=>{
        try{ delete window[cb]; }catch(_){}
        if (s.parentNode) s.parentNode.removeChild(s);
      },1000);
    }
    window[cb] = (data)=>{ if (!resolved){ resolved=true; cleanup(); resolve(data); } };
    s.onerror = ()=>{
      if (!resolved){
        resolved=true; cleanup();
        if (retryCount<maxRetries){
          jsonpRequest(params, retryCount+1).then(resolve).catch(reject);
        }else{
          const e=new Error('JSONP network error after retries'); e.code='JSONP_NETWORK'; reject(e);
        }
      }
    };
    document.body.appendChild(s);
  });
}

/* ---------- UI helpers ---------- */
function switchPage(id){
  Object.values(els.pages).forEach(p=> p.classList.toggle('active', p.id===id));
  els.navItems.forEach(a=> a.classList.toggle('active', a.getAttribute('data-page')===id));
}
function showLoading(show){ els.loadingToast?.classList.toggle('hidden', !show); }
function toastError(msg){ console.warn(msg); alert(msg); }
function toastInfo(msg){ console.info(msg); alert(msg); }
function handleDataError(err, msg){ console.error(err); toastError(msg); }
function setText(el,val){ if (el) el.textContent = val; }
function escapeHtml(v){ if (v==null) return ''; return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function escapeAttr(v){ if (v==null) return ''; return String(v).replace(/"/g,'&quot;'); }
