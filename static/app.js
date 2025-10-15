document.addEventListener('DOMContentLoaded', () => {
    // --- STATE ---
    let timersState = [];
    let selectedTime = { days: 0, hours: 0, minutes: 0 };
    const apiBase = '';

    // --- DOM ELEMENTS ---
    const timersContainer = document.getElementById('timers');
    const form = document.getElementById('add-timer-form');
    const nameInput = document.getElementById('name-input');
    const durationInput = document.getElementById('duration-input');
    const clearFinishedBtn = document.getElementById('clear-finished-btn');
    const togglePickerBtn = document.getElementById('toggle-picker-btn');
    const pickerContainer = document.getElementById('picker-container');
    const clearNameBtn = document.getElementById('clear-name-btn');
    const submitBtn = document.getElementById('submit-btn');
    const submitIcon = document.getElementById('submit-icon');
    const submitSpinner = document.getElementById('submit-spinner');
    const pickers = {
        days: document.getElementById('days-picker'),
        hours: document.getElementById('hours-picker'),
        minutes: document.getElementById('minutes-picker')
    };

    // --- API FUNCTIONS ---
    async function apiFetchTimers() {
        try {
            const res = await fetch(`${apiBase}/timers`);
            return res.ok ? await res.json() : [];
        } catch (error) {
            console.error("Failed to fetch timers:", error);
            return [];
        }
    }

    async function apiAddTimer(name, duration) {
        const res = await fetch(`${apiBase}/timers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, duration }),
        });
        if (!res.ok) alert('Failed to add timer');
    }

    async function apiDeleteTimer(id) {
        await fetch(`${apiBase}/timers/${id}`, { method: 'DELETE' });
    }

    // --- UI & UTILITY FUNCTIONS ---
    function formatRemaining(sec) {
        if (sec <= 0) return '✅ Finished!';
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        return `${d}d ${h}h ${m}m ${s}s`;
    }

    function populatePickers() {
        for (let i = 0; i <= 30; i++) pickers.days.innerHTML += `<div class="picker-item p-1 cursor-pointer rounded">${i}</div>`;
        for (let i = 0; i < 24; i++) pickers.hours.innerHTML += `<div class="picker-item p-1 cursor-pointer rounded">${i}</div>`;
        for (let i = 0; i < 60; i++) pickers.minutes.innerHTML += `<div class="picker-item p-1 cursor-pointer rounded">${i}</div>`;
    }

    function updatePickerSelection() {
        for (const unit in pickers) {
            Array.from(pickers[unit].children).forEach(child => {
                child.classList.remove('selected');
                if (parseInt(child.textContent) === selectedTime[unit]) {
                    child.classList.add('selected');
                    child.scrollIntoView({ block: 'center', behavior: 'smooth' });
                }
            });
        }
    }

    function updateDurationInputFromPicker() {
        const { days, hours, minutes } = selectedTime;
        durationInput.value = `${days} ${hours} ${minutes}`;
    }

    function parseSmartDuration(durationString) {
        const durationParts = durationString.trim().split(/\s+/);
        if (durationParts.some(part => /[a-zA-Z]/.test(part))) {
            return durationParts.join('');
        }
        let d = 0, h = 0, m = 0;
        const nums = durationParts.map(p => parseInt(p)).filter(n => !isNaN(n));
        if (nums.length === 1) m = nums[0];
        else if (nums.length === 2) { h = nums[0]; m = nums[1]; }
        else if (nums.length >= 3) { d = nums[0]; h = nums[1]; m = nums[2]; }
        return `${d}d${h}h${m}m`;
    }

    // --- CORE LOGIC ---
    function stopAllTimers() {
        timersState.forEach(t => {
            if (t.intervalId) clearInterval(t.intervalId);
        });
    }

    function renderTimers() {
        timersContainer.innerHTML = '';
        if (timersState.length === 0) {
            timersContainer.innerHTML = '<p class="text-center text-gray-400 text-lg mt-10 col-span-full">No active timers.</p>';
            return;
        }
        timersState.forEach(timer => {
            const isDone = timer.remaining_seconds <= 0;
            const cardClass = isDone ? 'timer-card finished' : 'timer-card';
            const textColor = isDone ? 'text-emerald-300' : 'text-slate-300';

            const div = document.createElement('div');
            div.id = `timer-${timer.id}`;
            div.className = `${cardClass} glass-card p-5 rounded-lg shadow-lg flex justify-between items-start transition-all duration-300 ease-in-out`;

            div.innerHTML = `
                <div>
                    <h2 class="font-bold text-xl mb-1 select-text">${timer.name}</h2>
                    <p class="font-mono ${textColor} text-sm select-text">${formatRemaining(timer.remaining_seconds)}</p>
                </div>
                <button data-id="${timer.id}" class="delete-btn text-slate-500 font-bold hover:text-red-400 transition select-none" title="Delete timer">✖</button>
            `;
            timersContainer.appendChild(div);
        });
    }

    function startClientSideCountdown() {
        timersState.forEach(timer => {
            if (timer.remaining_seconds > 0) {
                timer.intervalId = setInterval(() => {
                    timer.remaining_seconds--;
                    updateTimerDisplay(timer);
                    if (timer.remaining_seconds <= 0) {
                        clearInterval(timer.intervalId);
                        refreshAllTimers(); // Refresh to get the final "Finished" state
                    }
                }, 1000);
            }
        });
    }

    function updateTimerDisplay(timer) {
        const timerCard = document.getElementById(`timer-${timer.id}`);
        if (!timerCard) return;
        const p = timerCard.querySelector('p');
        p.textContent = formatRemaining(timer.remaining_seconds);
    }

    async function refreshAllTimers() {
        stopAllTimers();
        timersState = await apiFetchTimers();
        renderTimers();
        startClientSideCountdown();
    }

    // --- EVENT HANDLERS ---
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nameInput.value.trim();
        const durationRaw = durationInput.value.trim();
        if (!name || !durationRaw) {
            alert("Please provide both a task name and a duration.");
            return;
        }

        // Disable button and show spinner
        submitBtn.disabled = true;
        submitIcon.classList.add('hidden');
        submitSpinner.classList.remove('hidden');

        try {
            const finalDuration = parseSmartDuration(durationRaw);
            await apiAddTimer(name, finalDuration);

            // Clear inputs and refresh the list
            nameInput.value = '';
            durationInput.value = '';
            await refreshAllTimers();
            nameInput.focus();
            clearNameBtn.classList.add('hidden');
        } finally {
            // Re-enable button and hide spinner, even if an error occurred
            submitBtn.disabled = false;
            submitIcon.classList.remove('hidden');
            submitSpinner.classList.add('hidden');
        }
    });

    timersContainer.addEventListener('click', async e => {
        if (e.target.classList.contains('delete-btn')) {
            const timerId = e.target.dataset.id;
            await apiDeleteTimer(timerId);
            await refreshAllTimers();
        }
    });

    clearFinishedBtn.addEventListener('click', async () => {
        const finishedTimers = timersState.filter(t => t.remaining_seconds <= 0);
        if (finishedTimers.length === 0) return;
        if (confirm(`Are you sure you want to clear ${finishedTimers.length} finished timer(s)?`)) {
            await Promise.all(finishedTimers.map(t => apiDeleteTimer(t.id)));
            await refreshAllTimers();
        }
    });

    togglePickerBtn.addEventListener('click', () => pickerContainer.classList.toggle('hidden'));

    nameInput.addEventListener('input', () => clearNameBtn.classList.toggle('hidden', !nameInput.value));

    clearNameBtn.addEventListener('click', () => {
        nameInput.value = '';
        nameInput.focus();
        clearNameBtn.classList.add('hidden');
    });

    durationInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9dhm\s]/gi, '');
    });

    pickerContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('picker-item')) {
            const value = parseInt(e.target.textContent);
            const parentId = e.target.parentElement.id;
            if (parentId.includes('days')) selectedTime.days = value;
            if (parentId.includes('hours')) selectedTime.hours = value;
            if (parentId.includes('minutes')) selectedTime.minutes = value;
            updatePickerSelection();
            updateDurationInputFromPicker();
        }
    });

    // --- INITIALIZATION ---
    populatePickers();
    updatePickerSelection();
    refreshAllTimers();
});
