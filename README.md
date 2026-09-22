# Laya · gestão financeira de bonecos impressos em 3D e pintados à mão

Sistema web (HTML + JavaScript puro, sem build) para a Laya: cada boneco é **feito sob encomenda**. O sistema controla sinal, material consumido, pintura, entrega, contas a pagar e receber, fluxo de caixa e DRE.
Hospedagem gratuita no **GitHub Pages**; banco, login e tempo real no **Supabase**.

## O que faz

| Área | Recursos |
|---|---|
| Painel | Saldo de hoje, projeção de 30 dias, alerta de caixa negativo, cobertura em dias, encomendas em andamento, vencidos, materiais abaixo do mínimo |
| Encomendas | Orçamento → Em produção → Entregue. Lista com cliente, peça, data do pedido, entrega prevista, total, recebido e falta receber. Sinal padrão de 50% (editável); sinal e saldo viram contas a receber; margem prevista ao lançar e lucro real ao entregar |
| Fluxo de caixa | Projeção por semana (30/60/90/180 dias) e extrato realizado |
| Contas a receber / pagar | Baixa e estorno, filtros, recorrência mensal, parcelamento. Nas contas a receber: forma de pagamento (dinheiro, Pix, crédito, débito) com desconto automático da taxa do cartão |
| Compras | Entrada de material com custo médio; gera contas a pagar |
| Matérias-primas | Filamento (g), tinta e verniz (ml), bases e caixas (un), com estoque mínimo e registro de **perdas e falhas** |
| Modelos | Catálogo com preço base, ficha técnica de materiais, horas de pintura, valor da hora e custo extra |
| DRE | Mensal ou anual, por competência, com comparativo do período anterior e bloco de **reinvestimento**: você define o % do lucro líquido e vê o valor reinvestido, o lucro restante e a sugestão de destino (tráfego pago e marketing 60%, fundo de reserva/caixa 30%, melhoria operacional 10%, todos editáveis) |
| Relatórios | Inadimplência, rentabilidade por modelo, receita por cliente, exportação CSV |
| Cadastros | Modelos, clientes, fornecedores, matérias-primas, cartões e taxas da maquininha |

## Fluxo de uma encomenda

1. **Nova encomenda:** digite o nome do cliente (cliente novo é cadastrado automaticamente) e escolha o modelo, descreva a personalização, informe valor, sinal e prazo. O sistema mostra custo estimado e margem prevista.
   - O **sinal** começa em 50% do valor (metade no pedido, metade na entrega) e pode ser alterado. Ele vira uma conta a receber (recebida se você marcar) e o **saldo** vira outra, com vencimento no prazo.
   - Situação inicial **Em produção** baixa o material da ficha técnica na hora. Se faltar material, avisa e nada é gravado; use **Orçamento** e clique em *Iniciar produção* quando comprar.
2. **Entregar:** informe horas reais de pintura, valor da hora e outros custos. O sistema fecha o **custo real** (material + pintura + custo extra + outros), marca o saldo como recebido (se você quiser) e **reconhece a receita na DRE** na data da entrega.
3. **Estornar:** devolve o material ao estoque e remove lançamentos e venda ligados à encomenda.

## Custo de uma peça

`materiais da ficha + custo extra (energia, desgaste) + horas de pintura × valor da hora`

- Cadastre filamento em **gramas**, tinta e verniz em **ml**. Compre nas mesmas unidades (1 kg = 1000 g) para o custo médio ficar certo.
- **Atenção ao pró-labore:** se você retira pró-labore como despesa, deixe o *valor da hora* em 0 para não contar o seu trabalho duas vezes. Se paga uma pintora, use o valor real da hora dela.
- Falhas de impressão, tinta ressecada e pintura refeita: use **Perda** na linha do material. Baixa o estoque e entra na DRE como "Perdas e falhas de impressão".

## Testar agora (sem configurar nada)

Abra por um servidor local (módulos JS não rodam via `file://`):

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Sem Supabase, roda em **modo demonstração**: dados só no navegador. Use "Carregar dados de exemplo" no painel.

## Colocar no ar

