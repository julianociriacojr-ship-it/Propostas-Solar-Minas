#!/usr/bin/env node
// Servidor do Gerador de Propostas: entrega o app (index.html + vendor/) e guarda os dados
// num banco compartilhado entre todos os usuários.
//
// O banco é chave/valor, no mesmo formato que o app já usava no navegador (window.storage):
// cada chave vira um arquivo em DATA_DIR/kv/ (<sha256>.val com o valor e <sha256>.key com o nome
// da chave, porque chaves podem passar do limite de tamanho de nome de arquivo). Simples de inspecionar e de fazer backup
// (basta copiar a pasta DATA_DIR). Sem dependências além do próprio Node (>= 18).
//
// Variáveis de ambiente:
//   PORT       (padrão 3000)
//   HOST       (padrão 127.0.0.1; o Caddy na frente cuida do HTTPS)
//   DATA_DIR   (padrão ./data)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {loadUsers, checkPassword} = require('./users');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const KV_DIR = path.join(DATA_DIR, 'kv');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ACTIVITY_LOG = path.join(DATA_DIR, 'activity.log');

const MAX_BODY = 80 * 1024 * 1024;           // modelos .docx e fotos vêm em base64
const MAX_KEY = 2000;
const SESSION_DAYS = 30;
const COOKIE = 'sm_sid';

fs.mkdirSync(KV_DIR, {recursive:true});

// ---------- Sessões (persistidas para não deslogar todo mundo a cada atualização) ----------
let sessions = {};
try{ sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); }catch{ sessions = {}; }
let sessionsDirty = false;
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of Object.entries(sessions)) if (s.exp < now){ delete sessions[id]; sessionsDirty = true; }
  if (!sessionsDirty) return;
  sessionsDirty = false;
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), {mode:0o600}, err => { if (err) console.error('sessions', err); });
}, 5000).unref();

function newSession(user){
  const id = crypto.randomBytes(32).toString('hex');
  sessions[id] = {user, exp: Date.now() + SESSION_DAYS * 864e5};
  sessionsDirty = true;
  return id;
}

function parseCookies(req){
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')){
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req){
  const id = parseCookies(req)[COOKIE];
  const s = id && sessions[id];
  if (!s || s.exp < Date.now()) return null;
  // usuário removido pelo manage.js perde o acesso na hora
  if (!loadUsers(DATA_DIR)[s.user]) return null;
  return s.user;
}

function isHttps(req){ return req.headers['x-forwarded-proto'] === 'https'; }

