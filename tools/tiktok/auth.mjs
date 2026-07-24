// OAuth v2 do TikTok — você faz o login no SEU navegador; este script só troca
// o código pelo token. Nenhuma senha passa por aqui.
//
//   node auth.mjs url              → imprime a URL de autorização (com PKCE)
//   node auth.mjs exchange <code>  → troca o código por access + refresh token
//
// TikTok exige PKCE para apps de desktop. Como este toolkit roda no seu PC,
// geramos o par code_verifier/code_challenge e guardamos o verifier no .env
// entre os dois passos.

import { createHash, randomBytes } from 'node:crypto';
import { loadEnv, saveEnv, required } from './lib/env.mjs';
import { persistToken } from './lib/tiktok.mjs';

const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/';
const AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';

// Escopos oficiais. Ajuste conforme o que o app foi aprovado a usar:
//   user.info.basic    → perfil básico (open_id, nome, avatar)
//   user.info.profile  → bio, link e selo de verificado
//   user.info.stats    → seguidores, curtidas, nº de vídeos
//   video.list         → listar os vídeos públicos da conta
//   video.upload       → mandar vídeo pro rascunho/inbox (não publica sozinho)
//   video.publish      → publicar direto no perfil (Direct Post)
// Não existem escopos oficiais de comentário/curtida/DM para apps comuns.
const SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'user.info.stats',
  'video.list',
  'video.upload',
  'video.publish',
];

const env = loadEnv();
const [cmd, arg] = process.argv.slice(2);

/** base64url sem padding, como o PKCE exige. */
function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makePkce() {
  const verifier = base64url(randomBytes(48)); // 43–128 chars
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function authUrl() {
  const clientKey = required(env, 'TT_CLIENT_KEY');
  const redirect = required(env, 'TT_REDIRECT_URI');

  const { verifier, challenge } = makePkce();
  const state = base64url(randomBytes(16));
  // Guarda o verifier e o state para o passo `exchange` conferir.
  saveEnv({ TT_PKCE_VERIFIER: verifier, TT_OAUTH_STATE: state });

  const u = new URL(AUTH_URL);
  u.searchParams.set('client_key', clientKey);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(','));
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function exchange(code) {
  const clientKey = required(env, 'TT_CLIENT_KEY');
  const clientSecret = required(env, 'TT_CLIENT_SECRET');
  const redirect = required(env, 'TT_REDIRECT_URI');
  const verifier = required(env, 'TT_PKCE_VERIFIER', 'rode antes: node auth.mjs url');

  // O TikTok devolve o code URL-encoded e às vezes com "*..." de sufixo.
  const clean = decodeURIComponent(code).replace(/\*.*$/, '');

  const form = new URLSearchParams({
    client_key: clientKey,
    client_secret: clientSecret,
    code: clean,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Troca do código falhou: ${JSON.stringify(json)}`);
  }

  const saved = persistToken(json);
  // Limpa o verifier já usado (não serve mais e é sensível).
  saveEnv({ TT_PKCE_VERIFIER: '' });

  return {
    openId: saved.TT_OPEN_ID,
    scope: saved.TT_SCOPE,
    accessDays: Math.round(json.expires_in / 86400),
    accessHours: Math.round(json.expires_in / 3600),
    refreshDays: Math.round(json.refresh_expires_in / 86400),
  };
}

try {
  if (cmd === 'url') {
    console.log('\nAbra no navegador, faça login e aprove os escopos.');
    console.log('Depois copie o valor de ?code= da barra de endereço:\n');
    console.log(authUrl());
    console.log('\nEm seguida rode:  node auth.mjs exchange "<code>"\n');
  } else if (cmd === 'exchange') {
    if (!arg) throw new Error('Uso: node auth.mjs exchange "<code>"');
    const r = await exchange(arg);
    console.log('\n✓ Tokens salvos no .env');
    console.log(`  open_id: ${r.openId}`);
    console.log(`  escopos: ${r.scope}`);
    console.log(`  access token vale ~${r.accessHours}h (renova sozinho)`);
    console.log(`  refresh token vale ${r.refreshDays} dias\n`);
  } else {
    console.log('Uso:\n  node auth.mjs url\n  node auth.mjs exchange "<code>"');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
}
