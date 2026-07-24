# TikTok — automação do Patinhas

Node 22+, **zero dependências**. Publica vídeos e fotos, manda pro rascunho,
lê o perfil e lista os vídeos — tudo pela **API oficial** do TikTok
(Content Posting API + Display API + Login Kit).

Nada aqui é servido pelo site: a pasta `tools/` fica fora do deploy.

---

## O que dá e o que não dá (API oficial)

| Ação | |
|---|---|
| Publicar vídeo direto no perfil (Direct Post) | ✅ exige app **auditado** p/ sair público |
| Publicar carrossel de fotos | ✅ exige app **auditado** p/ sair público |
| Mandar vídeo pro rascunho/inbox (você finaliza no app) | ✅ funciona sem auditoria |
| Ler perfil (nome, seguidores, curtidas) | ✅ |
| Listar os vídeos públicos da conta + métricas | ✅ |
| **Ler / responder / ocultar comentários** | ❌ não existe na API pública |
| **Curtir / descurtir** | ❌ não existe na API |
| **Ler / enviar mensagens diretas (DM)** | ❌ não existe na API |
| Agendar post nativamente | ❌ você agenda do seu lado |
| Editar post publicado | ❌ |

> **Comentários e DM:** só a *Research API* (acadêmica, com aprovação especial)
> lê comentários — e mesmo assim só leitura. Bibliotecas não-oficiais que
> "logam como você" para comentar/curtir/mandar DM **violam os Termos do
> TikTok e derrubam a conta**; não usamos e não recomendamos.

### Sandbox (sem auditoria) × Produção (auditada)

- **Sem auditoria (padrão de todo app novo):** todo post é forçado a
  **SELF_ONLY** (privado, só você vê), não importa a privacidade escolhida.
  A conta usada precisa estar como privada na hora de postar. Dá pra liberar
  até ~5 contas de teste e ~15 posts/dia. Serve para validar tudo ponta a ponta.
- **Produção (auditada):** depois que o TikTok aprova o app no **Audit**, o
  Direct Post pode sair **público** (`--public`). A auditoria costuma levar
  **1 a 2 semanas** para um envio limpo e exige política de privacidade, vídeo
  de demonstração cobrindo cada escopo e descrição de uso dos dados.

Limites: ~15 posts/24h por conta (compartilhado entre apps) via Direct Post.

---

## Setup (uma vez)

**Passos 1 a 5 são no navegador, com a sua conta — eu não faço login por você.**

**1. Conta de desenvolvedor.** Entre em <https://developers.tiktok.com>, faça
login com o @ do Patinhas e aceite os termos de desenvolvedor.

**2. Criar o app.** Em *Manage apps* → *Connect an app*. Dê um nome e descrição.
Anote o **Client key** e o **Client secret** (em *Keys*).

**3. Adicionar produtos e escopos.** No app, adicione os produtos:
- **Login Kit** (obrigatório para o OAuth)
- **Content Posting API** (para publicar)
- **Display API** (para ler perfil e listar vídeos)

Em *Scopes*, marque: `user.info.basic`, `user.info.profile`, `user.info.stats`,
`video.list`, `video.upload`, `video.publish`. Alguns escopos só ficam
disponíveis depois da auditoria — marque o que aparecer.

**4. Redirect URI.** Em *Login Kit* → *Redirect URI*, cadastre uma URL HTTPS
que você controle, ex.: `https://patinhasbrasil.com.br/oauth/tiktok`. Ela não
precisa existir de verdade; você só vai copiar o `code` da barra de endereço.

**5. Verificar o domínio da mídia.** Para publicar por URL (`post`, `photos`),
o TikTok exige que o **domínio de onde a mídia é baixada** esteja verificado.
Em *Manage apps* → *URL properties*, adicione e verifique
`patinhasbrasil.com.br` (ou o domínio da Vercel onde você sobe os vídeos).
Sem isso, o `post` falha com `url_ownership_unverified`.
> Alternativa sem verificar domínio: use `upload <arquivo.mp4>` (envia o arquivo
> local direto) ou `draft <url>` (cai no rascunho).

**6. Preencha o `.env`:**

```bash
cd tools/tiktok && cp .env.example .env
```

Cole `TT_CLIENT_KEY`, `TT_CLIENT_SECRET` e `TT_REDIRECT_URI` (idêntico ao
cadastrado, inclusive a barra final, se houver).

**7. Autorize:**

```bash
node auth.mjs url
```

Abra a URL impressa, faça login e aprove. O navegador vai redirecionar para
uma página que provavelmente dá 404 — **isso é esperado**. O que importa é o
`?code=...` na barra de endereço. Copie esse valor e rode:

```bash
node auth.mjs exchange "COLE_O_CODE_AQUI"
```

Pronto: access token (24h, renova sozinho) e refresh token (365 dias) salvos
no `.env`.

```bash
node cli.mjs whoami
```

---

## Uso

```bash
node cli.mjs                        # lista todos os comandos
```

**Ler:**

```bash
node cli.mjs whoami                 # perfil + validade dos tokens
node cli.mjs videos 10              # últimos vídeos públicos + métricas
node cli.mjs creator                # opções/limites de publicação da conta
```

**Publicar por URL** (o TikTok baixa a mídia de um domínio **verificado** —
suba o vídeo no site primeiro e passe o link):

```bash
node cli.mjs post "https://patinhasbrasil.com.br/videos/rex.mp4" "Rex procura um lar 🐾"
node cli.mjs photos "https://.../1.jpg,https://.../2.jpg" "Feira de adoção neste sábado"
node cli.mjs status <publish-id>    # acompanha até PUBLISH_COMPLETE
```

**Publicar arquivo local** (não precisa de domínio verificado):

```bash
node cli.mjs upload "./rex.mp4" "Rex procura um lar 🐾"
```

**Mandar pro rascunho** (você finaliza no app, funciona sem auditoria):

```bash
node cli.mjs draft "https://patinhasbrasil.com.br/videos/rex.mp4"
```

> Enquanto o app não estiver auditado, tudo sai **privado (SELF_ONLY)**. Depois
> da aprovação, adicione `--public` para publicar aberto:
> `node cli.mjs post "<url>" "legenda" --public`.

---

## Tokens

O **access token vale 24h** e é renovado **automaticamente** antes de cada
chamada (usando o refresh token). O **refresh token vale 365 dias**; a cada
renovação o TikTok devolve um novo, então o prazo vai rolando enquanto você
usar. Se ficar mais de um ano sem usar, o refresh vence e é preciso refazer o
OAuth.

```bash
node cli.mjs refresh                # força a renovação na hora
```

O `whoami` avisa quando o refresh token está a menos de 30 dias de expirar.

---

## Segurança

- O `.env` tem os tokens e o *client secret* e **está no `.gitignore`** — nunca
  comite.
- Um token vazado dá acesso a publicar na conta. Se acontecer, gere um novo
  *Client secret* no painel do TikTok: isso invalida os tokens emitidos.
- Nunca use bibliotecas que "logam como você" para curtir/comentar/mandar DM:
  violam os Termos do TikTok e arriscam banir a conta do Patinhas.
