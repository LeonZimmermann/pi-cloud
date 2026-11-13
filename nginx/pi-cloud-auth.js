// njs-Modul für nginx: Sitzungs-Cookies und Passwortänderung.
//
// Sitzungs-Cookie: "<benutzer>.<HMAC-SHA256(schlüssel, benutzer:passwort-hash)>".
// Weil der Hash aus der Passwortdatei eingeht, werden mit einer
// Passwortänderung alle anderen Geräte dieses Benutzers abgemeldet.

import fs from 'fs';
import crypto from 'crypto';

const PASSWD = '/data/.pi-cloud/passwd';
const KEY = '/etc/nginx/pi-cloud.key';
const MIN_LENGTH = 8;

function readKey() {
    return fs.readFileSync(KEY, 'utf8').trim();
}

function readPasswd() {
    const users = {};
    const lines = fs.readFileSync(PASSWD, 'utf8').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const c = lines[i].indexOf(':');
        if (c > 0) users[lines[i].slice(0, c)] = lines[i].slice(c + 1);
    }
    return users;
}

function tokenFor(key, name, hash) {
    return name + '.' + crypto.createHmac('sha256', key).update(name + ':' + hash).digest('hex');
}

function safeEqual(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return d === 0;
}

// --- SHA-256-crypt ($5$), wie crypt(3) in musl/glibc ---

const ITOA64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ROUNDS = 5000;

function sha256(parts) {
    const h = crypto.createHash('sha256');
    for (let i = 0; i < parts.length; i++) h.update(parts[i]);
    return h.digest();
}

function repeatTo(src, len) {
    const out = [];
    let n = len;
    while (n >= 32) { out.push(src); n -= 32; }
    if (n > 0) out.push(src.slice(0, n));
    return Buffer.concat(out.length ? out : [Buffer.alloc(0)]);
}

function sha256crypt(password, salt) {
    const P = Buffer.from(password, 'utf8');
    const S = Buffer.from(salt, 'utf8');
    const B = sha256([P, S, P]);

    const a = [P, S];
    for (let i = P.length; i > 0; i -= 32) a.push(i > 32 ? B : B.slice(0, i));
    for (let i = P.length; i > 0; i >>= 1) a.push(i & 1 ? B : P);
    const A = sha256(a);

    const dp = [];
    for (let i = 0; i < P.length; i++) dp.push(P);
    const Pseq = repeatTo(sha256(dp), P.length);

    const ds = [];
    for (let i = 0; i < 16 + A[0]; i++) ds.push(S);
    const Sseq = repeatTo(sha256(ds), S.length);

    let C = A;
    for (let r = 0; r < ROUNDS; r++) {
        const h = crypto.createHash('sha256');
        h.update(r & 1 ? Pseq : C);
        if (r % 3) h.update(Sseq);
        if (r % 7) h.update(Pseq);
        h.update(r & 1 ? C : Pseq);
        C = h.digest();
    }

    let out = '';
    function b64(b2, b1, b0, n) {
        let w = (b2 << 16) | (b1 << 8) | b0;
        for (let i = 0; i < n; i++) { out += ITOA64[w & 63]; w >>= 6; }
    }
    const g = [[0, 10, 20], [21, 1, 11], [12, 22, 2], [3, 13, 23], [24, 4, 14],
               [15, 25, 5], [6, 16, 26], [27, 7, 17], [18, 28, 8], [9, 19, 29]];
    for (let i = 0; i < g.length; i++) b64(C[g[i][0]], C[g[i][1]], C[g[i][2]], 4);
    b64(0, C[31], C[30], 3);
    return '$5$' + salt + '$' + out;
}

function newSalt() {
    const raw = crypto.createHash('sha256').update(String(Math.random()) + Date.now() + readKey()).digest();
    let s = '';
    for (let i = 0; i < 16; i++) s += ITOA64[raw[i] & 63];
    return s;
}

