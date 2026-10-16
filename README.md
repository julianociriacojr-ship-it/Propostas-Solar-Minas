# Gerador de Propostas — Solar Minas

App de página única (`index.html`) para montar propostas comerciais e de manutenção da Solar Minas: importa a PCC (planilha de valores) e o catálogo de produtos (.xlsx), deixa escolher os produtos e fotos de cada proposta, e gera o documento final em `.docx` a partir de um modelo do Word. A geração do documento acontece no navegador; um servidor pequeno (pasta `server/`) guarda os dados num **banco compartilhado por toda a equipe**, com login.

## Armazenamento de dados: dois modos

O app escolhe o modo sozinho ao abrir:

- **Servidor (banco compartilhado)**: quando aberto pelo endereço da VPS. Pede usuário e senha, e todos os usuários leem e gravam os mesmos catálogo, modelos, fotos, banco de imagens e propostas. O canto superior direito mostra `👤 usuário · banco compartilhado`.
- **Local**: quando não há servidor (arquivo aberto direto, GitHub Pages, Netlify). Os dados ficam só naquele navegador (IndexedDB), como no app antigo.

Exceção: o rascunho de proposta ainda sem nome de cliente é separado por usuário, para um não sobrescrever o do outro. Quando duas pessoas editam a **mesma** proposta ao mesmo tempo, vale a última gravação.

### Levar os dados antigos para o servidor

Quem já usava o app no navegador vê, depois de fazer login, o botão **"⬆ Enviar dados deste navegador para o servidor"**. Ele copia catálogo, fotos, modelos e propostas salvas para o banco compartilhado. Se algum item já existir no servidor, o app pergunta se deve substituir ou manter. Os dados continuam no navegador como cópia de segurança.

Os botões **"Exportar dados (.json)"** / **"Importar dados (.json)"** continuam funcionando para levar uma proposta (sem fotos) manualmente.

## Instalar na VPS (Ubuntu)

Como root na VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/julianociriacojr-ship-it/Propostas-Solar-Minas/HEAD/deploy/install.sh | bash
```

O script (`deploy/install.sh`) instala Node.js e Caddy, baixa este repositório em `/opt/propostas`, cria o serviço `propostas` (systemd), configura HTTPS automático, backup diário e pede o nome do primeiro usuário. No fim ele mostra o endereço do app.

- **Endereço**: sem domínio próprio, usa um endereço gratuito do [sslip.io](https://sslip.io) com o IP da VPS, por exemplo `https://propostas.203-0-113-10.sslip.io`, com certificado HTTPS válido. Para usar um domínio próprio depois, aponte o DNS (registro A) para o IP da VPS e rode de novo: `DOMAIN=propostas.seudominio.com.br bash /opt/propostas/deploy/install.sh`.
- **Dados**: ficam em `/var/lib/propostas` (`kv/` com os dados, `users.json` com usuários e senhas em hash, `activity.log` com quem gravou o quê e quando).
- **Backup**: todo dia em `/var/backups/propostas` (mantém 30 dias). Para restaurar: `systemctl stop propostas`, extrair o `.tar.gz` em `/var/lib`, `systemctl start propostas`. Vale copiar esses arquivos para fora da VPS de vez em quando.

Administração na VPS:

```bash
propostas add-user maria      # cria usuário (ou troca a senha); pede a senha
propostas remove-user maria   # remove e derruba as sessões dele
propostas list-users
propostas update              # baixa a versão mais nova do GitHub e reinicia
propostas logs
propostas backup              # backup imediato
```

**Fluxo de atualização**: altere o código, faça push para a branch principal no GitHub e rode `propostas update` na VPS. Todo mundo recebe a versão nova ao recarregar a página.

## Como rodar localmente

```bash
node server/manage.js add-user teste   # cria um usuário (dados em ./data)
npm start                              # http://localhost:3000
```

Sem o servidor, abrir o `index.html` direto (ou `python3 -m http.server 8080`) também funciona, no modo local.

As bibliotecas (SheetJS/xlsx 0.18.5, JSZip 3.10.1, docx-preview 0.4.0) ficam em `vendor/`, sem depender de CDN.

## Tela em etapas

A proposta é montada em etapas, uma por vez, com **← Voltar / Próximo →** no rodapé (que também tem o **💾 Salvar**):

1. **🏠 Início** — abrir uma proposta salva (para continuar ou fazer revisão) ou **+ Nova proposta**.
2. **Cliente** — tipo (comercial/manutenção), dados do cliente e prazos. Mostra qual modelo .docx será usado.
3. **Valores** — PCC: importar, ajustar MKP/negociação, nota.
4. **Produtos** — buscar no catálogo, incluir, fotos.
5. **Gerar** — conferência com ✅/⚠️ de cada etapa (com botão para ir corrigir), pré-visualização e download do .docx.

