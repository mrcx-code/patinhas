// Cliente da Instagram Graph API (rota "Instagram API with Instagram Login").
// Sem dependências: usa fetch nativo do Node 18+.

import { loadEnv, saveEnv, required } from './env.mjs';

const GRAPH = 'https://graph.instagram.com';

export class IgError extends Error {
  constructor(status, payload) {
    const e = payload?.error ?? {};
    super(e.message || `HTTP ${status}`);
    this.name = 'IgError';
    this.status = status;
    this.code = e.code;
    this.subcode = e.error_subcode;
    this.type = e.type;
    this.payload = payload;
  }
}

export function client() {
  const env = loadEnv();
  const token = required(env, 'IG_ACCESS_TOKEN', 'rode: node auth.mjs url');
  const userId = env.IG_USER_ID || 'me';
  const version = env.IG_API_VERSION || 'v23.0';
  return new Instagram({ token, userId, version, env });
}

class Instagram {
  constructor({ token, userId, version, env }) {
    this.token = token;
    this.userId = userId;
    this.version = version;
    this.env = env;
  }

  async request(path, { method = 'GET', params = {}, body } = {}) {
    const url = new URL(`${GRAPH}/${this.version}/${path.replace(/^\//, '')}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    url.searchParams.set('access_token', this.token);

    const init = { method };
    if (body) {
      init.headers = { 'Content-Type': 'application/json' };
      init.body = JSON.stringify(body);
    }

    const res = await fetch(url, init);
    const text = await res.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      throw new IgError(res.status, { error: { message: text.slice(0, 400) } });
    }
    if (!res.ok || json.error) throw new IgError(res.status, json);
    return json;
  }

  get(path, params) { return this.request(path, { params }); }
  post(path, params) { return this.request(path, { method: 'POST', params }); }
  del(path, params) { return this.request(path, { method: 'DELETE', params }); }

  // ---------- Perfil ----------

  me() {
    return this.get(this.userId, {
      fields: 'id,user_id,username,name,account_type,media_count,followers_count,profile_picture_url',
    });
  }

  media(limit = 10) {
    return this.get(`${this.userId}/media`, {
      fields: 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count',
      limit,
    });
  }

  // ---------- Publicação ----------
  // A Meta busca a mídia na URL: precisa ser HTTPS pública (o seu domínio na Vercel serve).

  async createContainer(params) {
    const { id } = await this.post(`${this.userId}/media`, params);
    return id;
  }

  /** Espera o processamento (vídeo/reels leva alguns segundos). */
  async waitForContainer(containerId, { timeoutMs = 180_000, intervalMs = 4_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const { status_code: status, status } = await this.get(containerId, {
        fields: 'status_code,status',
      });
      if (status === 'FINISHED') return;
      if (status === 'ERROR' || status === 'EXPIRED') {
        throw new Error(`Container ${containerId} falhou: ${status} ${status ?? ''}`.trim());
      }
      if (Date.now() > deadline) {
        throw new Error(`Timeout esperando o container ${containerId} (último status: ${status})`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  publishContainer(creationId) {
    return this.post(`${this.userId}/media_publish`, { creation_id: creationId });
  }

  /** Fluxo completo: cria container → espera → publica. */
  async publish(params, { wait = true } = {}) {
    const containerId = await this.createContainer(params);
    if (wait) await this.waitForContainer(containerId);
    return this.publishContainer(containerId);
  }

  publishImage(imageUrl, caption) {
    return this.publish({ image_url: imageUrl, caption }, { wait: false });
  }

  publishStory(mediaUrl, { video = false } = {}) {
    // Stories não aceitam legenda, nem stickers/enquete via API.
    const params = { media_type: 'STORIES' };
    params[video ? 'video_url' : 'image_url'] = mediaUrl;
    return this.publish(params, { wait: video });
  }

  publishReel(videoUrl, caption, coverUrl) {
    return this.publish({
      media_type: 'REELS',
      video_url: videoUrl,
      caption,
      cover_url: coverUrl,
    });
  }

  /** urls: array de 2 a 10 URLs. Detecta vídeo pela extensão. */
  async publishCarousel(urls, caption) {
    if (urls.length < 2 || urls.length > 10) {
      throw new Error('Carrossel aceita de 2 a 10 itens.');
    }
    const children = [];
    for (const url of urls) {
      const isVideo = /\.(mp4|mov)(\?|$)/i.test(url);
      const params = { is_carousel_item: true };
      if (isVideo) {
        params.media_type = 'VIDEO';
        params.video_url = url;
      } else {
        params.image_url = url;
      }
      const id = await this.createContainer(params);
      if (isVideo) await this.waitForContainer(id);
      children.push(id);
    }
    return this.publish(
      { media_type: 'CAROUSEL', children: children.join(','), caption },
      { wait: false },
    );
  }

  // ---------- Comentários ----------

  comments(mediaId, limit = 50) {
    return this.get(`${mediaId}/comments`, {
      fields: 'id,text,username,timestamp,like_count,hidden,replies{id,text,username,timestamp}',
      limit,
    });
  }

  comment(mediaId, message) {
    return this.post(`${mediaId}/comments`, { message });
  }

  reply(commentId, message) {
    return this.post(`${commentId}/replies`, { message });
  }

  hideComment(commentId, hide = true) {
    return this.post(commentId, { hide });
  }

  deleteComment(commentId) {
    return this.del(commentId);
  }

  // ---------- Likes (API de 22/04/2026, exige instagram_manage_engagement) ----------

  like(kind, id) {
    return this.post(`${this.userId}/likes`, { [`${kind}_id`]: id });
  }

  unlike(kind, id) {
    return this.del(`${this.userId}/likes`, { [`${kind}_id`]: id });
  }

  // ---------- Direct ----------
  // Só dá pra RESPONDER, dentro de 24h após a última mensagem da pessoa.
  // Não existe forma de iniciar conversa.

  conversations(limit = 20) {
    return this.get(`${this.userId}/conversations`, {
      platform: 'instagram',
      fields: 'id,updated_time,participants,messages.limit(1){id,created_time,from,message}',
      limit,
    });
  }

  thread(conversationId, limit = 20) {
    return this.get(conversationId, {
      fields: `messages.limit(${limit}){id,created_time,from,to,message,attachments}`,
    });
  }

  sendMessage(recipientId, text) {
    return this.request(`${this.userId}/messages`, {
      method: 'POST',
      body: { recipient: { id: recipientId }, message: { text } },
    });
  }

  /** DM para quem comentou publicamente — a única forma de "puxar" conversa. */
  privateReply(commentId, message) {
    return this.post(`${commentId}/private_replies`, { message });
  }

  // ---------- Token ----------

  /** Renova o token de 60 dias e grava no .env. Token precisa ter >24h de vida. */
  async refreshToken() {
    const url = new URL(`${GRAPH}/refresh_access_token`);
    url.searchParams.set('grant_type', 'ig_refresh_token');
    url.searchParams.set('access_token', this.token);
    const res = await fetch(url);
    const json = await res.json();
    if (!res.ok || json.error) throw new IgError(res.status, json);

    const expiresAt = new Date(Date.now() + json.expires_in * 1000).toISOString();
    saveEnv({ IG_ACCESS_TOKEN: json.access_token, IG_TOKEN_EXPIRES_AT: expiresAt });
    return { expiresAt, days: Math.round(json.expires_in / 86400) };
  }

  /** Dias restantes do token, ou null se não souber. */
  tokenDaysLeft() {
    const at = this.env.IG_TOKEN_EXPIRES_AT;
    if (!at) return null;
    return Math.floor((new Date(at).getTime() - Date.now()) / 86_400_000);
  }
}
