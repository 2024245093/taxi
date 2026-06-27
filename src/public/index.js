const calendarEl = document.getElementById("calendar");
const titleEl = document.getElementById("monthTitle");

const _PURPOSE_MAP = { '출타': 'out', '복귀': 'back' };
const _STATION_MAP = { '용문역': 'yongmun', '여주역': 'yeoju', '양평역': 'yangpyeong', '여주터미널': 'yeojuterminal' }; //#키 값에 - 넣으면 안됨
function getRoomKey(date, purpose, station, time) {
    const p = _PURPOSE_MAP[purpose] || purpose;
    const s = _STATION_MAP[station] || station;
    const t = time.replace(':', '');
    return `${date}-${p}-${s}-${t}-1`;
}

let today = new Date();
let currentYear = today.getFullYear();
let currentMonth = today.getMonth();
let year = currentYear;
let month = currentMonth;

let reservations = {};
let selectedDate = null;
let selectedPurpose = null;
let selectedStation = null;
let daily_res_counts = {};
let partyQueue = [];
let currentParty = null;
let activeFilter = {
    purpose: '',
    station: '',
    time: ''
};
let step0ResData = null;
localStorage.removeItem('notifiedPartyKeys');

function renderCalendar() {
    calendarEl.innerHTML = "";
    titleEl.innerText = `${year}년 ${month + 1}월`;
    const headerRow = document.createElement("tr");
    ["월", "화", "수", "목", "금", "토", "일"].forEach(d => {
        const th = document.createElement("th");
        th.textContent = d;
        headerRow.appendChild(th);
    });
    calendarEl.appendChild(headerRow);
    const rawFirst = new Date(year, month, 1).getDay();
    const firstDay = (rawFirst + 6) % 7;
    const lastDate = new Date(year, month + 1, 0).getDate();
    let row = document.createElement("tr");
    for (let i = 0; i < firstDay; i++) {
        const empty = document.createElement("td");
        empty.classList.add("empty-cell");
        row.appendChild(empty);
    }
    for (let day = 1; day <= lastDate; day++) {
        const dateKey = `${year}-${month + 1}-${day}`;
        const cell = document.createElement("td");
        const res = reservations[dateKey];
        const count = daily_res_counts[dateKey] || 0;
        if (res) {
            if (res.party_agreed) {
                cell.classList.add("party-cell");
                cell.innerHTML = `<span class="cell-day">${day}</span><span class="cell-reserved cell-party-badge">파티</span>`;
            } else {
                cell.classList.add("reserved-cell");
                cell.innerHTML = `<span class="cell-day">${day}</span><span class="cell-count">${count}명</span><span class="cell-reserved">예약</span>`;
            }
        } else {
            cell.innerHTML = `<span class="cell-day">${day}</span><span class="cell-count">${count}명</span>`;
        }
        cell.addEventListener("click", () => handleDateClick(dateKey));
        row.appendChild(cell);
        if ((firstDay + day) % 7 === 0) {
            calendarEl.appendChild(row);
            row = document.createElement("tr");
        }
    }
    calendarEl.appendChild(row);
}

async function loadReservationCounts() {
    const params = new URLSearchParams();
    if (activeFilter.purpose) params.set('purpose', activeFilter.purpose);
    if (activeFilter.station) params.set('station', activeFilter.station);
    if (activeFilter.time) params.set('time', activeFilter.time);
    const qs = params.toString();
    const res = await fetch('/api/reservations/count' + (qs ? '?' + qs : ''));
    if (!res.ok) return;
    const data = await res.json();
    daily_res_counts = {};
    data.forEach(item => daily_res_counts[item.date] = parseInt(item.count));
}

function searchReservations() {
    activeFilter = {
        purpose: document.getElementById('filter-purpose').value,
        station: document.getElementById('filter-station').value,
        time: document.getElementById('filter-time').value
    };
    refreshCalendar();
}

function populateTimeSelect() {
    const sel = document.getElementById('filter-time');
    const allTimes = [...generateTimes("출타"), ...generateTimes("복귀")];
    allTimes.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = t;
        sel.appendChild(opt);
    });
}
async function refreshCalendar() {
    await loadReservationCounts();
    renderCalendar();
}

function prevMonth() {
    if (year === currentYear && month === currentMonth) {
        alert("이전 달로 이동할 수 없습니다.");
        return;
    }
    if (--month < 0) {
        month = 11;
        year--;
    }
    refreshCalendar();
}

