import { CONFIG } from './config.js';
import * as DB from './db.js';
import * as O from './ops.js';
import { $, $$, esc, num, brl, pct, qty, n2, today, addDays, addMonths, fmtD, fmtM, sum, csv, brlShort } from './util.js';

const { byId } = O;
const D = () => DB.cache;

const state = {
  h: 60,
  dre: { mode: 'mes', val: today().slice(0, 7) },
  f: { receber: { status: 'abertos', q: '' }, pagar: { status: 'abertos', q: '' } },
  enc: { status: 'andamento' },
  rel: { mes: today().slice(0, 7) },
  reinv: (() => { try { return JSON.parse(localStorage.getItem('laya:reinvest')) || null; } catch { return null; } })() || { pct: '', split: { trafego: 60, reserva: 30, melhoria: 10 } },
};
const VIEWS = {};
let charts = [], after = null;

const NAV = [
  ['Visão geral', [['painel', 'Painel'], ['fluxo', 'Fluxo de caixa'], ['dre', 'DRE'], ['relatorios', 'Relatórios']]],
  ['Financeiro', [['receber', 'Contas a receber'], ['pagar', 'Contas a pagar']]],
  ['Operação', [['encomendas', 'Encomendas'], ['compras', 'Compras']]],
  ['Cadastros', [['produtos', 'Modelos'], ['clientes', 'Clientes'], ['fornecedores', 'Fornecedores'], ['insumos', 'Matérias-primas'], ['cartoes', 'Cartões e taxas']]],
];

const CAT = {
  receber: ['Vendas', 'Sinal de encomenda', 'Outras receitas', 'Saldo inicial'],
  pagar: ['Aluguel', 'Salários', 'Impostos', 'Energia e água', 'Marketing', 'Frete e embalagem', 'Tintas e acabamento', 'Pincéis e ferramentas', 'Manutenção das impressoras', 'Taxas de cartão/marketplace', 'Matéria-prima', 'Outros'],
};

/* ---------- Helpers de UI ---------- */

function toast(msg, err) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = ''; }, err ? 7000 : 3800);
}

const opts = (arr, lab, sel, ph) =>
  `<option value="">${ph}</option>` + arr.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(typeof lab === 'function' ? lab(x) : x[lab])}</option>`).join('');

const tbl = (heads, rows, empty = 'Nada por aqui ainda.') => rows.length
  ? `<div class="tw"><table><thead><tr>${heads.map(h => `<th class="${h[1] || ''}">${h[0]}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
  : `<div class="empty">${empty}</div>`;
const tr = (cells, cls = '') => `<tr class="${cls}">${cells.map(c => `<td class="${c[1] || ''}">${c[0]}</td>`).join('')}</tr>`;
const head = (t, sub, tools = '') => `<div class="head"><div><h2>${t}</h2>${sub ? `<p>${sub}</p>` : ''}</div><div class="tools">${tools}</div></div>`;
const kpi = (l, v, s = '', cls = '') => `<div class="kpi"><span>${l}</span><b class="${cls}">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;

function chart(sel, cfg) {
  Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
  Chart.defaults.color = '#7C6B67';
  charts.push(new Chart($(sel), cfg));
}

function fld(f, v = '') {
  const req = f.req ? 'required' : '', nm = `name="${f.k}"`;
  let inp;
  if (f.t === 'select') inp = `<select ${nm} ${req}>${f.opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`; }).join('')}</select>`;
  else if (f.t === 'textarea') inp = `<textarea ${nm} rows="2">${esc(v)}</textarea>`;
  else if (f.t === 'check') return `<label class="f chk ${f.w || ''}"><input ${nm} type="checkbox" ${v ? 'checked' : ''}><span>${f.l}</span></label>`;
  else inp = `<input ${nm} type="${f.t || 'text'}" ${f.t === 'number' ? `step="${f.step || 'any'}"` : ''} ${f.list ? `list="${f.list}"` : ''} value="${esc(v)}" ${req}>`;
  return `<label class="f ${f.w || ''}"><span>${f.l}</span>${inp}</label>`;
}

function openModal(title, body, onSubmit, wide) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<form class="sheet ${wide ? 'wide' : ''}"><header><h3>${title}</h3><button type="button" class="x" data-close aria-label="Fechar">×</button></header><div class="body">${body}</div><footer><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn primary">Salvar</button></footer></form>`;
  document.body.appendChild(m);
  m.addEventListener('mousedown', e => { if (e.target === m) m.remove(); });
  m.addEventListener('keydown', e => { if (e.key === 'Escape') m.remove(); });
  m.addEventListener('click', e => { if (e.target.closest('[data-close]')) m.remove(); });
  m.querySelector('form').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { if (await onSubmit(new FormData(e.target), m) !== false) m.remove(); }
    catch (err) { toast(err.message || String(err), true); }
    if (btn) btn.disabled = false;
  });
  m.querySelector('input:not([type=hidden]),select')?.focus();
  return m;
}

const rowBuilders = {};
const rowFicha = (r = {}) => `<div class="row" data-row><select name="f_mp">${opts(D().materias_primas, m => `${m.nome} (${m.unidade})`, r.mp_id, 'Material…')}</select><input name="f_q" type="number" step="any" min="0" placeholder="Qtd" value="${esc(r.qtd ?? '')}" aria-label="Quantidade por peça"><button type="button" class="x" data-act="rmRow" aria-label="Remover">×</button></div>`;
rowBuilders.ficha = rowFicha;

