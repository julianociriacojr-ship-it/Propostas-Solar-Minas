# Gerador de Propostas — Solar Minas

App de página única (`index.html`) para montar propostas comerciais e de manutenção da Solar Minas: importa a PCC (planilha de valores) e o catálogo de produtos (.xlsx), deixa escolher os produtos e fotos de cada proposta, e gera o documento final em `.docx` a partir de um modelo do Word — tudo direto no navegador, sem servidor.

## Como rodar localmente

Não tem build nem dependências de Node — é só abrir o arquivo:

```bash
python3 -m http.server 8080
# depois acesse http://localhost:8080
```

(Abrir o `index.html` direto com duplo clique também funciona na maioria dos navegadores, mas alguns recursos, como `webkitdirectory` para importar pastas de fotos, funcionam melhor servido por http.)

## Armazenamento de dados

O app salva catálogo, modelo `.docx`, fotos e propostas por cliente automaticamente **neste navegador**, usando IndexedDB. Isso significa:

- Os dados persistem entre sessões no mesmo navegador/computador.
- **Não sincronizam** entre computadores, navegadores diferentes ou usuários diferentes — cada pessoa que abrir o app num aparelho novo começa com o catálogo vazio.
- Limpar os dados do navegador (ou usar aba anônima) apaga o que foi salvo.

Se no futuro for necessário compartilhar catálogo/propostas entre várias pessoas/aparelhos, o próximo passo natural é adicionar um backend (ex: Netlify Functions + banco de dados como Supabase/Firebase) para centralizar esse armazenamento — hoje o app funciona 100% client-side.

Use os botões **"Exportar dados (.json)"** / **"Importar dados (.json)"** para levar uma proposta (sem fotos) de um navegador para outro manualmente.

## Banco de imagens (fotos dos produtos)

No Passo 2 (Catálogo), o botão **"🖼️ Banco de imagens"** deixa subir uma pasta inteira de fotos de uma vez, sem precisar renomear nada:

- Cada arquivo é comparado primeiro com o **Código Interno** do produto e, se não bater, com o **nome do produto** (tolerando acento, plural, ordem das palavras, etc.).
- Bateu exato (código ou nome) → já vem marcado pra anexar direto ao produto. Bateu "parecido" → fica como sugestão, você confere antes de confirmar.
- Toda imagem enviada fica guardada no banco, mesmo a que não bate com nenhum produto agora — assim ela é reaproveitada automaticamente quando você cadastrar ou incluir esse produto depois.
- Ao incluir um produto novo numa proposta (pela busca, pela sincronização com a PCC, ou cadastrando um produto novo), o app já procura sozinho no banco: achou exato, anexa na hora; achou "parecido", aparece um aviso na lista de "Produtos incluídos" pra você confirmar com um clique.
- Na própria busca de produtos (Passo 2), quem ainda não tem foto mostra um botão **"📷 Anexar foto"** — escolhe o arquivo ali mesmo, sem precisar incluir o produto na proposta antes. A foto é salva direto no catálogo, então já fica disponível em qualquer proposta futura.
- O botão **"🔄 Sincronizar catálogo com o banco"** revarre todo o catálogo em busca de produtos sem foto que batam com alguma imagem já salva — útil depois de subir fotos novas ou cadastrar produtos novos, sem precisar reselecionar a pasta.

## Pré-visualização do documento

