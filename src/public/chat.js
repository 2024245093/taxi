const params  = new URLSearchParams(location.search);
const roomKey = params.get('room');

let myUsername = '';
let socket     = null;
let peopleVisible = false;
let roomData   = null;

const messagesEl = document.getElementById('chat-messages');
const loadingEl  = document.getElementById('chat-loading');
const inputEl    = document.getElementById('msg-input');
inputEl.addEventListener('input', autoResize);
const peoplePanelEl = document.getElementById('people-panel');
const peopleListEl = document.getElementById('people-list');

if (!roomKey) {
    alert('잘못된 접근입니다.');
    location.href = 'index.html';
}

async function init() {
    try {
        const res  = await fetch(`/api/rooms/${roomKey}/verify`);
        if (res.status === 401) { location.href = 'login.html'; return; }
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || '접근 권한이 없습니다.');
            location.href = 'index.html';
            return;
        }
        const data = await res.json();
        myUsername = data.username;

        const r = data.room;
        roomData = r;
        const timeRaw = roomKey.split('-').at(-2);
        const timeStr = timeRaw.slice(0, 2) + ':' + timeRaw.slice(2);
        document.getElementById('room-info').textContent = `${r.date} · ${r.purpose === '출타' ? '출타' : '복귀'} · ${r.station} · ${timeStr}`;

        await loadHistory();
        await loadPeople();
        await loadChatEarlyParty();
        await checkSurveyStatus();
        connectSocket();
    } catch (e) {
        console.error(e);
        alert('서버 연결 오류가 발생했습니다.');
        location.href = 'index.html';
    }
}

async function loadHistory() {
    const res  = await fetch(`/api/rooms/${roomKey}/messages`);
    if (!res.ok) return;
    const msgs = await res.json();
    loadingEl.style.display = 'none';
    if (msgs.length === 0) {
        const empty = document.createElement('div');
        empty.className   = 'chat-empty';
        empty.textContent = '아직 메시지가 없습니다. 첫 메시지를 보내보세요!';
        messagesEl.appendChild(empty);
    } else {
        msgs.forEach(m => appendMessage(m.username, m.content, m.created_at, false));
    }
    scrollBottom();
}

async function loadPeople() {
    const res = await fetch(`/api/rooms/${roomKey}/people`);
    if (!res.ok) return;
    const people = await res.json();
    peopleListEl.innerHTML = '';
    people.forEach(person => {
        const row = document.createElement('div');
        row.className = 'person-row';
        row.innerHTML = `<span class="person-id">${escHtml(person.username)}</span><span class="person-phone">${escHtml(person.phone)}</span>`;
        peopleListEl.appendChild(row);
    });
}

function togglePeoplePanel() {
    peopleVisible = !peopleVisible;
    peoplePanelEl.style.display = peopleVisible ? 'block' : 'none';
}

async function loadChatEarlyParty() {
    if (!roomData) return;
    try {
        const p = new URLSearchParams({
            date: roomData.date,
            purpose: roomData.purpose,
            station: roomData.station,
            time: roomData.time
        });
        const r = await fetch('/api/early-party-status?' + p);
        if (!r.ok) return;
        const { total, voted, myVote } = await r.json();
        updateChatEarlyBtn(total, voted, myVote);
    } catch (e) {
        console.error('chat early-party-status 실패', e);
    }
}

function updateChatEarlyBtn(total, voted, myVote) {
    const bar    = document.getElementById('early-party-bar');
    const btn    = document.getElementById('chat-early-btn');
    const countEl = document.getElementById('chat-early-count');
    if (!bar || !btn || !countEl) return;
    if (total >= 2) {
        bar.style.display = 'block';
        btn.classList.toggle('voted', myVote);
        countEl.textContent = `찬성 ${voted} / ${total}명`;
    } else {
        bar.style.display = 'none';
    }
}

async function chatToggleEarlyVote() {
    if (!roomData) return;
    const { date, purpose, station, time } = roomData;
    try {
        const r = await fetch('/api/early-party-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, purpose, station, time })
        });
        const data = await r.json();
        if (!r.ok) { alert(data.error || '오류 발생'); return; }
        if (data.completed) {
            document.getElementById('early-party-bar').style.display = 'none';
            alert(`🎉 파티 완성! ${data.count}명으로 파티가 구성되었습니다.`);
        } else {
            updateChatEarlyBtn(data.total, data.voted, data.myVote);
        }
    } catch (e) {
        alert('서버 연결 오류가 발생했습니다.');
    }
}

let surveyChoice = null;

async function checkSurveyStatus() {
    try {
        const r = await fetch(`/api/satisfaction/check?room_key=${encodeURIComponent(roomKey)}`);
        if (!r.ok) return;
        const { submitted } = await r.json();
        if (submitted) {
            const bar = document.getElementById('survey-bar');
            if (bar) bar.style.display = 'none';
        }
    } catch (e) {
        console.error('survey check 오류:', e);
    }
}

function selectSurvey(satisfied) {
    surveyChoice = satisfied;
    const reasonWrap = document.getElementById('survey-reason-wrap');
    const btnO = document.querySelector('.survey-o');
    const btnX = document.querySelector('.survey-x');
    btnO.classList.toggle('selected-o', satisfied);
    btnX.classList.toggle('selected-x', !satisfied);
    if (satisfied) {
        reasonWrap.style.display = 'none';
        submitSurvey();
    } else {
        reasonWrap.style.display = 'flex';
        document.getElementById('survey-reason').focus();
    }
}

async function submitSurvey() {
    if (surveyChoice === null) return;
    const reason = surveyChoice ? null : (document.getElementById('survey-reason')?.value.trim() || null);
    try {
        await fetch('/api/satisfaction', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ room_key: roomKey, success: surveyChoice, reason })
        });
    } catch (e) {
        console.error('satisfaction 제출 오류:', e);
    }
    const bar = document.getElementById('survey-bar');
    if (bar) {
        bar.innerHTML = '<p class="survey-done">✅ 응답해주셔서 감사합니다!</p>';
        setTimeout(() => { bar.style.display = 'none'; }, 2000);
    }
}

function connectSocket() {
    socket = io();
    socket.on('connect', () => socket.emit('join-room', roomKey));
    socket.on('error',   (msg) => { alert(msg); location.href = 'index.html'; });
    socket.on('new-message', (msg) => {
        const empty = messagesEl.querySelector('.chat-empty');
        if (empty) empty.remove();
        appendMessage(msg.username, msg.content, msg.created_at, true);
        scrollBottom();
    });
}

function appendMessage(username, content, createdAt, animate) {
    const isMe  = username === myUsername;
    const wrap  = document.createElement('div');
    wrap.className = 'msg-wrap ' + (isMe ? 'msg-me' : 'msg-other');
    if (animate) wrap.classList.add('msg-new');
    const time = new Date(createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

    if (isMe) {
        wrap.innerHTML = `<div class="msg-time">${time}</div><div class="msg-bubble msg-bubble-me">${escHtml(content)}</div>`;
    } else {
        wrap.innerHTML = `<div class="msg-username">${escHtml(username)}</div><div class="msg-row"><div class="msg-bubble msg-bubble-other">${escHtml(content)}</div><div class="msg-time">${time}</div></div>`;
    }
    messagesEl.appendChild(wrap);
}

function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
}

function sendMessage() {
    const content = inputEl.value.trim();
    if (!content || !socket) return;
    socket.emit('send-message', content);
    inputEl.value = '';
    inputEl.style.height = 'auto';
    inputEl.focus();
}

function scrollBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function escHtml(str) {
    return str
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;')
        .replace(/\n/g,'<br>');
}

init();
