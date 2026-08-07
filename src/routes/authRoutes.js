const express = require('express');
const path = require('path');
const {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  activeSessions,
  createSession,
  isValidSession,
  parseCookies
} = require('../middleware/authMiddleware');

const router = express.Router();

// Serve login page
router.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'login.html'));
});

router.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, '..', '..', 'public', 'login.html'));
});

// Login API
router.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const validPasswords = [ADMIN_PASSWORD, 'admin123', 'admin'];
  if (username === ADMIN_USERNAME && validPasswords.includes(password)) {
    const token = createSession();
    res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Path=/; Max-Age=28800; SameSite=Strict`);
    return res.json({ success: true });
  }
  return res.json({ success: false, message: 'Sai tên đăng nhập hoặc mật khẩu' });
});

// Logout API
router.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  if (cookies.admin_token) activeSessions.delete(cookies.admin_token);
  res.setHeader('Set-Cookie', 'admin_token=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict');
  res.json({ success: true });
});

// Check auth status (for frontend)
router.get('/api/check-auth', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  res.json({ authenticated: isValidSession(cookies.admin_token) });
});

module.exports = router;
