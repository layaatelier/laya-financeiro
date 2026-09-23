import * as DB from './db.js';
import { num, sum, iso, today, addDays, addMonths, qty } from './util.js';

const D = () => DB.cache;
export const byId = (t, id) => D()[t].find(x => x.id === id);
const r2 = v => Math.round(num(v) * 100) / 100;

// Valor bruto de um lançamento (antes da taxa do cartão). Contas antigas, sem taxa, usam o próprio valor.
export const bruto = l => l.valor_bruto != null && l.valor_bruto !== '' ? num(l.valor_bruto) : num(l.valor);

export const FORMAS = { dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Cartão de crédito', debito: 'Cartão de débito' };
export const cartaoLabel = c => `${c.nome}${c.bandeira ? ' · ' + c.bandeira : ''} · ${c.tipo === 'debito' ? 'Débito' : 'Crédito'}`;

// Aplica a forma de pagamento a um valor bruto: guarda bruto, taxa e grava em "valor" o líquido que entra no caixa.
export function aplicarPagamento(valorBruto, forma, cartaoId, taxaPct) {
  const b = r2(valorBruto);
  const cartao = ['credito', 'debito'].includes(forma) ? byId('cartoes', cartaoId) : null;
  const pctTaxa = Math.min(100, Math.max(0, num(taxaPct)));
  const taxa = r2(b * pctTaxa / 100);
  return {
    forma_pagamento: forma || null, cartao_id: cartao?.id || null, cartao_nome: cartao ? cartaoLabel(cartao) : null,
    valor_bruto: b, taxa_pct: pctTaxa, taxa_valor: taxa, valor: r2(b - taxa),
  };
}

/* ---------- Cálculos ---------- */

export function parcelar(total, n, primeiro) {
  n = Math.max(1, Math.floor(n) || 1);
  const base = Math.floor(total / n * 100) / 100;
  const out = []; let acc = 0;
  for (let i = 0; i < n; i++) {
    const v = i === n - 1 ? r2(total - acc) : base;
    acc = r2(acc + v);
    out.push({ valor: v, vencimento: addMonths(primeiro, i) });
  }
  return out;
}

export const saldoAtual = () =>
  sum(D().lancamentos.filter(l => l.data_pagamento), l => l.tipo === 'receber' ? l.valor : -l.valor);

// Projeção diária: saldo atual + pendências por vencimento. Vencidos entram no dia de hoje.
export function projecao(dias) {
  const t = today();
  const pend = D().lancamentos.filter(l => !l.data_pagamento);
  let saldo = saldoAtual();
  const saldo0 = saldo;
  const pts = []; let min = { v: saldo, d: t };
  for (let i = 0; i <= dias; i++) {
    const d = addDays(t, i);
    const hit = l => i === 0 ? l.vencimento <= d : l.vencimento === d;
    const ent = sum(pend.filter(l => l.tipo === 'receber' && hit(l)), l => l.valor);
    const sai = sum(pend.filter(l => l.tipo === 'pagar' && hit(l)), l => l.valor);
    saldo = r2(saldo + ent - sai);
    pts.push({ d, ent, sai, saldo });
    if (saldo < min.v) min = { v: saldo, d };
  }
  return { pts, min, saldo0 };
}

// Quantos dias o caixa atual cobre, pela média de saídas pagas nos últimos 90 dias.
export function cobertura() {
  const ini = addDays(today(), -90);
  const saidas = sum(D().lancamentos.filter(l => l.tipo === 'pagar' && l.data_pagamento && l.data_pagamento >= ini), l => l.valor);
  const media = saidas / 90;
  return media > 0 ? Math.max(0, saldoAtual()) / media : null;
}

export function periodo(mode, val) {
  if (mode === 'ano') {
    const y = +val.slice(0, 4);
    return { ini: `${y}-01-01`, fim: `${y}-12-31`, pIni: `${y - 1}-01-01`, pFim: `${y - 1}-12-31` };
  }
  const [y, m] = val.split('-').map(Number);
  const last = (yy, mm) => iso(new Date(yy, mm, 0));
  const p = addMonths(`${val}-01`, -1);
  const [py, pm] = p.split('-').map(Number);
  return { ini: `${val}-01`, fim: last(y, m), pIni: `${p.slice(0, 7)}-01`, pFim: last(py, pm) };
}

// DRE por competência: receita na data da entrega; despesas pelo vencimento; perdas pela data do registro.
// Compras de matéria-prima não são despesa: entram no resultado via CMV quando o produto é vendido.
export function dre(ini, fim) {
  const v = D().vendas.filter(x => x.data >= ini && x.data <= fim);
  const bruta = sum(v, x => sum(x.itens || [], i => num(i.qtd) * num(i.preco)));
  const desc = sum(v, x => x.desconto);
  const liq = bruta - desc;
  const cmv = sum(v, x => x.custo_total);
  const lb = liq - cmv;
  const L = D().lancamentos.filter(l => l.vencimento >= ini && l.vencimento <= fim);
  const desp = {};
  L.filter(l => l.tipo === 'pagar' && l.origem !== 'compra').forEach(l => {
    const c = l.categoria || 'Sem categoria';
    desp[c] = (desp[c] || 0) + num(l.valor);
  });
  // Taxas da maquininha descontadas nas contas a receber entram como despesa.
  const taxas = sum(L.filter(l => l.tipo === 'receber'), l => l.taxa_valor);
  if (taxas) desp['Taxas de cartão/marketplace'] = (desp['Taxas de cartão/marketplace'] || 0) + taxas;
  const perd = sum(D().perdas.filter(x => x.data >= ini && x.data <= fim), x => x.custo_total);
  if (perd) desp['Perdas e falhas de impressão'] = perd;
  const totDesp = sum(Object.values(desp));
  const outras = sum(L.filter(l => l.tipo === 'receber' && !['venda', 'encomenda'].includes(l.origem) && l.categoria !== 'Saldo inicial'), bruto);
  return { bruta, desc, liq, cmv, lb, desp, totDesp, outras, res: lb - totDesp + outras, n: v.length };
}

/* ---------- Operações ---------- */

// Custo de uma peça do catálogo: insumos da ficha + custo extra (energia, desgaste) + pintura (horas × valor/hora).
export const custoModelo = p => r2(
  sum(p.ficha || [], f => num(f.qtd) * num(byId('materias_primas', f.mp_id)?.custo_unitario))
  + num(p.custo_extra) + num(p.horas_pintura) * num(p.valor_hora));
const temComposicao = p => (p.ficha || []).length || num(p.custo_extra) > 0 || num(p.horas_pintura) > 0;

export async function recalcCustos() {
  for (const p of D().produtos) {
    if (!temComposicao(p)) continue;
    const custo = custoModelo(p);
    if (custo !== r2(p.custo)) await DB.update('produtos', p.id, { custo });
  }
}

export async function salvarCompra(o) {
  const mp = byId('materias_primas', o.materia_prima_id);
  if (!mp) throw new Error('Selecione a matéria-prima.');
  const q = num(o.quantidade), val = num(o.valor_total);
  if (q <= 0 || val <= 0) throw new Error('Informe quantidade e valor da compra.');
  const forn = byId('fornecedores', o.fornecedor_id);
  const parcelas = o.pago ? 1 : Math.max(1, Math.floor(num(o.parcelas)) || 1);
  const compra = await DB.insert('compras', {
    fornecedor_id: forn?.id || null, fornecedor_nome: forn?.nome || '', materia_prima_id: mp.id, materia_prima_nome: mp.nome,
    data: o.data, quantidade: q, valor_total: val, parcelas,
  });
  const novoEst = num(mp.estoque) + q;
  const custoMedio = (Math.max(0, num(mp.estoque)) * num(mp.custo_unitario) + val) / (Math.max(0, num(mp.estoque)) + q);
  await DB.update('materias_primas', mp.id, { estoque: novoEst, custo_unitario: Math.round(custoMedio * 10000) / 10000 });
  const primeiro = o.pago ? o.data : (o.primeiro_venc || o.data);
  const ps = parcelar(val, parcelas, primeiro);
  for (let i = 0; i < ps.length; i++) {
    await DB.insert('lancamentos', {
      tipo: 'pagar',
      descricao: `Compra ${mp.nome}${forn ? ' · ' + forn.nome : ''}${parcelas > 1 ? ` (${i + 1}/${parcelas})` : ''}`,
      categoria: 'Matéria-prima', valor: ps[i].valor, vencimento: ps[i].vencimento,
      data_pagamento: o.pago ? o.data : null, parceiro: forn?.nome || '', origem: 'compra', origem_id: compra.id,
    });
  }
  await recalcCustos();
  return compra;
}

export async function estornarCompra(id) {
  const c = byId('compras', id);
  const mp = byId('materias_primas', c.materia_prima_id);
  if (mp) await DB.update('materias_primas', mp.id, { estoque: num(mp.estoque) - num(c.quantidade) });
  for (const l of D().lancamentos.filter(l => l.origem === 'compra' && l.origem_id === id)) await DB.remove('lancamentos', l.id);
  await DB.remove('compras', id);
}

/* ---------- Encomendas (produção sob pedido) ---------- */

export function checarInsumos(p, q) {
  for (const f of p.ficha || []) {
    const mp = byId('materias_primas', f.mp_id);
    if (!mp) throw new Error('Um insumo da ficha técnica foi removido. Edite o modelo.');
    if (num(mp.estoque) < num(f.qtd) * q) throw new Error(`Falta ${mp.nome}: precisa de ${qty(f.qtd * q)} ${mp.unidade}, há ${qty(mp.estoque)}. Registre a compra ou salve como orçamento.`);
  }
}

export async function salvarEncomenda(o) {
  const p = byId('produtos', o.produto_id);
  if (!p) throw new Error('Selecione o modelo.');
  const q = num(o.quantidade), preco = r2(o.preco_total);
  if (q <= 0) throw new Error('Informe a quantidade.');
  if (preco <= 0) throw new Error('Informe o valor da encomenda.');
  const sinal = r2(Math.min(Math.max(num(o.sinal), 0), preco));
  if (o.status === 'producao') checarInsumos(p, q); // valida antes de gravar qualquer coisa
  const nomeLivre = String(o.cliente_nome || '').trim();
  let cli = byId('clientes', o.cliente_id) || D().clientes.find(c => c.nome.trim().toLowerCase() === nomeLivre.toLowerCase());
  if (!cli && !nomeLivre) throw new Error('Informe o nome do cliente.');
  if (!cli) cli = await DB.insert('clientes', { nome: nomeLivre, documento: '', email: '', telefone: '', cidade: '', obs: 'Cadastrado automaticamente pela encomenda' });
  const enc = await DB.insert('encomendas', {
    cliente_id: cli.id, cliente_nome: cli.nome, produto_id: p.id, produto_nome: p.nome,
    descricao: o.descricao || '', quantidade: q, preco_total: preco, sinal, prazo: o.prazo, data_pedido: o.data_pedido,
    status: 'orcamento', horas_pintura: num(p.horas_pintura) * q, valor_hora: num(p.valor_hora), outros_custos: 0, custo_total: 0, consumo: [],
  });
  const nome = `${p.nome}${q > 1 ? ` ×${q}` : ''} · ${cli.nome}`;
  if (sinal > 0) {
    await DB.insert('lancamentos', { tipo: 'receber', descricao: `Sinal · ${nome}`, categoria: 'Sinal de encomenda', valor: sinal, vencimento: o.data_pedido, data_pagamento: o.sinal_recebido ? o.data_pedido : null, parceiro: cli.nome, origem: 'encomenda', origem_id: enc.id,
      ...(o.sinal_recebido && o.pag?.forma ? aplicarPagamento(sinal, o.pag.forma, o.pag.cartao_id, o.pag.taxa_pct) : {}) });
  }
  if (preco - sinal > 0.004) {
    await DB.insert('lancamentos', { tipo: 'receber', descricao: `Saldo · ${nome}`, categoria: 'Vendas', valor: r2(preco - sinal), vencimento: o.prazo, data_pagamento: null, parceiro: cli.nome, origem: 'encomenda', origem_id: enc.id });
  }
  if (o.status === 'producao') await iniciarProducao(enc.id);
  return enc;
}

// Consome os insumos da ficha técnica (filamento, tinta, verniz, embalagem...) e guarda o custo no momento.
export async function iniciarProducao(id) {
  const e = byId('encomendas', id);
  if (e.status !== 'orcamento') throw new Error('Esta encomenda já foi iniciada.');
  const p = byId('produtos', e.produto_id);
  if (!p) throw new Error('O modelo desta encomenda foi removido.');
  checarInsumos(p, num(e.quantidade));
  const consumo = [];
  for (const f of p.ficha || []) {
    const mp = byId('materias_primas', f.mp_id);
    const usado = num(f.qtd) * num(e.quantidade);
    consumo.push({ mp_id: mp.id, nome: mp.nome, unidade: mp.unidade, qtd: usado, custo: r2(usado * num(mp.custo_unitario)) });
    await DB.update('materias_primas', mp.id, { estoque: num(mp.estoque) - usado });
  }
  await DB.update('encomendas', id, { status: 'producao', consumo });
}

// Entrega: fecha o custo real (material + pintura + extras) e reconhece a receita na DRE.
export async function entregarEncomenda(id, o) {
  const e = byId('encomendas', id);
  if (e.status === 'orcamento') throw new Error('Inicie a produção antes de entregar.');
  if (e.status !== 'producao') throw new Error('Esta encomenda já foi entregue.');
  const p = byId('produtos', e.produto_id);
  const horas = num(o.horas_pintura), vh = num(o.valor_hora), outros = num(o.outros_custos);
  const material = sum(e.consumo || [], c => c.custo);
  const custo_total = r2(material + horas * vh + num(p?.custo_extra) * num(e.quantidade) + outros);
  const q = num(e.quantidade);
  await DB.insert('vendas', {
    cliente_id: e.cliente_id, cliente_nome: e.cliente_nome, data: o.data_entrega,
    itens: [{ produto_id: e.produto_id, nome: e.produto_nome, qtd: q, preco: num(e.preco_total) / q, custo: custo_total / q }],
    desconto: 0, total: num(e.preco_total), custo_total, forma_pagamento: 'Encomenda', parcelas: 1, encomenda_id: id,
  });
  const saldo = D().lancamentos.find(l => l.origem === 'encomenda' && l.origem_id === id && l.categoria === 'Vendas');
  if (saldo) await DB.update('lancamentos', saldo.id, { vencimento: o.data_entrega, data_pagamento: o.saldo_recebido ? o.data_entrega : null,
    ...(o.saldo_recebido && o.pag?.forma ? aplicarPagamento(bruto(saldo), o.pag.forma, o.pag.cartao_id, o.pag.taxa_pct) : {}) });
  await DB.update('encomendas', id, { status: 'entregue', data_entrega: o.data_entrega, horas_pintura: horas, valor_hora: vh, outros_custos: outros, custo_total });
}

// Desfaz tudo: devolve material ao estoque, remove lançamentos e a venda gerada.
export async function estornarEncomenda(id) {
  const e = byId('encomendas', id);
  if (e.status !== 'orcamento') {
    for (const c of e.consumo || []) {
      const mp = byId('materias_primas', c.mp_id);
      if (mp) await DB.update('materias_primas', mp.id, { estoque: num(mp.estoque) + num(c.qtd) });
    }
  }
  for (const v of D().vendas.filter(v => v.encomenda_id === id)) await DB.remove('vendas', v.id);
  for (const l of D().lancamentos.filter(l => l.origem === 'encomenda' && l.origem_id === id)) await DB.remove('lancamentos', l.id);
  await DB.remove('encomendas', id);
}

/* ---------- Perdas e falhas de impressão ---------- */

export async function registrarPerda(o) {
  const mp = byId('materias_primas', o.materia_prima_id);
  if (!mp) throw new Error('Selecione o material.');
  const q = num(o.quantidade);
  if (q <= 0) throw new Error('Informe a quantidade perdida.');
  if (num(mp.estoque) < q) throw new Error(`O estoque de ${mp.nome} (${qty(mp.estoque)} ${mp.unidade}) é menor que a perda informada.`);
  await DB.insert('perdas', { materia_prima_id: mp.id, materia_prima_nome: mp.nome, quantidade: q, custo_total: r2(q * num(mp.custo_unitario)), data: o.data, motivo: o.motivo || '' });
  await DB.update('materias_primas', mp.id, { estoque: num(mp.estoque) - q });
}

export async function estornarPerda(id) {
  const pe = byId('perdas', id);
  const mp = byId('materias_primas', pe.materia_prima_id);
  if (mp) await DB.update('materias_primas', mp.id, { estoque: num(mp.estoque) + num(pe.quantidade) });
  await DB.remove('perdas', id);
}

/* ---------- Dados de exemplo (modo demonstração) ---------- */

export async function seedDemo() {
  const t = today();
  const mes = n => addMonths(t.slice(0, 8) + '05', n);
  const ins = {};
  for (const [nome, unidade, minimo] of [['Filamento PLA cinza', 'g', 1500], ['Tinta acrílica', 'ml', 100], ['Verniz e primer', 'ml', 80], ['Base de acrílico', 'un', 8], ['Caixa de presente', 'un', 10]]) {
    ins[nome] = await DB.insert('materias_primas', { nome, unidade, estoque: 0, estoque_minimo: minimo, custo_unitario: 0 });
  }
  for (const [nome, bandeira, tipo, taxa] of [['Maquininha', 'Visa', 'credito', 3.15], ['Maquininha', 'Mastercard', 'credito', 3.15], ['Maquininha', 'Elo', 'credito', 3.79], ['Maquininha', 'Visa', 'debito', 1.37], ['Maquininha', 'Mastercard', 'debito', 1.37]]) {
    await DB.insert('cartoes', { nome, bandeira, tipo, taxa, obs: '' });
  }
  const pessoa = nome => ({ nome, documento: '', email: '', telefone: '', cidade: '', obs: '' });
  const f1 = await DB.insert('fornecedores', pessoa('Filamentos Prime 3D'));
  const f2 = await DB.insert('fornecedores', pessoa('Casa das Tintas'));
  const f3 = await DB.insert('fornecedores', pessoa('Embalagens Bella'));
  const cl = [];
  for (const n of ['Ana Souza', 'Loja Geek Point', 'Bruno Lima (Instagram)', 'Carla Mendes', 'Estúdio Fantasia']) cl.push(await DB.insert('clientes', pessoa(n)));
  await DB.insert('lancamentos', { tipo: 'receber', descricao: 'Saldo inicial de caixa', categoria: 'Saldo inicial', valor: 3500, vencimento: addDays(t, -80), data_pagamento: addDays(t, -80), parceiro: '', origem: 'manual' });
  const compras = [
    [-2, 'Filamento PLA cinza', f1, 5000, 425, 1], [-2, 'Tinta acrílica', f2, 500, 250, 1], [-2, 'Verniz e primer', f2, 300, 105, 1], [-2, 'Base de acrílico', f3, 60, 180, 1], [-2, 'Caixa de presente', f3, 100, 180, 1],
    [-1, 'Filamento PLA cinza', f1, 5000, 410, 1], [0, 'Tinta acrílica', f2, 300, 165, 2], [0, 'Base de acrílico', f3, 40, 116, 1],
  ];
  for (const [m, n, f, q, v, par] of compras) {
    await salvarCompra({ materia_prima_id: ins[n].id, fornecedor_id: f.id, data: mes(m) <= t ? mes(m) : t, quantidade: q, valor_total: v, parcelas: par, pago: m < 0, primeiro_venc: addDays(t, 10) });
  }
  const M = (nome, sku, preco, horas, extra, ficha) => DB.insert('produtos', { nome, sku, preco, custo: 0, custo_extra: extra, horas_pintura: horas, valor_hora: 25, estoque: 0, estoque_minimo: 0, ativo: true, ficha });
  const F = (n, q) => ({ mp_id: ins[n].id, qtd: q });
  const mini = await M('Miniatura 10 cm', 'MIN-10', 149, 1.5, 3, [F('Filamento PLA cinza', 35), F('Tinta acrílica', 6), F('Verniz e primer', 4), F('Caixa de presente', 1)]);
  const medio = await M('Boneco 15 cm', 'BON-15', 289, 3, 6, [F('Filamento PLA cinza', 90), F('Tinta acrílica', 12), F('Verniz e primer', 8), F('Base de acrílico', 1), F('Caixa de presente', 1)]);
  const grande = await M('Boneco 20 cm · edição especial', 'BON-20', 490, 5.5, 10, [F('Filamento PLA cinza', 180), F('Tinta acrílica', 20), F('Verniz e primer', 12), F('Base de acrílico', 1), F('Caixa de presente', 1)]);
  await recalcCustos();
  // [pedido, prazo, entrega, cliente, modelo, qtd, sinal, descrição]
  const entregues = [
    [-62, -48, -49, 0, medio, 1, 100, 'Personagem de anime, pintura com detalhes dourados'], [-58, -45, -44, 1, mini, 6, 300, 'Lote de 6 miniaturas para vitrine'],
    [-50, -36, -37, 2, grande, 1, 200, 'Guerreiro com capa azul, base personalizada'], [-44, -30, -30, 3, medio, 2, 250, 'Casal de bonecos para topo de bolo'],
    [-38, -24, -25, 4, mini, 8, 400, 'Miniaturas para campanha de RPG'], [-30, -17, -18, 0, medio, 1, 120, 'Boneco pet, cores do cachorro'],
    [-22, -10, -11, 2, grande, 1, 250, 'Dragão, pintura degradê'], [-15, -5, -6, 3, medio, 3, 300, 'Trio de personagens'],
  ];
  for (const [ped, prazo, ent, c, mod, q, sinal, desc] of entregues) {
    const e = await salvarEncomenda({ cliente_id: cl[c].id, produto_id: mod.id, quantidade: q, preco_total: mod.preco * q, sinal, sinal_recebido: true, prazo: addDays(t, prazo), data_pedido: addDays(t, ped), descricao: desc, status: 'producao' });
    await entregarEncomenda(e.id, { data_entrega: addDays(t, ent), horas_pintura: num(mod.horas_pintura) * q * 1.1, valor_hora: 25, outros_custos: 0, saldo_recebido: ped < -25 });
  }
  const andamento = [
    [-6, 8, 1, grande, 1, 250, 'Boneco de jogo com armadura, pintura metálica', 'producao'], [-3, 12, 4, medio, 2, 200, 'Dupla de personagens de série', 'producao'],
    [-2, 15, 3, grande, 2, 400, 'Par de guerreiros, pintura metálica', 'producao'], [-1, 25, 2, medio, 3, 300, 'Trio de personagens de série', 'producao'],
    [-1, 20, 0, mini, 4, 0, 'Orçamento de 4 miniaturas', 'orcamento'],
  ];
  for (const [ped, prazo, c, mod, q, sinal, desc, st] of andamento) {
    await salvarEncomenda({ cliente_id: cl[c].id, produto_id: mod.id, quantidade: q, preco_total: mod.preco * q, sinal, sinal_recebido: true, prazo: addDays(t, prazo), data_pedido: addDays(t, ped), descricao: desc, status: st });
  }
  await registrarPerda({ materia_prima_id: ins['Filamento PLA cinza'].id, quantidade: 140, data: addDays(t, -20), motivo: 'Falha de impressão (peça descolou da mesa)' });
  await registrarPerda({ materia_prima_id: ins['Tinta acrílica'].id, quantidade: 15, data: addDays(t, -9), motivo: 'Tinta ressecada' });
  const desp = [['Aluguel do ateliê', 'Aluguel', 600], ['Energia das impressoras', 'Energia e água', 250], ['Anúncios e Instagram', 'Marketing', 200], ['Taxas de cartão e marketplace', 'Taxas de cartão/marketplace', 90]];
  for (const [d, c, v] of desp) {
    for (let m = -2; m <= 2; m++) {
      const venc = mes(m);
      await DB.insert('lancamentos', { tipo: 'pagar', descricao: d, categoria: c, valor: v, vencimento: venc, data_pagamento: venc <= addDays(t, -1) ? venc : null, parceiro: '', origem: 'manual' });
    }
  }
}