function openInfo(title, msg, actLabel, onAct) {
  const m = document.createElement('div');
  m.className = 'modal';
  m.innerHTML = `<div class="sheet"><header><h3>${title}</h3><button type="button" class="x" data-close aria-label="Fechar">×</button></header><div class="body"><p style="margin:0">${msg}</p></div><footer><button type="button" class="btn ghost" data-close>Fechar</button>${actLabel ? '<button type="button" class="btn primary" data-go>' + actLabel + '</button>' : ''}</footer></div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => {
    if (e.target === m || e.target.closest('[data-close]')) m.remove();
    else if (e.target.closest('[data-go]')) { m.remove(); onAct(); }
  });
  m.querySelector('[data-go]')?.focus();
}

/* ---------- Painel ---------- */

VIEWS.painel = () => {
  const t = today(), P = O.projecao(30), saldo = P.saldo0;
  const pend = D().lancamentos.filter(l => !l.data_pagamento);
  const win = (tp, a, b) => sum(pend.filter(l => l.tipo === tp && l.vencimento >= a && l.vencimento <= b), l => l.valor);
  const rec30 = win('receber', t, addDays(t, 30)), pag30 = win('pagar', t, addDays(t, 30));
  const recV = sum(pend.filter(l => l.tipo === 'receber' && l.vencimento < t), l => l.valor);
  const pagV = sum(pend.filter(l => l.tipo === 'pagar' && l.vencimento < t), l => l.valor);
  const m = t.slice(0, 7), pr = O.periodo('mes', m), R = O.dre(pr.ini, pr.fim), cob = O.cobertura();
  const risco = P.min.v < 0, atencao = !risco && cob !== null && cob < 30;
  const st = risco ? ['risco', 'Caixa fica negativo'] : atencao ? ['atencao', 'Cobertura curta'] : ['ok', 'Caixa saudável'];
  const msg = risco
    ? `O saldo previsto fica negativo: ${brl(P.min.v)} em ${fmtD(P.min.d)}. Antecipe recebimentos ou renegocie vencimentos.`
    : `Menor saldo previsto nos próximos 30 dias: ${brl(P.min.v)} em ${fmtD(P.min.d)}.`;
  const vazio = !D().lancamentos.length && !D().produtos.length;

  const prox = [...pend].sort((a, b) => a.vencimento.localeCompare(b.vencimento)).slice(0, 8);
  const baixos = D().materias_primas.filter(p => num(p.estoque_minimo) > 0 && num(p.estoque) <= num(p.estoque_minimo)).map(p => [p.nome, `${qty(p.estoque)} ${p.unidade}`, 'Comprar antes de faltar']);
  const andamento = D().encomendas.filter(e => e.status !== 'entregue').sort((a, b) => a.prazo.localeCompare(b.prazo));

  after = () => {
    chart('#c-proj', {
      type: 'line',
      data: { labels: P.pts.map(p => fmtD(p.d).slice(0, 5)), datasets: [{ data: P.pts.map(p => p.saldo), borderColor: '#94694A', backgroundColor: 'rgba(201,165,130,.22)', fill: true, tension: .2, pointRadius: 0, borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => brl(c.parsed.y) } } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: brlShort }, grid: { color: c => c.tick.value === 0 ? '#B04A5F' : '#F0E4DD' } } } },
    });
    const ms = []; for (let i = -5; i <= 2; i++) ms.push(addMonths(m + '-01', i).slice(0, 7));
    const agg = (tipo, paid) => ms.map(k => sum(D().lancamentos.filter(l => l.tipo === tipo && l.categoria !== 'Saldo inicial' && !!l.data_pagamento === paid && (l.data_pagamento || l.vencimento).slice(0, 7) === k), l => l.valor));
    chart('#c-mes', {
      type: 'bar',
      data: {
        labels: ms.map(fmtM), datasets: [
          { label: 'Entradas realizadas', data: agg('receber', true), backgroundColor: '#4B7866', stack: 'in' },
          { label: 'Entradas previstas', data: agg('receber', false), backgroundColor: '#A9C9B9', stack: 'in' },
          { label: 'Saídas realizadas', data: agg('pagar', true), backgroundColor: '#B04A5F', stack: 'out' },
          { label: 'Saídas previstas', data: agg('pagar', false), backgroundColor: '#E8B4BE', stack: 'out' },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: brlShort }, grid: { color: '#F0E4DD' } } } },
    });
  };

  return `${head('Painel', 'Entradas, saídas e previsão de caixa em tempo real.')}
  ${vazio ? `<div class="banner"><span>${DB.isCloud ? 'Comece cadastrando produtos, clientes e matérias-primas, ou lance um saldo inicial em Contas a receber (categoria "Saldo inicial").' : 'Sem dados ainda. Carregue um exemplo para explorar o sistema.'}</span>${DB.isCloud ? '' : '<button class="btn primary" data-act="seed">Carregar dados de exemplo</button>'}</div>` : ''}
  <section class="hero">
    <div class="hero-top">
      <div><div class="lbl">Saldo em caixa hoje</div><div class="big ${saldo < 0 ? 'out' : ''}">${brl(saldo)}</div><div class="sub">${msg}</div></div>
      <span class="pill ${st[0]}">${st[1]}</span>
    </div>
    <div class="chart-box"><canvas id="c-proj" aria-label="Saldo projetado dos próximos 30 dias"></canvas></div>
  </section>
  <div class="kpis">
    ${kpi('A receber em 30 dias', brl(rec30), '', 'in')}
    ${kpi('A pagar em 30 dias', brl(pag30), '', 'out')}
    ${kpi('Recebimentos vencidos', brl(recV), recV ? 'Cobrar clientes' : 'Nenhum', recV ? 'out' : '')}
    ${kpi('Pagamentos vencidos', brl(pagV), pagV ? 'Regularizar' : 'Nenhum', pagV ? 'out' : '')}
    ${kpi('Resultado do mês (DRE)', brl(R.res), `${R.n} venda(s) no mês`, R.res < 0 ? 'out' : 'in')}
    ${kpi('Encomendas em andamento', andamento.length, `${brl(sum(andamento, e => e.preco_total))} em pedidos`)}
    ${kpi('Cobertura do caixa', cob === null ? '—' : `${Math.floor(cob)} dias`, 'pela média de saídas de 90 dias')}
  </div>
  <div class="grid2">
    <div class="card"><h3>Entradas e saídas por mês</h3><div class="chart-box sm"><canvas id="c-mes"></canvas></div></div>
    <div class="card"><h3>Próximos vencimentos</h3>${prox.length ? `<ul class="list">${prox.map(l => `<li><span>${esc(l.descricao)}<small>${fmtD(l.vencimento)}${l.vencimento < t ? ' · vencido' : ''}</small></span><b class="${l.tipo === 'receber' ? 'in' : 'out'}">${l.tipo === 'receber' ? '+' : '−'} ${brl(l.valor)}</b></li>`).join('')}</ul>` : '<div class="empty">Sem contas em aberto.</div>'}</div>
  </div>
  <div class="grid2" style="margin-top:14px">
    <div class="card"><h3>Encomendas em andamento</h3>${andamento.length ? `<ul class="list">${andamento.slice(0, 6).map(e => `<li><span>${esc(e.cliente_nome)} · ${esc(e.produto_nome)}<small>${STATUS_ENC[e.status][1]} · prazo ${fmtD(e.prazo)}${e.prazo < t ? ' · atrasada' : ''}</small></span><b>${brl(e.preco_total)}</b></li>`).join('')}</ul>` : '<div class="empty">Nenhuma encomenda em andamento.</div>'}</div>
    <div class="card"><h3>Materiais abaixo do mínimo</h3>${baixos.length ? `<ul class="list">${baixos.map(b => `<li><span>${esc(b[0])}<small>${b[2]}</small></span><b class="out">${b[1]}</b></li>`).join('')}</ul>` : '<div class="empty">Materiais dentro do mínimo.</div>'}</div>
  </div>`;
};

/* ---------- Fluxo de caixa ---------- */

VIEWS.fluxo = () => {
  const h = state.h, P = O.projecao(h), t = today();
  const wk = [];
  for (let i = 0; i < P.pts.length; i += 7) {
    const s = P.pts.slice(i, i + 7);
    wk.push({ a: s[0].d, b: s.at(-1).d, ent: sum(s, x => x.ent), sai: sum(s, x => x.sai), saldo: s.at(-1).saldo });
  }
  const ext = D().lancamentos.filter(l => l.data_pagamento && l.data_pagamento >= addDays(t, -30)).sort((a, b) => b.data_pagamento.localeCompare(a.data_pagamento));
  after = () => chart('#c-fluxo', {
    type: 'bar',
    data: {
      labels: wk.map(w => fmtD(w.a).slice(0, 5)),
      datasets: [
        { type: 'bar', label: 'Entradas', data: wk.map(w => w.ent), backgroundColor: '#4B7866' },
        { type: 'bar', label: 'Saídas', data: wk.map(w => -w.sai), backgroundColor: '#B04A5F' },
        { type: 'line', label: 'Saldo no fim do período', data: wk.map(w => w.saldo), borderColor: '#94694A', backgroundColor: '#94694A', tension: .2, pointRadius: 3 },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } }, tooltip: { callbacks: { label: c => `${c.dataset.label}: ${brl(c.parsed.y)}` } } }, scales: { x: { grid: { display: false } }, y: { ticks: { callback: brlShort }, grid: { color: '#F0E4DD' } } } },
  });
  return `${head('Fluxo de caixa', 'Saldo real de hoje e projeção pelas contas a pagar e receber.', `<select data-state="h" aria-label="Horizonte">${[30, 60, 90, 180].map(x => `<option value="${x}" ${x === h ? 'selected' : ''}>Próximos ${x} dias</option>`).join('')}</select>`)}
  <div class="kpis">
    ${kpi('Saldo hoje', brl(P.saldo0), '', P.saldo0 < 0 ? 'out' : '')}
    ${kpi(`Saldo previsto em ${h} dias`, brl(P.pts.at(-1).saldo), '', P.pts.at(-1).saldo < 0 ? 'out' : 'in')}
    ${kpi('Menor saldo previsto', brl(P.min.v), fmtD(P.min.d), P.min.v < 0 ? 'out' : '')}
  </div>
  <div class="card"><h3>Projeção semanal</h3><div class="chart-box sm"><canvas id="c-fluxo"></canvas></div></div>
  <div class="card" style="margin-top:14px"><h3>Detalhe por semana</h3>
    ${tbl([['Período'], ['Entradas', 'r'], ['Saídas', 'r'], ['Saldo final', 'r']], wk.map(w => tr([[`${fmtD(w.a)} a ${fmtD(w.b)}`], [brl(w.ent), 'r in'], [brl(w.sai), 'r out'], [brl(w.saldo), `r ${w.saldo < 0 ? 'out' : ''}`]])))}
    <p class="hint">Contas vencidas e ainda em aberto entram na primeira semana.</p></div>
  <div class="card" style="margin-top:14px"><h3>Extrato dos últimos 30 dias</h3>
    ${tbl([['Data'], ['Descrição'], ['Entrada', 'r'], ['Saída', 'r']], ext.map(l => tr([[fmtD(l.data_pagamento)], [esc(l.descricao)], [l.tipo === 'receber' ? brl(l.valor) : '', 'r in'], [l.tipo === 'pagar' ? brl(l.valor) : '', 'r out']])), 'Nenhuma movimentação realizada nos últimos 30 dias.')}</div>`;
};

/* ---------- Contas a receber / pagar ---------- */

/* Forma de pagamento (contas a receber) */

const cartoesDe = forma => D().cartoes.filter(c => c.tipo === forma).sort((a, b) => O.cartaoLabel(a).localeCompare(O.cartaoLabel(b), 'pt-BR'));
const cartaoOpts = (forma, sel) => {
  const cs = cartoesDe(forma);
  return cs.length ? `<option value="">Escolha a bandeira…</option>` + cs.map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(O.cartaoLabel(c))} · ${n2(c.taxa)}%</option>`).join('')
    : `<option value="">Nenhum cartão de ${forma === 'debito' ? 'débito' : 'crédito'} cadastrado</option>`;
};

function pagFields(r = {}) {
  const forma = r.forma_pagamento || '';
  const card = ['credito', 'debito'].includes(forma);
  return `<div class="grid" style="margin-top:12px">
    ${fld({ k: 'forma_pagamento', l: 'Forma de pagamento', t: 'select', opts: [['', 'Não informada'], ...Object.entries(O.FORMAS)] }, forma)}
    <label class="f" data-pag-card ${card ? '' : 'hidden'}><span>Cartão / bandeira</span><select name="cartao_id" ${card && cartoesDe(forma).length ? 'required' : ''}>${card ? cartaoOpts(forma, r.cartao_id) : ''}</select></label>
    ${fld({ k: 'taxa_pct', l: 'Taxa (%)', t: 'number' }, r.taxa_pct ?? 0)}
    <p class="hint full" data-pag-res></p></div>`;
}

