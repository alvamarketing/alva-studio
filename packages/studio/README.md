# Alva Studio

Construtor visual de landing pages da Alva Marketing, criado sobre o GrapesJS 0.23.6 sem alterar o núcleo do fork.

## Executar

Requer Node.js 22 ou superior e pnpm 9.

```sh
cd packages/studio
pnpm --ignore-workspace install --frozen-lockfile
pnpm --ignore-workspace start
```

Abra o endereço impresso, normalmente http://127.0.0.1:4178. No primeiro acesso local, crie a conta do dono com nome, e-mail e uma senha de pelo menos 12 caracteres. Páginas existentes são preservadas.

## O que funciona

- Criar, buscar, renomear, duplicar e excluir páginas.
- Seis pontos de partida: página em branco, serviços, apresentação, oferta, evento e confirmação.
- Editor visual com blocos ilustrados, instruções em português e controles contextuais para texto, imagem, botão, formulário, aparência e espaçamento.
- Formulários com aparência consistente em qualquer seção e destino HTTPS configurável.
- Salvamento automático do projeto completo, prévia isolada e download do HTML.
- Área do dono para atualizar a conta e conectar a Vercel sem editar arquivos do servidor.
- Publicação em um projeto Vercel estável por página, consulta do estado e conexão de domínio próprio.

## Vercel

Abra **Configurações do app → Publicação · Vercel**, informe um token de acesso e, se necessário, o identificador da equipe. O token é cifrado no servidor, nunca volta para o navegador e não entra no HTML das páginas. Como alternativa de migração, o servidor ainda reconhece `VERCEL_TOKEN` e `VERCEL_TEAM_ID` do ambiente enquanto não houver configuração salva.

Salvar mantém um rascunho. Publicar exige uma ação explícita. Só o estado `READY` confirma que a Vercel concluiu a publicação. Cada página mantém seu próprio projeto e pode receber um domínio independente. O domínio precisa pertencer à conta; eventuais registros e verificações DNS continuam sendo feitos no provedor e na Vercel.

Excluir uma página local não remove o projeto ou o domínio remoto. Duplicar limpa o vínculo de publicação e de domínio, mas mantém o destino do formulário.

## Dados e operação

Por padrão, conta, páginas e configurações ficam em `packages/studio/.data/`, ignorado pelo Git. Defina `DATA_DIR` para usar outro volume persistente e faça backup desse diretório completo, inclusive `secret.key`. Use apenas um processo por diretório de dados.

O servidor escuta somente em `127.0.0.1` por padrão. Para operar atrás de um proxy HTTPS próprio, configure `HOST` e `PUBLIC_ORIGIN` com a origem pública exata. A criação da primeira conta deve ser feita localmente antes de expor o serviço. Sessões duram até 12 horas e são encerradas quando o processo reinicia. Esta versão tem uma única conta de dono e ainda não oferece recuperação de senha por e-mail.

Assets enviados pelo editor podem ser incorporados como base64; o salvamento aceita até 8 MiB. Para páginas maiores, prefira URLs de mídia.

## Verificar

```sh
node --test test/*.test.mjs
```

Os testes de publicação usam transporte simulado e não alteram uma conta Vercel real.
