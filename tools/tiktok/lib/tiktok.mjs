// Cliente da TikTok API oficial (open.tiktokapis.com).
// Sem dependências: usa fetch nativo do Node 22.
//
// Produtos usados:
//   - Login Kit / OAuth v2   → token e refresh
//   - Display API            → perfil (user.info) e lista de vídeos (video.list)
//   - Content Posting API    → publicar vídeo/foto (video.publish) ou mandar
//                              pro rascunho/inbox (video.upload)
//
// O que a API oficial do TikTok NÃO oferece (por isso não existe aqui):
//   - Ler/postar/responder/ocultar comentários (só a Research API acadêmica lê)
//   - Curtir / descurtir
//   - Enviar ou ler mensagens diretas (DM)
// Ver o README para detalhes.

import { readFileSync, statSync } from 'node:fs';
import { loadEnv, saveEnv, required } from './env.mjs';

// Host das APIs de dados/publicação. A tela de autorização (login) fica em
// www.tiktok.com e é montada no auth.mjs.
const API = 'https://open.tiktokapis.com';

export class TikTokError extends Error {
  constructor(status, payload) {
    // O TikTok devolve erro em dois formatos: { error: {...} } (OAuth) e
    // { error: { code, message, log_id } } (v2). Cobrimos os dois.
    const e = payload?.error ?? {};
    const msg = e.message || e.error_description || e.log_id
      ? (e.message || e.error_description || `HTTP ${status}`)
      : `HTTP ${status}`;
    super(msg);
    this.name = 'TikTokError';
    this.status = status;
    this.code = e.code || e.error || e.error_type; // ex.: 'access_token_invalid'
    this.logId = e.log_id;
    this.payload = payload;
  }
}

export function client() {
  const env = loadEnv();
  required(env, 'TT_ACCESS_TOKEN', 'rode: node auth.mjs url  (e depois exchange)');
  return new TikTok(env);
}

class TikTok {
  constructor(env) {
    this.env = env;
    this.token = env.TT_ACCESS_TOKEN;
    this.openId = env.TT_OPEN_ID || null;
  }

  // ---------- HTTP ----------