function nextMonth() {
    if (++month > 11) {
        month = 0;
        year++;
    }
    refreshCalendar();
}

function handleDateClick(dateKey) {
    const res = reservations[dateKey];
    if (res) showReservationInfo(dateKey, res);
    else {
        selectedDate = dateKey;
        selectedPurpose = null;
        selectedStation = null;
        goStep(1);
        document.getElementById("popup-overlay").style.display = "flex";
    }
}

function goStep(n) {
    [0, 1, 2, 3].forEach(i => document.getElementById("step" + i).style.display = i === n ? "block" : "none");
}

function closePopup() {
    document.getElementById("popup-overlay").style.display = "none";
}

function onOverlayClick(e) {
    if (e.target === document.getElementById("popup-overlay")) closePopup();
}

async function showReservationInfo(dateKey, res) {
    const [y, m, d] = dateKey.split("-");
    document.getElementById("step0-date").textContent = `${y}년 ${m}월 ${d}일`;
    document.getElementById("step0-badge").textContent = res.purpose;
    document.getElementById("step0-badge").className = "purpose-badge " + (res.purpose === "출타" ? "badge-out" : "badge-in");
    document.getElementById("delete-btn").onclick = function() { deleteReservation(dateKey); };
    const route = res.purpose === "출타" ? `부대 → ${res.station}` : `${res.station} → 부대`;
    document.getElementById("step0-detail").textContent = `${route}  ·  ${res.time} 출발`;
    step0ResData = { date: dateKey, purpose: res.purpose, station: res.station, time: res.time };

    const chatBtn     = document.getElementById("chat-enter-btn");
    const delBtn      = document.getElementById("delete-btn");
    const earlyBtn    = document.getElementById("early-party-btn");
    const dissolveBtn = document.getElementById("dissolve-btn");

    if (chatBtn)     chatBtn.style.display     = 'block';
    if (delBtn)      delBtn.style.display      = res.party_agreed ? 'none' : 'block';
    if (earlyBtn)    earlyBtn.style.display    = 'none';
    if (dissolveBtn) dissolveBtn.style.display = 'none';

    goStep(0);
    document.getElementById("popup-overlay").style.display = "flex";

    if (res.party_agreed) {
        const roomKey = getRoomKey(dateKey, res.purpose, res.station, res.time);
        await loadDissolveStatus(roomKey);
    } else if (earlyBtn) {
        await loadEarlyPartyStatus(res);
    }
}

async function loadDissolveStatus(roomKey) {
    try {
        const r = await fetch(`/api/rooms/${roomKey}/dissolve-status`);
        if (!r.ok) return;
        const { total, voted, myVote } = await r.json();
        updateDissolveBtn(roomKey, total, voted, myVote);
    } catch (e) {
        console.error('dissolve-status 실패', e);
    }
}

function updateDissolveBtn(roomKey, total, voted, myVote) {
    const btn = document.getElementById("dissolve-btn");
    const countEl = document.getElementById("dissolve-count");
    if (!btn) return;
    btn.style.display = 'flex';
    btn.dataset.roomKey = roomKey;
    btn.classList.toggle('voted', myVote);
    if (countEl) countEl.textContent = `찬성 ${voted} / ${total}명`;
}