// Liga os campos: forma → lista de bandeiras; bandeira → taxa; mostra taxa e líquido.
function wirePag(m, getBruto) {
  const f = m.querySelector('form').elements, box = m.querySelector('[data-pag-card]'), res = m.querySelector('[data-pag-res]');
  const show = () => {
    const b = getBruto(), p = num(f.taxa_pct.value), tx = Math.round(b * p) / 100;
    res.textContent = b ? (p ? `Taxa: ${brl(tx)} · entra no caixa: ${brl(b - tx)}` : `Entra no caixa: ${brl(b)} (sem taxa)`) : '';
  };
  m.addEventListener('change', e => {
    if (e.target.name === 'forma_pagamento') {
      const fm = e.target.value, card = ['credito', 'debito'].includes(fm);
      box.hidden = !card;
      f.cartao_id.innerHTML = card ? cartaoOpts(fm) : '';
      f.cartao_id.required = card && cartoesDe(fm).length > 0;
      f.taxa_pct.value = 0;
      if (card && cartoesDe(fm).length === 1) { f.cartao_id.value = cartoesDe(fm)[0].id; f.taxa_pct.value = num(cartoesDe(fm)[0].taxa); }
    }
    if (e.target.name === 'cartao_id') f.taxa_pct.value = num(byId('cartoes', e.target.value)?.taxa);
    show();
  });
  m.addEventListener('input', show);
  show();
}

const readPag = (fd, valorBruto) => O.aplicarPagamento(valorBruto, fd.get('forma_pagamento'), fd.get('cartao_id'), fd.get('taxa_pct'));

const statusOf = l => l.data_pagamento ? ['pago', l.tipo === 'receber' ? 'Recebido' : 'Pago'] : l.vencimento < today() ? ['venc', 'Vencido'] : ['aberto', 'Em aberto'];

