// CLI do Instagram. Rode `node cli.mjs` para ver os comandos.

import { client, IgError } from './lib/ig.mjs';

const [cmd, ...args] = process.argv.slice(2);

const HELP = `
Instagram — Patinhas

  Perfil
    whoami                          dados da conta + validade do token
    media [limite]                  últimos posts

  Publicar  (URLs precisam ser HTTPS públicas — use o domínio do site)
    post <url-imagem> "legenda"
    story <url-imagem|video> [--video]
    reel <url-video> "legenda" [url-capa]
    carousel "url1,url2,..." "legenda"

  Comentários
    comments <media-id>
    comment <media-id> "texto"
    reply <comment-id> "texto"
    hide <comment-id> [false]
    rmcomment <comment-id>

  Likes
    like media|comment <id>
    unlike media|comment <id>

  Direct  (só responder, dentro de 24h — não dá pra iniciar conversa)
    dms [limite]
    dm <conversation-id>
    send <user-id> "texto"
    pvreply <comment-id> "texto"    DM para quem comentou publicamente

  Token
    refresh                         renova por mais 60 dias
`;

function out(x) {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') return out(HELP);

  const ig = client();

  switch (cmd) {
    case 'whoami': {
      const me = await ig.me();
      const days = ig.tokenDaysLeft();
      out(me);
      if (days !== null) {
        out(days < 0
          ? `\n⚠ TOKEN EXPIRADO há ${-days} dias — rode: node cli.mjs refresh`
          : days < 10
            ? `\n⚠ Token expira em ${days} dias — rode: node cli.mjs refresh`
            : `\nToken válido por mais ${days} dias.`);
      }
      return;
    }

    case 'media':
      return out(await ig.media(Number(args[0]) || 10));

    case 'post':
      if (!args[0]) throw new Error('Uso: post <url-imagem> "legenda"');
      return out(await ig.publishImage(args[0], args[1]));

    case 'story':
      if (!args[0]) throw new Error('Uso: story <url> [--video]');
      return out(await ig.publishStory(args[0], { video: args.includes('--video') }));

    case 'reel':
      if (!args[0]) throw new Error('Uso: reel <url-video> "legenda" [url-capa]');
      return out(await ig.publishReel(args[0], args[1], args[2]));

    case 'carousel': {
      if (!args[0]) throw new Error('Uso: carousel "url1,url2" "legenda"');
      const urls = args[0].split(',').map((s) => s.trim()).filter(Boolean);
      return out(await ig.publishCarousel(urls, args[1]));
    }

    case 'comments':
      if (!args[0]) throw new Error('Uso: comments <media-id>');
      return out(await ig.comments(args[0]));

    case 'comment':
      if (!args[1]) throw new Error('Uso: comment <media-id> "texto"');
      return out(await ig.comment(args[0], args[1]));

    case 'reply':
      if (!args[1]) throw new Error('Uso: reply <comment-id> "texto"');
      return out(await ig.reply(args[0], args[1]));

    case 'hide':
      if (!args[0]) throw new Error('Uso: hide <comment-id> [false]');
      return out(await ig.hideComment(args[0], args[1] !== 'false'));

    case 'rmcomment':
      if (!args[0]) throw new Error('Uso: rmcomment <comment-id>');
      return out(await ig.deleteComment(args[0]));

    case 'like':
    case 'unlike': {
      const [kind, id] = args;
      if (!['media', 'comment'].includes(kind) || !id) {
        throw new Error(`Uso: ${cmd} media|comment <id>`);
      }
      return out(await ig[cmd](kind, id));
    }

    case 'dms':
      return out(await ig.conversations(Number(args[0]) || 20));

    case 'dm':
      if (!args[0]) throw new Error('Uso: dm <conversation-id>');
      return out(await ig.thread(args[0]));

    case 'send':
      if (!args[1]) throw new Error('Uso: send <user-id> "texto"');
      return out(await ig.sendMessage(args[0], args[1]));

    case 'pvreply':
      if (!args[1]) throw new Error('Uso: pvreply <comment-id> "texto"');
      return out(await ig.privateReply(args[0], args[1]));

    case 'refresh': {
      const r = await ig.refreshToken();
      return out(`✓ Token renovado — válido por ${r.days} dias (até ${r.expiresAt})`);
    }

    default:
      out(`Comando desconhecido: ${cmd}`);
      out(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof IgError) {
    console.error(`\n✗ Instagram [${err.status}${err.code ? ` code ${err.code}` : ''}]: ${err.message}`);
    if (err.code === 190) console.error('  → token inválido/expirado: node cli.mjs refresh');
    if (err.code === 10 || err.code === 200) console.error('  → falta permissão: refaça o OAuth com o escopo certo');
    if (err.code === 4 || err.code === 17) console.error('  → limite de uso atingido: espere e tente de novo');
  } else {
    console.error(`\n✗ ${err.message}`);
  }
  process.exit(1);
});
