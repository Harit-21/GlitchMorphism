document.addEventListener('DOMContentLoaded', () => {
    let timersState = [];
    let selectedTimerIds = [];
    let selectedTime = { days: 0, hours: 0, minutes: 0 };
    const apiBase = '';
    let countdownInterval;

    const elements = {
        timers: document.getElementById('timers'),
        form: document.getElementById('add-timer-form'),
        nameInput: document.getElementById('name-input'),
        durationInput: document.getElementById('duration-input'),
        togglePickerBtn: document.getElementById('toggle-picker-btn'),
        pickerContainer: document.getElementById('picker-container'),
        clearNameBtn: document.getElementById('clear-name-btn'),
        submitBtn: document.getElementById('submit-btn'),
        submitIcon: document.getElementById('submit-icon'),
        submitSpinner: document.getElementById('submit-spinner'),
        clearFinishedBtn: document.getElementById('clear-finished-btn'),
        bulkActions: document.getElementById('bulk-actions'),
        reduceMinutesInput: document.getElementById('reduce-minutes-input'),
        reduceTimeBtn: document.getElementById('reduce-time-btn'),
        selectionCount: document.getElementById('selection-count'),
        selectAllBtn: document.getElementById('select-all-btn'),
        deselectAllBtn: document.getElementById('deselect-all-btn'),
        uploadInput: document.getElementById('screenshot-upload'),
        uploadStatus: document.getElementById('upload-status'),
        pickers: {
            days: document.getElementById('days-picker'),
            hours: document.getElementById('hours-picker'),
            minutes: document.getElementById('minutes-picker')
        }
    };

    // --- API FUNCTIONS (No changes) ---
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

    // --- MAIN REFRESH & RENDER ---
    async function refreshAllTimers() {
        timersState = await apiFetchTimers();
        updateBulkActionsUI();
        renderTimers();
        startCountdown();
    }

    function renderTimers() {
        if (!elements.timers) return;
        if (timersState.length === 0) {
            elements.timers.innerHTML = '<div class="empty-state">No active timers. Add one below!</div>';
            return;
        }
        elements.timers.innerHTML = timersState.map(timer => {
            const isDone = timer.remaining_seconds <= 0;
            const isSelected = selectedTimerIds.includes(timer.id);
            const total = timer.total_seconds || 1;
            const percent = isDone ? 0 : Math.max(0, Math.min(100, (timer.remaining_seconds / total) * 100));

            return `
                <div class="timer-card glass-card ${isDone ? 'finished' : ''} ${isSelected ? 'selected' : ''}" data-id="${timer.id}">
                    <div class="timer-header">
                        <div class="timer-info">
                            <input type="checkbox" class="timer-checkbox" ${isSelected ? 'checked' : ''} ${isDone ? 'disabled' : ''} data-id="${timer.id}" style="pointer-events: none;"/>
                            <div class="timer-content">
                                <div class="timer-name">${timer.name}</div>
                                <div class="timer-time font-mono ${isDone ? 'finished' : ''}">${formatRemaining(timer.remaining_seconds)}</div>
                            </div>
                        </div>
                        <button class="delete-btn" data-id="${timer.id}">✖</button>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${percent}%"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // --- COUNTDOWN LOGIC ---
    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            let hasChanges = false;
            timersState.forEach(timer => {
                if (timer.remaining_seconds > 0) {
                    timer.remaining_seconds--;
                    hasChanges = true;
                    if (timer.remaining_seconds <= 0) {
                        refreshAllTimers();
                    }
                }
            });
            if (hasChanges) {
                renderTimers();
            }
        }, 1000);
    }

    // --- UI & HELPER FUNCTIONS ---
    function formatRemaining(sec) { if (sec <= 0) return '✅ Finished!'; const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return `${d}d ${h}h ${m}m ${s}s`; }
    function parseSmartDuration(str) { const clean = str.trim().toLowerCase(); if (/^\d+$/.test(clean)) return `0d0h${clean}m`; let d=0, h=0, m=0; const r = /(\d+)\s*(d|h|m)/g; let match; while((match=r.exec(clean))){ if(match[2]==='d')d=parseInt(match[1]); else if(match[2]==='h')h=parseInt(match[1]); else if(match[2]==='m')m=parseInt(match[1]); } return `${d}d${h}h${m}m`; }
    function updateBulkActionsUI() {
        if (selectedTimerIds.length > 0) {
            elements.selectionCount.textContent = `${selectedTimerIds.length} selected`;
            elements.bulkActions.classList.remove('hidden');
        } else {
            elements.bulkActions.classList.add('hidden');
        }
    }
    
    // ✅ ADDED: A dedicated function to handle selection logic
    function toggleSelection(timerId) {
        const timer = timersState.find(t => t.id === timerId);
        if (!timer || timer.remaining_seconds <= 0) {
            return; // Can't select finished timers
        }
        
        const index = selectedTimerIds.indexOf(timerId);
        if (index > -1) {
            selectedTimerIds.splice(index, 1); // Deselect
        } else {
            selectedTimerIds.push(timerId); // Select
        }

        updateBulkActionsUI();
        renderTimers();
    }


    // --- EVENT LISTENERS ---
    elements.form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = elements.nameInput.value.trim();
        const raw = elements.durationInput.value.trim();
        if (!name || !raw) return alert("Name and duration required");
        
        elements.submitBtn.disabled = true;
        elements.submitIcon.style.display = 'none';
        elements.submitSpinner.style.display = 'block';

        try {
            const parsed = parseSmartDuration(raw);
            await apiAddTimer(name, parsed);
            elements.nameInput.value = '';
            elements.durationInput.value = '';
            elements.pickerContainer.classList.add('hidden');
            elements.clearNameBtn.classList.add('hidden');
            selectedTimerIds = [];
            await refreshAllTimers();
            elements.nameInput.focus();
        } finally {
            elements.submitBtn.disabled = false;
            elements.submitIcon.style.display = 'block';
            elements.submitSpinner.style.display = 'none';
        }
    });

    // ✅ FIXED: This listener is now simpler and handles clicks anywhere on the card
    elements.timers.addEventListener('click', async e => {
        const card = e.target.closest('.timer-card');
        if (!card) return;

        const timerId = parseInt(card.dataset.id, 10);
        
        // If delete button is clicked, handle deletion
        if (e.target.closest('.delete-btn')) {
            const timer = timersState.find(t => t.id === timerId);
            if (timer && timer.remaining_seconds > 0) {
                if (confirm(`Are you sure you want to delete the active timer "${timer.name}"?`)) {
                    await apiDeleteTimer(timerId);
                    await refreshAllTimers();
                }
            } else if (timer) {
                await apiClearTimer(timerId);
                await refreshAllTimers();
            }
        } else {
            // For any other click on the card, toggle its selection
            toggleSelection(timerId);
        }
    });

    elements.clearFinishedBtn.addEventListener('click', async () => {
        const finished = timersState.filter(t => t.remaining_seconds <= 0);
        if (finished.length === 0) return;
        if (confirm(`Clear ${finished.length} finished timer(s)?`)) {
            await Promise.all(finished.map(t => apiClearTimer(t.id)));
            selectedTimerIds = [];
            await refreshAllTimers();
        }
    });

    elements.reduceTimeBtn.addEventListener('click', async () => {
        const minutes = parseInt(elements.reduceMinutesInput.value);
        if (isNaN(minutes) || minutes <= 0) return alert('Enter valid minutes');
        if (selectedTimerIds.length === 0) return;
        await apiReduceTime(selectedTimerIds, minutes);
        elements.reduceMinutesInput.value = '';
        selectedTimerIds = [];
        await refreshAllTimers();
    });
    
    function selectAll() {
        const activeTimers = timersState.filter(t => t.remaining_seconds > 0);
        selectedTimerIds = activeTimers.map(t => t.id);
        updateBulkActionsUI();
        renderTimers();
    }

    elements.selectAllBtn.addEventListener('click', selectAll);

    elements.deselectAllBtn.addEventListener('click', () => {
        selectedTimerIds = [];
        updateBulkActionsUI();
        renderTimers();
    });

    elements.uploadInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        elements.uploadStatus.classList.remove('hidden');
        elements.uploadStatus.textContent = 'Processing screenshot...';
        try {
            await apiUploadScreenshot(file);
            elements.uploadStatus.textContent = 'Success! Refreshing timers...';
            await refreshAllTimers();
        } catch (error) {
            elements.uploadStatus.textContent = error.message;
        } finally {
            setTimeout(() => { elements.uploadStatus.classList.add('hidden'); }, 4000);
            e.target.value = '';
        }
    });
    
    document.querySelectorAll('.quick-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            elements.nameInput.value = btn.dataset.name;
            elements.durationInput.value = btn.dataset.duration;
            elements.clearNameBtn.classList.remove('hidden');
        });
    });

    elements.togglePickerBtn.addEventListener('click', () => {
        elements.pickerContainer.classList.toggle('hidden');
    });

    elements.nameInput.addEventListener('input', () => {
        elements.clearNameBtn.classList.toggle('hidden', !elements.nameInput.value);
    });

    elements.clearNameBtn.addEventListener('click', () => {
        elements.nameInput.value = '';
        elements.nameInput.focus();
        elements.clearNameBtn.classList.add('hidden');
    });

    // --- Picker Logic ---
    function populatePickers() {
        const padding = '<div style="height: 3rem;"></div>';
        for (const unit in elements.pickers) {
            const limit = unit === 'days' ? 30 : unit === 'hours' ? 23 : 59;
            let html = padding;
            for (let i = 0; i <= limit; i++) { html += `<div class="picker-item">${i}</div>`; }
            html += padding;
            elements.pickers[unit].innerHTML = html;
        }
    }

    function setupPickerListeners() {
        for (const unit in elements.pickers) {
            let scrollTimeout;
            elements.pickers[unit].addEventListener('scroll', () => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    const picker = elements.pickers[unit];
                    const rect = picker.getBoundingClientRect();
                    const center = rect.top + rect.height / 2;
                    let closest = null;
                    let minDist = Infinity;
                    Array.from(picker.children).forEach(item => {
                        const itemRect = item.getBoundingClientRect();
                        const dist = Math.abs(center - (itemRect.top + itemRect.height / 2));
                        if (dist < minDist) { minDist = dist; closest = item; }
                    });
                    if (closest) {
                        Array.from(picker.children).forEach(c => c.classList.remove('selected'));
                        closest.classList.add('selected');
                        selectedTime[unit] = parseInt(closest.textContent);
                        elements.durationInput.value = `${selectedTime.days}d ${selectedTime.hours}h ${selectedTime.minutes}m`;
                    }
                }, 150);
            });
        }
    }
    
    // --- INITIALIZATION ---
    populatePickers();
    setupPickerListeners();
    refreshAllTimers();
});
