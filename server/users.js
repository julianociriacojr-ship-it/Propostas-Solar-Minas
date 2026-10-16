// Usuários do app: guardados em DATA_DIR/users.json com a senha em hash (scrypt).
// Gerenciados pela linha de comando (ver manage.js), não pelo navegador.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function usersFile(dataDir){ return path.join(dataDir, 'users.json'); }

function loadUsers(dataDir){
  try{ return JSON.parse(fs.readFileSync(usersFile(dataDir), 'utf8')); }
  catch(err){ if (err.code === 'ENOENT') return {}; throw err; }
}

function saveUsers(dataDir, users){
  fs.mkdirSync(dataDir, {recursive:true});
  const tmp = usersFile(dataDir) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(users, null, 2), {mode:0o600});
  fs.renameSync(tmp, usersFile(dataDir));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')){
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return {salt, hash};
}

function checkPassword(user, password){
  if (!user || !user.salt || !user.hash) return false;
  const a = Buffer.from(hashPassword(password, user.salt).hash, 'hex');
  const b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {loadUsers, saveUsers, hashPassword, checkPassword};
