const { v4: uuidv4 } = require('uuid');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = '0934494823';
const activeSessions = new Map(); // token -> expiry timestamp
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

function createSession() {
  const token = uuidv4();
  activeSessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function isValidSession(token) {
  if (!token || !activeSessions.has(token)) return false;
  const expiry = activeSessions.get(token);
  if (Date.now() > expiry) { activeSessions.delete(token); return false; }
  return true;
}

function parseCookies(cookieHeader = '') {
  const cookies = {};
  cookieHeader.split(';').forEach(part => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return cookies;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie);
  if (isValidSession(cookies.admin_token)) return next();
  res.redirect('/login');
}

module.exports = {
  ADMIN_USERNAME,
  ADMIN_PASSWORD,
  activeSessions,
  createSession,
  isValidSession,
  parseCookies,
  requireAdmin
};