function viewLanc(tipo) {
  const rec = tipo === 'receber', F = state.f[tipo], t = today();
  let rows = D().lancamentos.filter(l => l.tipo === tipo);
  const aberto = rows.filter(l => !l.data_pagamento);
  const mes = t.slice(0, 7);
  const feitoMes = sum(rows.filter(l => l.data_pagamento?.slice(0, 7) === mes && l.categoria !== 'Saldo inicial'), l => l.valor);
  rows = rows.filter(l => F.status === 'todos' || (F.status === 'abertos' && !l.data_pagamento) || (F.status === 'vencidos' && !l.data_pagamento && l.vencimento < t) || (F.status === 'pagos' && l.data_pagamento));
  if (F.q) { const q = F.q.toLowerCase(); rows = rows.filter(l => `${l.descricao} ${l.parceiro} ${l.categoria} ${O.FORMAS[l.forma_pagamento] || ''} ${l.cartao_nome || ''}`.toLowerCase().includes(q)); }
  rows.sort((a, b) => F.status === 'pagos' ? b.data_pagamento.localeCompare(a.data_pagamento) : a.vencimento.localeCompare(b.vencimento));
  const body = rows.map(l => {
    const s = statusOf(l);
    return tr([
      [fmtD(l.vencimento)], [`${esc(l.descricao)}<small>${esc(l.categoria || '')}${l.parceiro ? ' · ' + esc(l.parceiro) : ''}${rec ? ` · ${l.forma_pagamento ? esc(l.cartao_nome || O.FORMAS[l.forma_pagamento]) : '<i>sem forma de pagamento</i>'}` : ''}</small>`],
      [`${brl(l.valor)}${num(l.taxa_valor) > 0 ? `<small>bruto ${brl(O.bruto(l))} · taxa ${brl(l.taxa_valor)}</small>` : ''}`, 'r'], [`<span class="pill ${s[0]}">${s[1]}${l.data_pagamento ? ' ' + fmtD(l.data_pagamento).slice(0, 5) : ''}</span>`],
      [`${l.data_pagamento ? `<button class="btn sm ghost" data-act="estornar" data-id="${l.id}">Desfazer</button>` : `<button class="btn sm" data-act="baixar" data-id="${l.id}">${rec ? 'Receber' : 'Pagar'}</button>`}
        <button class="btn sm ghost" data-act="editLanc" data-id="${l.id}">Editar</button><button class="btn sm ghost danger" data-act="delLanc" data-id="${l.id}">Excluir</button>`, 'acts'],
    ]);
  });
  return `${head(rec ? 'Contas a receber' : 'Contas a pagar', rec ? 'Parcelas de vendas e outras entradas.' : 'Compras, despesas fixas e variáveis.',
    `<select data-state="f.${tipo}.status" aria-label="Filtro">${[['abertos', 'Em aberto'], ['vencidos', 'Vencidos'], ['pagos', rec ? 'Recebidos' : 'Pagos'], ['todos', 'Todos']].map(([v, l]) => `<option value="${v}" ${F.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
     <input type="search" placeholder="Buscar" value="${esc(F.q)}" data-state="f.${tipo}.q" aria-label="Buscar"><button class="btn primary" data-act="newLanc" data-t="${tipo}">${rec ? 'Nova conta a receber' : 'Nova conta a pagar'}</button>`)}
  <div class="kpis">
    ${kpi('Total em aberto', brl(sum(aberto, l => l.valor)), `${aberto.length} conta(s)`)}
    ${kpi('Vencido', brl(sum(aberto.filter(l => l.vencimento < t), l => l.valor)), '', 'out')}
    ${kpi(rec ? 'Recebido no mês' : 'Pago no mês', brl(feitoMes), rec ? 'líquido, já sem taxas' : '', rec ? 'in' : 'out')}
    ${rec ? kpi('Taxas de cartão no mês', brl(sum(D().lancamentos.filter(l => l.tipo === 'receber' && l.data_pagamento?.slice(0, 7) === mes), l => l.taxa_valor)), `${D().lancamentos.filter(l => l.tipo === 'receber' && !l.forma_pagamento).length} conta(s) sem forma de pagamento`, 'out') : ''}
  </div>
  <div class="card">${tbl([['Vencimento'], ['Descrição'], ['Valor', 'r'], ['Situação'], ['', 'r']], body, 'Nenhuma conta neste filtro.')}</div>`;
}
VIEWS.receber = () => viewLanc('receber');
VIEWS.pagar = () => viewLanc('pagar');

function lancForm(tipo, id) {
  const r = id ? byId('lancamentos', id) : { vencimento: today() };
  const cats = [...new Set([...CAT[tipo], ...D().lancamentos.filter(l => l.tipo === tipo).map(l => l.categoria).filter(Boolean)])];
  const parts = (tipo === 'receber' ? D().clientes : D().fornecedores).map(x => x.nome);
  const F = [
    { k: 'descricao', l: 'Descrição', req: 1, w: 'full' }, { k: 'valor', l: tipo === 'receber' ? 'Valor bruto (R$)' : 'Valor (R$)', t: 'number', req: 1 }, { k: 'vencimento', l: 'Vencimento', t: 'date', req: 1 },
    { k: 'categoria', l: 'Categoria', list: 'dl-c' }, { k: 'parceiro', l: tipo === 'receber' ? 'Cliente' : 'Fornecedor', list: 'dl-p' },
    { k: 'data_pagamento', l: tipo === 'receber' ? 'Recebido em (opcional)' : 'Pago em (opcional)', t: 'date' },
    ...(id ? [] : [{ k: 'repetir', l: 'Repetir por (meses)', t: 'number', step: '1' }]),
  ];
  const rec = tipo === 'receber';
  const m = openModal(id ? 'Editar conta' : (rec ? 'Nova conta a receber' : 'Nova conta a pagar'),
    `<div class="grid">${F.map(f => fld(f, f.k === 'repetir' ? 1 : f.k === 'valor' && id ? O.bruto(r) : r[f.k] ?? '')).join('')}</div>${rec ? pagFields(r) : ''}
     <datalist id="dl-c">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist><datalist id="dl-p">${parts.map(c => `<option value="${esc(c)}">`).join('')}</datalist>
     ${id ? '' : '<p class="hint">Use "Repetir" para lançar despesas mensais fixas (aluguel, salários) de uma vez.</p>'}`,
    async fd => {
      const o = { tipo, descricao: fd.get('descricao').trim(), valor: num(fd.get('valor')), vencimento: fd.get('vencimento'), categoria: fd.get('categoria'), parceiro: fd.get('parceiro'), data_pagamento: fd.get('data_pagamento') || null };
      if (rec) Object.assign(o, readPag(fd, o.valor));
      if (id) return DB.update('lancamentos', id, o);
      const rep = Math.min(60, Math.max(1, Math.floor(num(fd.get('repetir'))) || 1));
      for (let i = 0; i < rep; i++) {
        await DB.insert('lancamentos', { ...o, descricao: rep > 1 ? `${o.descricao} (${i + 1}/${rep})` : o.descricao, vencimento: addMonths(o.vencimento, i), data_pagamento: i === 0 ? o.data_pagamento : null, origem: 'manual' });
      }
    });
  if (rec) wirePag(m, () => num(m.querySelector('[name=valor]').value));
}

/* ---------- Encomendas ---------- */

const STATUS_ENC = { orcamento: ['aberto', 'Orçamento'], producao: ['atencao', 'Em produção'], entregue: ['pago', 'Entregue'] };

const recebidoEnc = e => sum(D().lancamentos.filter(l => l.origem === 'encomenda' && l.origem_id === e.id && l.data_pagamento), O.bruto);
const faltaEnc = e => Math.max(0, Math.round((num(e.preco_total) - recebidoEnc(e)) * 100) / 100);

VIEWS.encomendas = () => {
  const F = state.enc, t = today(), mes = t.slice(0, 7);
  const all = D().encomendas, and = all.filter(e => e.status !== 'entregue');
  const entMes = all.filter(e => e.status === 'entregue' && (e.data_entrega || '').slice(0, 7) === mes);
  const lucroMes = sum(entMes, e => num(e.preco_total) - num(e.custo_total));
  const rows = all.filter(e => F.status === 'todas' || (F.status === 'andamento' ? e.status !== 'entregue' : e.status === F.status))
    .sort((a, b) => ['andamento', 'orcamento', 'producao'].includes(F.status) ? a.prazo.localeCompare(b.prazo) : b.data_pedido.localeCompare(a.data_pedido))
    .map(e => {
      const st = STATUS_ENC[e.status], atraso = e.status !== 'entregue' && e.prazo < t, falta = faltaEnc(e);
      const lucro = e.status === 'entregue' ? `<small>lucro ${brl(num(e.preco_total) - num(e.custo_total))} · ${pct((num(e.preco_total) - num(e.custo_total)) / num(e.preco_total))}</small>` : '';
      const acts = e.status === 'orcamento' ? `<button class="btn sm" data-act="iniciarEnc" data-id="${e.id}">Iniciar produção</button><button class="btn sm ghost danger" data-act="delEnc" data-id="${e.id}">Excluir</button>`
        : e.status === 'producao' ? `<button class="btn sm" data-act="entregarEnc" data-id="${e.id}">Entregar</button><button class="btn sm ghost danger" data-act="delEnc" data-id="${e.id}">Estornar</button>`
        : `<button class="btn sm ghost danger" data-act="delEnc" data-id="${e.id}">Estornar</button>`;
      return tr([
        [`${esc(e.cliente_nome)}<small>${esc(e.produto_nome)}${num(e.quantidade) > 1 ? ` ×${qty(e.quantidade)}` : ''}${e.descricao ? ' · ' + esc(e.descricao) : ''}</small>`],
        [fmtD(e.data_pedido)],
        [`${fmtD(e.prazo)}${atraso ? ' <span class="pill venc">atrasada</span>' : ''}${e.data_entrega ? `<small>entregue em ${fmtD(e.data_entrega)}</small>` : ''}`],
        [`${brl(e.preco_total)}${lucro}`, 'r'], [brl(recebidoEnc(e)), 'r in'], [brl(falta), `r ${falta > 0 ? 'out' : ''}`],
        [`<span class="pill ${st[0]}">${st[1]}</span>`], [acts, 'acts'],
      ]);
    });
  return `${head('Encomendas', 'Cada peça é feita sob pedido: sinal, produção, pintura e entrega.',
    `<select data-state="enc.status" aria-label="Filtro">${[['andamento', 'Em andamento'], ['orcamento', 'Orçamentos'], ['producao', 'Em produção'], ['entregue', 'Entregues'], ['todas', 'Todas']].map(([v, l]) => `<option value="${v}" ${F.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn primary" data-act="newEnc">Nova encomenda</button>`)}
  <div class="kpis">
    ${kpi('Em andamento', and.length, `${brl(sum(and, e => e.preco_total))} em pedidos`)}
    ${kpi('Já recebido (em andamento)', brl(sum(and, recebidoEnc)), 'sinais e pagamentos', 'in')}
    ${kpi('Falta receber (em andamento)', brl(sum(and, faltaEnc)), `${and.filter(e => e.prazo < t).length} atrasada(s)`, 'out')}
    ${kpi('Entregues no mês', entMes.length, brl(sum(entMes, e => e.preco_total)))}
    ${kpi('Lucro das entregas no mês', brl(lucroMes), 'receita − custo real', lucroMes < 0 ? 'out' : 'in')}
  </div>
  <div class="card">${tbl([['Cliente e peça'], ['Pedido'], ['Entrega prevista'], ['Total', 'r'], ['Recebido', 'r'], ['Falta receber', 'r'], ['Situação'], ['', 'r']], rows, 'Nenhuma encomenda neste filtro.')}</div>`;
};

function encForm() {
  const ms = D().produtos.filter(p => p.ativo !== false);
  if (!ms.length) return openInfo('Cadastre um modelo primeiro', 'Toda encomenda parte de um modelo (por exemplo, "Boneco 15 cm") com preço base e ficha técnica de materiais. Cadastre o primeiro modelo e volte aqui. Se ainda não cadastrou os materiais (filamento, tinta, verniz, embalagem), comece por Cadastros > Matérias-primas.', 'Cadastrar modelo', () => cadForm('produtos'));
  const m = openModal('Nova encomenda', `<div class="grid">
    ${fld({ k: 'cliente_nome', l: 'Nome do cliente', req: 1, list: 'dl-cli' })}
    ${fld({ k: 'produto_id', l: 'Modelo', t: 'select', opts: [['', 'Escolha…'], ...ms.map(p => [p.id, p.nome])], req: 1 })}
    ${fld({ k: 'descricao', l: 'Personalização (personagem, cores, detalhes)', t: 'textarea', w: 'full' })}
    ${fld({ k: 'quantidade', l: 'Quantidade', t: 'number' }, 1)}
    ${fld({ k: 'preco_total', l: 'Valor total (R$)', t: 'number', req: 1 })}
    ${fld({ k: 'sinal', l: 'Sinal (R$) · padrão 50%', t: 'number' }, 0)}
    ${fld({ k: 'data_pedido', l: 'Data do pedido e do sinal', t: 'date', req: 1 }, today())}
    ${fld({ k: 'prazo', l: 'Prazo de entrega', t: 'date', req: 1 }, addDays(today(), 15))}
    ${fld({ k: 'status', l: 'Situação inicial', t: 'select', opts: [['producao', 'Em produção (usa o material agora)'], ['orcamento', 'Orçamento (ainda não produzir)']] })}
    ${fld({ k: 'sinal_recebido', l: 'Sinal já recebido', t: 'check' }, true)}
    <p class="hint full" id="est"></p></div><datalist id="dl-cli">${D().clientes.map(c => `<option value="${esc(c.nome)}">`).join('')}</datalist>
    <p class="hint">Cliente novo é cadastrado automaticamente. Metade no pedido e metade na entrega é o padrão; altere o sinal se combinar diferente.</p>`, async fd => {
    await O.salvarEncomenda({
      cliente_nome: fd.get('cliente_nome'), produto_id: fd.get('produto_id'), descricao: fd.get('descricao').trim(), quantidade: num(fd.get('quantidade')),
      preco_total: num(fd.get('preco_total')), sinal: num(fd.get('sinal')), data_pedido: fd.get('data_pedido'), prazo: fd.get('prazo'),
      status: fd.get('status'), sinal_recebido: fd.get('sinal_recebido') === 'on',
    });
    toast('Encomenda registrada.');
  }, true);
  const upd = setPrice => {
    const f = m.querySelector('form').elements, p = byId('produtos', f.produto_id.value), est = m.querySelector('#est');
    if (!p) { est.textContent = ''; return; }
    const q = num(f.quantidade.value);
    if (setPrice) f.preco_total.value = Math.round(num(p.preco) * q * 100) / 100;
    const preco = num(f.preco_total.value), custo = num(p.custo) * q;
    if (!sinalManual) f.sinal.value = Math.round(preco * 50) / 100;
    const falta = Math.max(0, preco - num(f.sinal.value));
    est.textContent = `Custo estimado: ${brl(custo)}${preco ? ` · margem prevista: ${pct((preco - custo) / preco)}` : ''} · falta receber na entrega: ${brl(falta)}`;
  };
  let sinalManual = false;
  m.addEventListener('change', e => { if (['produto_id', 'quantidade'].includes(e.target.name)) upd(true); });
  m.addEventListener('input', e => {
    if (e.target.name === 'sinal') { sinalManual = true; upd(false); }
    if (e.target.name === 'preco_total') upd(false);
  });
}

function entregarForm(id) {
  const e = byId('encomendas', id);
  const saldo = D().lancamentos.find(l => l.origem === 'encomenda' && l.origem_id === id && l.categoria === 'Vendas');
  openModal('Entregar encomenda', `<p>${esc(e.cliente_nome)} · ${esc(e.produto_nome)} · <b>${brl(e.preco_total)}</b></p><div class="grid">
    ${fld({ k: 'data_entrega', l: 'Data da entrega', t: 'date', req: 1 }, today())}
    ${fld({ k: 'horas_pintura', l: 'Horas de pintura (reais)', t: 'number' }, e.horas_pintura)}
    ${fld({ k: 'valor_hora', l: 'Valor da hora (R$)', t: 'number' }, e.valor_hora)}
    ${fld({ k: 'outros_custos', l: 'Outros custos (R$)', t: 'number' }, 0)}
    ${fld({ k: 'saldo_recebido', l: `Saldo recebido na entrega${saldo ? ` (${brl(saldo.valor)})` : ''}`, t: 'check', w: 'full' }, true)}</div>
    <p class="hint">Material já consumido: ${brl(sum(e.consumo || [], c => c.custo))}. Receita e custo entram na DRE na data da entrega. Se você já retira pró-labore, use valor da hora 0 para não contar seu trabalho duas vezes.</p>`,
  async fd => {
    await O.entregarEncomenda(id, { data_entrega: fd.get('data_entrega'), horas_pintura: num(fd.get('horas_pintura')), valor_hora: num(fd.get('valor_hora')), outros_custos: num(fd.get('outros_custos')), saldo_recebido: fd.get('saldo_recebido') === 'on' });
    toast('Encomenda entregue.');
  });
}

function perdaForm(mpId) {
  if (!D().materias_primas.length) return openInfo('Cadastre uma matéria-prima primeiro', 'Para registrar uma perda, o material precisa existir no cadastro.', 'Cadastrar matéria-prima', () => cadForm('insumos'));
  openModal('Registrar perda ou falha', `<div class="grid">
    ${fld({ k: 'materia_prima_id', l: 'Material', t: 'select', opts: D().materias_primas.map(m => [m.id, `${m.nome} (${m.unidade})`]), req: 1 }, mpId)}
    ${fld({ k: 'quantidade', l: 'Quantidade perdida', t: 'number', req: 1 })}
    ${fld({ k: 'data', l: 'Data', t: 'date', req: 1 }, today())}
    ${fld({ k: 'motivo', l: 'Motivo', list: 'dl-m' })}</div>
    <datalist id="dl-m"><option value="Falha de impressão"><option value="Peça descolou da mesa"><option value="Tinta ressecada"><option value="Pintura refeita"><option value="Encomenda cancelada"></datalist>
    <p class="hint">A perda baixa o estoque e entra na DRE como despesa "Perdas e falhas de impressão".</p>`,
  async fd => { await O.registrarPerda({ materia_prima_id: fd.get('materia_prima_id'), quantidade: num(fd.get('quantidade')), data: fd.get('data'), motivo: fd.get('motivo') }); toast('Perda registrada.'); });
}

/* ---------- Compras ---------- */

VIEWS.compras = () => {
  const rows = [...D().compras].sort((a, b) => b.data.localeCompare(a.data) || b.created_at.localeCompare(a.created_at)).map(c => tr([
    [fmtD(c.data)], [`${esc(c.materia_prima_nome)}<small>${esc(c.fornecedor_nome || 'Sem fornecedor')}</small>`], [qty(c.quantidade), 'r'],
    [brl(c.valor_total), 'r'], [c.parcelas > 1 ? `${c.parcelas}x` : 'À vista/1x'],
    [`<button class="btn sm ghost danger" data-act="delCompra" data-id="${c.id}">Estornar</button>`, 'acts'],
  ]));
  return `${head('Compras de matéria-prima', 'Filamento, resina e embalagens: entram no estoque, atualizam o custo médio e geram contas a pagar.', '<button class="btn primary" data-act="newCompra">Nova compra</button>')}
  <div class="card">${tbl([['Data'], ['Matéria-prima'], ['Qtd', 'r'], ['Valor', 'r'], ['Pagamento'], ['', 'r']], rows, 'Nenhuma compra registrada.')}</div>`;
};

function compraForm() {
  if (!D().materias_primas.length) return openInfo('Cadastre uma matéria-prima primeiro', 'Para registrar uma compra, o material precisa existir no cadastro (por exemplo, "Filamento PLA cinza", em gramas).', 'Cadastrar matéria-prima', () => cadForm('insumos'));
  openModal('Nova compra', `<div class="grid">
    ${fld({ k: 'materia_prima_id', l: 'Matéria-prima', t: 'select', opts: D().materias_primas.map(m => [m.id, `${m.nome} (${m.unidade})`]), req: 1 })}
    ${fld({ k: 'fornecedor_id', l: 'Fornecedor', t: 'select', opts: [['', 'Sem fornecedor'], ...D().fornecedores.map(c => [c.id, c.nome])] })}
    ${fld({ k: 'data', l: 'Data', t: 'date', req: 1 }, today())}
    ${fld({ k: 'quantidade', l: 'Quantidade', t: 'number', req: 1 })}
    ${fld({ k: 'valor_total', l: 'Valor total (R$)', t: 'number', req: 1 })}
    ${fld({ k: 'parcelas', l: 'Parcelas', t: 'number', step: '1' }, 1)}
    ${fld({ k: 'primeiro_venc', l: '1º vencimento', t: 'date' }, today())}
    ${fld({ k: 'pago', l: 'Já pago no ato', t: 'check' }, false)}</div>`, async fd => {
    await O.salvarCompra({ materia_prima_id: fd.get('materia_prima_id'), fornecedor_id: fd.get('fornecedor_id'), data: fd.get('data'), quantidade: num(fd.get('quantidade')), valor_total: num(fd.get('valor_total')), parcelas: num(fd.get('parcelas')), primeiro_venc: fd.get('primeiro_venc'), pago: fd.get('pago') === 'on' });
    toast('Compra registrada.');
  });
}

/* ---------- DRE ---------- */

VIEWS.dre = () => {
  const S = state.dre, P = O.periodo(S.mode, S.val), A = O.dre(P.ini, P.fim), B = O.dre(P.pIni, P.pFim);
  const dl = (a, b) => b ? `${a >= b ? '+' : ''}${pct((a - b) / Math.abs(b))}` : '—';
  const line = (l, a, b, cls = '') => `<tr class="${cls}"><td>${l}</td><td class="r">${brl(a)}</td><td class="r muted">${A.liq ? pct(a / A.liq) : '—'}</td><td class="r muted">${brl(b)}</td><td class="r muted">${dl(a, b)}</td></tr>`;
  const cats = [...new Set([...Object.keys(A.desp), ...Object.keys(B.desp)])].sort((x, y) => (A.desp[y] || 0) - (A.desp[x] || 0));
  const per = S.mode === 'ano'
    ? `<input type="number" min="2000" max="2100" value="${S.val.slice(0, 4)}" data-state="dre.val" data-dre-year aria-label="Ano">`
    : `<input type="month" value="${S.val}" data-state="dre.val" aria-label="Mês">`;
  return `${head('DRE', 'Demonstração do resultado por competência, comparada ao período anterior.', `<select data-state="dre.mode" data-dre-mode aria-label="Tipo de período"><option value="mes" ${S.mode === 'mes' ? 'selected' : ''}>Mensal</option><option value="ano" ${S.mode === 'ano' ? 'selected' : ''}>Anual</option></select>${per}`)}
  <div class="card"><div class="tw"><table>
    <thead><tr><th>Descrição</th><th class="r">Período</th><th class="r">% da receita líquida</th><th class="r">Anterior</th><th class="r">Variação</th></tr></thead><tbody>
    ${line('Receita bruta de vendas', A.bruta, B.bruta, 'sub')}
    ${line('(−) Descontos', -A.desc, -B.desc, 'indent')}
    ${line('(=) Receita líquida', A.liq, B.liq, 'sub')}
    ${line('(−) Custo dos produtos vendidos (CMV)', -A.cmv, -B.cmv)}
    ${line('(=) Lucro bruto', A.lb, B.lb, 'sub')}
    ${cats.map(c => line(`(−) ${esc(c)}`, -(A.desp[c] || 0), -(B.desp[c] || 0), 'indent')).join('')}
    ${line('(−) Total de despesas operacionais', -A.totDesp, -B.totDesp, 'sub')}
    ${line('(+) Outras receitas', A.outras, B.outras)}
    ${line('(=) Resultado do período', A.res, B.res, 'total')}
    </tbody></table></div>
    <p class="hint">Vendas entram pela data da venda; despesas pelo vencimento. Compras de matéria-prima não são despesa: viram custo (CMV) quando o produto é vendido. O saldo inicial de caixa fica fora do resultado.</p></div>${reinvCard(A.res)}`;
};

const SUG = [['trafego', 'Tráfego pago e marketing'], ['reserva', 'Fundo de reserva / caixa'], ['melhoria', 'Melhoria operacional']];

function reinvCard(res) {
  const R = state.reinv, p = Math.min(100, Math.max(0, num(R.pct)));
  const valor = res > 0 ? Math.round(res * p) / 100 : 0;
  const restante = res - valor;
  const somaSplit = sum(SUG, ([k]) => R.split[k]);
  return `<div class="card" style="margin-top:14px"><h3>Reinvestimento e lucro</h3>
    <div class="tools" style="margin-bottom:12px"><label class="f"><span>% do lucro líquido a reinvestir</span><input type="number" min="0" max="100" step="any" placeholder="ex.: 30" value="${esc(R.pct)}" data-state="reinv.pct" aria-label="Percentual de reinvestimento"></label></div>
    <div class="kpis">
      ${kpi('Lucro líquido do período', brl(res), 'resultado da DRE', res < 0 ? 'out' : '')}
      ${kpi(`Reinvestimento${R.pct !== '' ? ` (${pct(p / 100)})` : ''}`, brl(valor), res > 0 ? '' : 'sem lucro para reinvestir')}
      ${kpi('Lucro restante', brl(restante), 'depois do reinvestimento', restante < 0 ? 'out' : 'in')}
    </div>
    <h3 style="font-size:17px">Sugestão de destino do reinvestimento</h3>
    ${tbl([['Destino'], ['% do reinvestimento', 'r'], ['Valor', 'r']], SUG.map(([k, l]) => tr([[l], [`<input type="number" min="0" max="100" step="any" value="${esc(R.split[k])}" data-state="reinv.split.${k}" aria-label="${esc(l)}" style="width:84px;text-align:right">`, 'r'], [brl(valor * num(R.split[k]) / 100), 'r']])).concat(tr([['Total'], [pct(somaSplit / 100), 'r'], [brl(valor * somaSplit / 100), 'r']], 'total')))}
    <p class="hint">${Math.abs(somaSplit - 100) > 0.01 ? `A soma das sugestões é ${pct(somaSplit / 100)}; ajuste para 100%. ` : ''}O percentual incide sobre o lucro líquido do período (resultado da DRE, depois de despesas e perdas). Os percentuais ficam salvos neste navegador.</p></div>`;
}

/* ---------- Relatórios ---------- */

// Recebimentos do mês (pela data do recebimento), agrupados por forma de pagamento e por cartão/bandeira.
function recebPorForma(mes) {
  const L = D().lancamentos.filter(l => l.tipo === 'receber' && l.categoria !== 'Saldo inicial' && l.data_pagamento?.slice(0, 7) === mes);
  const add = (o, k, l) => { const a = o[k] || (o[k] = { n: 0, b: 0, t: 0, v: 0 }); a.n++; a.b += O.bruto(l); a.t += num(l.taxa_valor); a.v += num(l.valor); };
  const formas = {}, cartoes = {};
  L.forEach(l => {
    add(formas, O.FORMAS[l.forma_pagamento] || 'Não informada', l);
    if (['credito', 'debito'].includes(l.forma_pagamento)) add(cartoes, l.cartao_nome || `${O.FORMAS[l.forma_pagamento]} (sem bandeira)`, l);
  });
  const ord = o => Object.entries(o).sort((a, b) => b[1].b - a[1].b);
  return { formas: ord(formas), cartoes: ord(cartoes), tot: { n: L.length, b: sum(L, O.bruto), t: sum(L, l => l.taxa_valor), v: sum(L, l => l.valor) } };
}

function formaCard() {
  const mes = state.rel.mes, R = recebPorForma(mes), T = R.tot;
  const linha = ([k, a]) => tr([[esc(k)], [a.n, 'r'], [brl(a.b), 'r'], [T.b ? pct(a.b / T.b) : '—', 'r'], [brl(a.t), `r ${a.t ? 'out' : ''}`], [a.b ? pct(a.t / a.b) : '—', 'r'], [brl(a.v), 'r in']]);
  const heads = [['Forma'], ['Qtd', 'r'], ['Bruto', 'r'], ['% do total', 'r'], ['Taxa', 'r'], ['Taxa média', 'r'], ['Líquido', 'r']];
  const total = tr([['Total'], [T.n, 'r'], [brl(T.b), 'r'], [T.b ? '100%' : '—', 'r'], [brl(T.t), 'r'], [T.b ? pct(T.t / T.b) : '—', 'r'], [brl(T.v), 'r']], 'total');
  return `<div class="card"><div class="head" style="margin-bottom:10px"><div><h3>Recebimentos por forma de pagamento</h3><p class="hint" style="margin:0">Pela data do recebimento. Saldo inicial fica fora.</p></div>
    <div class="tools"><input type="month" value="${mes}" data-state="rel.mes" aria-label="Mês"><button class="btn" data-act="csv" data-t="formas">Exportar</button></div></div>
    <div class="kpis">${kpi('Recebido bruto', brl(T.b), `${T.n} recebimento(s)`)}${kpi('Taxas de cartão', brl(T.t), T.b ? `${pct(T.t / T.b)} do bruto` : '', T.t ? 'out' : '')}${kpi('Entrou no caixa', brl(T.v), 'líquido', 'in')}</div>
    ${tbl(heads, R.formas.length ? [...R.formas.map(linha), total] : [], 'Nenhum recebimento neste mês.')}
    ${R.cartoes.length ? `<h3 style="font-size:17px;margin-top:16px">Cartões por bandeira</h3>${tbl([['Cartão / bandeira'], ...heads.slice(1)], R.cartoes.map(linha))}` : ''}</div>`;
}

VIEWS.relatorios = () => {
  const t = today(), L = D().lancamentos;
  const inad = {};
  L.filter(l => l.tipo === 'receber' && !l.data_pagamento && l.vencimento < t).forEach(l => {
    const k = l.parceiro || 'Sem cliente'; const a = inad[k] || (inad[k] = { v: 0, n: 0, min: l.vencimento });
    a.v += num(l.valor); a.n++; if (l.vencimento < a.min) a.min = l.vencimento;
  });
  const cli = {};
  D().vendas.forEach(v => { const k = v.cliente_nome || 'Consumidor final'; const a = cli[k] || (cli[k] = { v: 0, n: 0 }); a.v += num(v.total); a.n++; });
  const pro = {};
  D().vendas.forEach(v => (v.itens || []).forEach(i => { const a = pro[i.nome] || (pro[i.nome] = { q: 0, r: 0, c: 0 }); a.q += num(i.qtd); a.r += num(i.qtd) * num(i.preco); a.c += num(i.qtd) * num(i.custo); }));
  const cat = {};
  L.filter(l => l.tipo === 'pagar' && !l.data_pagamento).forEach(l => { const k = l.categoria || 'Sem categoria'; cat[k] = (cat[k] || 0) + num(l.valor); });
  const days = d => Math.floor((new Date(t) - new Date(d)) / 864e5);
  return `${head('Relatórios', 'Análises prontas e exportação para Excel (CSV).', `<button class="btn" data-act="csv" data-t="lancamentos">Exportar lançamentos</button><button class="btn" data-act="csv" data-t="vendas">Exportar vendas</button><button class="btn" data-act="csv" data-t="produtos">Exportar produtos</button><button class="btn" data-act="csv" data-t="clientes">Exportar clientes</button><button class="btn" data-act="csv" data-t="insumos">Exportar estoque</button>`)}
  <div class="stack">
  ${formaCard()}
  <div class="grid2">
    <div class="card"><h3>Inadimplência por cliente</h3>${tbl([['Cliente'], ['Parcelas', 'r'], ['Valor', 'r'], ['Atraso', 'r']], Object.entries(inad).sort((a, b) => b[1].v - a[1].v).map(([k, a]) => tr([[esc(k)], [a.n, 'r'], [brl(a.v), 'r out'], [`${days(a.min)} dias`, 'r']])), 'Nenhum recebimento vencido.')}</div>
    <div class="card"><h3>Contas a pagar em aberto por categoria</h3>${tbl([['Categoria'], ['Valor', 'r']], Object.entries(cat).sort((a, b) => b[1] - a[1]).map(([k, v]) => tr([[esc(k)], [brl(v), 'r']])), 'Nenhuma conta a pagar em aberto.')}</div>
  </div>
  <div class="card"><h3>Rentabilidade por modelo</h3>${tbl([['Modelo'], ['Qtd vendida', 'r'], ['Receita', 'r'], ['Custo', 'r'], ['Lucro bruto', 'r'], ['Margem', 'r']], Object.entries(pro).sort((a, b) => (b[1].r - b[1].c) - (a[1].r - a[1].c)).map(([k, a]) => tr([[esc(k)], [qty(a.q), 'r'], [brl(a.r), 'r'], [brl(a.c), 'r'], [brl(a.r - a.c), 'r in'], [pct(a.r ? (a.r - a.c) / a.r : NaN), 'r']])), 'Sem vendas.')}</div>
  <div class="card"><h3>Receita por cliente</h3>${tbl([['Cliente'], ['Vendas', 'r'], ['Total', 'r'], ['Ticket médio', 'r']], Object.entries(cli).sort((a, b) => b[1].v - a[1].v).map(([k, a]) => tr([[esc(k)], [a.n, 'r'], [brl(a.v), 'r'], [brl(a.v / a.n), 'r']])), 'Sem vendas.')}</div>
  </div>`;
};

/* ---------- Cadastros ---------- */

const PESSOA = [
  { k: 'nome', l: 'Nome', req: 1, w: 'full' }, { k: 'documento', l: 'CPF/CNPJ' }, { k: 'telefone', l: 'Telefone' },
  { k: 'email', l: 'E-mail', t: 'email' }, { k: 'cidade', l: 'Cidade' }, { k: 'obs', l: 'Observações', t: 'textarea', w: 'full' },
];
const CAD = {
  produtos: {
    t: 'produtos', titulo: 'Modelos', sing: 'modelo', sub: 'Catálogo de bonecos: preço base, ficha técnica de materiais, horas de pintura e margem.',
    fields: [{ k: 'nome', l: 'Nome do modelo', req: 1, w: 'full' }, { k: 'sku', l: 'Código (SKU)' }, { k: 'ativo', l: 'Ativo', t: 'select', opts: [['true', 'Sim'], ['false', 'Não']] },
      { k: 'preco', l: 'Preço base (R$)', t: 'number' }, { k: 'horas_pintura', l: 'Horas de pintura por peça', t: 'number' }, { k: 'valor_hora', l: 'Valor da hora de pintura (R$)', t: 'number' },
      { k: 'custo_extra', l: 'Custo extra por peça (R$)', t: 'number' }, { k: 'custo', l: 'Custo unitário (R$)', t: 'number' }],
    heads: [['Modelo'], ['Preço', 'r'], ['Custo', 'r'], ['Margem', 'r'], ['Pintura', 'r']],
    cells: p => [[`${esc(p.nome)}${p.ativo === false ? ' <span class="pill aberto">inativo</span>' : ''}<small>${esc(p.sku || '')}${(p.ficha || []).length ? ` · ${(p.ficha || []).length} materiais na ficha` : ''}</small>`], [brl(p.preco), 'r'], [brl(p.custo), 'r'], [pct(num(p.preco) ? (num(p.preco) - num(p.custo)) / num(p.preco) : NaN), 'r'], [`${qty(p.horas_pintura)} h`, 'r']],
  },
  clientes: {
    t: 'clientes', titulo: 'Clientes', sing: 'cliente', sub: 'Quem compra de você e quanto já comprou.', fields: PESSOA,
    heads: [['Cliente'], ['Contato'], ['Cidade'], ['Comprado', 'r'], ['Em aberto', 'r']],
    cells: c => [[esc(c.nome) + `<small>${esc(c.documento || '')}</small>`], [`${esc(c.telefone || '')}<small>${esc(c.email || '')}</small>`], [esc(c.cidade || '')],
      [brl(sum(D().vendas.filter(v => v.cliente_id === c.id), v => v.total)), 'r'], [brl(sum(D().lancamentos.filter(l => l.tipo === 'receber' && !l.data_pagamento && l.parceiro === c.nome), l => l.valor)), 'r']],
  },
  fornecedores: {
    t: 'fornecedores', titulo: 'Fornecedores', sing: 'fornecedor', sub: 'De quem você compra matéria-prima.', fields: PESSOA,
    heads: [['Fornecedor'], ['Contato'], ['Cidade'], ['Comprado', 'r']],
    cells: c => [[esc(c.nome) + `<small>${esc(c.documento || '')}</small>`], [`${esc(c.telefone || '')}<small>${esc(c.email || '')}</small>`], [esc(c.cidade || '')], [brl(sum(D().compras.filter(v => v.fornecedor_id === c.id), v => v.valor_total)), 'r']],
  },
  insumos: {
    t: 'materias_primas', titulo: 'Matérias-primas', sing: 'matéria-prima', art: 'Nova', nenhum: 'Nenhuma', sub: 'Filamentos, resinas, embalagens e acessórios, com custo médio atualizado a cada compra.',
    fields: [{ k: 'nome', l: 'Nome', req: 1, w: 'full' }, { k: 'unidade', l: 'Unidade', t: 'select', opts: ['un', 'kg', 'g', 'L', 'ml', 'm', 'cx'] }, { k: 'custo_unitario', l: 'Custo unitário (R$)', t: 'number' }, { k: 'estoque', l: 'Estoque atual', t: 'number' }, { k: 'estoque_minimo', l: 'Estoque mínimo', t: 'number' }],
    heads: [['Matéria-prima'], ['Estoque', 'r'], ['Mínimo', 'r'], ['Custo unit.', 'r'], ['Valor em estoque', 'r']],
    cells: m => [[esc(m.nome)], [`${qty(m.estoque)} ${esc(m.unidade)}${num(m.estoque_minimo) > 0 && num(m.estoque) <= num(m.estoque_minimo) ? ' <span class="pill venc">baixo</span>' : ''}`, 'r'], [qty(m.estoque_minimo), 'r'], [brl(m.custo_unitario), 'r'], [brl(num(m.estoque) * num(m.custo_unitario)), 'r']],
  },
  cartoes: {
    t: 'cartoes', titulo: 'Cartões e taxas', sing: 'cartão', sub: 'Bandeiras aceitas na maquininha, tipo (crédito ou débito) e a taxa cobrada. A taxa é descontada automaticamente nas contas a receber.',
    fields: [{ k: 'nome', l: 'Maquininha (ex.: Stone, InfinitePay)', req: 1 }, { k: 'bandeira', l: 'Bandeira', list: 'dl-band', req: 1 },
      { k: 'tipo', l: 'Tipo', t: 'select', opts: [['credito', 'Crédito'], ['debito', 'Débito']] }, { k: 'taxa', l: 'Taxa da maquininha (%)', t: 'number', req: 1 },
      { k: 'obs', l: 'Observações', t: 'textarea', w: 'full' }],
    extraForm: '<datalist id="dl-band"><option value="Visa"><option value="Mastercard"><option value="Elo"><option value="Hipercard"><option value="American Express"><option value="Outras"></datalist>',
    heads: [['Maquininha e bandeira'], ['Tipo'], ['Taxa', 'r'], ['Usado em', 'r']],
    cells: c => [[`${esc(c.nome)}<small>${esc(c.bandeira || '')}</small>`], [c.tipo === 'debito' ? 'Débito' : 'Crédito'], [`${n2(c.taxa)}%`, 'r'], [`${D().lancamentos.filter(l => l.cartao_id === c.id).length} conta(s)`, 'r']],
  },
};
function perdasCard() {
  const rows = [...D().perdas].sort((a, b) => b.data.localeCompare(a.data)).map(x => tr([
    [fmtD(x.data)], [esc(x.materia_prima_nome)], [qty(x.quantidade), 'r'], [brl(x.custo_total), 'r out'], [esc(x.motivo || '')],
    [`<button class="btn sm ghost danger" data-act="delPerda" data-id="${x.id}">Estornar</button>`, 'acts'],
  ]));
  return `<div class="card" style="margin-top:14px"><h3>Perdas e falhas de impressão</h3>${tbl([['Data'], ['Material'], ['Qtd', 'r'], ['Custo', 'r'], ['Motivo'], ['', 'r']], rows, 'Nenhuma perda registrada. Use "Perda" na linha do material para lançar falhas.')}</div>`;
}
Object.keys(CAD).forEach(k => {
  VIEWS[k] = () => {
    const C = CAD[k], rows = [...D()[C.t]].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || String(a.bandeira || '').localeCompare(String(b.bandeira || ''), 'pt-BR') || String(a.tipo || '').localeCompare(String(b.tipo || '')));
    const extra = k === 'insumos' ? kpi('Valor total em estoque', brl(sum(rows, m => num(m.estoque) * num(m.custo_unitario)))) : '';
    return `${head(C.titulo, C.sub, `<input type="search" placeholder="Buscar" data-filter aria-label="Buscar"><button class="btn primary" data-act="cadNew" data-t="${k}">${C.art || 'Novo'} ${C.sing}</button>`)}
    ${extra ? `<div class="kpis">${extra}${kpi('Cadastrados', rows.length)}</div>` : ''}
    <div class="card">${tbl([...C.heads, ['', 'r']], rows.map(r => tr([...C.cells(r), [`${k === 'insumos' ? `<button class="btn sm ghost" data-act="newPerda" data-id="${r.id}">Perda</button>` : ''}<button class="btn sm ghost" data-act="cadEdit" data-t="${k}" data-id="${r.id}">Editar</button><button class="btn sm ghost danger" data-act="cadDel" data-t="${k}" data-id="${r.id}">Excluir</button>`, 'acts']])), `${C.nenhum || 'Nenhum'} ${C.sing} cadastrado${C.art ? 'a' : ''}.`)}</div>${k === 'insumos' ? perdasCard() : ''}`;
  };
});

function cadForm(key, id) {
  const C = CAD[key], r = id ? byId(C.t, id) : {};
  const ficha = key === 'produtos' ? `<div class="full"><h4>Ficha técnica (materiais por peça)</h4><div data-rows>${(r.ficha || []).map(rowFicha).join('')}</div><button type="button" class="btn ghost sm" data-act="addRow" data-kind="ficha">+ Insumo</button><p class="hint">Liste o que cada peça consome: filamento em gramas, tinta e verniz em ml, base e caixa em unidades. O custo da peça = materiais + custo extra (energia, desgaste da impressora) + horas de pintura × valor da hora. Se você já retira pró-labore, deixe o valor da hora em 0 para não contar seu trabalho duas vezes.</p></div>` : '';
  openModal(id ? `Editar ${C.sing}` : `${C.art || 'Novo'} ${C.sing}`, `<div class="grid">${C.fields.map(f => fld(f, f.k === 'ativo' ? String(r.ativo !== false) : (r[f.k] ?? (f.t === 'number' ? 0 : '')))).join('')}${ficha}</div>${C.extraForm || ''}`, async fd => {
    const o = {};
    C.fields.forEach(f => { let v = fd.get(f.k); if (f.t === 'number') v = num(v); if (f.k === 'ativo') v = v === 'true'; o[f.k] = typeof v === 'string' ? v.trim() : v; });
    if (key === 'produtos') {
      const mp = fd.getAll('f_mp'), q = fd.getAll('f_q');
      o.ficha = mp.map((m, i) => ({ mp_id: m, qtd: num(q[i]) })).filter(x => x.mp_id && x.qtd > 0);
      if (o.ficha.length || num(o.custo_extra) > 0 || num(o.horas_pintura) > 0) o.custo = O.custoModelo(o);
    }
    if (id) await DB.update(C.t, id, o); else await DB.insert(C.t, o);
    if (key === 'insumos') await O.recalcCustos();
  }, key === 'produtos');
}

/* ---------- Ações ---------- */

const ACT = {
  newLanc: (_, t) => lancForm(t),
  editLanc: id => lancForm(byId('lancamentos', id).tipo, id),
  delLanc: async id => { if (confirm('Excluir esta conta?')) await DB.remove('lancamentos', id); },
  baixar: id => {
    const l = byId('lancamentos', id), rec = l.tipo === 'receber', b = O.bruto(l);
    const m = openModal(rec ? 'Registrar recebimento' : 'Registrar pagamento', `<p>${esc(l.descricao)} · <b>${brl(rec ? b : l.valor)}</b></p>${fld({ k: 'd', l: 'Data', t: 'date', req: 1 }, today())}${rec ? pagFields(l) : ''}`,
      fd => DB.update('lancamentos', id, { data_pagamento: fd.get('d'), ...(rec ? readPag(fd, b) : {}) }));
    if (rec) wirePag(m, () => b);
  },
  estornar: async id => { await DB.update('lancamentos', id, { data_pagamento: null }); },
  newEnc: encForm, newCompra: compraForm, newPerda: (id) => perdaForm(id),
  iniciarEnc: async id => { await O.iniciarProducao(id); toast('Produção iniciada: material baixado do estoque.'); },
  entregarEnc: id => entregarForm(id),
  delEnc: async id => { if (confirm('Estornar a encomenda? O material volta ao estoque e os lançamentos e a venda vinculados são removidos.')) { await O.estornarEncomenda(id); toast('Encomenda estornada.'); } },
  delPerda: async id => { if (confirm('Estornar esta perda? O material volta ao estoque.')) { await O.estornarPerda(id); toast('Perda estornada.'); } },
  delCompra: async id => { if (confirm('Estornar a compra? O estoque diminui e as contas a pagar vinculadas são removidas.')) { await O.estornarCompra(id); toast('Compra estornada.'); } },
  cadNew: (_, t) => cadForm(t),
  cadEdit: (id, t) => cadForm(t, id),
  cadDel: async (id, t) => { if (confirm(t === 'cartoes' ? 'Excluir este cartão? As contas já lançadas mantêm a taxa que foi descontada.' : 'Excluir este cadastro?')) await DB.remove(CAD[t].t, id); },
  addRow: (_, __, b) => { b.closest('.body').querySelector('[data-rows]').insertAdjacentHTML('beforeend', rowBuilders[b.dataset.kind]()); },
  rmRow: (_, __, b) => b.closest('[data-row]').remove(),
  seed: async () => { await O.seedDemo(); toast('Dados de exemplo carregados.'); },
  logout: async () => { await DB.auth.signOut(); location.reload(); },
  wipe: () => { if (confirm('Apagar todos os dados salvos neste navegador?')) { DB.wipeLocal(); location.reload(); } },
  csv: (_, t) => {
    const L = D();
    const M = {
      lancamentos: [['Tipo', 'Descrição', 'Categoria', 'Parceiro', 'Valor bruto', 'Taxa', 'Valor líquido', 'Forma de pagamento', 'Cartão', 'Vencimento', 'Pagamento'], L.lancamentos.map(l => [l.tipo, l.descricao, l.categoria, l.parceiro, n2(O.bruto(l)), n2(l.taxa_valor), n2(l.valor), O.FORMAS[l.forma_pagamento] || '', l.cartao_nome || '', l.vencimento, l.data_pagamento || ''])],
      vendas: [['Data', 'Cliente', 'Itens', 'Desconto', 'Total', 'Custo', 'Pagamento'], L.vendas.map(v => [v.data, v.cliente_nome, (v.itens || []).map(i => `${i.qtd}x ${i.nome}`).join(' | '), n2(v.desconto), n2(v.total), n2(v.custo_total), v.forma_pagamento])],
      produtos: [['Produto', 'SKU', 'Preço', 'Custo', 'Estoque', 'Mínimo'], L.produtos.map(p => [p.nome, p.sku, n2(p.preco), n2(p.custo), n2(p.estoque), n2(p.estoque_minimo)])],
      clientes: [['Nome', 'Documento', 'Telefone', 'E-mail', 'Cidade'], L.clientes.map(c => [c.nome, c.documento, c.telefone, c.email, c.cidade])],
      formas: (() => {
        const R = recebPorForma(state.rel.mes), row = (tipo, [k, a]) => [tipo, k, a.n, n2(a.b), n2(a.t), n2(a.v)];
        return [['Agrupamento', 'Forma / cartão', 'Quantidade', 'Bruto', 'Taxa', 'Líquido'], [...R.formas.map(x => row('Forma de pagamento', x)), ...R.cartoes.map(x => row('Cartão', x))]];
      })(),
      insumos: [['Matéria-prima', 'Unidade', 'Estoque', 'Mínimo', 'Custo unitário'], L.materias_primas.map(m => [m.nome, m.unidade, n2(m.estoque), n2(m.estoque_minimo), n2(m.custo_unitario)])],
    };
    csv(t === 'formas' ? `recebimentos-por-forma-${state.rel.mes}` : t, ...M[t]);
  },
};

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b || !ACT[b.dataset.act]) return;
  try { await ACT[b.dataset.act](b.dataset.id, b.dataset.t, b); } catch (err) { toast(err.message || String(err), true); }
});
document.addEventListener('change', e => {
  const el = e.target.closest('[data-state]');
  if (!el) return;
  const path = el.dataset.state.split('.'); let o = state;
  path.slice(0, -1).forEach(k => { o = o[k]; });
  let v = el.value;
  if (el.hasAttribute('data-dre-year')) v = v ? `${v}` : today().slice(0, 4);
  if (path.join('.') === 'h') v = num(v);
  o[path.at(-1)] = v;
  if (path[0] === 'reinv') { try { localStorage.setItem('laya:reinvest', JSON.stringify(state.reinv)); } catch { /* sem armazenamento */ } }
  if (el.hasAttribute('data-dre-mode')) state.dre.val = v === 'ano' ? state.dre.val.slice(0, 4) : `${state.dre.val.slice(0, 4)}-${today().slice(5, 7)}`;
  render();
});
document.addEventListener('input', e => {
  if (!e.target.matches('[data-filter]')) return;
  const q = e.target.value.toLowerCase();
  $$('#main tbody tr').forEach(r => { r.hidden = !r.textContent.toLowerCase().includes(q); });
});

/* ---------- Render / boot ---------- */

function render() {
  charts.forEach(c => c.destroy()); charts = []; after = null;
  const v = location.hash.replace('#/', '') || 'painel';
  const key = VIEWS[v] ? v : 'painel';
  $('#main').innerHTML = VIEWS[key]();
  $$('.nav a').forEach(a => a.classList.toggle('on', a.dataset.v === key));
  after?.();
}
let tm;
const schedule = () => { clearTimeout(tm); tm = setTimeout(render, 60); };
window.addEventListener('hashchange', () => { render(); scrollTo(0, 0); });

function shell() {
  $('#root').innerHTML = `<div class="app"><aside class="side"><div class="brand"><img src="logo.png" alt="${esc(CONFIG.EMPRESA)}"><small>Gestão financeira</small></div>
  <nav class="nav">${NAV.map(([g, items]) => `<div class="grp">${g}</div>${items.map(([k, l]) => `<a href="#/${k}" data-v="${k}">${l}</a>`).join('')}`).join('')}</nav>
  <div class="mode">${DB.isCloud ? '<span><span class="dot live"></span>Nuvem · tempo real</span><button class="lnk" data-act="logout">Sair</button>' : '<span><span class="dot"></span>Modo demonstração</span><small>Dados salvos só neste navegador. Configure o Supabase em config.js.</small><button class="lnk" data-act="wipe">Apagar dados locais</button>'}</div></aside><main id="main"></main></div>`;
}

function showLogin(msg = '') {
  $('#root').innerHTML = `<div class="login"><div class="wrap"><img src="logo.png" alt="${esc(CONFIG.EMPRESA)}"><form id="lf"><p>Gestão financeira</p>
    <label class="f"><span>E-mail</span><input name="email" type="email" required autocomplete="username"></label>
    <label class="f"><span>Senha</span><input name="password" type="password" minlength="6" required autocomplete="current-password"></label>
    <p class="err" role="alert">${esc(msg)}</p><button class="btn primary">Entrar</button><button type="button" class="btn ghost" id="su">Criar conta</button></form></div></div>`;
  $('#lf').onsubmit = async e => {
    e.preventDefault(); const f = new FormData(e.target);
    try { await DB.auth.signIn(f.get('email'), f.get('password')); boot(); } catch (err) { showLogin(err.message); }
  };
  $('#su').onclick = async () => {
    const f = new FormData($('#lf'));
    try { const d = await DB.auth.signUp(f.get('email'), f.get('password')); if (d.session) boot(); else showLogin('Conta criada. Confirme o e-mail, se exigido, e entre.'); } catch (err) { showLogin(err.message); }
  };
}

// Logo após o login, o token pode parecer "do futuro" por alguns segundos (relógios dos servidores do Supabase). Tenta de novo.
async function carregarComRetentativa() {
  let ultimo;
  for (let i = 1; i <= 6; i++) {
    try { await DB.load(); return; } catch (err) {
      ultimo = err;
      if (!/future|issued|iat/i.test(err.message || '')) break;
      const m = $('#main'); if (m) m.innerHTML = `<div class="banner">Conectando ao banco de dados… tentativa ${i} de 6.</div>`;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  throw ultimo;
}

async function boot() {
  const s = await DB.auth.session();
  if (!s) return showLogin();
  shell();
  DB.onChange(schedule);
  try { await carregarComRetentativa(); } catch (err) {
    const relogio = /future|issued|iat/i.test(err.message || '');
    $('#main').innerHTML = `<div class="banner"><span>Não foi possível carregar os dados: ${esc(err.message)}. ${relogio ? 'É uma diferença de relógio entre servidores do Supabase, normalmente passageira. Aguarde um minuto e recarregue a página.' : 'Confira config.js e se as tabelas foram criadas no Supabase.'}</span><button class="btn" onclick="location.reload()">Tentar de novo</button></div>`;
    return;
  }
  DB.subscribe();
  render();
}
boot();
