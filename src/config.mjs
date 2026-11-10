import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(file = path.resolve('.env')) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const index = s.indexOf('=');
    if (index < 1) continue;
    const key = s.slice(0,index).trim();
    if (process.env[key] === undefined) process.env[key] = s.slice(index+1).trim().replace(/^['"]|['"]$/g, '');
  }
}
export function config() {
  return {
    host: process.env.HOST || '127.0.0.1',
    port: Number(process.env.PORT || '4173'),
    dbPath: process.env.DB_PATH || './data/annon-office.sqlite',
    demoMode: process.env.DEMO_MODE === 'true',
    openaiKey: process.env.OPENAI_API_KEY || '',
    openaiModel: process.env.OPENAI_MODEL || 'gpt-5.5',
  };
}
