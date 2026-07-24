// CLI do TikTok. Rode `node cli.mjs` para ver os comandos.

import { client, TikTokError } from './lib/tiktok.mjs';

const [cmd, ...args] = process.argv.slice(2);

const HELP = `
TikTok — Observatório do Patinhas

  Perfil e vídeos
    whoami                          dados da conta + validade dos tokens
    videos [limite]                 vídeos públicos da conta (máx. 20)
    creator                         opções de privacidade e limites de post

  Publicar  (URLs precisam ser HTTPS de um DOMÍNIO VERIFICADO no painel)
    post <url-video> "legenda" [--public]     publica vídeo direto no perfil
    photos "url1,url2" "legenda" [--public]   carrossel de fotos
    upload <arquivo.mp4> "legenda" [--public] publica a partir de arquivo local
    draft <url-video>                         manda pro rascunho (não publica)
    status <publish-id>                       checa o andamento de um post

  Token
    refresh                         renova o access token na hora

  ⚠ Enquanto o app NÃO passar pelo Audit do TikTok, todo post sai como
    SELF_ONLY (privado, só você vê) — o --public só funciona depois de auditado.

  A API OFICIAL do TikTok NÃO permite (não há comando aqui pra isso):
    · ler / responder / ocultar comentários
    · curtir / descurtir
    · enviar ou ler mensagens diretas (DM)
`;

function out(x) {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, 2));
}

/** Lê --public da lista de args e devolve { privacy, rest } sem a flag. */
function parsePrivacy(list) {
  const rest = list.filter((a) => a !== '--public');
  const privacy = list.includes('--public') ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY';
  return { privacy, rest };
}

async function main() {
  if (!cmd || cmd === 'help' || cmd === '--help') return out(HELP);

  const tt = client();

  switch (cmd) {
    case 'whoami': {
      const me = await tt.me();
      out(me);
      const accSec = tt.accessSecondsLeft();
      const refDays = tt.refreshDaysLeft();
      if (accSec !== null) {
        out(accSec < 0
          ? '\n(access token vencido — será renovado sozinho na próxima chamada)'
          : `\nAccess token válido por mais ~${Math.round(accSec / 3600)}h.`);
      }
      if (refDays !== null) {
        out(refDays < 0
          ? '⚠ REFRESH TOKEN EXPIRADO — refaça o OAuth: node auth.mjs url'
          : refDays < 30
            ? `⚠ Refresh token expira em ${refDays} dias — refaça o OAuth antes disso.`
            : `Refresh token válido por mais ${refDays} dias.`);
      }
      return;
    }

    case 'videos':
      return out(await tt.videos(Number(args[0]) || 10));

    case 'creator':
      return out(await tt.creatorInfo());

    case 'post': {
      const { privacy, rest } = parsePrivacy(args);
      if (!rest[0]) throw new Error('Uso: post <url-video> "legenda" [--public]');
      const r = await tt.postVideoByUrl(rest[0], rest[1], { privacy });
      out(r);
      return out(`\nAcompanhe:  node cli.mjs status ${r?.data?.publish_id}`);
    }

    case 'photos': {
      const { privacy, rest } = parsePrivacy(args);
      if (!rest[0]) throw new Error('Uso: photos "url1,url2" "legenda" [--public]');
      const urls = rest[0].split(',').map((s) => s.trim()).filter(Boolean);
      const r = await tt.postPhotosByUrl(urls, rest[1], { privacy });
      out(r);
      return out(`\nAcompanhe:  node cli.mjs status ${r?.data?.publish_id}`);
    }

    case 'upload': {
      const { privacy, rest } = parsePrivacy(args);
      if (!rest[0]) throw new Error('Uso: upload <arquivo.mp4> "legenda" [--public]');
      const r = await tt.postVideoFile(rest[0], rest[1], { privacy });
      out(r);
      return out(`\nAcompanhe:  node cli.mjs status ${r?.data?.publish_id}`);
    }

    case 'draft': {
      if (!args[0]) throw new Error('Uso: draft <url-video>');
      const r = await tt.draftVideoByUrl(args[0]);
      out(r);
      return out('\nAbra o app do TikTok: o vídeo está na sua caixa de entrada pra finalizar.');
    }

    case 'status':
      if (!args[0]) throw new Error('Uso: status <publish-id>');
      return out(await tt.status(args[0]));

    case 'refresh': {
      const r = await tt.refreshToken();
      return out(`✓ Access token renovado (vale ~24h). Refresh token vale ${r.refreshDays} dias.`);
    }

    default:
      out(`Comando desconhecido: ${cmd}`);
      out(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  if (err instanceof TikTokError) {
    console.error(`\n✗ TikTok [${err.status}${err.code ? ` ${err.code}` : ''}]: ${err.message}`);
    if (err.code === 'access_token_invalid' || err.code === 'access_token_expired') {
      console.error('  → token inválido/expirado: node cli.mjs refresh (ou refaça o OAuth)');
    }
    if (err.code === 'scope_not_authorized' || err.code === 'scope_permission_missed') {
      console.error('  → falta escopo: refaça o OAuth com o escopo certo (node auth.mjs url)');
    }
    if (err.code === 'rate_limit_exceeded') {
      console.error('  → limite de uso atingido: espere e tente de novo');
    }
    if (err.code === 'url_ownership_unverified') {
      console.error('  → o domínio da URL de mídia não está verificado no painel de desenvolvedor');
    }
    if (err.logId) console.error(`  log_id: ${err.logId}`);
  } else {
    console.error(`\n✗ ${err.message}`);
  }
  process.exit(1);
});