async function toggleDissolveVote() {
    const btn = document.getElementById("dissolve-btn");
    if (!btn || !step0ResData) return;
    const roomKey = btn.dataset.roomKey;
    if (!roomKey) return;
    try {
        const r = await fetch(`/api/rooms/${roomKey}/dissolve-vote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await r.json();
        if (!r.ok) { alert(data.error || '오류 발생'); return; }
        if (data.dissolved) {
            const date = step0ResData.date;
            if (reservations[date]) reservations[date].party_agreed = false;
            await refreshCalendar();
            closePopup();
            alert(`파티가 해산되었습니다. (${data.count}명)`);
        } else {
            updateDissolveBtn(roomKey, data.total, data.voted, data.myVote);
        }
    } catch (e) {
        console.error('dissolve-vote 오류:', e);
        alert('서버 연결 오류가 발생했습니다.');
    }
}

async function loadEarlyPartyStatus(res) {
    try {
        const params = new URLSearchParams({
            date: step0ResData.date,
            purpose: res.purpose,
            station: res.station,
            time: res.time
        });
        const r = await fetch('/api/early-party-status?' + params);
        if (!r.ok) return;
        const { total, voted, myVote } = await r.json();
        updateEarlyPartyBtn(total, voted, myVote);
    } catch (e) {
        console.error('early-party-status 실패', e);
    }
}

function updateEarlyPartyBtn(total, voted, myVote) {
    const btn = document.getElementById("early-party-btn");
    const countEl = document.getElementById("early-party-count");
    if (!btn) { console.warn('[early-party-btn] 요소를 찾을 수 없음'); return; }
    if (total >= 2) {
        btn.style.display = 'flex';
        btn.classList.toggle('voted', myVote);
        if (countEl) countEl.textContent = `찬성 ${voted} / ${total}명`;
    } else {
        btn.style.display = 'none';
    }
}

async function toggleEarlyVote() {
    if (!step0ResData) return;
    const { date, purpose, station, time } = step0ResData;
    try {
        const r = await fetch('/api/early-party-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date, purpose, station, time })
        });
        let data;
        try {
            data = await r.json();
        } catch (jsonErr) {
            console.error('[early-toggle] JSON 파싱 실패 status=' + r.status, jsonErr);
            alert('서버 응답 오류 (status ' + r.status + ')');
            return;
        }
        if (!r.ok) { alert(data.error || '오류 발생'); return; }

        if (data.completed) {
            if (reservations[date]) reservations[date].party_agreed = true;
            await refreshCalendar();
            closePopup();
            alert(`🎉 파티 완성! ${data.count}명으로 파티가 구성되었습니다.`);
        } else {
            updateEarlyPartyBtn(data.total, data.voted, data.myVote);
        }
    } catch (e) {
        console.error('[early-toggle] 오류:', e);
        alert('서버 연결 오류가 발생했습니다.\n(콘솔에서 상세 오류 확인 가능)');
    }
}
async function enterRoom() {
    if (!step0ResData) return;
    const {
        date,
        purpose,
        station,
        time
    } = step0ResData;
    try {
        const res = await fetch('/api/rooms/enter', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                date,
                purpose,
                station,
                time
            })
        });
        const data = await res.json();
        if (!res.ok) {
            alert(data.error || '대화방 입장 실패');
            return;
        }
        location.href = `chat.html?room=${encodeURIComponent(data.room_key)}`;
    } catch (e) {
        alert('서버 연결 오류가 발생했습니다.');
    }
}
async function deleteReservation(dateKey) {
    if (!confirm("예약을 삭제하시겠습니까?")) return;
    const res = await fetch('/api/reservations', {
        method: 'DELETE',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            date: dateKey
        })
    });
    const data = await res.json();
    if (data.success) {
        delete reservations[dateKey];
        await refreshCalendar();
        closePopup();
    } else {
        alert(data.message || "삭제 실패");
    }
}

function selectPurpose(purpose) {
    selectedPurpose = purpose;
    document.getElementById("step2-title").textContent = purpose === "출타" ? "목적지 선택" : "출발지 선택";
    goStep(2);
}

function selectStation(station) {
    selectedStation = station;
    const isOut = selectedPurpose === "출타";
    document.getElementById("step3-subtitle").textContent = isOut ? `출타 · 부대 → ${station}` : `복귀 · ${station} → 부대`;
    initWheelPicker();
    goStep(3);
}
async function confirmSelection() {
    const time = getSelectedTime();
    const body = {
        date: selectedDate,
        purpose: selectedPurpose,
        station: selectedStation,
        time
    };
    try {
        const res = await fetch('/api/reservations', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || '저장 실패');
            return;
        }
        reservations[selectedDate] = {
            purpose: selectedPurpose,
            station: selectedStation,
            time
        };
        await refreshCalendar();
        closePopup();
    } catch (err) {
        alert("서버 연결 오류가 발생했습니다.");
    }
}
const ITEM_H = 44;

function generateTimes(purpose) {
    if (purpose === "출타") {
        return ["07:00", "07:30", "17:30"];
    }
    const times = [];
    let h = 18, m = 0;
    while (h < 20 || (h === 20 && m === 0)) {
        times.push(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`);
        m += 10;
        if (m >= 60) { m = 0; h++; }
    }
    return times;
}