function setSessionCookie(req, res, id, maxAgeSec){
  const parts = [`${COOKIE}=${id}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (isHttps(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

// ---------- Limite de tentativas de login ----------
const loginFails = new Map(); // ip -> {n, until}
function clientIp(req){
  const remote = req.socket.remoteAddress || '';
  const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  const fwd = local && req.headers['x-forwarded-for'];
  return fwd ? fwd.split(',')[0].trim() : remote;
}
function loginBlocked(ip){
  const f = loginFails.get(ip);
  return f && f.n >= 10 && f.until > Date.now();
}
function loginFailed(ip){
  const f = loginFails.get(ip);
  if (!f || f.until < Date.now()) loginFails.set(ip, {n:1, until: Date.now() + 15 * 60e3});
  else f.n++;
}

// ---------- Banco chave/valor em arquivos ----------
function keyBase(key){ return path.join(KV_DIR, crypto.createHash('sha256').update(key, 'utf8').digest('hex')); }

async function writeAtomic(file, data){
  const tmp = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, data, 'utf8');
  await fsp.rename(tmp, file); // troca atômica: nunca fica um arquivo pela metade
}
async function unlinkIfExists(file){
  try{ await fsp.unlink(file); }
  catch(err){ if (err.code !== 'ENOENT') throw err; }
}

async function kvGet(key){
  try{ return await fsp.readFile(keyBase(key) + '.val', 'utf8'); }
  catch(err){ if (err.code === 'ENOENT') return null; throw err; }
}
async function kvSet(key, value){
  const base = keyBase(key);
  await writeAtomic(base + '.key', key);
  await writeAtomic(base + '.val', value);
}
async function kvDelete(key){
  const base = keyBase(key);
  await unlinkIfExists(base + '.val');
  await unlinkIfExists(base + '.key');
}
async function kvList(prefix){
  const names = new Set(await fsp.readdir(KV_DIR));
  const keys = [];
  for (const n of names){
    if (!n.endsWith('.key') || !names.has(n.slice(0, -4) + '.val')) continue;
    const key = await fsp.readFile(path.join(KV_DIR, n), 'utf8');
    if (key.startsWith(prefix)) keys.push(key);
  }
  return keys;
}

function logActivity(user, op, key){
  const line = `${new Date().toISOString()}\t${user}\t${op}\t${key}\n`;
  fs.appendFile(ACTIVITY_LOG, line, () => {});
}

// ---------- HTTP ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function send(res, status, body, type = 'application/json; charset=utf-8', extra = {}){
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-store', ...extra});
  res.end(data);
}

function readBody(req){
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY){ reject(Object.assign(new Error('Arquivo grande demais'), {status:413})); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const STATIC = {
  '/': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/index.html': ['index.html', 'text/html; charset=utf-8', 'no-cache'],
  '/vendor/xlsx.full.min.js': ['vendor/xlsx.full.min.js', 'text/javascript; charset=utf-8', 'public, max-age=604800'],
  '/vendor/jszip.min.js': ['vendor/jszip.min.js', 'text/javascript; charset=utf-8', 'public, max-age=604800'],
  '/vendor/docx-preview.min.js': ['vendor/docx-preview.min.js', 'text/javascript; charset=utf-8', 'public, max-age=604800'],
};

async function handleApi(req, res, url){
  const p = url.pathname;

  if (p === '/api/login' && req.method === 'POST'){
    const ip = clientIp(req);
    if (loginBlocked(ip)) return send(res, 429, {error:'Muitas tentativas. Aguarde 15 minutos.'});
    let body;
    try{ body = JSON.parse(await readBody(req)); }catch{ return send(res, 400, {error:'Requisição inválida'}); }
    const user = String(body.user || '').trim();
    const users = loadUsers(DATA_DIR);
    if (!Object.prototype.hasOwnProperty.call(users, user) || !checkPassword(users[user], String(body.pass || ''))){
      loginFailed(ip);
      return send(res, 401, {error:'Usuário ou senha incorretos'});
    }
    loginFails.delete(ip);
    setSessionCookie(req, res, newSession(user), SESSION_DAYS * 86400);
    logActivity(user, 'login', '-');
    return send(res, 200, {user});
  }

  if (p === '/api/logout' && req.method === 'POST'){
    const id = parseCookies(req)[COOKIE];
    if (id && sessions[id]){ delete sessions[id]; sessionsDirty = true; }
    setSessionCookie(req, res, '', 0);
    return send(res, 200, {ok:true});
  }

  const user = currentUser(req);
  if (!user) return send(res, 401, {error:'Faça login'});

  if (p === '/api/me' && req.method === 'GET') return send(res, 200, {user});

  // Proteção contra CSRF: requisições que alteram dados precisam deste cabeçalho, que um
  // site de terceiros não consegue enviar sem CORS (e aqui não há CORS).
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'propostas'){
    return send(res, 403, {error:'Cabeçalho ausente'});
  }

  if (p === '/api/kv' && req.method === 'GET'){
    return send(res, 200, {keys: await kvList(url.searchParams.get('prefix') || '')});
  }

  if (p.startsWith('/api/kv/')){
    let key;
    try{ key = decodeURIComponent(p.slice('/api/kv/'.length)); }catch{ return send(res, 400, {error:'Chave inválida'}); }
    if (!key || key.length > MAX_KEY) return send(res, 400, {error:'Chave inválida'});

    if (req.method === 'GET'){
      const v = await kvGet(key);
      return v === null ? send(res, 404, {error:'Não encontrado'}) : send(res, 200, v, 'text/plain; charset=utf-8');
    }
    if (req.method === 'PUT'){
      await kvSet(key, await readBody(req));
      logActivity(user, 'set', key);
      return send(res, 200, {ok:true});
    }
    if (req.method === 'DELETE'){
      await kvDelete(key);
      logActivity(user, 'delete', key);
      return send(res, 200, {ok:true});
    }
  }

  return send(res, 404, {error:'Não encontrado'});
}

const server = http.createServer(async (req, res) => {
  try{
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    const entry = STATIC[url.pathname];
    if (!entry || (req.method !== 'GET' && req.method !== 'HEAD')) return send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
    const [file, type, cache] = entry;
    const data = await fsp.readFile(path.join(ROOT, file));
    res.writeHead(200, {...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': cache});
    res.end(req.method === 'HEAD' ? undefined : data);
  }catch(err){
    console.error(err);
    if (!res.headersSent) send(res, err.status || 500, {error: err.status ? err.message : 'Erro interno'});
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Gerador de Propostas em http://${HOST}:${PORT} (dados em ${DATA_DIR})`);
  if (!Object.keys(loadUsers(DATA_DIR)).length){
    console.log('Nenhum usuário cadastrado. Crie um com: node server/manage.js add-user <nome>');
  }
});
