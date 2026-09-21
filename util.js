export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export const brl = v => (num(v) + 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const pct = v => Number.isFinite(v) ? (v * 100 + 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%' : '—';
export const qty = v => num(v).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const n2 = v => String(Math.round(num(v) * 100) / 100).replace('.', ',');
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const today = () => iso(new Date());
export const dt = s => new Date(s + 'T12:00:00');
export const addDays = (s, n) => { const d = dt(s); d.setDate(d.getDate() + n); return iso(d); };
export const addMonths = (s, n) => {
  const d = dt(s), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return iso(d);
};
export const fmtD = s => s ? s.split('-').reverse().join('/') : '—';
export const fmtM = s => dt(s + '-01').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
export const sum = (a, f = x => x) => a.reduce((s, x) => s + num(f(x)), 0);
export const brlShort = v => Math.abs(v) >= 1000 ? (v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil' : String(Math.round(v));

export function csv(nome, headers, rows) {
  const q = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const txt = '\ufeff' + [headers, ...rows].map(r => r.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = nome + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