function verify(password, hash) {
    if (hash.indexOf('$5$') === 0) {
        const parts = hash.split('$');
        if (parts.length !== 4 || parts[2].indexOf('rounds=') === 0) return false;
        return safeEqual(sha256crypt(password, parts[2]), hash);
    }
    if (hash.indexOf('{PLAIN}') === 0) return safeEqual('{PLAIN}' + password, hash);
    return false;
}

// --- Variablen (js_set) ---

// Benutzer aus einem gültigen Sitzungs-Cookie, sonst "".
function cookieUser(r) {
    const c = r.variables.cookie_pc_session || '';
    const dot = c.lastIndexOf('.');
    if (dot < 1) return '';
    const name = c.slice(0, dot);
    try {
        const hash = readPasswd()[name];
        return hash && safeEqual(tokenFor(readKey(), name, hash), c) ? name : '';
    } catch (e) {
        r.error('pi-cloud: ' + e.message);
        return '';
    }
}

// Cookie-Wert nach erfolgreicher Basic-Auth.
function loginToken(r) {
    const name = r.variables.remote_user;
    try {
        const hash = name && readPasswd()[name];
        return hash ? tokenFor(readKey(), name, hash) : '';
    } catch (e) {
        r.error('pi-cloud: ' + e.message);
        return '';
    }
}

// --- POST /api/password {current, next} ---

function reply(r, status, body) {
    r.headersOut['Content-Type'] = 'application/json';
    r.headersOut['Cache-Control'] = 'no-store';
    r.return(status, JSON.stringify(body));
}

function changePassword(r) {
    if (r.method !== 'POST') return reply(r, 405, { error: 'Nur POST.' });
    // Eigener Header erzwingt einen CORS-Preflight: Schutz vor CSRF.
    if (!r.headersIn['X-PC-App']) return reply(r, 403, { error: 'Nur aus der App.' });

    const name = r.variables.pc_user;
    let body;
    try {
        body = JSON.parse(r.requestText || '');
    } catch (e) {
        return reply(r, 400, { error: 'Ungültige Anfrage.' });
    }
    const current = typeof body.current === 'string' ? body.current : '';
    const next = typeof body.next === 'string' ? body.next : '';

    if (next.length < MIN_LENGTH) return reply(r, 400, { error: 'Das neue Passwort braucht mindestens ' + MIN_LENGTH + ' Zeichen.' });
    if (next.length > 256) return reply(r, 400, { error: 'Das neue Passwort ist zu lang.' });
    if (/[\x00-\x1f\x7f]/.test(next)) return reply(r, 400, { error: 'Das neue Passwort enthält ungültige Zeichen.' });
    if (next === current) return reply(r, 400, { error: 'Das neue Passwort muss sich vom alten unterscheiden.' });

    let lines;
    try {
        lines = fs.readFileSync(PASSWD, 'utf8').split('\n').filter((l) => l);
    } catch (e) {
        r.error('pi-cloud: ' + e.message);
        return reply(r, 500, { error: 'Passwortdatei nicht lesbar.' });
    }
    const idx = lines.findIndex((l) => l.slice(0, l.indexOf(':')) === name);
    if (!name || idx < 0) return reply(r, 403, { error: 'Unbekannter Benutzer.' });
    if (!verify(current, lines[idx].slice(name.length + 1))) {
        return reply(r, 400, { error: 'Das aktuelle Passwort ist falsch.' });
    }

    const hash = sha256crypt(next, newSalt());
    lines[idx] = name + ':' + hash;
    try {
        const tmp = PASSWD + '.tmp';
        fs.writeFileSync(tmp, lines.join('\n') + '\n', { mode: 384 });
        fs.renameSync(tmp, PASSWD);
    } catch (e) {
        r.error('pi-cloud: ' + e.message);
        return reply(r, 500, { error: 'Passwort konnte nicht gespeichert werden.' });
    }

    // Dieses Gerät bleibt angemeldet, alle anderen werden abgemeldet.
    r.headersOut['Set-Cookie'] = 'pc_session=' + tokenFor(readKey(), name, hash)
        + '; Path=/; Max-Age=31536000; HttpOnly; SameSite=Strict';
    reply(r, 200, { ok: true });
}

export default { cookieUser, loginToken, changePassword, sha256crypt };
