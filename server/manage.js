#!/usr/bin/env node
// Gerencia os usuários do app.
//   node server/manage.js add-user <nome>      cria ou troca a senha (pergunta a senha)
//   node server/manage.js remove-user <nome>
//   node server/manage.js list-users
// Usa DATA_DIR (padrão: ./data), o mesmo diretório do servidor.
'use strict';
const path = require('node:path');
const readline = require('node:readline');
const {loadUsers, saveUsers, hashPassword} = require('./users');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

function ask(question, hidden){
  return new Promise(resolve => {
    const rl = readline.createInterface({input:process.stdin, output:process.stdout, terminal:true});
    if (hidden){
      // não mostra a senha enquanto digita
      rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(s); };
    }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer); });
  });
}

async function main(){
  const [cmd, name] = process.argv.slice(2);
  const users = loadUsers(DATA_DIR);

  if (cmd === 'list-users'){
    const names = Object.keys(users);
    console.log(names.length ? names.join('\n') : '(nenhum usuário)');
    return;
  }
  if (!name || !/^[a-zA-Z0-9._-]{2,40}$/.test(name)){
    console.error('Uso: node server/manage.js add-user|remove-user <nome>  (letras, números, ponto, hífen)');
    process.exit(1);
  }
  if (cmd === 'add-user'){
    const pass = process.env.NEW_PASSWORD || await ask(`Senha para ${name}: `, true);
    if (pass.length < 8){ console.error('A senha precisa ter pelo menos 8 caracteres.'); process.exit(1); }
    const existed = !!users[name];
    users[name] = hashPassword(pass);
    saveUsers(DATA_DIR, users);
    console.log(existed ? `Senha de ${name} atualizada.` : `Usuário ${name} criado.`);
    return;
  }
  if (cmd === 'remove-user'){
    if (!users[name]){ console.error(`Usuário ${name} não existe.`); process.exit(1); }
    delete users[name];
    saveUsers(DATA_DIR, users);
    console.log(`Usuário ${name} removido. Sessões abertas dele deixam de valer.`);
    return;
  }
  console.error('Comandos: add-user <nome>, remove-user <nome>, list-users');
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