A barra do topo mostra ✓ nas etapas prontas e ⚠️ no que falta (ex.: produto sem foto). Nenhuma etapa bloqueia: dá para pular e voltar. **⚙️ Configurações** fica à parte, com o que se faz uma vez para a equipe: modelos .docx, planilha do catálogo, banco de imagens e exportar/importar .json.

**Modelos .docx**: ficam salvos no banco do servidor (chaves `modelo` e `modeloManutencao`) e carregam sozinhos para todos. Para trocar, envie o novo em ⚙️ Configurações. Os modelos não ficam no GitHub de propósito (o repositório é público).

## Custo, MKP e negociação (internos)

Ao importar a PCC, o app lê também a coluna **Custo**, o **MKP** de cada item e o **Índice** de cada bloco (a célula ao lado de "Indice" no título do bloco; 0,90 = 10% de negociação). Na tabela do Passo 1:

- **Vlr. Unit. = Custo × MKP ÷ Índice**, a mesma conta da planilha.
- Mudar o **MKP** de um item recalcula o preço dele; digitar o **Vlr. Unit.** à mão recalcula o MKP.
- Cada bloco tem o campo **🔒 Negociação %** na faixa do bloco; mudar recalcula todos os itens com custo daquele bloco.
- Cada bloco tem **+ Item neste bloco** (linha nova no fim daquele bloco) e, exceto o principal, **✕ bloco**. **+ Novo bloco** cria um bloco extra, que vira uma tabela própria no documento.
- Custo, MKP e negociação ficam salvos na proposta, mas **não vão para o documento do cliente**: a tabela e os blocos do .docx continuam iguais (material, qtd., un., valor unitário e total).

## Cadastro de produtos: foto obrigatória e sem repetição

- **+ Novo produto** só salva com foto (ou com uma foto do banco de imagens que bata exato com o nome).
- Enquanto você digita o nome, o formulário mostra os produtos já cadastrados com nome igual ou parecido, com o botão **Usar este na proposta**. Nome igual (ignorando acento, maiúscula, plural e ordem das palavras) bloqueia o cadastro; parecido pede confirmação. Código repetido é bloqueado sem diferenciar maiúscula.
- **📷 Produtos sem foto (N)** lista o que ainda falta foto, com anexar direto.
- **🔍 Procurar duplicados** agrupa produtos com mesmo código ou mesmo nome; **Manter este** junta o grupo num cadastro só (a foto passa para o que ficou e propostas antigas que usavam o código removido passam a usar o que ficou).
- No modo servidor, o catálogo é relido do banco antes de cada gravação: duas pessoas cadastrando ao mesmo tempo não apagam o cadastro uma da outra.
- Reimportar a planilha do catálogo pergunta o que fazer com produtos que estão no app mas não na planilha (antes eles sumiam).

## Banco de imagens (fotos dos produtos)

O banco de imagens é uma galeria dentro do app (página **🖼️ Imagens**), guardada no servidor para toda a equipe. Envie a pasta de fotos uma vez arrastando para a área da página (aceita pasta com subpastas) ou pelos botões; depois a foto de qualquer produto é escolhida pelo botão **🖼️ Do banco** (na busca, em Produtos incluídos, em Produtos sem foto e no + Novo produto), com as fotos de nome parecido aparecendo primeiro. Foto anexada do computador a um produto entra no banco sozinha, com o nome do produto. A galeria tem busca pelo nome, ✏️ para renomear e 🗑 para apagar. Renomear ou apagar não mexe nos produtos: cada produto guarda a própria cópia da foto. Vale renomear com o nome do produto, que é o que o app usa para sugerir a foto certa. Cada imagem tem uma miniatura (`banco_mini:...`) para a galeria abrir rápido.

Detalhes do casamento automático:

No Passo 2 (Catálogo), o botão **"🖼️ Banco de imagens"** deixa subir uma pasta inteira de fotos de uma vez, sem precisar renomear nada:

- Cada arquivo é comparado primeiro com o **Código Interno** do produto e, se não bater, com o **nome do produto** (tolerando acento, plural, ordem das palavras, etc.).
- Bateu exato (código ou nome) → já vem marcado pra anexar direto ao produto. Bateu "parecido" → fica como sugestão, você confere antes de confirmar.
- Toda imagem enviada fica guardada no banco, mesmo a que não bate com nenhum produto agora — assim ela é reaproveitada automaticamente quando você cadastrar ou incluir esse produto depois.
- Ao incluir um produto novo numa proposta (pela busca, pela sincronização com a PCC, ou cadastrando um produto novo), o app já procura sozinho no banco: achou exato, anexa na hora; achou "parecido", aparece um aviso na lista de "Produtos incluídos" pra você confirmar com um clique.
- Na própria busca de produtos (Passo 2), quem ainda não tem foto mostra um botão **"📷 Anexar foto"** — escolhe o arquivo ali mesmo, sem precisar incluir o produto na proposta antes. A foto é salva direto no catálogo, então já fica disponível em qualquer proposta futura.
- O botão **"🔄 Sincronizar catálogo com o banco"** revarre todo o catálogo em busca de produtos sem foto que batam com alguma imagem já salva — útil depois de subir fotos novas ou cadastrar produtos novos, sem precisar reselecionar a pasta.

