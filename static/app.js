document.addEventListener('DOMContentLoaded', () => {
    let timersState = [];
    let selectedTimerIds = []; // ✅ ADDED: State for selected timers
    let selectedTime = { days: 0, hours: 0, minutes: 0 };
    const apiBase = '';

    const timersContainer = document.getElementById('timers');
    const form = document.getElementById('add-timer-form');
    const nameInput = document.getElementById('name-input');
    const durationInput = document.getElementById('duration-input');
    const togglePickerBtn = document.getElementById('toggle-picker-btn');
    const pickerContainer = document.getElementById('picker-container-wrapper');
    const clearNameBtn = document.getElementById('clear-name-btn');
    const submitBtn = document.getElementById('submit-btn');
    const submitIcon = document.getElementById('submit-icon');
    const submitSpinner = document.getElementById('submit-spinner');
    const quickBtns = document.querySelectorAll('.quick-btn');
    const clearFinishedBtn = document.getElementById('clear-finished-btn');
    const pickers = { days: document.getElementById('days-picker'), hours: document.getElementById('hours-picker'), minutes: document.getElementById('minutes-picker') };
    const uploadInput = document.getElementById('screenshot-upload');
    const uploadStatus = document.getElementById('upload-status');

    // ✅ ADDED: New bulk action elements
    const bulkActionsContainer = document.getElementById('bulk-actions');
    const reduceMinutesInput = document.getElementById('reduce-minutes-input');
    const reduceTimeBtn = document.getElementById('reduce-time-btn');
    const selectionCountEl = document.getElementById('selection-count');
    const deselectAllBtn = document.getElementById('deselect-all-btn');

    // --- API FUNCTIONS ---
    async function apiFetchTimers() {
        try { const res = await fetch(`${apiBase}/timers`); return res.ok ? await res.json() : []; }
        catch (err) { console.error("Fetch error:", err); return []; }
    }
    async function apiAddTimer(name, duration) {
        const res = await fetch(`${apiBase}/timers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, duration }) });
        if (!res.ok) alert("Failed to add timer");
    }
    async function apiDeleteTimer(id) {
        await fetch(`${apiBase}/timers/${id}`, { method: 'DELETE' });
    }
    async function apiClearTimer(id) {
        await fetch(`${apiBase}/timers/${id}/clear`, { method: 'POST' });
    }
    // ✅ ADDED: New API function to reduce time
    async function apiReduceTime(timer_ids, minutes) {
        const res = await fetch(`${apiBase}/timers/reduce-time`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ timer_ids, minutes }) });
        if (!res.ok) alert("Failed to reduce time for timers.");
    }

    async function apiUploadScreenshot(file) {
        const formData = new FormData();
        formData.append("file", file);
        const res = await fetch(`${apiBase}/upload-screenshot`, { method: 'POST', body: formData });
        if (!res.ok) {
            const errorData = await res.json();
            throw new Error(errorData.detail || 'Screenshot upload failed');
        }
        return await res.json();
    }

    uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        uploadStatus.textContent = 'Processing screenshot...';
        uploadStatus.classList.remove('hidden');
        try {
            const result = await apiUploadScreenshot(file);
            console.log("Server response:", result);
            uploadStatus.textContent = 'Success! Refreshing timers...';
            await refreshAllTimers();
        } catch (error) {
            console.error(error);
            uploadStatus.textContent = error.message;
        } finally {
            setTimeout(() => { uploadStatus.classList.add('hidden'); }, 4000);
            e.target.value = '';
        }
    });

    // --- MAIN REFRESH FUNCTION ---
    async function refreshAllTimers() {
        stopAllTimers();
        timersState = await apiFetchTimers();
        selectedTimerIds = []; // Clear selection on full refresh
        updateBulkActionsUI();
        renderTimers();
        startClientSideCountdown();
    }

    // --- EVENT HANDLERS ---
    timersContainer.addEventListener('click', async e => {
        const target = e.target;
        if (target.classList.contains('delete-btn')) {
            const timerId = parseInt(target.dataset.id);
            const timer = timersState.find(t => t.id === timerId);
            if (timer && timer.remaining_seconds > 0) {
                if (confirm(`Are you sure you want to delete the active timer "${timer.name}"?`)) {
                    await apiDeleteTimer(timerId);
                }
            } else if (timer) {
                await apiClearTimer(timerId);
            }
            await refreshAllTimers();
        }
        // ✅ ADDED: Handle checkbox clicks
        else if (target.classList.contains('timer-checkbox')) {
            const timerId = parseInt(target.dataset.id);
            const card = target.closest('.timer-card');
            if (target.checked) {
                if (!selectedTimerIds.includes(timerId)) selectedTimerIds.push(timerId);
                card.classList.add('selected');
            } else {
                selectedTimerIds = selectedTimerIds.filter(id => id !== timerId);
                card.classList.remove('selected');
            }
            updateBulkActionsUI();
        }
    });

    clearFinishedBtn.addEventListener('click', async () => {
        const finishedTimers = timersState.filter(t => t.remaining_seconds <= 0);
        if (finishedTimers.length === 0) return;
        if (confirm(`Are you sure you want to clear ${finishedTimers.length} finished timer(s) from view?`)) {
            const clearPromises = finishedTimers.map(timer => apiClearTimer(timer.id));
            await Promise.all(clearPromises);
            await refreshAllTimers();
        }
    });

    // ✅ ADDED: Event listener for the new "Reduce Time" button
    reduceTimeBtn.addEventListener('click', async () => {
        const minutes = parseInt(reduceMinutesInput.value);
        if (isNaN(minutes) || minutes <= 0) {
            alert('Please enter a valid number of minutes to reduce.');
            return;
        }
        if (selectedTimerIds.length === 0) return;

        await apiReduceTime(selectedTimerIds, minutes);
        reduceMinutesInput.value = ''; // Clear input
        await refreshAllTimers(); // This will also clear selection and hide the panel
    });

    // ✅ ADDED: Event listener to deselect all timers
    deselectAllBtn.addEventListener('click', () => {
        selectedTimerIds = [];
        document.querySelectorAll('.timer-card.selected').forEach(card => {
            card.classList.remove('selected');
            card.querySelector('.timer-checkbox').checked = false;
        });
        updateBulkActionsUI();
    });

    // --- UI & HELPER FUNCTIONS ---
    // ✅ ADDED: Show/hide bulk actions panel
    function updateBulkActionsUI() {
        if (selectedTimerIds.length > 0) {
            selectionCountEl.textContent = `${selectedTimerIds.length} selected`;
            bulkActionsContainer.classList.remove('hidden');
        } else {
            bulkActionsContainer.classList.add('hidden');
        }
    }

    // ✅ MODIFIED: Added checkbox to the timer card template
    function renderTimers() {
        timersContainer.innerHTML = '';
        if (timersState.length === 0) {
            timersContainer.innerHTML = `<p class="text-center text-slate-400 text-base mt-10 col-span-full">No active timers. Add one below!</p>`;
            return;
        }
        timersState.forEach(timer => {
            const isDone = timer.remaining_seconds <= 0;
            const div = document.createElement('div');
            div.id = `timer-${timer.id}`;
            div.className = `timer-card ${isDone ? 'finished' : ''} glass-card p-4 rounded-lg shadow-lg flex flex-col gap-3 transition-all`;
            const total = timer.total_seconds || 1;
            const percent = isDone ? 0 : Math.max(0, Math.min(100, (timer.remaining_seconds / total) * 100));
            div.innerHTML = `
                <div class="flex justify-between items-start">
                    <div class="flex items-center gap-3">
                        <input type="checkbox" data-id="${timer.id}" class="timer-checkbox h-5 w-5 rounded bg-stone-700/50 border-stone-600 text-amber-500 focus:ring-amber-500 cursor-pointer">
                        <div>
                            <h2 class="font-bold text-lg">${timer.name}</h2>
                            <p class="font-mono text-sm ${isDone ? 'text-emerald-400' : 'text-slate-300'}">${formatRemaining(timer.remaining_seconds)}</p>
                        </div>
                    </div>
                    <button data-id="${timer.id}" class="delete-btn text-slate-500 hover:text-red-400 transition">✖</button>
                </div>
                <div class="w-full bg-stone-800 h-2 rounded overflow-hidden">
                    <div class="h-full bg-amber-500 transition-all duration-1000 ease-linear" style="width: ${percent}%"></div>
                </div>
            `;
            timersContainer.appendChild(div);
        });
    }

    function formatRemaining(sec) { if (sec <= 0) return '✅ Finished!'; const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return `${d}d ${h}h ${m}m ${s}s`; }
    function parseSmartDuration(str) { const clean = str.trim().toLowerCase(); if (/^\d+$/.test(clean)) return `0d0h${clean}m`; let days = 0, hours = 0, minutes = 0; const regex = /(\d+)\s*(d|h|m)/g; let match; while ((match = regex.exec(clean))) { const num = parseInt(match[1]); const unit = match[2]; if (unit === 'd') days = num; else if (unit === 'h') hours = num; else if (unit === 'm') minutes = num; } return `${days}d${hours}h${minutes}m`; }
    function populatePickers() { const padding = '<div class="h-12 flex-shrink-0"></div>'; for (const unit in pickers) { const limit = unit === 'days' ? 30 : unit === 'hours' ? 23 : 59; let html = padding; for (let i = 0; i <= limit; i++) { html += `<div class="picker-item p-2 text-center">${i}</div>`; } html += padding; pickers[unit].innerHTML = html; } }
    function updateDurationInputFromPicker() { const { days, hours, minutes } = selectedTime; durationInput.value = `${days}d ${hours}h ${minutes}m`; }
    function stopAllTimers() { timersState.forEach(t => t.intervalId && clearInterval(t.intervalId)); }
    function startClientSideCountdown() { timersState.forEach(timer => { if (timer.remaining_seconds > 0) { if (!timer.total_seconds) { timer.total_seconds = timer.remaining_seconds; } timer.intervalId = setInterval(() => { timer.remaining_seconds--; updateTimerDisplay(timer); if (timer.remaining_seconds < 0) { clearInterval(timer.intervalId); refreshAllTimers(); } }, 1000); } }); }
    function updateTimerDisplay(timer) { const card = document.getElementById(`timer-${timer.id}`); if (!card) return; const text = card.querySelector('p'); const progress = card.querySelector('div.bg-amber-500'); text.textContent = formatRemaining(timer.remaining_seconds); const percent = Math.max(0, (timer.remaining_seconds / timer.total_seconds) * 100); progress.style.width = `${percent}%`; }
    form.addEventListener('submit', async (e) => { e.preventDefault(); const name = nameInput.value.trim(); const raw = durationInput.value.trim(); if (!name || !raw) return alert("Name and duration required"); submitBtn.disabled = true; submitIcon.classList.add('hidden'); submitSpinner.classList.remove('hidden'); try { const parsed = parseSmartDuration(raw); await apiAddTimer(name, parsed); nameInput.value = ''; durationInput.value = ''; pickerContainer.classList.add('hidden'); clearNameBtn.classList.add('hidden'); await refreshAllTimers(); nameInput.focus(); } finally { submitBtn.disabled = false; submitIcon.classList.remove('hidden'); submitSpinner.classList.add('hidden'); } });
    quickBtns.forEach(btn => { btn.addEventListener('click', () => { nameInput.value = btn.dataset.name; durationInput.value = btn.dataset.duration; clearNameBtn.classList.remove('hidden'); }); });
    togglePickerBtn.addEventListener('click', () => { pickerContainer.classList.toggle('hidden'); });
    nameInput.addEventListener('input', () => { clearNameBtn.classList.toggle('hidden', !nameInput.value); });
    clearNameBtn.addEventListener('click', () => { nameInput.value = ''; nameInput.focus(); clearNameBtn.classList.add('hidden'); });
    durationInput.addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^0-9dhm\s]/gi, ''); });
    for (const unit in pickers) { let scrollTimeout; pickers[unit].addEventListener('scroll', () => { clearTimeout(scrollTimeout); scrollTimeout = setTimeout(() => { const picker = pickers[unit]; const top = picker.getBoundingClientRect().top; const center = top + picker.clientHeight / 2; let closest = null; let minDist = Infinity; Array.from(picker.children).forEach(item => { const itemTop = item.getBoundingClientRect().top; const dist = Math.abs(center - (itemTop + item.offsetHeight / 2)); if (dist < minDist) { minDist = dist; closest = item; } }); if (closest && !closest.classList.contains('selected')) { Array.from(picker.children).forEach(child => child.classList.remove('selected')); closest.classList.add('selected'); selectedTime[unit] = parseInt(closest.textContent); updateDurationInputFromPicker(); } }, 150); }); }

    // --- INITIALIZATION ---
    populatePickers();
    refreshAllTimers();
});
