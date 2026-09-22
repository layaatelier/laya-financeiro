import { CONFIG } from './config.js';

export const TABLES = ['clientes', 'fornecedores', 'materias_primas', 'produtos', 'vendas', 'compras', 'lancamentos', 'encomendas', 'perdas', 'cartoes'];
// Tabelas novas: se ainda não foram criadas no Supabase, o sistema abre mesmo assim (lista vazia).
const OPCIONAIS = ['cartoes'];
export const cache = Object.fromEntries(TABLES.map(t => [t, []]));
export const isCloud = Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && globalThis.window?.supabase);
const sb = isCloud ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY) : null;
const LS = 'laya:';
let cb = () => {};
export const onChange = f => { cb = f; };

export const auth = {
  async session() {
    if (!isCloud) return { local: true };
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async signIn(email, password) { const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) throw error; },
  async signUp(email, password) { const { data, error } = await sb.auth.signUp({ email, password }); if (error) throw error; return data; },
  async signOut() { await sb.auth.signOut(); },
};

export async function load() {
  if (isCloud) {
    await Promise.all(TABLES.map(async t => {
      const { data, error } = await sb.from(t).select('*').order('created_at', { ascending: false }).limit(5000);
      if (error && OPCIONAIS.includes(t)) { console.warn(`Tabela ${t} indisponível: ${error.message}`); cache[t] = []; return; }
      if (error) throw error;
      cache[t] = data;
    }));
  } else {
    TABLES.forEach(t => { cache[t] = JSON.parse(localStorage.getItem(LS + t) || '[]'); });
  }
  cb();
}

const persist = t => { if (!isCloud) localStorage.setItem(LS + t, JSON.stringify(cache[t])); };

export async function insert(t, row) {
  if (isCloud) {
    const { data, error } = await sb.from(t).insert(row).select().single();
    if (error) throw error;
    row = data;
  } else {
    row = { ...row, id: crypto.randomUUID(), created_at: new Date().toISOString() };
  }
  if (!cache[t].some(x => x.id === row.id)) cache[t].unshift(row);
  persist(t); cb();
  return row;
}

export async function update(t, id, patch) {
  if (isCloud) {
    const { data, error } = await sb.from(t).update(patch).eq('id', id).select().single();
    if (error) throw error;
    patch = data;
  }
  const i = cache[t].findIndex(x => x.id === id);
  if (i >= 0) cache[t][i] = { ...cache[t][i], ...patch };
  persist(t); cb();
}

export async function remove(t, id) {
  if (isCloud) {
    const { error } = await sb.from(t).delete().eq('id', id);
    if (error) throw error;
  }
  cache[t] = cache[t].filter(x => x.id !== id);
  persist(t); cb();
}

// Tempo real: outras abas/usuários/dispositivos atualizam a tela automaticamente.
export function subscribe() {
  if (!isCloud) return;
  sb.channel('laya').on('postgres_changes', { event: '*', schema: 'public' }, p => {
    const a = cache[p.table];
    if (!a) return;
    if (p.eventType === 'DELETE') cache[p.table] = a.filter(x => x.id !== p.old.id);
    else {
      const i = a.findIndex(x => x.id === p.new.id);
      if (i >= 0) a[i] = p.new; else a.unshift(p.new);
    }
    cb();
  }).subscribe();
}

export function wipeLocal() {
  TABLES.forEach(t => localStorage.removeItem(LS + t));
}
