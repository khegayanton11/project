'use strict';
// Сервис форм: чистый Node.js без зависимостей, данные в data/db.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const TYPES = ['text', 'textarea', 'email', 'number', 'date', 'select', 'radio', 'checkbox'];
const CHOICE = ['select', 'radio', 'checkbox'];
const MAX_BODY = 200 * 1024;

const httpError = (status, message, extra) => Object.assign(new Error(message), { status }, extra);
const uid = (n = 6) => crypto.randomBytes(n).toString('base64url');
const str = (v, max) => String(v ?? '').trim().slice(0, max);

// ---------- хранилище ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { forms: [], responses: [], sessions: [] };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch { /* первый запуск */ }

function flush() {
  clearTimeout(timer);
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE); // атомарная замена, файл не повредится при сбое
}
let timer;
const saveSoon = () => { clearTimeout(timer); timer = setTimeout(flush, 300); }; // для частых событий аналитики
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });

// ---------- формы ----------
function cleanForm(input) {
  const title = str(input.title, 200);
  if (!title) throw httpError(400, 'Укажите название формы');
  const used = new Set();
  const fields = (Array.isArray(input.fields) ? input.fields : []).slice(0, 50).map((f) => {
    const type = TYPES.includes(f.type) ? f.type : 'text';
    const label = str(f.label, 200);
    if (!label) throw httpError(400, 'У каждого вопроса должен быть текст');
    let id = /^[\w-]{1,32}$/.test(f.id || '') ? f.id : 'f_' + uid(4);
    while (used.has(id)) id = 'f_' + uid(4);
    used.add(id);
    const options = CHOICE.includes(type)
      ? [...new Set((Array.isArray(f.options) ? f.options : []).map((o) => str(o, 100)).filter(Boolean))].slice(0, 50)
      : [];
    if (CHOICE.includes(type) && !options.length) throw httpError(400, `Добавьте варианты ответа для вопроса «${label}»`);
    return { id, type, label, required: !!f.required, options };
  });
  return { title, description: str(input.description, 2000), published: !!input.published, fields };
}

function validate(form, raw) {
  const answers = {}, errors = {};
  for (const f of form.fields) {
    let v = raw ? raw[f.id] : undefined;
    if (typeof v === 'string') v = v.trim();
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) {
      if (f.required) errors[f.id] = 'Обязательный вопрос';
      continue;
    }
    if (f.type === 'checkbox') {
      if (Array.isArray(v) && v.every((x) => f.options.includes(x))) answers[f.id] = v;
      else errors[f.id] = 'Выберите из предложенных вариантов';
      continue;
    }
    v = String(v);
    if (v.length > 5000) errors[f.id] = 'Слишком длинный ответ';
    else if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) errors[f.id] = 'Некорректный email';
    else if (f.type === 'number' && !Number.isFinite(Number(v))) errors[f.id] = 'Введите число';
    else if (f.type === 'date' && !(/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)))) errors[f.id] = 'Некорректная дата';
    else if ((f.type === 'select' || f.type === 'radio') && !f.options.includes(v)) errors[f.id] = 'Выберите из предложенных вариантов';
    else answers[f.id] = v;
  }
  return { answers, errors };
}

// ---------- аналитика: где студенты бросают форму ----------
function touchSession(form, body) {
  const sid = String(body.sid || '');
  if (!/^[\w-]{8,64}$/.test(sid)) throw httpError(400, 'Некорректный sid');
  let s = db.sessions.find((x) => x.id === sid && x.formId === form.id);
  if (!s) {
    s = { id: sid, formId: form.id, startedAt: new Date().toISOString(), touched: [], lastField: null, submitted: false };
    db.sessions.push(s);
  }
  if (body.type === 'field' && !s.submitted && form.fields.some((f) => f.id === body.fieldId)) {
    if (!s.touched.includes(body.fieldId)) s.touched.push(body.fieldId);
    s.lastField = body.fieldId;
  }
  return s;
}

function stats(form) {
  const ss = db.sessions.filter((s) => s.formId === form.id);
  return {
    views: ss.length,
    started: ss.filter((s) => s.touched.length).length,
    submitted: ss.filter((s) => s.submitted).length,
    perField: form.fields.map((f) => ({
      id: f.id,
      label: f.label,
      reached: ss.filter((s) => s.touched.includes(f.id)).length,
      abandonedHere: ss.filter((s) => !s.submitted && s.lastField === f.id).length,
    })),
  };
}