### 1. Supabase (banco + login)
1. Crie um projeto em https://supabase.com.
2. **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e execute. Se você já tinha rodado uma versão anterior, rode de novo: o arquivo atualiza a estrutura sem apagar dados. (A tabela antiga `producoes` deixa de ser usada e pode ser removida.)
3. **Project Settings → API**: copie a *Project URL* e a chave *anon public*.
4. Preencha `config.js`:
   ```js
   export const CONFIG = { SUPABASE_URL: 'https://xxxx.supabase.co', SUPABASE_ANON_KEY: 'eyJ...', EMPRESA: 'Laya' };
   ```
5. Abra o sistema, clique em **Criar conta** e entre com o seu e-mail.
6. **Importante:** depois de criar seu usuário, vá em **Authentication → Providers → Email** e desative *Allow new users to sign up*. As políticas RLS liberam os dados para qualquer usuário autenticado; sem isso, qualquer pessoa com o link poderia criar conta e ver tudo. Para dar acesso à equipe, crie usuários em **Authentication → Users → Add user**.

A chave `anon` pode ficar pública no repositório: a proteção vem do login + RLS.

### 2. GitHub Pages
```bash
git init && git add . && git commit -m "Laya financeiro"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/laya-financeiro.git
git push -u origin main
```
No GitHub: **Settings → Pages → Build and deployment → Deploy from a branch → main / (root)**.
O sistema fica em `https://SEU_USUARIO.github.io/laya-financeiro/`.

## Reinvestimento

Na DRE, informe o percentual do **lucro líquido** que será reinvestido (campo em branco até você escolher). O sistema calcula o valor reinvestido e o lucro restante, e divide o reinvestimento pelas sugestões de destino. Se o período tiver prejuízo, não há valor a reinvestir. Os percentuais ficam salvos no navegador em uso.

## Forma de pagamento e taxas de cartão

1. Em **Cadastros → Cartões e taxas**, cadastre uma linha por maquininha + bandeira + tipo (ex.: Stone · Visa · Crédito · 3,15%).
2. Em **Contas a receber**, informe o **valor bruto** e a forma de pagamento. No cartão, escolha a bandeira: a taxa é preenchida sozinha (pode ser ajustada) e o sistema grava o **líquido** que entra no caixa, guardando bruto e taxa.
3. Contas antigas: clique em **Editar** (ou em **Receber**) e escolha a forma de pagamento.

A taxa aplicada fica gravada na conta: mudar a taxa no cadastro depois não altera o que já foi lançado. Na DRE, as taxas entram em "Taxas de cartão/marketplace"; não lance essas taxas também em contas a pagar, senão contam duas vezes.

## Regras de cálculo

- **Saldo em caixa** = contas recebidas − contas pagas. Para partir de um saldo real, lance uma conta a receber com categoria **Saldo inicial**, já marcada como recebida.
- **Projeção** = saldo de hoje + contas em aberto pelo vencimento. Contas vencidas e não pagas entram no dia de hoje.
- **DRE** por competência: receita e custo real (CMV) na **data da entrega**; despesas pelo vencimento; perdas pela data do registro. Sinais e saldos de encomendas não contam como "outras receitas" (evita duplicar). Compras de material não são despesa: viram custo quando a peça é entregue. O saldo inicial fica fora.

## Limites conhecidos

- Cada operação (ex.: iniciar produção) grava em várias tabelas em sequência pelo navegador. Se a conexão cair no meio, pode ficar incompleta; a evolução é mover isso para funções SQL (RPC) do Supabase.
- Sistema de uma empresa só (todos os usuários veem tudo) e sem perfis de permissão.
- Encomenda não é editável depois de criada: estorne e lance de novo.
- Sem emissão de nota fiscal nem conciliação bancária automática.

## Estrutura (versão plana, para enviar pelo celular)

```
index.html    página única
style.css     estilos (cores nas variáveis do topo)
config.js     URL e chave do Supabase e nome da empresa
db.js         acesso a dados (Supabase ou localStorage), auth, tempo real
ops.js        regras: projeção, DRE, encomendas, compras, perdas
app.js        telas e ações
util.js       funções de apoio
logo.png      logo da Laya
favicon.png   ícone da aba
schema.sql    tabelas do banco (colar no SQL Editor do Supabase; não é usado pelo site)
```

Todos os arquivos ficam juntos na raiz do repositório, sem pastas.
