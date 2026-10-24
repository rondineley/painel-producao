# Painel de Produção — pacote para nuvem

Versão independente, com a interface atual, tema claro/escuro, produção diária, filtros, exportação Excel/PNG, relatórios com imagens e contador online.

## O que vem no pacote

- `public/`: o site completo; o arquivo inicial é `index.html`.
- `worker.ts` e `app/api/`: servidor e APIs.
- `drizzle/`: migrações que criam as tabelas no D1.
- `banco/estrutura.sql`: estrutura completa do banco.
- `banco/banco-inicial.sqlite`: banco SQLite vazio, com as tabelas já criadas, para inspeção.
- `wrangler.json`: configuração de hospedagem, banco D1 e imagens R2.

O banco da nova hospedagem começa **vazio**. Este ZIP não contém os registros e imagens do site publicado anteriormente. Não inclui senhas ou acesso à sua conta.

## Publicar na Cloudflare

Você precisa de uma conta Cloudflare, Node.js 22.13 ou superior e acesso ao serviço R2 na sua conta. A criação dos recursos é feita na sua própria conta; eventuais limites e custos são os do seu plano.

1. Extraia TODO o ZIP. Abra o terminal dentro da pasta `painel-producao-nuvem`.
2. Instale as dependências e faça login:

```sh
npm install
npm run login
```

3. Crie o banco e o armazenamento de imagens:

```sh
npx wrangler d1 create painel-producao-db
npx wrangler r2 bucket create painel-producao-imagens
```
 ⛅️ wrangler 4.92.0 (update available 4.152.0)
──────────────────────────────────────────────
┌──────────────────────────────────────┬────────────────────┬──────────────────────────┬────────────┬────────────┬───────────┬──────────────┐
│ uuid                                 │ name               │ created_at               │ version    │ num_tables │ file_size │ jurisdiction │
├──────────────────────────────────────┼────────────────────┼──────────────────────────┼────────────┼────────────┼───────────┼──────────────┤
│ 64cbb8f6-6187-4b0e-8c1c-72ad5bcc06f8 │ painel-producao-db │ 2026-10-24T20:57:38.171Z │ production │ 0          │ 12288     │              │
└──────────────────────────────────────┴────────────────────┴──────────────────────────┴────────────┴────────────┴───────────┴──────────────┘

Se você já tiver criado esses recursos, não os crie de novo: reutilize-os. Se escolher outros nomes, ajuste `database_name` e `bucket_name` em `wrangler.json`.

4. Copie o `database_id` retornado no passo anterior. Configure-o:

```sh
npm run configurar
```

5. Publique:

```sh
npm run deploy
```

O comando aplica as migrações na nuvem e publica o site. Confirme as migrações quando o Wrangler perguntar. No fim, ele mostra a URL `workers.dev` do SEU site. Os dados e as imagens passam a ficar na sua conta.

## Testar antes, sem publicar

```sh
npm run banco:local
npm run dev
```

Abra a URL local mostrada no terminal. O D1 e o R2 locais usam dados separados da nuvem. Para validar o código e preparar o Worker sem publicar:

```sh
npm run check
npm run build
```

Não basta abrir `index.html` com clique duplo: os recursos de banco e envio de imagens dependem do servidor.

## Dados já existentes no painel antigo

O botão **Exportar backup** do painel antigo exporta os lançamentos de IMAGENS. No novo painel, **Importar backup** permite importá-los. Esse backup não inclui a tabela numérica de produção diária; preserve-a também pela exportação Excel antes de uma migração. O ZIP traz a estrutura inicial, não uma cópia do banco de produção antigo.

## Acesso

O comportamento foi preservado: site por link, sem login próprio. A tela de consulta bloqueia a edição na interface; a barra lateral permite lançamentos. Não há separação de usuários por senha. O banco e o bucket não têm credenciais no navegador; somente o Worker acessa os recursos pelas vinculações da Cloudflare.

## Atualizações e manutenção

Edite o HTML em `public/index.html`, o JavaScript em `public/panel.js` e os estilos em `public/panel.css` e `public/theme.css`. Após editar, publique novamente com `npm run deploy`. Não apague migrações já aplicadas. O bucket R2 guarda as imagens; o D1 guarda os registros e referências.

## Referências oficiais

- https://developers.cloudflare.com/workers/static-assets/binding/
- https://developers.cloudflare.com/workers/wrangler/commands/d1/
- https://developers.cloudflare.com/workers/wrangler/commands/r2/
