const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const db = require('../db');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-please';
const TOKEN_EXPIRES_IN = process.env.TOKEN_EXPIRES_IN || '7d';

async function createToken(user) {
  const payload = { id: user.id, role: user.role || 'user' };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

async function getUserById(id) {
  const u = await db('users').where({ id }).first();
  if (!u) return null;
  // map DB fields to API object (omit password_hash)
  return {
    id: u.id,
    student_no: u.student_no,
    name: u.name,
    department: u.department,
    role: u.role,
    email: u.email,
    avatar_url: u.avatar_url,
    nickname: u.nickname,
  };
}

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, password, email, student_no } = req.body || {};
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });

    // check uniqueness by student_no or email if provided
    if (student_no) {
      const ex = await db('users').where({ student_no }).first();
      if (ex) return res.status(409).json({ error: 'student_no already exists' });
    }
    if (email) {
      const ex = await db('users').where({ email }).first();
      if (ex) return res.status(409).json({ error: 'email already exists' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [id] = await db('users').insert({ name, password_hash: hash, email: email || null, student_no: student_no || null }).returning('id');
    // some MySQL configs return id differently; ensure numeric id
    const userId = (typeof id === 'object' && id.insertId) ? id.insertId : id;
    const user = await getUserById(userId);
    const token = await createToken({ id: userId, role: user.role });
    return res.json({ id: userId, token });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'register failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, student_no, password } = req.body || {};
    if ((!email && !student_no) || !password) return res.status(400).json({ error: 'email/student_no and password required' });
    const q = email ? { email } : { student_no };
    const user = await db('users').where(q).first();
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash || '');
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = await createToken(user);
    return res.json({ id: user.id, token });
  } catch (err) {
    console.error('login error', err);
    return res.status(500).json({ error: 'login failed' });
  }
});

// auth middleware for Bearer token
function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.*)$/i);
    if (!m) return res.status(401).json({ error: 'missing token' });
    const token = m[1];
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid token' });
  }
}

// get current user
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const u = await getUserById(req.user.id);
    if (!u) return res.status(404).json({ error: 'user not found' });
    return res.json(u);
  } catch (err) {
    console.error('me error', err);
    return res.status(500).json({ error: 'failed' });
  }
});

// update current user
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const allowed = ['name', 'department', 'avatar_url', 'nickname', 'email'];
    const payload = {};
    for (const k of allowed) if (req.body[k] !== undefined) payload[k] = req.body[k];
    if (Object.keys(payload).length === 0) return res.status(400).json({ error: 'no updatable fields' });
    await db('users').where({ id: req.user.id }).update(payload);
    const u = await getUserById(req.user.id);
    return res.json(u);
  } catch (err) {
    console.error('update me error', err);
    return res.status(500).json({ error: 'update failed' });
  }
});

module.exports = router;
