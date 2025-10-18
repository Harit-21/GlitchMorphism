document.addEventListener('DOMContentLoaded', () => {
    let timersState = [];
    let selectedTimerIds = [];
    let selectedTime = { days: 0, hours: 0, minutes: 0 };
    const apiBase = 'https://glitchmorphism.onrender.com';
    let countdownInterval;
    let currentCategory = 'All';
    let showEndTime = false;
    let savedTemplates = [];

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
        tabsContainer: document.getElementById('tabs-container'),
        templatesContainer: document.getElementById('templates-container'),
        endTimeToggle: document.getElementById('end-time-toggle'),
        categoryInput: document.getElementById('category-input'),
        repeatToggle: document.getElementById('repeat-toggle'),
        saveTemplateToggle: document.getElementById('save-template-toggle'),
        clearFinishedBtn: document.getElementById('clear-finished-btn'),
        bulkActions: document.getElementById('bulk-actions'),
        adjustMinutesInput: document.getElementById('adjust-minutes-input'),
        adjustTimeBtn: document.getElementById('adjust-time-btn'),
        selectionCount: document.getElementById('selection-count'),
        selectAllBtn: document.getElementById('select-all-btn'),
        deselectAllBtn: document.getElementById('deselect-all-btn'),
        uploadInput: document.getElementById('screenshot-upload'),
        uploadStatus: document.getElementById('upload-status'),
        inputSection: document.querySelector('.input-section'),
        pickers: {
            days: document.getElementById('days-picker'),
            hours: document.getElementById('hours-picker'),
            minutes: document.getElementById('minutes-picker')
        }
    };

    // --- API FUNCTIONS (No changes) ---
    async function apiFetchTimers() {
        try {
            const res = await fetch(`${apiBase}/timers`);
            if (!res.ok) return [];
            const timers = await res.json();
            // Add a client-side 'endTime' property for accurate countdowns
            return timers.map(timer => ({
                ...timer,
                endTime: Date.now() + timer.remaining_seconds * 1000
            }));
        } catch (err) {
            console.error("Fetch error:", err);
            return [];
        }
    }
    async function apiAddTimer(name, duration, category, is_repeating) {
        const res = await fetch(`${apiBase}/timers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, duration, category, is_repeating })
        });
        if (!res.ok) {
            alert("Failed to add timer");
            return null;
        }
        return await res.json();
    }
    async function apiDeleteTimer(id) {
        await fetch(`${apiBase}/timers/${id}`, { method: 'DELETE' });
    }
    async function apiClearTimer(id) {
        await fetch(`${apiBase}/timers/${id}/clear`, { method: 'POST' });
    }
    async function apiAdjustTime(timer_ids, minutes) {
        await fetch(`${apiBase}/timers/adjust-time`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timer_ids, minutes })
        });
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

    async function apiFetchTemplates() {
        try {
            const res = await fetch(`${apiBase}/templates`);
            if (!res.ok) return [];
            return await res.json();
        } catch (err) {
            console.error("Failed to fetch templates:", err);
            return [];
        }
    }

    async function apiAddTemplate(name, duration, category) {
        await fetch(`${apiBase}/templates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, duration, category })
        });
    }

    async function apiDeleteTemplate(id) {
        await fetch(`${apiBase}/templates/${id}`, { method: 'DELETE' });
    }

    // --- MAIN REFRESH & RENDER ---

    async function refreshAllTimers() {
        if (countdownInterval) clearInterval(countdownInterval);
        timersState = await apiFetchTimers();
        selectedTimerIds = [];
        renderTabs();
        renderTimers();
        updateBulkActionsUI();
        startCountdown();
    }

    function renderTabs() {
        const categories = ['All', ...new Set(timersState.map(t => t.category))];
        elements.tabsContainer.innerHTML = categories.map(cat =>
            `<button class="tab-btn ${cat === currentCategory ? 'active' : ''}" data-category="${cat}">${cat}</button>`
        ).join('');
    }

    function updateBodyPadding() {
        if (!elements.inputSection) return;
        const inputHeight = elements.inputSection.offsetHeight;
        document.body.style.paddingBottom = `${inputHeight + 20}px`; // Add 20px extra space
    }

    // ✅ NEW: Renders the saved templates
    function renderTemplates() {
        if (savedTemplates.length === 0) {
            elements.templatesContainer.innerHTML = `<div style="color: var(--slate-500); font-size: 0.875rem;">Save timers as templates for quick access.</div>`;
            return;
        }
        elements.templatesContainer.innerHTML = savedTemplates.map((template, index) => `
            <div class="template-card" data-id="${template.id}" data-name="${template.name}" data-duration="${template.duration}" data-category="${template.category || ''}">
                <div>
                    <div style="font-weight: bold;">${template.name} <span style="font-size: 0.8rem; color: var(--slate-400);">(${template.category || 'General'})</span></div>
                    <div style="font-size: 0.8rem; color: var(--slate-400);">${template.duration}</div>
                </div>
                <button class="delete-template-btn">✖</button>
            </div>
        `).join('');
    }

    function renderTimers() {
        if (!elements.timers) return;

        const timersToDisplay = currentCategory === 'All'
            ? timersState
            : timersState.filter(timer => timer.category === currentCategory);

        if (timersToDisplay.length === 0) {
            elements.timers.innerHTML = currentCategory === 'All'
                ? '<div class="empty-state">No active timers. Add one below!</div>'
                : `<div class="empty-state">No timers found in the '${currentCategory}' category.</div>`;
            return;
        }

        elements.timers.innerHTML = timersToDisplay.map(timer => {
            const isDone = timer.remaining_seconds <= 0;
            const isSelected = selectedTimerIds.includes(timer.id);
            const total = timer.total_seconds || 1;
            const percent = isDone ? 0 : Math.max(0, Math.min(100, (timer.remaining_seconds / total) * 100));

            return `
            <div id="timer-${timer.id}" class="timer-card glass-card ${isDone ? 'finished' : ''} ${isSelected ? 'selected' : ''}" data-id="${timer.id}">
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

    function startCountdown() {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = setInterval(() => {
            const now = Date.now();
            let hasFinished = false;
            timersState.forEach(timer => {
                if (timer.remaining_seconds > 0) {
                    const newRemaining = Math.round((timer.endTime - now) / 1000);
                    if (newRemaining !== timer.remaining_seconds) {
                        timer.remaining_seconds = Math.max(0, newRemaining);
                        updateTimerDisplay(timer);
                    }
                }
            });
            if (hasFinished) setTimeout(refreshAllTimers, 1500); // Refresh to fetch the newly created repeating timer
        }, 1000);
    }

    // ✅ NEW: formatDisplayTime handles the toggle logic
    function formatDisplayTime(timer) {
        if (showEndTime && timer.remaining_seconds > 0) {
            const endDate = new Date(timer.endTime);
            const today = new Date();
            const tomorrow = new Date();
            tomorrow.setDate(today.getDate() + 1);
            const timeString = endDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
            if (endDate.toDateString() === today.toDateString()) return `Today at ${timeString}`;
            if (endDate.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${timeString}`;
            return endDate.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ` at ${timeString}`;
        }
        const sec = timer.remaining_seconds;
        if (sec <= 0) return '✅ Finished!';
        const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60;
        return `${d}d ${h}h ${m}m ${s}s`;
    }

    // --- UI & HELPER FUNCTIONS ---
    function formatRemaining(sec) { if (sec <= 0) return '✅ Finished!'; const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return `${d}d ${h}h ${m}m ${s}s`; }

    function parseSmartDuration(str) { const clean = str.trim().toLowerCase(); if (/^\d+$/.test(clean)) return `0d0h${clean}m`; let d = 0, h = 0, m = 0; const r = /(\d+)\s*(d|h|m)/g; let match; while ((match = r.exec(clean))) { if (match[2] === 'd') d = parseInt(match[1]); else if (match[2] === 'h') h = parseInt(match[1]); else if (match[2] === 'm') m = parseInt(match[1]); } return `${d}d${h}h${m}m`; }

    function updateBulkActionsUI() {
        if (selectedTimerIds.length > 0) {
            elements.selectionCount.textContent = `${selectedTimerIds.length} selected`;
            elements.bulkActions.classList.remove('hidden');
        } else {
            elements.bulkActions.classList.add('hidden');
        }
    }

    function updateTimerDisplay(timer) {
        const card = document.getElementById(`timer-${timer.id}`);
        if (!card) return;
        const timeElement = card.querySelector('.timer-time');
        const progressFill = card.querySelector('.progress-fill');

        // Use your existing formatDisplayTime function
        timeElement.textContent = formatDisplayTime(timer);

        const total = timer.total_seconds || 1;
        const percent = Math.max(0, (timer.remaining_seconds / total) * 100);
        progressFill.style.width = `${percent}%`;

        if (timer.remaining_seconds <= 0 && !card.classList.contains('finished')) {
            // Timer has just finished
            card.classList.add('finished');
            timeElement.classList.add('finished');
            card.querySelector('.timer-checkbox').disabled = true;

            if (timer.is_repeating) {
                // If it was a repeating timer, we need to refresh to get the new one from the backend
                setTimeout(refreshAllTimers, 1500);
            }
        }
        updateFavicon();
    }

    function updateFavicon() {
        const link = document.querySelector("link[rel~='icon']") || document.createElement('link');
        const activeTimers = timersState.filter(t => t.remaining_seconds > 0);

        if (!activeTimers.length) {
            link.href = 'data:image/x-icon;,'; // Reset to blank favicon
            return;
        }

        const shortestTimer = activeTimers.sort((a, b) => a.remaining_seconds - b.remaining_seconds)[0];
        const sec = shortestTimer.remaining_seconds;

        let displayText = "!";
        let fontSize = 'bold 38px "JetBrains Mono"';

        if (sec <= 0) {
            displayText = '✅';
        } else if (sec < 3600) {
            displayText = Math.round(sec / 60).toString();
        } else if (sec < 86400) {
            displayText = `${Math.round(sec / 3600)}h`;
            fontSize = 'bold 37px "JetBrains Mono"';
        } else {
            displayText = `${Math.round(sec / 86400)}d`;
            fontSize = 'bold 37px "JetBrains Mono"';
        }

        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#7c3aed';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = 'white';
        ctx.font = fontSize;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, 32, 34);

        link.type = 'image/x-icon';
        link.rel = 'shortcut icon';
        link.href = canvas.toDataURL("image/x-icon");
        if (!link.parentNode) document.head.appendChild(link);
    }

    function toggleSelection(timerId) {
        const timer = timersState.find(t => t.id === timerId);
        if (!timer || timer.remaining_seconds <= 0) return;
        const card = document.getElementById(`timer-${timerId}`);
        const checkbox = card.querySelector('.timer-checkbox');
        const index = selectedTimerIds.indexOf(timerId);
        if (index > -1) {
            selectedTimerIds.splice(index, 1);
            if (card) card.classList.remove('selected');
            if (checkbox) checkbox.checked = false;
        } else {
            selectedTimerIds.push(timerId);
            if (card) card.classList.add('selected');
            if (checkbox) checkbox.checked = true;
        }
        updateBulkActionsUI();
    }

    // --- EVENT LISTENERS ---
    elements.form.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = elements.nameInput.value.trim();
        const rawDuration = elements.durationInput.value.trim();
        const category = elements.categoryInput ? elements.categoryInput.value.trim() : ''; // Safely get category
        const isRepeating = elements.repeatToggle.checked;
        const shouldSaveTemplate = elements.saveTemplateToggle.checked;

        if (!name || !rawDuration) {
            return alert("Name and duration are required.");
        }

        elements.submitBtn.disabled = true;
        elements.submitIcon.style.display = 'none';
        elements.submitSpinner.style.display = 'block';

        try {
            if (shouldSaveTemplate) {
                await apiAddTemplate(name, rawDuration, category);
                savedTemplates = await apiFetchTemplates();
                renderTemplates();
            }

            // --- Perform Action and Get New Timer Data ---
            const newTimer = await apiAddTimer(name, rawDuration, category, isRepeating);

            if (newTimer) {
                // --- Update UI Instantly with Server Data ---
                // Add the new timer to the start of our state array
                timersState.unshift({
                    ...newTimer,
                    endTime: Date.now() + newTimer.remaining_seconds * 1000
                });
                // Re-render the UI with the new timer
                renderTabs();
                renderTimers();
            } else {
                // If something went wrong, fall back to a full refresh
                await refreshAllTimers();
            }

            elements.form.reset();
            elements.pickerContainer.classList.add('hidden');
            elements.clearNameBtn.classList.add('hidden');
            elements.nameInput.focus();

        } catch (error) {
            console.error("Failed to add timer:", error);
            alert("Could not add the timer. Please try again.");
        } finally {
            // --- Hide Loading State ---
            elements.submitBtn.disabled = false;
            elements.submitIcon.style.display = 'block';
            elements.submitSpinner.style.display = 'none';
        }
    });

    elements.tabsContainer.addEventListener('click', e => {
        if (e.target.classList.contains('tab-btn')) {
            currentCategory = e.target.dataset.category;
            renderTabs();
            renderTimers();
        }
    });

    elements.endTimeToggle.addEventListener('change', e => {
        showEndTime = e.target.checked;
        renderTimers();
    });

    elements.templatesContainer.addEventListener('click', async e => {
        const templateCard = e.target.closest('.template-card');
        if (!templateCard) return;
        if (e.target.classList.contains('delete-template-btn')) {
            const templateId = parseInt(templateCard.dataset.id, 10);
            if (confirm("Delete this template?")) {
                await apiDeleteTemplate(templateId);
                savedTemplates = await apiFetchTemplates();
                renderTemplates();
            }
        } else {
            elements.nameInput.value = templateCard.dataset.name;
            elements.durationInput.value = templateCard.dataset.duration;
            elements.categoryInput.value = templateCard.dataset.category || '';
        }
    });

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

    elements.adjustTimeBtn.addEventListener('click', async () => {
        const rawValue = elements.adjustMinutesInput.value.trim();
        if (!/^[+-]?\d+$/.test(rawValue)) {
            alert('Please enter a valid number (e.g., 10, -10, +10)');
            return;
        }
        let minutes = parseInt(rawValue, 10);
        if (isNaN(minutes)) {
            alert('Invalid number format.');
            return;
        }
        if (!rawValue.startsWith('+') && !rawValue.startsWith('-')) {
            minutes = -Math.abs(minutes);
        }
        if (selectedTimerIds.length === 0) return;
        await apiAdjustTime(selectedTimerIds, minutes);
        elements.adjustMinutesInput.value = '';
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
        setTimeout(updateBodyPadding, 50);
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

    async function initializeApp() {
        savedTemplates = await apiFetchTemplates(); // Fetch from DB on load
        renderTemplates();
        populatePickers();
        setupPickerListeners();
        await refreshAllTimers();
        updateBodyPadding();
    }
    initializeApp();
});
