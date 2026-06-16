const express    = require('express');
const session    = require('express-session');
const pgSession  = require('connect-pg-simple')(session);
const bcrypt     = require('bcryptjs');
const argon2     = require('argon2');
const { Pool }   = require('pg');
const path       = require('path');
const http       = require('http');
const { Server } = require('socket.io');

const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer);
const PORT       = process.env.PORT || 5000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode') ? undefined : false
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) UNIQUE NOT NULL,
      phone VARCHAR(20) NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS session (
      sid VARCHAR NOT NULL COLLATE "default",
      sess JSON NOT NULL,
      expire TIMESTAMP(6) NOT NULL,
      CONSTRAINT session_pkey PRIMARY KEY (sid)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reservations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date VARCHAR(20) NOT NULL,
      purpose VARCHAR(10) NOT NULL,
      station VARCHAR(20) NOT NULL,
      time VARCHAR(10) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, date)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rooms (
      id SERIAL PRIMARY KEY,
      date VARCHAR(20) NOT NULL,
      purpose VARCHAR(10) NOT NULL,
      station VARCHAR(20) NOT NULL,
      time VARCHAR(10) NOT NULL,
      counter INTEGER NOT NULL DEFAULT 1,
      room_key VARCHAR(100) UNIQUE NOT NULL,
      party_notified BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username VARCHAR(50) NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS party_notified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS party_agreed BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS username VARCHAR(50);`);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS members TEXT[];`);
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS early_vote BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE reservations ADD COLUMN IF NOT EXISTS username VARCHAR(50);`);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS members TEXT[];`);
  await pool.query(`ALTER TABLE rooms ADD COLUMN IF NOT EXISTS dissolve_votes INTEGER[] NOT NULL DEFAULT '{}';`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS captain (
      unit_num INTEGER PRIMARY KEY,
      hash VARCHAR(500) NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS suggestions (
      id SERIAL PRIMARY KEY,
      username VARCHAR(50) NOT NULL,
      suggestion TEXT NOT NULL,
      answer TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS satisfaction (
      id SERIAL PRIMARY KEY,
      room_key VARCHAR(100) NOT NULL,
      username VARCHAR(50) NOT NULL,
      success BOOLEAN NOT NULL,
      reason TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log('Database tables ready.');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const sessionMiddleware = session({
  store: new pgSession({ pool, tableName: 'session' }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7, httpOnly: true }
});
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: '로그인이 필요합니다.' });
}

const PURPOSE_MAP = { '출타': 'out', '복귀': 'back' };
const STATION_MAP = { '용문역': 'yongmun', '여주역': 'yeoju', '양평역': 'yangpyeong' };

function buildRoomKey(date, purpose, station, time, counter) {
  const p = PURPOSE_MAP[purpose] || purpose;
  const s = STATION_MAP[station] || station;
  const t = time.replace(':', '');
  return `${date}-${p}-${s}-${t}-${counter}`;
}

app.post('/api/register', async (req, res) => {
  const { username, password, phone, captainName } = req.body;
  if (!username || !password || !phone || !captainName) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  if (password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 합니다.' });

  const unitNum = parseInt(username.trim()[0], 10);
  if (isNaN(unitNum)) return res.status(400).json({ error: '아이디 형식이 올바르지 않습니다.' });

  try {
    const captainRow = await pool.query('SELECT hash FROM captain WHERE unit_num = $1', [unitNum]);
    if (captainRow.rowCount === 0) return res.status(403).json({ error: '해당 중대의 직속상관 정보가 등록되어 있지 않습니다.' });

    const valid = await argon2.verify(captainRow.rows[0].hash, captainName.trim());
    if (!valid) return res.status(403).json({ error: '직속상관 관등성명이 일치하지 않습니다.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, phone, password_hash) VALUES ($1, $2, $3) RETURNING id, username',
      [username.trim(), phone.trim(), hash]
    );
    req.session.userId = result.rows[0].id;
    req.session.username = result.rows[0].username;
    res.json({ success: true, username: result.rows[0].username });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });
    console.error('Register error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/admin/set-captain', async (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  const { key, unitNum, captainName } = req.body;
  if (!adminKey || key !== adminKey) return res.status(403).json({ error: '관리자 키가 올바르지 않습니다.' });
  if (unitNum === undefined || !captainName) return res.status(400).json({ error: '중대번호와 관등성명을 입력하세요.' });
  try {
    const hash = await argon2.hash(captainName.trim());
    await pool.query(
      'INSERT INTO captain (unit_num, hash) VALUES ($1, $2) ON CONFLICT (unit_num) DO UPDATE SET hash = EXCLUDED.hash',
      [parseInt(unitNum), hash]
    );
    res.json({ success: true, unitNum, message: `${unitNum}중대 직속상관 등록 완료` });
  } catch (err) {
    console.error('set-captain error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: '아이디와 비밀번호를 입력하세요.' });
  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username.trim()]);
    if (result.rows.length === 0) return res.status(401).json({ error: '아이디나 비밀번호가 옳지 않음' });
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: '아이디나 비밀번호가 옳지 않음' });
    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, phone, created_at FROM users WHERE id = $1', [req.session.userId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/reservations', requireAuth, async (req, res) => {
  const { date, purpose, station, time } = req.body;
  if (!date || !purpose || !station || !time) return res.status(400).json({ error: '모든 항목을 입력하세요.' });
  try {
    const result = await pool.query(
      `INSERT INTO reservations (user_id, username, date, purpose, station, time)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, date) DO UPDATE
         SET username = EXCLUDED.username,
             purpose = EXCLUDED.purpose,
             station = EXCLUDED.station,
             time = EXCLUDED.time,
             created_at = NOW()
       RETURNING *`,
      [req.session.userId, req.session.username, date, purpose, station, time]
    );
    res.json({ success: true, reservation: result.rows[0] });
  } catch (err) {
    console.error('Reservation error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/reservations', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM reservations WHERE user_id = $1 ORDER BY date', [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Get reservations error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.delete('/api/reservations', requireAuth, async (req, res) => {
  try {
    const { date } = req.body;
    const resRow = await pool.query(
      'SELECT purpose, station, time FROM reservations WHERE user_id=$1 AND date=$2',
      [req.session.userId, date]
    );
    if (resRow.rowCount === 0) return res.status(404).json({ success: false, message: '삭제할 예약이 없습니다.' });
    const { purpose, station, time } = resRow.rows[0];

    await pool.query('DELETE FROM reservations WHERE user_id=$1 AND date=$2', [req.session.userId, date]);

    const roomKey = buildRoomKey(date, purpose, station, time, 1);
    const membersRes = await pool.query(
      `SELECT COALESCE(re.username, u.username) AS username
       FROM reservations re
       JOIN users u ON u.id = re.user_id
       WHERE re.date=$1 AND re.purpose=$2 AND re.station=$3 AND re.time=$4
       ORDER BY COALESCE(re.username, u.username) ASC`,
      [date, purpose, station, time]
    );
    const members = membersRes.rows.map(r => r.username);
    await pool.query('UPDATE rooms SET members=$1 WHERE room_key=$2', [members, roomKey]);

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

app.get('/api/reservations/count', requireAuth, async (req, res) => {
  try {
    const { purpose, station, time } = req.query;
    const result = await pool.query(
      `SELECT date, COUNT(*) as count
       FROM reservations
       WHERE party_agreed = FALSE
         AND ($1::text IS NULL OR purpose = $1)
         AND ($2::text IS NULL OR station = $2)
         AND ($3::text IS NULL OR time = $3)
       GROUP BY date`,
      [purpose || null, station || null, time || null]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('count API error:', err);
    res.status(500).json({ error: '서버 오류 발생' });
  }
});

app.get('/api/party-complete', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.date, r.purpose, r.station, r.time, COUNT(*) as count
       FROM reservations r
       WHERE EXISTS (
         SELECT 1 FROM reservations
         WHERE user_id = $1
           AND date = r.date AND purpose = r.purpose
           AND station = r.station AND time = r.time
           AND party_agreed = FALSE
       )
       GROUP BY r.date, r.purpose, r.station, r.time
       HAVING COUNT(*) >= 4
       ORDER BY r.date`,
      [req.session.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('party-complete error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/party-agree', requireAuth, async (req, res) => {
  const { date, purpose, station, time } = req.body;
  if (!date || !purpose || !station || !time)
    return res.status(400).json({ error: '예약 정보가 올바르지 않습니다.' });
  try {
    await pool.query(
      `UPDATE reservations SET party_agreed = TRUE
       WHERE user_id = $1 AND date = $2 AND purpose = $3 AND station = $4 AND time = $5`,
      [req.session.userId, date, purpose, station, time]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('party-agree error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/early-party-status', requireAuth, async (req, res) => {
  const { date, purpose, station, time } = req.query;
  if (!date || !purpose || !station || !time)
    return res.status(400).json({ error: '예약 정보가 올바르지 않습니다.' });
  try {
    const totalRes = await pool.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN early_vote THEN 1 ELSE 0 END) as voted
       FROM reservations
       WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4 AND party_agreed=FALSE`,
      [date, purpose, station, time]
    );
    const myRes = await pool.query(
      `SELECT early_vote FROM reservations
       WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5`,
      [req.session.userId, date, purpose, station, time]
    );
    const total = parseInt(totalRes.rows[0].total) || 0;
    const voted = parseInt(totalRes.rows[0].voted) || 0;
    const myVote = myRes.rows[0]?.early_vote || false;
    res.json({ total, voted, myVote });
  } catch (err) {
    console.error('early-party-status error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/early-party-toggle', requireAuth, async (req, res) => {
  const { date, purpose, station, time } = req.body;
  if (!date || !purpose || !station || !time)
    return res.status(400).json({ error: '예약 정보가 올바르지 않습니다.' });
  try {
    const myRes = await pool.query(
      `SELECT early_vote FROM reservations
       WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5 AND party_agreed=FALSE`,
      [req.session.userId, date, purpose, station, time]
    );
    if (myRes.rowCount === 0) return res.status(403).json({ error: '해당 예약이 없습니다.' });

    const newVote = !myRes.rows[0].early_vote;
    await pool.query(
      `UPDATE reservations SET early_vote=$1
       WHERE user_id=$2 AND date=$3 AND purpose=$4 AND station=$5 AND time=$6`,
      [newVote, req.session.userId, date, purpose, station, time]
    );

    const countRes = await pool.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN early_vote THEN 1 ELSE 0 END) as voted
       FROM reservations
       WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4 AND party_agreed=FALSE`,
      [date, purpose, station, time]
    );
    const total = parseInt(countRes.rows[0].total) || 0;
    const voted = parseInt(countRes.rows[0].voted) || 0;

    if (total >= 2 && voted === total) {
      await pool.query(
        `UPDATE reservations SET party_agreed=TRUE, early_vote=FALSE
         WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4 AND party_agreed=FALSE`,
        [date, purpose, station, time]
      );
      const membersRes = await pool.query(
        `SELECT COALESCE(username, u.username) AS username
         FROM reservations re
         JOIN users u ON u.id = re.user_id
         WHERE re.date=$1 AND re.purpose=$2 AND re.station=$3 AND re.time=$4
         ORDER BY COALESCE(re.username, u.username) ASC`,
        [date, purpose, station, time]
      );
      const members = membersRes.rows.map(r => r.username);
      return res.json({ completed: true, count: total, myVote: true, voted: total, total, members });
    }

    res.json({ completed: false, myVote: newVote, voted, total });
  } catch (err) {
    console.error('early-party-toggle error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/rooms/enter', requireAuth, async (req, res) => {
  const { date, purpose, station, time } = req.body;
  if (!date || !purpose || !station || !time) return res.status(400).json({ error: '예약 정보가 올바르지 않습니다.' });
  try {
    const myRes = await pool.query('SELECT party_agreed FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5', [req.session.userId, date, purpose, station, time]);
    if (myRes.rowCount === 0) return res.status(403).json({ error: '해당 예약이 없습니다.' });
    const partyAgreed = myRes.rows[0].party_agreed;
    if (!partyAgreed) {
      const countRes = await pool.query('SELECT COUNT(*) as count FROM reservations WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4', [date, purpose, station, time]);
      if (parseInt(countRes.rows[0].count) < 2) return res.status(403).json({ error: '같이 예약한 파티원이 없습니다.' });
    }
    const roomKey = buildRoomKey(date, purpose, station, time, 1);
    const membersRes = await pool.query(
      `SELECT COALESCE(re.username, u.username) AS username
       FROM reservations re
       JOIN users u ON u.id = re.user_id
       WHERE re.date=$1 AND re.purpose=$2 AND re.station=$3 AND re.time=$4
       ORDER BY COALESCE(re.username, u.username) ASC`,
      [date, purpose, station, time]
    );
    const members = membersRes.rows.map(r => r.username);
    const existing = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [roomKey]);
    let room = existing.rows[0];
    if (!room) {
      const created = await pool.query(
        `INSERT INTO rooms (date, purpose, station, time, counter, room_key, members) VALUES ($1,$2,$3,$4,1,$5,$6) RETURNING *`,
        [date, purpose, station, time, roomKey, members]
      );
      room = created.rows[0];
    } else {
      const updated = await pool.query(
        `UPDATE rooms SET members=$1 WHERE room_key=$2 RETURNING *`,
        [members, roomKey]
      );
      room = updated.rows[0];
    }
    res.json({ success: true, room_key: room.room_key, members: room.members });
  } catch (err) {
    console.error('rooms/enter error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/rooms/:roomKey/dissolve-status', requireAuth, async (req, res) => {
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [req.params.roomKey]);
    if (room.rowCount === 0) return res.status(404).json({ error: '대화방이 없습니다.' });
    const r = room.rows[0];
    const myRes = await pool.query(
      'SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5 AND party_agreed=TRUE',
      [req.session.userId, r.date, r.purpose, r.station, r.time]
    );
    if (myRes.rowCount === 0) return res.status(403).json({ error: '권한이 없습니다.' });
    const countRes = await pool.query(
      'SELECT COUNT(*) as total FROM reservations WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4 AND party_agreed=TRUE',
      [r.date, r.purpose, r.station, r.time]
    );
    const total = parseInt(countRes.rows[0].total) || 0;
    const dissolveVotes = r.dissolve_votes || [];
    const voted = dissolveVotes.length;
    const myVote = dissolveVotes.includes(req.session.userId);
    res.json({ total, voted, myVote });
  } catch (err) {
    console.error('dissolve-status error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/rooms/:roomKey/dissolve-vote', requireAuth, async (req, res) => {
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [req.params.roomKey]);
    if (room.rowCount === 0) return res.status(404).json({ error: '대화방이 없습니다.' });
    const r = room.rows[0];
    const myRes = await pool.query(
      'SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5 AND party_agreed=TRUE',
      [req.session.userId, r.date, r.purpose, r.station, r.time]
    );
    if (myRes.rowCount === 0) return res.status(403).json({ error: '해당 파티의 멤버가 아닙니다.' });
    const dissolveVotes = r.dissolve_votes || [];
    const myVote = dissolveVotes.includes(req.session.userId);
    const newVotes = myVote
      ? dissolveVotes.filter(id => id !== req.session.userId)
      : [...dissolveVotes, req.session.userId];
    const countRes = await pool.query(
      'SELECT COUNT(*) as total FROM reservations WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4 AND party_agreed=TRUE',
      [r.date, r.purpose, r.station, r.time]
    );
    const total = parseInt(countRes.rows[0].total) || 0;
    if (newVotes.length >= total && total > 0) {
      await pool.query(
        'UPDATE reservations SET party_agreed=FALSE WHERE date=$1 AND purpose=$2 AND station=$3 AND time=$4',
        [r.date, r.purpose, r.station, r.time]
      );
      await pool.query('DELETE FROM rooms WHERE room_key=$1', [req.params.roomKey]);
      return res.json({ dissolved: true, count: total });
    }
    await pool.query('UPDATE rooms SET dissolve_votes=$1 WHERE room_key=$2', [newVotes, req.params.roomKey]);
    res.json({ dissolved: false, myVote: !myVote, voted: newVotes.length, total });
  } catch (err) {
    console.error('dissolve-vote error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/rooms/:roomKey/verify', requireAuth, async (req, res) => {
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [req.params.roomKey]);
    if (room.rowCount === 0) return res.status(404).json({ error: '대화방이 없습니다.' });
    const r = room.rows[0];
    const myRes = await pool.query('SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5', [req.session.userId, r.date, r.purpose, r.station, r.time]);
    if (myRes.rowCount === 0) return res.status(403).json({ error: '이 대화방에 접근 권한이 없습니다.' });
    res.json({ success: true, room: r, username: req.session.username });
  } catch (err) {
    console.error('verify error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/rooms/:roomKey/messages', requireAuth, async (req, res) => {
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [req.params.roomKey]);
    if (room.rowCount === 0) return res.status(404).json({ error: '대화방이 없습니다.' });
    const r = room.rows[0];
    const myRes = await pool.query('SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5', [req.session.userId, r.date, r.purpose, r.station, r.time]);
    if (myRes.rowCount === 0) return res.status(403).json({ error: '접근 권한이 없습니다.' });
    const msgs = await pool.query('SELECT username, content, created_at FROM messages WHERE room_id=$1 ORDER BY created_at ASC LIMIT 100', [r.id]);
    res.json(msgs.rows);
  } catch (err) {
    console.error('messages error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/rooms/:roomKey/people', requireAuth, async (req, res) => {
  try {
    const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [req.params.roomKey]);
    if (room.rowCount === 0) return res.status(404).json({ error: '대화방이 없습니다.' });
    const r = room.rows[0];
    const myRes = await pool.query('SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5', [req.session.userId, r.date, r.purpose, r.station, r.time]);
    if (myRes.rowCount === 0) return res.status(403).json({ error: '접근 권한이 없습니다.' });
    const people = await pool.query(
      `SELECT u.username, u.phone
       FROM reservations re
       JOIN users u ON u.id = re.user_id
       WHERE re.date=$1 AND re.purpose=$2 AND re.station=$3 AND re.time=$4
       ORDER BY u.username ASC`,
      [r.date, r.purpose, r.station, r.time]
    );
    res.json(people.rows);
  } catch (err) {
    console.error('people error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/satisfaction/check', requireAuth, async (req, res) => {
  const { room_key } = req.query;
  if (!room_key) return res.status(400).json({ error: '필수 항목 없음' });
  try {
    const result = await pool.query(
      `SELECT success FROM satisfaction WHERE room_key=$1 AND username=$2 LIMIT 1`,
      [room_key, req.session.username]
    );
    res.json({ submitted: result.rowCount > 0, success: result.rows[0]?.success ?? null });
  } catch (err) {
    console.error('satisfaction check error:', err);
    res.status(500).json({ error: '서버 오류' });
  }
});

app.post('/api/satisfaction', requireAuth, async (req, res) => {
  const { room_key, success, reason } = req.body;
  if (room_key === undefined || success === undefined) return res.status(400).json({ error: '필수 항목이 없습니다.' });
  try {
    await pool.query(
      `INSERT INTO satisfaction (room_key, username, success, reason) VALUES ($1, $2, $3, $4)`,
      [room_key, req.session.username, success, reason || null]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('satisfaction POST error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.get('/api/suggestions', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM suggestions ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    console.error('suggestions GET error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

app.post('/api/suggestions', requireAuth, async (req, res) => {
  const { suggestion } = req.body;
  if (!suggestion || !suggestion.trim()) return res.status(400).json({ error: '건의 내용을 입력하세요.' });
  try {
    const result = await pool.query(
      'INSERT INTO suggestions (username, suggestion) VALUES ($1,$2) RETURNING *',
      [req.session.username, suggestion.trim()]
    );
    const row = result.rows[0];
    io.to('suggestions').emit('new-suggestion', row);
    res.json(row);
  } catch (err) {
    console.error('suggestions POST error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});
// deprecated code
app.post('/api/admin/suggestions/:id/answer', async (req, res) => {
  const { key, answer } = req.body;
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || key !== adminKey) return res.status(403).json({ error: '관리자 키가 올바르지 않습니다.' });
  if (!answer || !answer.trim()) return res.status(400).json({ error: '답변 내용을 입력하세요.' });
  try {
    const result = await pool.query(
      'UPDATE suggestions SET answer=$1 WHERE id=$2 RETURNING *',
      [answer.trim(), parseInt(req.params.id)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: '건의사항을 찾을 수 없습니다.' });
    const row = result.rows[0];
    io.to('suggestions').emit('suggestion-answered', { id: row.id, answer: row.answer });
    res.json(row);
  } catch (err) {
    console.error('suggestions answer error:', err);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
  }
});

const wrap = m => (socket, next) => m(socket.request, {}, next);
io.use(wrap(sessionMiddleware));
io.use((socket, next) => {
  if (socket.request.session && socket.request.session.userId) return next();
  next(new Error('Unauthorized'));
});

io.on('connection', async (socket) => {
  const userId = socket.request.session.userId;
  const username = socket.request.session.username;

  socket.on('join-suggestions', () => {
    socket.join('suggestions');
  });

  socket.on('join-room', async (roomKey) => {
    try {
      const room = await pool.query('SELECT * FROM rooms WHERE room_key=$1', [roomKey]);
      if (room.rowCount === 0) return socket.emit('error', '대화방이 없습니다.');
      const r = room.rows[0];
      const myRes = await pool.query('SELECT 1 FROM reservations WHERE user_id=$1 AND date=$2 AND purpose=$3 AND station=$4 AND time=$5', [userId, r.date, r.purpose, r.station, r.time]);
      if (myRes.rowCount === 0) return socket.emit('error', '접근 권한이 없습니다.');
      socket.join(roomKey);
      socket.data.roomKey = roomKey;
      socket.data.roomId = r.id;
      socket.emit('joined', { roomKey, username });
    } catch (err) {
      console.error('join-room error:', err);
      socket.emit('error', '서버 오류가 발생했습니다.');
    }
  });

  socket.on('send-message', async (content) => {
    if (!socket.data.roomKey || !content || !content.trim()) return;
    try {
      const saved = await pool.query(
        'INSERT INTO messages (room_id, user_id, username, content) VALUES ($1,$2,$3,$4) RETURNING *',
        [socket.data.roomId, userId, username, content.trim()]
      );
      const msg = saved.rows[0];
      io.to(socket.data.roomKey).emit('new-message', { username: msg.username, content: msg.content, created_at: msg.created_at });
    } catch (err) {
      console.error('send-message error:', err);
    }
  });
});

// 라인 700-710 수정
const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.warn('⚠️ DATABASE_URL not set!');
  console.warn('Set this env var in your platform:', dbUrl);
}

if (dbUrl) {
  initDb().then(() => {
    httpServer.listen(PORT, '0.0.0.0', () => 
      console.log(`✅ Server running on port ${PORT} with DB`)
    );
  }).catch(err => {
    console.error('❌ DB init failed:', err.message);
    process.exit(1);
  });
} else {
  httpServer.listen(PORT, '0.0.0.0', () => 
    console.log(`⚠️ Server running on port ${PORT} WITHOUT DB`)
  );
}


//보안을 위한 대책들
//1. 회원가입 시 중대장급 직속상관 관등성명 요구하기 (직속상관 관등성명은 해시값으로 데이터베이스에 저장, 비밀번호처럼 복호화 불가능함)
//2. 중대장급 계정 만들어서 회원가입 요청을 직접 검증하고 승인하기


// signup.js 수정
//회원가입 시도가 10회 이상 실패하면 1시간 동안 회원가입을 할 수 없도록 하는 코드 추가 (아이피 제한 등)
//출발/복귀에 따라 예약 시간대 구분, 조정



/**
 * d228b-07ed5
 * 1fe6a-a792f
 * ecef1-bd937
 * 30ab3-75ce9
 * ab64b-beee0
 * d99ae-cfedd
 * 5e77f-86ad8
 * bbcfd-fe1b7
 * 06b24-61726
 * 95215-b79ed
 * 61db8-efc49
 * afb62-c92f7
 * 99995-7f499
 * 9478e-37f46
 * bd950-62b11
 * 36b58-6212d
 *
 * https://techkamar.medium.com/avoiding-downtime-in-render-com-free-tier-website-with-this-free-trick-09332c70e277
 */
