# Certifica

MVP SaaS em português para gestão de certidões e regularidade fiscal. Next.js 16, React 19, Supabase Auth/Postgres/Storage e Vercel. Nome provisório.

## O que funciona

- Cadastro e entrada por e-mail/senha com Supabase Auth; confirmação de e-mail conforme as configurações do projeto.
- Ambientes independentes, com vários CNPJs por cliente.
- Perfis administrador, operador e visualizador; convites por link de uso único com validade de 48 horas.
- CNPJ numérico e alfanumérico, com validação dos dígitos verificadores na aplicação e no banco.
- Registro manual de certidões federal, estadual, municipal, FGTS e trabalhista; CPEN é tratada como regular durante a validade.
- PDFs privados (até 4 MiB), acesso por links assinados de 60 segundos e autorização por ambiente.
- Painel de vencimentos, alertas internos, busca, filtros e CSV protegido contra fórmulas de planilhas.
- Histórico de documentos preservado; indicadores usam o último documento emitido de cada tipo por empresa.
- Auditoria automática pelo banco; usuários não podem inserir ou alterar eventos diretamente.

## Limites desta versão

**Não há nenhum conector fiscal ativo.** Uma solicitação é gravada como `blocked`, sem acessar um portal e sem inferir regularidade. Não há agendamento, notificações por e-mail, cobrança de assinaturas, recuperação de senha, edição/exclusão de cadastros ou gestão de certificados digitais nesta versão.

O painel não atesta regularidade fiscal completa: reflete documentos cadastrados. PDFs são anexados pelo usuário, sem extração automática nem validação de autenticidade. A cobertura inicial do painel é de até 1.000 empresas e 1.000 registros retornados por consulta, sujeita ao limite da Data API do projeto. Para carteiras maiores, implementar paginação/indicadores no banco antes do uso.

## Banco compartilhado com Nacena

Projeto Supabase: `phsuikibjuzjvdiinstv` (Nacena). **Não foi criado um projeto pago novo.**

Os objetos deste aplicativo têm prefixo `fiscal_`; funções privilegiadas ficam em `fiscal_private` e o bucket é `fiscal-certificates`. Nenhuma tabela, política, função ou bucket preexistente do Nacena foi alterado. Identidade Supabase Auth, limites de uso, recursos, backups e faturamento são compartilhados; isso não equivale a projetos Supabase separados. A autorização dos ambientes fiscais depende exclusivamente de `fiscal_memberships`, nunca de metadados editáveis do usuário.

As migrations deste repositório contêm **apenas o módulo fiscal**. O histórico remoto também contém migrations de outros sistemas. Não execute `supabase db reset`, `db push`, `migration repair`, `config push` ou restauração de schema indiscriminadamente contra o projeto compartilhado. Use migrations aditivas revisadas e aplique apenas as novas do módulo fiscal pelo MCP ou processo equivalente.

## Executar

Requer Node.js 22.13+ (produção e CI: 24).

```sh
npm ci
cp .env.example .env.local
# Preencha URL e chave PUBLICÁVEL do projeto, sem service_role.
npm run dev
```

Variáveis obrigatórias em `.env.local` e em cada ambiente Vercel:

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Não há chave administrativa/service-role neste aplicativo. Nunca adicione uma chave secreta a `NEXT_PUBLIC_*`.

## Autenticação compartilhada

Contas existentes do Nacena podem entrar com suas credenciais Supabase; isso não concede acesso automático a ambientes fiscais. Não altere `SITE_URL`, modelos de e-mail, SMTP, políticas globais ou provedores de autenticação do projeto compartilhado apenas para este app.

Para levar a confirmação de novas contas diretamente de volta ao Certifica, acrescente a URL exata `https://<dominio-do-certifica>/auth/callback` em Authentication → URL Configuration → Redirect URLs, preservando todos os endereços existentes. Até lá, o Supabase pode enviar o usuário ao endereço principal do Nacena após a confirmação; volte ao Certifica e entre normalmente. Nunca desabilite a confirmação de e-mail para contornar essa configuração.

## Verificação

```sh
npm test
npm run typecheck
npm run build
```

Os testes usam PostgreSQL em WASM (PGlite), não mocks de SQL. Aplicam o schema fiscal e validam leitura e escrita entre tenants, vínculos de empresa, perfis, convites, eventos de auditoria, PDFs e acesso anônimo. Auth e Storage são representados por schemas mínimos no teste; isso não substitui um teste do navegador autenticado com o serviço real.

Foi feita também uma verificação transacional no projeto Supabase real, usando papéis `authenticated`, duas identidades temporárias e rollback integral. Nenhuma conta ou dado de teste foi persistido.

O workflow GitHub executa testes, TypeScript e build sem segredos. A Vercel também executa esses checks no build. Para deploy automático por Git, conecte o repositório `KelvinDiogo/certifica-fiscal` ao projeto Vercel `certifica-fiscal` na equipe ADA.

## Próximos passos do produto

1. Escolher portais/provedor e CNPJs autorizados para um piloto.
2. Implementar um conector real com estados separados de sucesso, indisponibilidade, autenticação pendente e erro.
3. Executar tarefas em workers/fila adequados; não executar navegador de longa duração dentro de requisições web.
4. Adicionar paginação e métricas SQL para carteiras maiores, renovação agendada, alertas por e-mail e recuperação de senha.
5. Adicionar revogação de membros/convites e cobrança de assinaturas antes da comercialização ampla.

Nunca tratar falha de consulta, ausência de documento ou falta de cobertura como regularidade fiscal.
