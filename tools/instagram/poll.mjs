// Polling: checa DMs e comentários novos sem precisar de servidor ou webhook.
// Roda na sua máquina, custo zero, nada exposto na internet.
//
//   node poll.mjs            → uma passada e sai (bom pro Agendador de Tarefas)
//   node poll.mjs --watch    → fica rodando, checa a cada 5 min
//   node poll.mjs --watch --interval 60

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { client, IgError } from './lib/ig.mjs';

const STATE_PATH = join(dirname(fileURLToPath(import.meta.url)), '.state.json');

function loadState() {
  if (!existsSync(STATE_PATH)) return { seenMessages: [], seenComments: [], lastRun: null };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { seenMessages: [], seenComments: [], lastRun: null };
  }
}

function saveState(state) {
  // Mantém a lista curta pra não crescer sem limite.
  state.seenMessages = state.seenMessages.slice(-500);
  state.seenComments = state.seenComments.slice(-500);
  state.lastRun = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
}

function hoursSince(iso) {
  return (Date.now() - new Date(iso).getTime()) / 3_600_000;
}

async function checkDMs(ig, state) {
  const found = [];
  let convs;
  try {
    convs = await ig.conversations(20);
  } catch (err) {
    if (err instanceof IgError && (err.code === 10 || err.code === 200)) {
      console.log('  (DMs indisponíveis — falta a permissão de mensagens)');
      return found;
    }
    throw err;
  }

  for (const conv of convs.data ?? []) {
    const msg = conv.messages?.data?.[0];
    if (!msg || state.seenMessages.includes(msg.id)) continue;

    // Ignora o que nós mesmos enviamos.
    if (String(msg.from?.id) === String(ig.userId)) {
      state.seenMessages.push(msg.id);
      continue;
    }

    state.seenMessages.push(msg.id);
    const h = hoursSince(msg.created_time);
    found.push({
      tipo: 'DM',
      de: msg.from?.username ?? msg.from?.id,
      userId: msg.from?.id,
      texto: msg.message,
      horas: h,
      janelaAberta: h < 24,
      conversationId: conv.id,
    });
  }
  return found;
}

async function checkComments(ig, state) {
  const found = [];
  const media = await ig.media(10);

  for (const item of media.data ?? []) {
    if (!item.comments_count) continue;
    let res;
    try {
      res = await ig.comments(item.id, 25);
    } catch (err) {
      if (err instanceof IgError && (err.code === 10 || err.code === 200)) continue;
      throw err;
    }

    for (const c of res.data ?? []) {
      if (state.seenComments.includes(c.id)) continue;
      state.seenComments.push(c.id);
      // Não avisa sobre comentários da própria conta.
      if (c.username && c.username === state.username) continue;
      found.push({
        tipo: 'comentário',
        de: c.username,
        texto: c.text,
        commentId: c.id,
        mediaId: item.id,
        permalink: item.permalink,
      });
    }
  }
  return found;
}

function report(items) {
  if (!items.length) {
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] nada novo.`);
    return;
  }
  console.log(`\n[${new Date().toLocaleTimeString('pt-BR')}] ${items.length} novidade(s):\n`);
  for (const it of items) {
    if (it.tipo === 'DM') {
      const janela = it.janelaAberta
        ? `janela aberta, ~${Math.max(0, 24 - Math.floor(it.horas))}h restantes`
        : 'JANELA FECHADA — não dá mais pra responder';
      console.log(`  💬 DM de @${it.de} (${janela})`);
      console.log(`     "${it.texto}"`);
      if (it.janelaAberta) console.log(`     responder:  node cli.mjs send ${it.userId} "sua resposta"`);
    } else {
      console.log(`  💭 comentário de @${it.de}`);
      console.log(`     "${it.texto}"`);
      console.log(`     responder:  node cli.mjs reply ${it.commentId} "sua resposta"`);
      console.log(`     curtir:     node cli.mjs like comment ${it.commentId}`);
    }
    console.log('');
  }
}

async function pass() {
  const ig = client();
  const state = loadState();

  const days = ig.tokenDaysLeft();
  if (days !== null && days < 10) {
    console.log(days < 0
      ? `⚠ TOKEN EXPIRADO — rode: node cli.mjs refresh`
      : `⚠ Token expira em ${days} dias — rode: node cli.mjs refresh`);
  }

  if (!state.username) {
    try {
      state.username = (await ig.me()).username;
    } catch { /* segue sem filtrar os próprios comentários */ }
  }

  const items = [...(await checkDMs(ig, state)), ...(await checkComments(ig, state))];
  saveState(state);
  report(items);
}

const watch = process.argv.includes('--watch');
const idx = process.argv.indexOf('--interval');
const intervalMin = idx !== -1 ? Number(process.argv[idx + 1]) || 5 : 5;

async function run() {
  try {
    await pass();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    if (!watch) process.exit(1);
  }
}

await run();
if (watch) {
  console.log(`\nMonitorando a cada ${intervalMin} min. Ctrl+C para parar.\n`);
  setInterval(run, intervalMin * 60_000);
}