function initWheelPicker() {
    const picker = document.getElementById("timePicker");
    const times = generateTimes(selectedPurpose);
    picker.innerHTML = "";
    times.forEach(t => {
        const item = document.createElement("div");
        item.className = "wheel-item";
        item.textContent = t;
        picker.appendChild(item);
    });
    picker.style.paddingTop = "88px";
    picker.style.paddingBottom = "88px";
    picker.scrollTop = 0;
    updateWheelStyle(picker);
    picker.addEventListener("scroll", () => updateWheelStyle(picker), {
        passive: true
    });
}

function getSelectedTime() {
    const picker = document.getElementById("timePicker");
    const idx = Math.round(picker.scrollTop / ITEM_H);
    const times = generateTimes(selectedPurpose);
    return times[Math.max(0, Math.min(idx, times.length - 1))];
}

function updateWheelStyle(picker) {
    const items = picker.querySelectorAll(".wheel-item");
    const centerIdx = Math.round(picker.scrollTop / ITEM_H);
    items.forEach((item, i) => {
        const dist = Math.abs(i - centerIdx);
        if (dist === 0) {
            item.style.fontWeight = "700";
            item.style.fontSize = "1.5rem";
            item.style.color = "#4f46e5";
            item.style.opacity = "1";
        } else if (dist === 1) {
            item.style.fontWeight = "400";
            item.style.fontSize = "1.2rem";
            item.style.color = "#374151";
            item.style.opacity = "0.6";
        } else {
            item.style.fontWeight = "400";
            item.style.fontSize = "1rem";
            item.style.color = "#374151";
            item.style.opacity = "0.25";
        }
    });
}
async function loadReservations() {
    try {
        const res = await fetch('/api/reservations');
        if (!res.ok) return;
        const data = await res.json();
        data.forEach(r => {
            reservations[r.date] = {
                purpose: r.purpose,
                station: r.station,
                time: r.time,
                party_agreed: r.party_agreed
            };
        });
    } catch (e) {
        console.error("예약 로드 실패", e);
    }
}
async function checkPartyComplete() {
    try {
        const res = await fetch('/api/party-complete');
        if (!res.ok) return;
        const parties = await res.json();
        if (parties.length === 0) return;
        partyQueue = parties;
        showNextParty();
    } catch (e) {
        console.error('파티 확인 실패', e);
    }
}

function showNextParty() {
    if (partyQueue.length === 0) return;
    currentParty = partyQueue.shift();
    const [y, m, d] = currentParty.date.split('-');
    const direction = currentParty.purpose === '출타' ? `부대 → ${currentParty.station}` : `${currentParty.station} → 부대`;
    document.getElementById('party-info').textContent = `${y}년 ${m}월 ${d}일 · ${currentParty.purpose} · ${direction} · ${currentParty.time} · ${currentParty.count}명`;
    document.getElementById('party-overlay').style.display = 'flex';
}

async function respondParty(agree) {
    document.getElementById('party-overlay').style.display = 'none';
    if (agree && currentParty) {
        try {
            await fetch('/api/party-agree', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    date: currentParty.date,
                    purpose: currentParty.purpose,
                    station: currentParty.station,
                    time: currentParty.time
                })
            });
            if (reservations[currentParty.date]) {
                reservations[currentParty.date].party_agreed = true;
            }
            await refreshCalendar();
        } catch (e) {
            console.error('파티 동의 저장 실패', e);
        }
    }
    if (!agree && currentParty) {
        try {
            await fetch('/api/reservations', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ date: currentParty.date })
            });
            delete reservations[currentParty.date];
            await refreshCalendar();
        } catch (e) {
            console.error('예약 취소 실패', e);
        }
    }
    currentParty = null;
    if (partyQueue.length > 0) setTimeout(showNextParty, 400);
}
document.addEventListener("DOMContentLoaded", async function() {
    populateTimeSelect();
    renderCalendar();
    try {
        const res = await fetch('/api/me');
        if (!res.ok) {
            alert("로그인해야합니다 !");
            location.href = "login.html";
            return;
        }
        const me = await res.json();
        document.getElementById('user_id').textContent = me.username;
        await loadReservations();
        await refreshCalendar();
        await checkPartyComplete();
    } catch (err) {
        alert("서버 연결 오류가 발생했습니다.");
        location.href = "login.html";
    }
});
async function logout() {
    await fetch('/api/logout', {
        method: 'POST'
    });
    alert('로그아웃되었습니다.');
    location.href = 'login.html';
}
