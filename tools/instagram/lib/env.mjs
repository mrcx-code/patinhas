// Leitor/escritor de .env sem dependências.
// O .env fica em tools/instagram/.env e está no .gitignore.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ENV_PATH = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env');

function parse(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv() {
  if (!existsSync(ENV_PATH)) return {};
  return parse(readFileSync(ENV_PATH, 'utf8'));
}

/** Grava/atualiza chaves no .env preservando comentários e ordem. */
export function saveEnv(updates) {
  const lines = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8').split(/\r?\n/) : [];
  const pending = new Map(Object.entries(updates));

  const next = lines.map((raw) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return raw;
    const eq = line.indexOf('=');
    if (eq === -1) return raw;
    const key = line.slice(0, eq).trim();
    if (!pending.has(key)) return raw;
    const value = pending.get(key);
    pending.delete(key);
    return `${key}=${value}`;
  });

  for (const [key, value] of pending) next.push(`${key}=${value}`);
  while (next.length && next[next.length - 1] === '') next.pop();
  writeFileSync(ENV_PATH, next.join('\n') + '\n', 'utf8');
}

/** Lê uma chave obrigatória, com mensagem de erro útil. */
export function required(env, key, hint) {
  const value = env[key];
  if (!value) {
    throw new Error(`Falta ${key} no ${ENV_PATH}${hint ? `\n  → ${hint}` : ''}`);
  }
  return value;
}
