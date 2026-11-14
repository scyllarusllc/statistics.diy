// Single administrator account. Password hash lives in the environment, sessions in SQLite.
import {randomBytes, createHash, createHmac, scryptSync, timingSafeEqual} from 'node:crypto';

const sha256 = value => createHash('sha256').update(value).digest('hex');
export const SESSION_SECONDS = 14 * 86400;

export function hashPassword(password, salt = randomBytes(16)) {
  return `scrypt$${salt.toString('base64url')}$${scryptSync(password, salt, 32).toString('base64url')}`;
}
export function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = scryptSync(password, Buffer.from(salt, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const same = (a, b) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export function cookie(req, name) {
  const part = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(name + '='));
  return part ? part.slice(name.length + 1) : '';
}
export function setCookie(res, name, value, age, origin) {
  const values = res.getHeader('Set-Cookie') || [];
  res.setHeader('Set-Cookie', [...values, `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${origin.startsWith('https:') ? '; Secure' : ''}`]);
}

export function createAuth(db, origin, {username = 'Administrator', passwordHash, password} = {}) {
  // ADMIN_PASSWORD (plain) is a convenience for development; ADMIN_PASSWORD_HASH is preferred.
  const stored = passwordHash || (password ? hashPassword(password) : '');
  let failures = [];
  const csrfFor = token => createHmac('sha256', token).update('statistics-diy-csrf').digest('hex');
  return {
    enabled: Boolean(stored),
    username,
    isAdmin(req) {
      const token = cookie(req, 'sd_session');
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
      const row = db.prepare('SELECT expires FROM admin_sessions WHERE token_hash = ?').get(sha256(token));
      return Boolean(row && row.expires > Date.now() / 1000);
    },
    csrf(req) {
      const token = cookie(req, 'sd_session');
      return token ? csrfFor(token) : '';
    },
    csrfValid(req) {
      const expected = this.csrf(req);
      return Boolean(expected) && same(String(req.headers['x-csrf-token'] || ''), expected);
    },
    login(req, res, usr, pwd) {
      const now = Date.now();
      failures = failures.filter(time => time > now - 15 * 60000);
      if (failures.length >= 10) return 'throttled';
      const plausible = Boolean(stored) && typeof usr === 'string' && typeof pwd === 'string' && pwd.length <= 1024;
      // Always run the hash so timing does not reveal whether the username matched.
      const valid = plausible && verifyPassword(pwd, stored) && same(usr, username);
      if (!valid) {
        failures.push(now);
        return 'invalid';
      }
      const previous = cookie(req, 'sd_session');
      if (previous) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(previous));
      const token = randomBytes(32).toString('base64url');
      db.prepare('DELETE FROM admin_sessions WHERE expires < ?').run(Math.floor(now / 1000));
      db.prepare('INSERT INTO admin_sessions (token_hash, expires) VALUES (?, ?)').run(sha256(token), Math.floor(now / 1000) + SESSION_SECONDS);
      setCookie(res, 'sd_session', token, SESSION_SECONDS, origin);
      return 'ok';
    },
    logout(req, res) {
      const token = cookie(req, 'sd_session');
      if (token) db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(sha256(token));
      setCookie(res, 'sd_session', '', 0, origin);
    }
  };
}
