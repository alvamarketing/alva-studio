# Plano de implementação — Alva Studio

Original. Especificação: briefing.md. Execução nesta sessão com aprovação de escopo na conversa.

1. Criar pacote independente `packages/studio`, sem substituir os scripts originais.
2. Testar primeiro Store(dir): create/list/get/update/duplicate/remove; persistência, revisões e independência entre cópias. Implementar escrita atômica em disco e revisão otimista.
3. Montar interface de lista e editor com GrapesJS 0.23.6 e locale pt; salvar o JSON inteiro; exportar HTML/CSS/JS com metadata. Modelos possuem formulário com action configurável e nenhum dado real.
4. Testar Publisher com fetch injetável: projeto estável por id, arquivos de publicação, alvo production, credencial só em header do servidor e falhas controladas. Implementar configuração por variáveis de ambiente.
5. Servidor local: restringir Host e Origin, exigir JSON nas mutações, limitar corpo e servir somente arquivos conhecidos. Testar requisições HTTP reais em porta efêmera.
6. Instalar dependência em pacote isolado, rodar node --test, iniciar painel e abrir uma prévia local. Não publicar na Vercel ou enviar alterações ao GitHub nesta etapa.

## Segunda entrega — execução paralela

- Editor: módulo isolado de UI guiada, ícones, propriedades por seleção, ação adicionar por clique e arraste, undo/redo.
- Templates: catálogo de seis pontos de partida, CSS e normalização de formulários sem perda de conteúdo.
- Backend: conta do dono, login/logout, troca de senha, sessão e armazenamento protegido das configurações Vercel.
- Integração: tela de primeiro acesso, login e modal de administração; seleção visual de templates; tradução dos estados de publicação.
- Verificação: testes de contratos, acesso negado sem sessão, troca de senha, isolamento de previews, preservação dos projetos e publicação simulada. Browser QA em dados temporários, sem contas/campanhas reais.
