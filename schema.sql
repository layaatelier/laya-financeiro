-- Laya · schema para Supabase
-- Cole este arquivo inteiro em: Supabase > SQL Editor > New query > Run

create extension if not exists "pgcrypto";

create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text, email text, telefone text, cidade text, obs text,
  created_at timestamptz not null default now()
);

create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text, email text, telefone text, cidade text, obs text,
  created_at timestamptz not null default now()
);

create table if not exists materias_primas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null default 'un',
  estoque numeric not null default 0,
  estoque_minimo numeric not null default 0,
  custo_unitario numeric not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists produtos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  sku text,
  preco numeric not null default 0,
  custo numeric not null default 0,           -- custo unitário (calculado pela ficha técnica + custo extra)
  custo_extra numeric not null default 0,     -- energia e desgaste da impressora, por peça
  horas_pintura numeric not null default 0,   -- horas de pintura à mão por peça
  valor_hora numeric not null default 0,      -- valor da hora de pintura (R$)
  estoque numeric not null default 0,
  estoque_minimo numeric not null default 0,
  ativo boolean not null default true,
  ficha jsonb not null default '[]'::jsonb,   -- [{mp_id, qtd}] insumos por unidade
  created_at timestamptz not null default now()
);

-- Se você já rodou uma versão anterior deste arquivo, estas linhas atualizam a estrutura:
alter table produtos add column if not exists custo_extra numeric not null default 0;
alter table produtos add column if not exists horas_pintura numeric not null default 0;
alter table produtos add column if not exists valor_hora numeric not null default 0;
alter table vendas add column if not exists encomenda_id uuid;

create table if not exists vendas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  data date not null default current_date,
  itens jsonb not null default '[]'::jsonb,   -- [{produto_id, nome, qtd, preco, custo}]
  desconto numeric not null default 0,
  total numeric not null default 0,
  custo_total numeric not null default 0,
  forma_pagamento text,
  parcelas int not null default 1,
  encomenda_id uuid,                          -- venda gerada na entrega de uma encomenda
  created_at timestamptz not null default now()
);

create table if not exists compras (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid references fornecedores(id) on delete set null,
  fornecedor_nome text,
  materia_prima_id uuid references materias_primas(id) on delete set null,
  materia_prima_nome text,
  data date not null default current_date,
  quantidade numeric not null,
  valor_total numeric not null,
  parcelas int not null default 1,
  created_at timestamptz not null default now()
);

-- Encomendas: cada boneco é feito sob pedido (sinal, produção, pintura, entrega)
create table if not exists encomendas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references clientes(id) on delete set null,
  cliente_nome text,
  produto_id uuid references produtos(id) on delete set null,
  produto_nome text,
  descricao text,
  quantidade numeric not null default 1,
  preco_total numeric not null default 0,
  sinal numeric not null default 0,
  data_pedido date not null default current_date,
  prazo date not null,
  data_entrega date,
  status text not null default 'orcamento' check (status in ('orcamento', 'producao', 'entregue')),
  horas_pintura numeric not null default 0,
  valor_hora numeric not null default 0,
  outros_custos numeric not null default 0,
  custo_total numeric not null default 0,     -- custo real fechado na entrega
  consumo jsonb not null default '[]'::jsonb, -- [{mp_id, nome, unidade, qtd, custo}] material baixado ao iniciar
  created_at timestamptz not null default now()
);

-- Perdas e falhas de impressão (baixam estoque e entram na DRE)
create table if not exists perdas (
  id uuid primary key default gen_random_uuid(),
  materia_prima_id uuid references materias_primas(id) on delete set null,
  materia_prima_nome text,
  quantidade numeric not null,
  custo_total numeric not null default 0,
  data date not null default current_date,
  motivo text,
  created_at timestamptz not null default now()
);

-- Contas a receber e a pagar (base do fluxo de caixa e da DRE)
create table if not exists lancamentos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('receber', 'pagar')),
  descricao text not null,
  categoria text,
  parceiro text,
  valor numeric not null check (valor >= 0),
  vencimento date not null,
  data_pagamento date,                        -- preenchido = já pago/recebido
  origem text not null default 'manual',      -- manual | encomenda | compra
  origem_id uuid,
  created_at timestamptz not null default now()
);

create index if not exists lancamentos_venc_idx on lancamentos (vencimento);
create index if not exists lancamentos_pag_idx on lancamentos (data_pagamento);
create index if not exists lancamentos_origem_idx on lancamentos (origem, origem_id);
create index if not exists vendas_data_idx on vendas (data);
create index if not exists encomendas_status_idx on encomendas (status, prazo);

-- Segurança: somente usuários autenticados acessam os dados.
do $$
declare t text;
begin
  foreach t in array array['clientes','fornecedores','materias_primas','produtos','vendas','compras','encomendas','perdas','lancamentos']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "acesso autenticado" on %I', t);
    execute format('create policy "acesso autenticado" on %I for all to authenticated using (true) with check (true)', t);
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
