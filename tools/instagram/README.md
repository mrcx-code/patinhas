# Instagram — automação do Patinhas

Node 22+, **zero dependências**. Publica posts/stories/reels, lê e responde
comentários, curte, e lê/responde DMs.

Nada aqui é servido pelo site: a pasta `tools/` fica fora do deploy.

---

## O que dá e o que não dá

| Ação | |
|---|---|
| Postar feed, carrossel, reels, stories | ✅ |
| Ler / comentar / responder / ocultar comentários | ✅ |
| Curtir post, reels e comentário | ✅ (API de abr/2026) |
| Ler DMs e **responder** | ⚠️ só dentro de 24h após a pessoa escrever |
| **Iniciar** DM com alguém | ❌ impossível pela API oficial |
| Agendar post nativamente | ❌ você agenda do seu lado |
| Editar post publicado | ❌ |
| Enquete/sticker no story | ❌ |

Limites: 50–100 posts/24h · ~200 DMs/hora · 750 respostas privadas/hora.

---

## Setup (uma vez)

**Passos 1 a 4 são no navegador, com a sua conta — eu não faço login por você.**

**1. Conta profissional.** O @ do Patinhas precisa ser Business ou Creator
(Instagram → Configurações → Tipo de conta).

**2. App na Meta.** Em <https://developers.facebook.com/apps> → *Criar app* →
tipo **Business**. Dentro dele, adicione o produto **Instagram** →
*API com Instagram Login*.

**3. Redirect URI.** No painel do produto Instagram, cadastre uma URL de
redirecionamento — pode ser qualquer HTTPS que você controle, ex.
`https://patinhasbrasil.com.br/oauth/instagram`. Ela não precisa existir de
verdade; você só vai copiar o `code` da barra de endereço.

**4. Credenciais.** Copie o *Instagram App ID* e o *Instagram App Secret*.

**5. Preencha o `.env`:**

```bash
cd tools/instagram && cp .env.example .env
```

Abra o `.env` e cole `IG_APP_ID`, `IG_APP_SECRET` e `IG_REDIRECT_URI`
(exatamente igual ao cadastrado, inclusive barra final).

**6. Autorize:**

```bash
node auth.mjs url
```

Abra a URL impressa, aprove. O navegador vai redirecionar para uma página que
provavelmente dá erro 404 — **isso é esperado**. O que importa é o `?code=...`
na barra de endereço. Copie esse valor e rode:

```bash
node auth.mjs exchange "COLE_O_CODE_AQUI"
```

Pronto: token de 60 dias gravado no `.env`.

```bash
node cli.mjs whoami
```

---

## Uso

```bash
node cli.mjs                       # lista todos os comandos
```

**Publicar.** A Meta busca a mídia numa URL HTTPS pública — suba a imagem no
site primeiro e passe o link:

```bash
node cli.mjs post "https://patinhasbrasil.com.br/img/rex.jpg" "Rex procura um lar 🐾"
node cli.mjs story "https://patinhasbrasil.com.br/img/story.jpg"
```

**Responder e curtir:**

```bash
node cli.mjs comments <media-id>
node cli.mjs reply <comment-id> "Obrigada! 💚"
node cli.mjs like comment <comment-id>
```

**Ver o que chegou** (DMs + comentários novos, sem servidor nenhum):

```bash
node poll.mjs                      # uma passada
node poll.mjs --watch              # fica monitorando a cada 5 min
```

O `poll.mjs` já imprime o comando pronto pra responder cada item, e avisa
quando a janela de 24h de um DM está fechando.

---

## Token expira a cada 60 dias

Se esquecer, a automação para sem aviso.

```bash
node cli.mjs refresh
```

O `poll.mjs` e o `whoami` avisam quando faltam menos de 10 dias. Vale colocar
o `refresh` no Agendador de Tarefas do Windows uma vez por mês.

---

## Segurança

- O `.env` tem o token e **está no `.gitignore`** — nunca comite.
- Um token vazado dá acesso a postar e ler DMs. Se acontecer, troque o
  *App Secret* no painel da Meta: isso invalida os tokens emitidos.
- `.state.json` (controle do polling) também é local e ignorado pelo git.