O botão **"👁️ Pré-visualizar documento"** gera a proposta (mesmo processo do "Gerar proposta") e mostra o resultado renderizado numa janela, antes de baixar — dá pra conferir dados, fotos e tabelas sem precisar abrir o Word. Usa a biblioteca [`docx-preview`](https://github.com/VolodymyrBaydalka/docxjs) (carregada via CDN, junto com XLSX e JSZip). A renderização não é 100% pixel-perfect ao Word (fontes e detalhes finos podem variar), mas é fiel o suficiente pra pegar erro de dado ou formatação antes de enviar pro cliente. O botão "⬇ Baixar .docx" dentro da prévia baixa exatamente o mesmo arquivo que foi renderizado, sem gerar de novo.

## Modelo comercial (.docx) — estrutura esperada

O modelo de proposta **comercial** foi redesenhado e o app espera esses placeholders exatos no `.docx`:

- **Dados do cliente**: `[NOME DO CLIENTE]`, `[NOME DO CONTATO]`, `[NOME DA OBRA]`, `[Nº DA PROPOSTA]`, `[DATA DE EMISSÃO]`. (O app também reconhece os tokens antigos — `[EMPRESA / CLIENTE FINAL]`, `[CONTATO RESPONSÁVEL]`, `[CÓDIGO]` — então um modelo antigo continua funcionando pros campos que ele tiver.)
- **Cards de produto**: o modelo pode vir com quantas caixas "PRODUTO N —" quiser prontas (ex: 5, em branco) — o app usa a 1ª como molde: se a proposta tiver menos produtos que caixas prontas, as extras somem do documento final; se tiver mais, o app cria caixas novas clonando a mesma estrutura. Cada caixa precisa manter exatamente `[NOME DO PRODUTO]`, `[clique aqui e insira a foto do produto]`, `[inserir breve descrição do produto]` e `[inserir especificações técnicas do produto]` — se esse texto for substituído por um exemplo real no Word, o app avisa e bloqueia a geração (em vez de gerar todo mundo com os dados do exemplo).
- **Tabela de valores ("2.1 Itens Inclusos")**: o modelo vem com até 2 blocos já prontos (o principal, sem título, e "Bloco 2", com título) — mesma lógica dos cards: com 1 bloco de PCC só, o "Bloco 2" some do documento; com 3+, o app cria blocos extras clonando a estrutura do "Bloco 2". A linha de item usa `[Descrição do material]` e `[R$ 0,00]` (unitário e total) — quantidade e unidade não têm token, são preenchidas pela posição da célula.
- **Resumo "2.2 Valores"**: uma linha "Bloco N" + `[R$ 0,00]` por bloco (adicionada/removida junto com a tabela correspondente), mais "Valor total do sistema" + `[R$ 0,00]` e `([valor por extenso])`.
- **Prazos**: localizados pelo rótulo da linha ("Prazo de fabricação", "Prazo de instalação"), não por token — pode reformatar a tabela à vontade que continua funcionando, contanto que o rótulo continue igual.

O modelo de **manutenção** continua usando a lógica antiga (tokens `[MATERIAL / SERVIÇO]`, `[QTD.]`, etc.), sem mudanças.

A seção "Não Contemplado Nesta Proposta" (lista de itens editável) foi removida do app — no modelo comercial novo esse texto é fixo, dentro de "1.2 Informações Adicionais", e não é mais gerenciado pelo app.

## Publicar e compartilhar

Como o app é um único `index.html` sem servidor, ele pode ser hospedado em qualquer lugar que sirva arquivos estáticos.

### GitHub Pages (grátis, direto deste repositório)

1. No GitHub, abra **Settings → Pages**.
2. Em "Build and deployment", escolha **Source: Deploy from a branch**, selecione a branch e a pasta `/ (root)` e salve.
3. Em 1 ou 2 minutos o app fica disponível em `https://<usuario>.github.io/Propostas-Solar-Minas/`.

O arquivo `.nojekyll` na raiz faz o GitHub servir os arquivos como estão. Observação: GitHub Pages só é gratuito para repositórios **públicos** (em conta free). Se o repositório for privado, use o Netlify (abaixo) ou Cloudflare Pages.

### Outras formas

- **Usar localmente**: baixar o `index.html` e abrir no navegador (ou `python3 -m http.server`). Dá pra mandar o arquivo por e-mail/WhatsApp para alguém usar.
- **Netlify na sua própria conta**: ver a seção abaixo.

## Deploy no Netlify

O repositório já inclui um `netlify.toml` configurado para publicar a raiz do projeto sem build:

1. No Netlify, "Add new site" → "Import an existing project" → conecte este repositório GitHub.
2. Build command: (vazio) — Publish directory: `.` (já vem definido no `netlify.toml`).
3. Cada push na branch conectada gera um novo deploy automático.

## Estrutura

```
index.html     # app completo (HTML + CSS + JS)
netlify.toml   # configuração de deploy do Netlify
.nojekyll      # faz o GitHub Pages servir os arquivos sem processar
```
