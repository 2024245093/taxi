let socket = null;
let myUsername = '';

const listEl    = document.getElementById('sg-list');
const loadingEl = document.getElementById('sg-loading');
const inputEl   = document.getElementById('sg-input');

inputEl.addEventListener('input', autoResize);

async function init() {
    try {
        const meRes = await fetch('/api/me');
        if (meRes.status === 401) { location.href = 'login.html'; return; }
        if (!meRes.ok) { loadingEl.textContent = '서버 오류'; return; }
        const me = await meRes.json();
        myUsername = me.username;

        await loadSuggestions();

        socket = io();
        socket.emit('join-suggestions');
        socket.on('new-suggestion', (row) => {
            const empty = document.querySelector('.sg-empty');
            if (empty) empty.remove();
            prependCard(row, true);
        });

        setInterval(loadSuggestions, 30000);
    } catch (e) {
        console.error('init error:', e);
        loadingEl.textContent = '서버 연결 오류';
    }
}

async function loadSuggestions() {
    try {
        const res = await fetch('/api/suggestions');
        if (res.status === 401) { location.href = 'login.html'; return; }
        if (!res.ok) { loadingEl.textContent = '불러오기 실패'; return; }
        const rows = await res.json();

        listEl.innerHTML = '';
        if (rows.length === 0) {
            listEl.innerHTML = '<div class="sg-empty">아직 건의사항이 없습니다.</div>';
        } else {
            rows.forEach(s => prependCard(s, false));
        }
    } catch (e) {
        console.error('loadSuggestions error:', e);
    }
}

function prependCard(s, animate) {
    const card = document.createElement('div');
    card.className = 'sg-card' + (animate ? ' sg-new' : '');
    card.id = `card-${s.id}`;
    card.innerHTML = `
        <div class="sg-card-header">
            <span class="sg-username">${escHtml(s.username)}</span>
            <span class="sg-date">${formatDate(s.created_at)}</span>
        </div>
        <div class="sg-text">${escHtml(s.suggestion)}</div>
        ${s.answer ? `
        <div class="sg-answer">
            <span class="answer-label">💬 답변</span>
            <div class="answer-text">${escHtml(s.answer)}</div>
        </div>` : ''}
    `;
    listEl.appendChild(card);
}

async function submitSuggestion() {
    const content = inputEl.value.trim();
    if (!content) return;
    try {
        const res = await fetch('/api/suggestions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ suggestion: content })
        });
        if (!res.ok) { const d = await res.json(); alert(d.error); return; }
        inputEl.value = '';
        inputEl.style.height = 'auto';
        inputEl.focus();
    } catch (e) {
        alert('서버 연결 오류');
    }
}

function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }) + ' ' +
           d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#039;')
        .replace(/\n/g,'<br>');
}

init();