## Pré-visualização do documento

O botão **"👁️ Pré-visualizar documento"** gera a proposta (mesmo processo do "Gerar proposta") e mostra o resultado renderizado numa janela, antes de baixar — dá pra conferir dados, fotos e tabelas sem precisar abrir o Word. Usa a biblioteca [`docx-preview`](https://github.com/VolodymyrBaydalka/docxjs) (em `vendor/`, junto com XLSX e JSZip). A renderização não é 100% pixel-perfect ao Word (fontes e detalhes finos podem variar), mas é fiel o suficiente pra pegar erro de dado ou formatação antes de enviar pro cliente. O botão "⬇ Baixar .docx" dentro da prévia baixa exatamente o mesmo arquivo que foi renderizado, sem gerar de novo.

## Modelo comercial (.docx) — estrutura esperada

O modelo de proposta **comercial** foi redesenhado e o app espera esses placeholders exatos no `.docx`:

- **Dados do cliente**: `[NOME DO CLIENTE]`, `[NOME DO CONTATO]`, `[NOME DA OBRA]`, `[Nº DA PROPOSTA]`, `[DATA DE EMISSÃO]`. (O app também reconhece os tokens antigos — `[EMPRESA / CLIENTE FINAL]`, `[CONTATO RESPONSÁVEL]`, `[CÓDIGO]` — então um modelo antigo continua funcionando pros campos que ele tiver.)
- **Cards de produto**: o modelo pode vir com quantas caixas "PRODUTO N —" quiser prontas (ex: 5, em branco) — o app usa a 1ª como molde: se a proposta tiver menos produtos que caixas prontas, as extras somem do documento final; se tiver mais, o app cria caixas novas clonando a mesma estrutura. Cada caixa precisa manter exatamente `[NOME DO PRODUTO]`, `[clique aqui e insira a foto do produto]`, `[inserir breve descrição do produto]` e `[inserir especificações técnicas do produto]` — se esse texto for substituído por um exemplo real no Word, o app avisa e bloqueia a geração (em vez de gerar todo mundo com os dados do exemplo).
- **Tabela de valores ("2.1 Itens Inclusos")**: o modelo vem com até 2 blocos já prontos (o principal, sem título, e "Bloco 2", com título) — mesma lógica dos cards: com 1 bloco de PCC só, o "Bloco 2" some do documento; com 3+, o app cria blocos extras clonando a estrutura do "Bloco 2". A linha de item usa `[Descrição do material]` e `[R$ 0,00]` (unitário e total) — quantidade e unidade não têm token, são preenchidas pela posição da célula.
- **Resumo "2.2 Valores"**: uma linha "Bloco N" + `[R$ 0,00]` por bloco (adicionada/removida junto com a tabela correspondente), mais "Valor total do sistema" + `[R$ 0,00]` e `([valor por extenso])`.
- **Prazos**: localizados pelo rótulo da linha ("Prazo de fabricação", "Prazo de instalação"), não por token — pode reformatar a tabela à vontade que continua funcionando, contanto que o rótulo continue igual.

O modelo de **manutenção** continua usando a lógica antiga (tokens `[MATERIAL / SERVIÇO]`, `[QTD.]`, etc.), sem mudanças.

A seção "Não Contemplado Nesta Proposta" (lista de itens editável) foi removida do app — no modelo comercial novo esse texto é fixo, dentro de "1.2 Informações Adicionais", e não é mais gerenciado pelo app.

## Publicar sem servidor (modo local)

O `index.html` também pode ser publicado no GitHub Pages ou no Netlify (há um `netlify.toml` pronto). Nesses casos não há login nem banco compartilhado: cada navegador guarda os próprios dados.

## Estrutura

```
index.html          # app completo (HTML + CSS + JS)
vendor/             # bibliotecas (xlsx, jszip, docx-preview)
server/server.js    # servidor: entrega o app, login e banco compartilhado
server/manage.js    # gerencia usuários (add-user, remove-user, list-users)
server/users.js     # senhas em hash (scrypt)
deploy/install.sh   # instalação/atualização na VPS Ubuntu
netlify.toml        # deploy sem servidor no Netlify (modo local)
.nojekyll           # deploy sem servidor no GitHub Pages (modo local)
```
