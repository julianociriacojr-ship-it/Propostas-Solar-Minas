#!/usr/bin/env bash
# Instala o Gerador de Propostas numa VPS Ubuntu (22.04 ou mais nova), como root.
#
#   curl -fsSL https://raw.githubusercontent.com/julianociriacojr-ship-it/Propostas-Solar-Minas/HEAD/deploy/install.sh | bash
#
# Opcional, antes do comando:
#   DOMAIN=propostas.seudominio.com.br   domínio próprio (o DNS já precisa apontar para a VPS).
#                                        Sem isso, usa um endereço gratuito do sslip.io com o IP da VPS.
#   BRANCH=main                          branch do GitHub a instalar (padrão: a principal do repositório)
#
# Pode rodar de novo quando quiser: atualiza o código e mantém os dados e usuários.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/julianociriacojr-ship-it/Propostas-Solar-Minas.git}"
BRANCH="${BRANCH:-}"
APP_DIR=/opt/propostas
DATA_DIR=/var/lib/propostas
BACKUP_DIR=/var/backups/propostas
SVC_USER=propostas

say(){ printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die(){ printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "rode como root (ou com sudo)."
command -v apt-get >/dev/null || die "este script é para Ubuntu/Debian."

say "Instalando pacotes básicos"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl git iproute2 ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node.js 22 (LTS)
NODE_MAJOR=0
command -v node >/dev/null && NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  say "Instalando Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

# Caddy (servidor web com HTTPS automático)
if ! command -v caddy >/dev/null; then
  # Outro servidor web ocupando a porta 80/443 impede o Caddy de pegar o certificado.
  if ss -ltnp 2>/dev/null | grep -E ':(80|443)\s' | grep -vq caddy; then
    ss -ltnp | grep -E ':(80|443)\s' || true
    die "já existe outro programa usando a porta 80 ou 443 (acima). Me avise qual é, para adaptar a instalação."
  fi
  say "Instalando Caddy"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

say "Baixando o app do GitHub"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin
  [ -n "$BRANCH" ] || BRANCH="$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  if [ -n "$BRANCH" ]; then git clone -q -b "$BRANCH" "$REPO_URL" "$APP_DIR"
  else git clone -q "$REPO_URL" "$APP_DIR"; fi
fi

id "$SVC_USER" >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin "$SVC_USER"
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R "$SVC_USER:$SVC_USER" "$DATA_DIR"
chmod 750 "$DATA_DIR"
chmod 700 "$BACKUP_DIR"

say "Configurando o serviço"
# Porta interna (só acessível pela própria VPS; o público entra pelo Caddy na 443).
# Mantém a da instalação anterior; na primeira vez procura uma livre a partir da 3100,
# para não disputar com outros apps já instalados (bots, painéis etc.).
PORT="$(sed -n 's/^Environment=PORT=//p' /etc/systemd/system/propostas.service 2>/dev/null || true)"
if [ -z "$PORT" ]; then
  PORT=3100
  while ss -ltn | awk '{print $4}' | grep -qE "[:.]$PORT\$"; do PORT=$((PORT + 1)); done
fi
echo "Porta interna: $PORT"
cat > /etc/systemd/system/propostas.service <<EOF
[Unit]
Description=Gerador de Propostas Solar Minas
After=network.target

[Service]
User=$SVC_USER
Environment=PORT=$PORT
Environment=HOST=127.0.0.1
Environment=DATA_DIR=$DATA_DIR
ExecStart=$(command -v node) $APP_DIR/server/server.js
Restart=always
RestartSec=3
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q propostas
systemctl restart propostas

# Atalho de administração: propostas add-user | remove-user | list-users | update | logs | backup
cat > /usr/local/bin/propostas <<EOF
#!/usr/bin/env bash
set -e
case "\$1" in
  add-user|remove-user|list-users)
    runuser -u $SVC_USER -- env DATA_DIR=$DATA_DIR $(command -v node) $APP_DIR/server/manage.js "\$@" ;;
  update)
    git -C $APP_DIR pull -q --ff-only && systemctl restart propostas && echo "Atualizado: \$(git -C $APP_DIR log -1 --format='%h %s')" ;;
  logs)
    journalctl -u propostas -n 100 --no-pager ;;
  backup)
    /etc/cron.daily/propostas-backup && ls -lh $BACKUP_DIR | tail -3 ;;
  *)
    echo "Uso: propostas add-user <nome> | remove-user <nome> | list-users | update | logs | backup" ;;
esac
EOF
chmod 755 /usr/local/bin/propostas

say "Configurando backup diário (guarda 30 dias em $BACKUP_DIR)"
cat > /etc/cron.daily/propostas-backup <<EOF
#!/bin/sh
tar czf $BACKUP_DIR/propostas-\$(date +%F).tar.gz -C $(dirname "$DATA_DIR") $(basename "$DATA_DIR")
find $BACKUP_DIR -name 'propostas-*.tar.gz' -mtime +30 -delete
EOF
chmod 755 /etc/cron.daily/propostas-backup

say "Configurando endereço e HTTPS"
if [ -z "${DOMAIN:-}" ]; then
  if [ -f /etc/caddy/propostas.caddy ]; then
    DOMAIN="$(head -1 /etc/caddy/propostas.caddy | awk '{print $1}')"
  else
    IP="$(curl -4 -fsS https://api.ipify.org || curl -4 -fsS https://ifconfig.me)"
    [ -n "$IP" ] || die "não consegui descobrir o IP público. Rode de novo com DOMAIN=..."
    DOMAIN="propostas.${IP//./-}.sslip.io"
  fi
fi
cat > /etc/caddy/propostas.caddy <<EOF
$DOMAIN {
	encode gzip
	request_body {
		max_size 100MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF
# Caddyfile padrão do pacote (página de exemplo na porta 80) é substituído;
# se já houver uma configuração própria, só acrescenta o site do app.
if [ ! -s /etc/caddy/Caddyfile ] || grep -q '/usr/share/caddy' /etc/caddy/Caddyfile; then
  echo 'import /etc/caddy/propostas.caddy' > /etc/caddy/Caddyfile
elif ! grep -q 'propostas.caddy' /etc/caddy/Caddyfile; then
  echo 'import /etc/caddy/propostas.caddy' >> /etc/caddy/Caddyfile
fi
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl reload caddy || systemctl restart caddy

if command -v ufw >/dev/null && ufw status | grep -q 'Status: active'; then
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
fi

if [ "$(propostas list-users)" = "(nenhum usuário)" ]; then
  say "Nenhum usuário cadastrado ainda"
  if [ -r /dev/tty ]; then
    read -r -p "Nome do primeiro usuário (ex.: juliano): " PRIMEIRO < /dev/tty
    [ -n "$PRIMEIRO" ] && propostas add-user "$PRIMEIRO" < /dev/tty
  fi
fi

sleep 2
if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then
  say "Pronto!"
  echo "Endereço do app:  https://$DOMAIN"
  echo "(o certificado HTTPS pode levar até 1 minuto na primeira vez)"
  echo
  echo "Comandos úteis:"
  echo "  propostas add-user <nome>     cria usuário ou troca a senha"
  echo "  propostas remove-user <nome>"
  echo "  propostas list-users"
  echo "  propostas update              baixa a versão mais nova do GitHub"
  echo "  propostas logs                mostra o log do servidor"
  echo "  propostas backup              faz um backup agora"
else
  journalctl -u propostas -n 30 --no-pager
  die "o serviço não respondeu. Veja o log acima."
fi