function toCsv(form) {
  const esc = (v) => {
    v = Array.isArray(v) ? v.join('; ') : String(v ?? '');
    if (/^[=+\-@\t\r]/.test(v) && isNaN(Number(v))) v = "'" + v; // защита от CSV-инъекций в Excel
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const rows = [['Дата', ...form.fields.map((f) => f.label)]];
  for (const r of db.responses.filter((x) => x.formId === form.id)) {
    rows.push([r.submittedAt, ...form.fields.map((f) => r.answers[f.id])]);
  }
  return '\ufeff' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

// ---------- API ----------
async function api(m, seg, req) {
  const now = new Date().toISOString();

  if (seg[0] === 'public' && seg[1]) {
    const form = db.forms.find((f) => f.slug === seg[1]);
    if (!form || !form.published) throw httpError(404, 'Форма не найдена или закрыта');
    if (m === 'GET' && !seg[2]) return { title: form.title, description: form.description, fields: form.fields };
    if (m === 'POST' && seg[2] === 'event') {
      touchSession(form, await readBody(req));
      saveSoon();
      return { ok: true };
    }
    if (m === 'POST' && seg[2] === 'submit') {
      const body = await readBody(req);
      const { answers, errors } = validate(form, body.answers);
      if (Object.keys(errors).length) throw httpError(422, 'Проверьте выделенные вопросы', { errors });
      if (body.sid) touchSession(form, { sid: body.sid }).submitted = true;
      db.responses.push({
        id: uid(), formId: form.id, submittedAt: now, answers,
        fields: form.fields.map(({ id, label, type }) => ({ id, label, type })), // снимок: правки формы не ломают старые ответы
      });
      flush();
      return { ok: true };
    }
  }

  if (seg[0] === 'forms') {
    const id = seg[1];
    if (!id) {
      if (m === 'GET') {
        return db.forms
          .map((f) => ({ ...f, responses: db.responses.filter((r) => r.formId === f.id).length }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }
      if (m === 'POST') {
        const form = { id: uid(), slug: uid(6), createdAt: now, updatedAt: now, ...cleanForm(await readBody(req)) };
        db.forms.push(form);
        flush();
        return form;
      }
    }
    const form = db.forms.find((f) => f.id === id);
    if (!form) throw httpError(404, 'Форма не найдена');
    if (!seg[2]) {
      if (m === 'GET') return form;
      if (m === 'PUT') {
        Object.assign(form, cleanForm(await readBody(req)), { updatedAt: now });
        flush();
        return form;
      }
      if (m === 'DELETE') {
        db.forms = db.forms.filter((f) => f !== form);
        db.responses = db.responses.filter((r) => r.formId !== id);
        db.sessions = db.sessions.filter((s) => s.formId !== id);
        flush();
        return { ok: true };
      }
    }
    if (m === 'GET' && seg[2] === 'responses') return db.responses.filter((r) => r.formId === id).reverse();
    if (m === 'GET' && seg[2] === 'stats') return stats(form);
    if (m === 'GET' && seg[2] === 'export.csv') return { __csv: toCsv(form) };
  }
  throw httpError(404, 'Не найдено');
}

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0, failed = false;
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > MAX_BODY) { failed = true; reject(httpError(413, 'Слишком большой запрос')); } else chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(httpError(400, 'Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function sendFile(res, name) {
  fs.readFile(path.join(PUBLIC, name), (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}
const json = (res, status, data) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

http.createServer(async (req, res) => {
  try {
    const p = new URL(req.url, 'http://localhost').pathname.replace(/\/+$/, '') || '/';
    const m = req.method;
    if (p === '/') { res.writeHead(302, { Location: '/admin' }); return res.end(); }
    if (m === 'GET' && p === '/admin') return sendFile(res, 'admin.html');
    if (m === 'GET' && /^\/f\/[\w-]+$/.test(p)) return sendFile(res, 'form.html');
    if (m === 'GET' && p.startsWith('/static/')) return sendFile(res, path.basename(p)); // basename: защита от ../
    if (p.startsWith('/api/')) {
      const out = await api(m, p.slice(5).split('/'), req);
      if (out && out.__csv != null) {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="responses.csv"' });
        return res.end(out.__csv);
      }
      return json(res, 200, out);
    }
    res.writeHead(404); res.end('Not found');
  } catch (e) {
    if (!e.status) console.error(e);
    json(res, e.status || 500, { error: e.status ? e.message : 'Внутренняя ошибка сервера', errors: e.errors });
  }
}).listen(PORT, () => console.log(`Сервис форм запущен: http://localhost:${PORT}/admin`));
