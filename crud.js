/* crud.js — KruBoard CRUD module (no bundler required)
   Exposes: window.KruBoardCRUD.init(deps)
*/
(function (global){
  function init(deps){
    // ===== dependencies from app.js =====
    const {
      state, els, apiRequest,
      utils: { toastInfo, toastError, escapeHtml, escapeAttr, validateDateFormat_, formatThaiDate, formatDueMeta_ },
      reload: { loadSecureData, loadPublicData },
      guards: { canManageTask },
    } = deps;

    // ===== internal state =====
    let activeUsersPromise = null;

    // ===== public binders =====
    function bindUI(){
      if (els.addTaskBtn){
        els.addTaskBtn.addEventListener('click', ()=> openTaskModal());
      }
      if (els.allTasksContainer){
        els.allTasksContainer.addEventListener('click', onTaskListClick);
      }
    }

    function initModalElements(){
      els.taskModal           = document.getElementById('taskModal');
      els.modalLoading        = document.getElementById('modalLoading');
      els.taskForm            = document.getElementById('taskForm');
      els.closeModalBtn       = document.getElementById('closeModalBtn');
      els.cancelModalBtn      = document.getElementById('cancelModalBtn');
      els.submitTaskBtn       = document.getElementById('submitTaskBtn');
      els.taskNameInput       = document.getElementById('taskName');
      els.taskAssigneeSearch  = document.getElementById('taskAssigneeSearch');
      els.taskAssigneeOptions = document.getElementById('taskAssigneeOptions');
      els.taskAssigneeSelected= document.getElementById('taskAssigneeSelected');
      els.taskDueDateInput    = document.getElementById('taskDueDate');
      els.taskNotesInput      = document.getElementById('taskNotes');
      els.quickDueButtons     = Array.from(document.querySelectorAll('[data-quick-due]'));

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

      if (els.closeModalBtn)   els.closeModalBtn.addEventListener('click', closeTaskModal);
      if (els.cancelModalBtn)  els.cancelModalBtn.addEventListener('click', closeTaskModal);
      if (els.taskForm)        els.taskForm.addEventListener('submit', handleTaskFormSubmit);

      updateQuickDueActive(null);
      updateAssigneeChips();
    }

    // ===== event handlers (list) =====
    function onTaskListClick(evt){
      const btn = evt.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.taskId;
      const action = btn.dataset.action;
      if (!id || !action) return;

      if (action === 'update-status'){
        handleUpdateStatus(id);
      }else if (action === 'edit-task'){
        handleEditTask(id);
      }else if (action === 'delete-task'){
        handleDeleteTask(id);
      }
    }

    // ===== CRUD core =====
    function openTaskModal(task){
      if (!els.taskModal) return;
      const isEditing = !!task;
      state.editingTask = task || null;

      if (els.taskForm) els.taskForm.reset();
      updateQuickDueActive(null);

      const titleEl = els.taskModalTitle || document.getElementById('taskModalTitle');
      const descEl  = els.taskModalDescription || document.getElementById('taskModalDescription');
      const submitLabel = els.submitTaskBtn?.querySelector('span:last-child');

      if (titleEl)  titleEl.textContent = isEditing ? 'แก้ไขงาน' : 'เพิ่มงานใหม่';
      if (descEl)   descEl.textContent  = isEditing ? 'ปรับปรุงรายละเอียดงานและบันทึกการแก้ไขของคุณ'
                                                    : 'กรอกข้อมูลให้ครบถ้วนเพื่อสร้างงานและแจ้งผู้รับผิดชอบ';
      if (submitLabel) submitLabel.textContent = isEditing ? 'บันทึกการแก้ไข' : 'บันทึกงาน';

      if (isEditing){
        if (els.taskNameInput) els.taskNameInput.value = task?.name || '';
        if (els.taskDueDateInput){
          const value = task?.dueDate && task.dueDate !== 'No Due Date' ? task.dueDate : '';
          els.taskDueDateInput.value = value || '';
        }
        if (els.taskNotesInput) els.taskNotesInput.value = task?.notes || '';
        state.assigneeSearchTerm = '';
        state.selectedAssignees  = [];
        updateAssigneeChips();
      }else{
        resetAssigneeSelection();
        if (els.taskNameInput) els.taskNameInput.value = '';
        if (els.taskDueDateInput) els.taskDueDateInput.value = '';
        if (els.taskNotesInput) els.taskNotesInput.value = '';
      }

      if (els.taskDueDateInput){
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth()+1).padStart(2,'0');
        const dd = String(today.getDate()).padStart(2,'0');
        els.taskDueDateInput.min = `${yyyy}-${mm}-${dd}`;
      }

      document.body.classList.add('modal-open');
      els.taskModal.classList.remove('hidden');
      requestAnimationFrame(()=> els.taskModal.classList.add('active'));

      ensureActiveUsers().then(()=>{
        if (isEditing){
          const email = String(task?.assigneeEmail || '').trim().toLowerCase();
          state.assigneeSearchTerm = '';
          state.selectedAssignees  = email ? [email] : [];
          if (els.taskAssigneeSearch) els.taskAssigneeSearch.value = '';
          if (state.activeUsers.length){
            renderAssigneeOptions(state.activeUsers);
          }else{
            setAssigneeStatus(email ? 'กำลังโหลดรายชื่อผู้รับผิดชอบ...' : 'ยังไม่มีรายชื่อผู้รับผิดชอบ');
          }
          updateAssigneeChips();
        }else{
          renderAssigneeOptions(state.activeUsers);
        }
      }).catch(()=>{});

      if (els.taskNameInput){
        setTimeout(()=>{ try{ els.taskNameInput.focus({preventScroll:true}); }catch(_){ els.taskNameInput.focus(); } }, 120);
      }
    }

    function closeTaskModal(){
      if (!els.taskModal) return;
      els.taskModal.classList.remove('active');
      document.body.classList.remove('modal-open');
      state.editingTask = null;
      setTimeout(()=>{ if (els.taskModal && !els.taskModal.classList.contains('active')) els.taskModal.classList.add('hidden'); }, 220);
      updateQuickDueActive(null);
    }

    async function handleTaskFormSubmit(evt){
      evt.preventDefault();

      if (!state.isLoggedIn){
        toastInfo('กรุณาเข้าสู่ระบบก่อน');
        return;
      }

      const editingTask   = state.editingTask ? {...state.editingTask} : null;
      const isEditing     = !!editingTask;
      const editingTaskId = editingTask ? (editingTask.id || editingTask.gid || editingTask.taskId || editingTask.TaskId || null) : null;
      const originalAssignee = editingTask ? String(editingTask.assigneeEmail || '').trim().toLowerCase() : '';

      const name    = (els.taskNameInput?.value || '').trim();
      const dueDate = (els.taskDueDateInput?.value || '').trim();
      if (!validateDateFormat_(dueDate)){
        toastError('รูปแบบวันที่ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)');
        return;
      }
      let notes = (els.taskNotesInput?.value || '').trim();
      if (isEditing && !notes && editingTask && editingTask.notes){
        notes = String(editingTask.notes);
      }

      const selectedAssignees = Array.isArray(state.selectedAssignees) ? state.selectedAssignees.filter(Boolean) : [];
      const primaryAssignee   = selectedAssignees[0] || originalAssignee || '';

      if (!name){ toastInfo('กรุณากรอกชื่องาน'); return; }
      if (isEditing && !editingTaskId){ toastError('ไม่พบข้อมูลงานสำหรับแก้ไข'); return; }

      showModalLoading(true);
      closeTaskModal();

      try{
        if (isEditing){
          const payload = { taskId: editingTaskId, name, assigneeEmail: primaryAssignee, dueDate, notes };
          const res = await apiRequest('web_update_task', payload, { maxRetries:2 });
          if (!res || res.success === false) throw new Error(res?.message || 'update task error');
          toastInfo('Task updated successfully');
        }else{
          const payload = { name, assigneeEmail: primaryAssignee, dueDate, notes };
          if (selectedAssignees.length) payload.assignees = JSON.stringify(selectedAssignees);
          const res = await apiRequest('web_create_task', payload, { maxRetries:2 });
          if (!res || res.success === false) throw new Error(res?.message || 'create task error');
          toastInfo('New task created');
        }
        await Promise.all([loadSecureData(), loadPublicData()]);
      }catch(err){
        handleDataError(err, isEditing ? 'ไม่สามารถอัปเดตงานได้' : 'ไม่สามารถเพิ่มงานใหม่ได้');
      }finally{
        showModalLoading(false);
      }
    }

    function showModalLoading(show){
      if (els.modalLoading) els.modalLoading.classList.toggle('hidden', !show);
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

    // ===== list actions =====
    function findTaskById(taskId){
      return (state.tasks || []).find(t => String(t.id).toUpperCase() === String(taskId).toUpperCase());
    }

    async function handleEditTask(taskId){
      if (!state.isLoggedIn){ toastInfo('กรุณาเข้าสู่ระบบก่อน'); return; }
      const task = findTaskById(taskId);
      if (!task){ toastInfo('ไม่พบบันทึกงานที่เลือก'); return; }
      if (!canManageTask(task)){ toastError('You do not have permission to edit this task'); return; }
      openTaskModal(task);
    }

    async function handleDeleteTask(taskId){
      if (!state.isLoggedIn){ toastInfo('กรุณาเข้าสู่ระบบก่อน'); return; }
      const task = findTaskById(taskId);
      if (!task){ toastInfo('ไม่พบบันทึกงานที่เลือก'); return; }
      if (!canManageTask(task)){ toastError('You do not have permission to delete this task'); return; }

      const ok = confirm('Delete task "' + task.name + '"?');
      if (!ok) return;

      try{
        const res = await apiRequest('web_delete_task', { taskId }, { maxRetries:2 });
        if (!res || res.success === false) throw new Error(res?.message || 'delete task error');
        toastInfo('Task deleted successfully');
        await Promise.all([loadSecureData(), loadPublicData()]);
      }catch(err){
        handleDataError(err, 'Unable to delete task');
      }
    }

    // ===== quick due =====
    function applyQuickDueSelection(targetBtn, offsetDays){
      if (!els.taskDueDateInput) return;
      const base = new Date();
      base.setHours(0,0,0,0);
      base.setDate(base.getDate() + (Number(offsetDays)||0));
      const iso = base.toISOString().slice(0,10);
      els.taskDueDateInput.value = iso;
      updateQuickDueActive(targetBtn);
    }
    function updateQuickDueActive(activeBtn){
      if (!Array.isArray(els.quickDueButtons)) return;
      els.quickDueButtons.forEach(btn=>{
        const on = btn === activeBtn;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    // ===== assignees =====
    function handleAssigneeSearchInput(){
      state.assigneeSearchTerm = (els.taskAssigneeSearch?.value || '').trim().toLowerCase();
      if (!state.activeUsers.length){ renderAssigneeOptions([]); return; }
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
      const next = !input.checked; input.checked = next; toggleAssigneeSelection(email, next);
    }
    function handleAssigneeChipClick(evt){
      const btn = evt.target.closest('[data-remove-email]');
      if (!btn) return;
      const email = String(btn.dataset.removeEmail || '').trim().toLowerCase();
      toggleAssigneeSelection(email, false);
    }
    function toggleAssigneeSelection(email, forceValue){
      if (!email) return;
      const normalized = email.toLowerCase();
      const selected = state.selectedAssignees || [];
      const idx = selected.indexOf(normalized);
      const exists = idx >= 0;
      const shouldAdd = forceValue === true || (forceValue !== false && !exists);

      if (state.editingTask){
        state.selectedAssignees = shouldAdd ? [normalized] : [];
        updateAssigneeOptionsActive(); updateAssigneeChips();
        return;
      }
      if (shouldAdd && !exists) selected.push(normalized);
      else if (!shouldAdd && exists) selected.splice(idx, 1);
      state.selectedAssignees = selected;
      updateAssigneeOptionsActive(); updateAssigneeChips();
    }
    function updateAssigneeOptionsActive(){
      if (!els.taskAssigneeOptions) return;
      els.taskAssigneeOptions.querySelectorAll('.assignee-option').forEach(node=>{
        const email = String(node.dataset.email || '').toLowerCase();
        const on = (state.selectedAssignees||[]).includes(email);
        node.classList.toggle('active', on);
        const cb = node.querySelector('input[type="checkbox"]'); if (cb) cb.checked = on;
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
        const msg = state.activeUsers.length ? 'ไม่พบรายชื่อที่ตรงกับการค้นหา' : 'ยังไม่มีรายชื่อผู้รับผิดชอบ';
        setAssigneeStatus(msg); return;
      }
      const html = users.map(u=>{
        const email = u.email || '';
        const on = (state.selectedAssignees||[]).includes(email);
        const detail = [u.role, u.department].filter(Boolean).join(' • ');
        const meta = detail ? `<span class="text-xs text-gray-400">${escapeHtml(detail)}</span>` : '';
        return `
          <div class="assignee-option${on?' active':''}" data-email="${escapeAttr(email)}">
            <label>
              <input type="checkbox" data-email="${escapeAttr(email)}" ${on ? 'checked' : ''}>
              <div class="assignee-meta">
                <span>${escapeHtml(u.name || email)}</span>
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
    function ensureActiveUsers(forceReload){
      if (!state.isLoggedIn){ setAssigneeStatus('ต้องเข้าสู่ระบบเพื่อเลือกผู้รับผิดชอบ'); return Promise.resolve([]); }
      if (!forceReload && state.activeUsers.length){
        renderAssigneeOptions(filterActiveUsersByTerm_(state.activeUsers, state.assigneeSearchTerm));
        return Promise.resolve(state.activeUsers);
      }
      if (activeUsersPromise && !forceReload) return activeUsersPromise;
      setAssigneeStatus('กำลังโหลดรายชื่อผู้รับผิดชอบ...');
      activeUsersPromise = apiRequest('users_active', {}, { maxRetries:1 })
        .then(res=>{
          if (!res || res.success === false) throw new Error(res?.message || 'active users error');
          const users = normalizeActiveUsers_(Array.isArray(res.data) ? res.data : []);
          state.activeUsers = users;
          renderAssigneeOptions(filterActiveUsersByTerm_(users, state.assigneeSearchTerm));
          return users;
        })
        .catch(err=>{ console.error('Active users load failed', err); setAssigneeStatus('ไม่สามารถโหลดรายชื่อผู้รับผิดชอบได้'); return []; })
        .finally(()=>{ activeUsersPromise = null; });
      return activeUsersPromise;
    }
    function resetAssigneeSelection(){
      state.assigneeSearchTerm = '';
      const selected = [];
      const me = String(state.currentUser?.email || '').trim().toLowerCase();
      if (me) selected.push(me);
      state.selectedAssignees = selected;
      if (els.taskAssigneeSearch) els.taskAssigneeSearch.value = '';
      if (state.activeUsers.length) renderAssigneeOptions(state.activeUsers);
      else setAssigneeStatus('กำลังโหลดรายชื่อผู้รับผิดชอบ...');
      updateAssigneeChips();
    }
    function getAssigneeLabel(email){
      const e = String(email||'').toLowerCase();
      const m = (state.activeUsers||[]).find(u => u.email === e);
      return m?.name || e;
    }
    function normalizeActiveUsers_(list){
      const seen = {}; return list.reduce((acc, raw)=>{
        const email = String(raw.email || '').trim().toLowerCase();
        if (!email || seen[email]) return acc;
        seen[email] = true;
        acc.push({ email, name: raw.name || raw.displayName || raw.user || email, role: raw.role || raw.level || raw.position || '', department: raw.department || raw.group || '' });
        return acc;
      }, []);
    }
    function filterActiveUsersByTerm_(users, term){
      if (!Array.isArray(users)) return [];
      const q = String(term||'').toLowerCase();
      if (!q) return users.slice();
      return users.filter(u=>{
        const name = (u.name||'').toLowerCase();
        const role = (u.role||'').toLowerCase();
        const dept = (u.department||'').toLowerCase();
        return name.includes(q) || (u.email||'').includes(q) || role.includes(q) || dept.includes(q);
      });
    }

    // ===== status toggle (example) =====
    async function handleUpdateStatus(taskId){
      const task = findTaskById(taskId);
      if (!task){ toastInfo('ไม่พบบันทึกงาน'); return; }
      if (!canManageTask(task)){ toastError('You do not have permission to update this task'); return; }
      try{
        const res = await apiRequest('update_status', { taskId, completed: task.completed === 'Yes' ? 'No' : 'Yes' }, { maxRetries: 1 });
        if (!res || res.success === false) throw new Error(res?.message || 'update status error');
        toastInfo('อัปเดตสถานะสำเร็จ');
        await Promise.all([loadSecureData(), loadPublicData()]);
      }catch(err){
        handleDataError(err, 'อัปเดตสถานะไม่สำเร็จ');
      }
    }

    // ===== expose + return =====
    return { bindUI, initModalElements, openTaskModal, closeTaskModal };
  }

  global.KruBoardCRUD = { init };
})(window);