  async request(path, { method = 'GET', query = {}, body } = {}) {
    // O access token vive só 24h — renova sozinho antes de cada chamada se
    // já venceu (e ainda houver refresh token válido).
    await this.ensureToken();

    const url = new URL(`${API}${path}`);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const init = { method, headers: { Authorization: `Bearer ${this.token}` } };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json; charset=UTF-8';
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new TikTokError(res.status, { error: { message: text.slice(0, 400) } });
    }
    // Nas APIs v2 o erro vem em json.error.code === 'ok' quando deu certo.
    const errCode = json?.error?.code;
    if (!res.ok || (errCode && errCode !== 'ok')) {
      throw new TikTokError(res.status, json);
    }
    return json;
  }

  get(path, query) { return this.request(path, { query }); }
  post(path, body, query) { return this.request(path, { method: 'POST', body, query }); }

  // ---------- Token ----------

  /** Segundos que faltam para o access token vencer (negativo = já venceu). */
  accessSecondsLeft() {
    const at = this.env.TT_ACCESS_EXPIRES_AT;
    if (!at) return null;
    return Math.floor((new Date(at).getTime() - Date.now()) / 1000);
  }

  /** Dias restantes do refresh token (365 dias no total), ou null. */
  refreshDaysLeft() {
    const at = this.env.TT_REFRESH_EXPIRES_AT;
    if (!at) return null;
    return Math.floor((new Date(at).getTime() - Date.now()) / 86_400_000);
  }

  /** Renova o access token se estiver vencido/quase. Chamado antes de cada request. */
  async ensureToken() {
    const left = this.accessSecondsLeft();
    // Renova com 2 min de folga. Se não sabemos a validade, não força.
    if (left === null || left > 120) return;
    if (!this.env.TT_REFRESH_TOKEN) return; // deixa a request falhar com msg clara
    await this.refreshToken();
  }

  /** Troca o refresh token por um novo access token (e novo refresh) e grava no .env. */
  async refreshToken() {
    const env = loadEnv();
    const clientKey = required(env, 'TT_CLIENT_KEY');
    const clientSecret = required(env, 'TT_CLIENT_SECRET');
    const refresh = required(env, 'TT_REFRESH_TOKEN', 'refaça o OAuth: node auth.mjs url');

    const form = new URLSearchParams({
      client_key: clientKey,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refresh,
    });
    const res = await fetch(`${API}/v2/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    });
    const json = await res.json();
    if (!res.ok || json.error) throw new TikTokError(res.status, json);

    const saved = persistToken(json);
    // Atualiza o objeto em memória para as próximas chamadas desta execução.
    this.token = saved.TT_ACCESS_TOKEN;
    this.openId = saved.TT_OPEN_ID || this.openId;
    this.env = { ...this.env, ...saved };
    return {
      accessDays: Math.round(json.expires_in / 86400),
      refreshDays: Math.round(json.refresh_expires_in / 86400),
    };
  }

  // ---------- Perfil (Display API) ----------
  // Campos básicos exigem 'user.info.basic'. Seguidores/curtidas/contagem de
  // vídeos exigem 'user.info.stats'; bio/verificado exigem 'user.info.profile'.

  me(fields) {
    const f = fields || [
      'open_id', 'union_id', 'display_name', 'avatar_url',
      'bio_description', 'is_verified', 'profile_deep_link',
      'follower_count', 'following_count', 'likes_count', 'video_count',
    ].join(',');
    return this.get('/v2/user/info/', { fields: f });
  }

  // ---------- Vídeos (Display API) ----------
  // Lista os vídeos PÚBLICOS da própria conta autenticada. Exige 'video.list'.

  videos(max = 10, cursor) {
    const fields = [
      'id', 'title', 'video_description', 'create_time', 'duration',
      'cover_image_url', 'share_url', 'embed_link',
      'view_count', 'like_count', 'comment_count', 'share_count',
    ].join(',');
    const body = { max_count: Math.min(max, 20) };
    if (cursor) body.cursor = Number(cursor);
    return this.post('/v2/video/list/', body, { fields });
  }

  // ---------- Publicação (Content Posting API) ----------
  // IMPORTANTE: enquanto o app não passar pelo Audit do TikTok, todo post sai
  // como SELF_ONLY (privado, só você vê). E o domínio das URLs de mídia
  // (PULL_FROM_URL) precisa estar VERIFICADO no painel de desenvolvedor.

  /** Query obrigatória antes de postar: diz opções de privacidade, limites e
   *  se a conta pode publicar agora. A UX oficial manda consultar isto antes. */
  creatorInfo() {
    return this.post('/v2/post/publish/creator_info/query/', {});
  }

  /** Monta o post_info comum a vídeo e foto. */
  #postInfo(title, opts = {}) {
    return {
      title: title ?? '',
      privacy_level: opts.privacy || 'SELF_ONLY',
      disable_comment: opts.disableComment ?? false,
      disable_duet: opts.disableDuet ?? false,
      disable_stitch: opts.disableStitch ?? false,
      ...(opts.brandContent ? { brand_content_toggle: true } : {}),
      ...(opts.brandOrganic ? { brand_organic_toggle: true } : {}),
      ...(opts.aigc ? { is_aigc: true } : {}),
    };
  }

  /** Publica um vídeo direto no perfil, baixando de uma URL HTTPS pública.
   *  O domínio da URL PRECISA estar verificado no painel. Exige 'video.publish'. */
  async postVideoByUrl(videoUrl, title, opts = {}) {
    const body = {
      post_info: this.#postInfo(title, opts),
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
    };
    return this.post('/v2/post/publish/video/init/', body);
  }

  /** Publica um carrossel de fotos direto no perfil, por URLs. Exige 'video.publish'. */
  async postPhotosByUrl(imageUrls, title, opts = {}) {
    if (!imageUrls.length) throw new Error('Passe ao menos 1 URL de imagem.');
    const body = {
      post_info: { ...this.#postInfo(title, opts), auto_add_music: opts.autoMusic ?? true },
      source_info: { source: 'PULL_FROM_URL', photo_images: imageUrls, photo_cover_index: 0 },
      post_mode: 'DIRECT_POST',
      media_type: 'PHOTO',
    };
    return this.post('/v2/post/publish/content/init/', body);
  }

  /** Manda o vídeo (por URL) para o INBOX/rascunho do TikTok, sem publicar.
   *  A pessoa termina de postar pelo app. Exige só 'video.upload' (mais fácil
   *  de aprovar) e não obriga o app a estar auditado para virar público. */
  draftVideoByUrl(videoUrl) {
    const body = { source_info: { source: 'PULL_FROM_URL', video_url: videoUrl } };
    return this.post('/v2/post/publish/inbox/video/init/', body);
  }

  /** Publica um vídeo a partir de um ARQUIVO LOCAL (upload em bloco único).
   *  Bom para arquivos até ~64MB; acima disso o TikTok pede upload fatiado.
   *  Se draft=true, cai no inbox (video.upload); senão publica (video.publish). */
  async postVideoFile(filePath, title, opts = {}, { draft = false } = {}) {
    const size = statSync(filePath).size;
    const source_info = {
      source: 'FILE_UPLOAD',
      video_size: size,
      chunk_size: size,
      total_chunk_count: 1,
    };
    const initPath = draft
      ? '/v2/post/publish/inbox/video/init/'
      : '/v2/post/publish/video/init/';
    const body = draft ? { source_info } : { post_info: this.#postInfo(title, opts), source_info };

    const init = await this.post(initPath, body);
    const uploadUrl = init?.data?.upload_url;
    const publishId = init?.data?.publish_id;
    if (!uploadUrl) throw new Error(`TikTok não devolveu upload_url: ${JSON.stringify(init)}`);

    // Sobe os bytes no upload_url (PUT direto, sem passar pelo host da API).
    const bytes = readFileSync(filePath);
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': String(size),
        'Content-Range': `bytes 0-${size - 1}/${size}`,
      },
      body: bytes,
    });
    if (!put.ok) {
      throw new Error(`Upload do arquivo falhou: HTTP ${put.status} ${await put.text()}`);
    }
    return { data: { publish_id: publishId } };
  }

  /** Consulta o andamento de um post/upload pelo publish_id devolvido no init. */
  status(publishId) {
    return this.post('/v2/post/publish/status/fetch/', { publish_id: publishId });
  }

  /** Fica consultando o status até concluir ou dar erro. */
  async waitForPost(publishId, { timeoutMs = 180_000, intervalMs = 4_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { data } = await this.status(publishId);
      const st = data?.status;
      if (st === 'PUBLISH_COMPLETE' || st === 'SEND_TO_USER_INBOX') return data;
      if (st === 'FAILED') {
        throw new Error(`Publicação falhou: ${data?.fail_reason || 'motivo desconhecido'}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`Timeout esperando o publish_id ${publishId} (último status: ${st})`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
}

/** Grava os campos de token do JSON de resposta do OAuth no .env. */
export function persistToken(json) {
  const now = Date.now();
  const saved = {
    TT_ACCESS_TOKEN: json.access_token,
    TT_REFRESH_TOKEN: json.refresh_token,
    TT_ACCESS_EXPIRES_AT: new Date(now + json.expires_in * 1000).toISOString(),
    TT_REFRESH_EXPIRES_AT: new Date(now + json.refresh_expires_in * 1000).toISOString(),
    TT_OPEN_ID: json.open_id ?? '',
    TT_SCOPE: json.scope ?? '',
  };
  saveEnv(saved);
  return saved;
}
