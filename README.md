# ZENITE

O sistema operacional da sua vida financeira. Não é só um controle de gastos —
o app pensa antes de você: gera orçamento automático a partir da sua renda,
projeta suas metas, prioriza suas dívidas e te dá recomendações a cada
lançamento.

100% local-first: todos os dados ficam salvos apenas no seu dispositivo
(`localStorage`), sem servidor, sem cadastro, sem conta.

## Funcionalidades

- **Onboarding inteligente** — informe nome e renda mensal e o app já gera um
  orçamento por envelopes (Moradia, Alimentação, Transporte, Lazer, Saúde,
  Assinaturas, Outros) proporcional à sua renda.
- **Dashboard** — saldo do mês, receitas x despesas, taxa de economia, valor
  recomendado para gastar por dia, score financeiro (0–100) e insights
  automáticos.
- **Orçamento por envelopes** — cada categoria muda de cor (verde → amarelo →
  laranja → vermelho) em 80% / 90% / 100% do limite.
- **Metas** — defina valor alvo e prazo; o app calcula o aporte mensal
  necessário e avisa se você está adiantado ou atrasado.
- **Central de dívidas** — cadastre suas dívidas e compare as estratégias
  *Snowball* (menor saldo primeiro) e *Avalanche* (maior juros primeiro), com
  simulação de meses até quitação e juros totais projetados.
- **Relatórios** — receitas x despesas dos últimos 6 meses e gastos por
  categoria no mês, com tabela de dados acessível.
- **Gamificação** — nível, XP, sequência diária (streak) e medalhas para
  incentivar disciplina financeira.
- **Motor de insights** — compara gastos por categoria com a média dos meses
  anteriores e sugere economias concretas em R$/ano.
- **Privacidade** — botão para ocultar todos os valores na tela (blur) e PIN
  de acesso opcional.

## Rodar localmente

Site 100% estático (um único `index.html`), sem build:

```
python3 -m http.server 8000
```

e acessar `http://localhost:8000`.

## Deploy no Netlify

1. Crie um site novo no [Netlify](https://app.netlify.com).
2. Conecte este repositório do GitHub (deploy automático a cada push) **ou**
   arraste a pasta do projeto direto na tela de deploy do Netlify.
3. Build command: (vazio) — Publish directory: `.`

## Roadmap sugerido

- Sincronização em nuvem opcional (Supabase) mantendo o modo local como padrão
- Calendário financeiro (contas a vencer, parcelas, assinaturas)
- Módulo de investimentos (renda fixa, ações, cripto, rentabilidade)
- Simulador "e se" (alterar renda, gastos, metas e ver o impacto na hora)
- Biometria / Face ID via WebAuthn
