// OAuth do Instagram — você faz o login no SEU navegador; este script só troca o
// código pelo token. Nenhuma senha passa por aqui.
//
//   node auth.mjs url              → imprime a URL de autorização
//   node auth.mjs exchange <code>  → troca o código por token de 60 dias

import { loadEnv, saveEnv, required } from './lib/env.mjs';

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  // Likes (API de abr/2026). Se o Instagram recusar a URL dizendo que o escopo é
  // inválido, remova esta linha — o resto funciona igual, só sem curtir.
  'instagram_manage_engagement',
];

const env = loadEnv();
const [cmd, arg] = process.argv.slice(2);

function authUrl() {
  const appId = required(env, 'IG_APP_ID');
  const redirect = required(env, 'IG_REDIRECT_URI');
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', appId);
  u.searchParams.set('redirect_uri', redirect);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(','));
  return u.toString();
}

async function exchange(code) {
  const appId = required(env, 'IG_APP_ID');
  const secret = required(env, 'IG_APP_SECRET');
  const redirect = required(env, 'IG_REDIRECT_URI');

  // O Instagram às vezes devolve o code com "#_" grudado no fim.
  const clean = decodeURIComponent(code).replace(/#_$/, '');

  // 1) code → token curto (1h)
  const form = new URLSearchParams({
    client_id: appId,
    client_secret: secret,
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code: clean,
  });
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    body: form,
  });
  const short = await shortRes.json();
  if (!shortRes.ok || short.error_type || short.error) {
    throw new Error(`Troca do código falhou: ${JSON.stringify(short)}`);
  }

  // 2) token curto → token longo (60 dias)
  const longUrl = new URL('https://graph.instagram.com/access_token');
  longUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longUrl.searchParams.set('client_secret', secret);
  longUrl.searchParams.set('access_token', short.access_token);
  const longRes = await fetch(longUrl);
  const long = await longRes.json();
  if (!longRes.ok || long.error) {
    throw new Error(`Troca para token longo falhou: ${JSON.stringify(long)}`);
  }

  const expiresAt = new Date(Date.now() + long.expires_in * 1000).toISOString();
  saveEnv({
    IG_ACCESS_TOKEN: long.access_token,
    IG_USER_ID: String(short.user_id ?? ''),
    IG_TOKEN_EXPIRES_AT: expiresAt,
  });

  return { userId: short.user_id, expiresAt, days: Math.round(long.expires_in / 86400) };
}

try {
  if (cmd === 'url') {
    console.log('\nAbra no navegador, aprove, e copie o valor de ?code= da barra de endereço:\n');
    console.log(authUrl());
    console.log('\nDepois rode:  node auth.mjs exchange "<code>"\n');
  } else if (cmd === 'exchange') {
    if (!arg) throw new Error('Uso: node auth.mjs exchange "<code>"');
    const r = await exchange(arg);
    console.log(`\n✓ Token salvo no .env`);
    console.log(`  usuário: ${r.userId}`);
    console.log(`  expira em ${r.days} dias (${r.expiresAt})\n`);
  } else {
    console.log('Uso:\n  node auth.mjs url\n  node auth.mjs exchange "<code>"');
  }
} catch (err) {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
}
