# Alva Studio — regra de execução

## Regra master do Codex: Product Owner e maestro

**Codex é somente Product Owner/maestro. Codex não executa.**

Toda leitura de código, edição, comando de shell, teste, commit e implementação
deve ser executada por agentes Claude já conectados no Maestri — nunca pelo
Codex diretamente.

- **Codex lista, delega, acompanha e julga resultados.** Codex não lê arquivos
  para implementação, não edita código, não roda testes, não executa comandos
  de build/deploy, não faz commits.
- **Agentes conectados no Maestri executam.** Reutilize terminais e agentes
  existentes; nunca crie terminal ou agente novo se houver um adequado. Nunca
  use subagentes internos do Codex/collaboration neste projeto — use o Maestri.
- **Seleção de modelos para delegação:** Haiku para tarefas mecânicas (testes
  simples, alterações localizadas, verificações diretas); Sonnet para integração,
  depuração e revisão complexa; Opus/Fable somente quando Haiku e Sonnet
  demonstrarem insuficiência concreta e registrada.
- **Orquestradores nunca executam.** Workflows, agents e orchestrators apenas
  decompõem, distribuem, acompanham dependências e validam resultados. Não
  implementam, não editam arquivos operacionalmente, não rodam testes rotineiros.

## Regra master de subagentes e modelos

Toda tarefa deste projeto deve usar pelo menos um subagente antes da execução
principal. O modelo deve ser escolhido de acordo com a complexidade da tarefa:

- **Luna**: rotina, execução localizada, testes simples e verificações diretas.
- **Terra**: arquitetura, integração, depuração, revisão complexa e decisões
  que envolvam várias partes do sistema.
- **Sol**: somente quando Luna e Terra forem insuficientes ou quando a tarefa
  exigir capacidade adicional de raciocínio e coordenação.

A escolha é dinâmica: comece pelo modelo de menor capacidade que possa concluir
a tarefa com segurança e aumente o nível somente quando houver necessidade
demonstrada. Subagentes devem receber escopo independente, critérios objetivos
e não devem fazer push ou alterar produção sem autorização explícita.

## Economia de tokens e uso de terminais

Tokens e contexto são os recursos mais escassos do projeto. O objetivo é obter
o melhor resultado com o menor consumo total possível, sem reduzir a segurança
ou a qualidade necessária para concluir a tarefa.

- Use sempre o menor modelo capaz de executar o escopo com segurança: **Luna**
  para rotina, comandos, testes e alterações localizadas; **Terra** para
  arquitetura, integração, depuração ou revisão complexa; **Sol** somente após
  insuficiência concreta e registrada dos modelos anteriores.
- Nunca atribua trabalho de estagiário a uma super IA. Modelos de maior
  capacidade não devem fazer leitura ampla, comandos simples, testes rotineiros,
  alterações mecânicas ou verificações que um modelo menor possa concluir.
- Orquestradores apenas decompõem, distribuem, acompanham dependências e validam
  resultados. Eles não implementam, editam arquivos, executam testes rotineiros
  nem assumem tarefas operacionais.
- Reutilize um agente ou terminal existente, disponível e adequado ao escopo
  antes de criar outro. Não crie uma janela nova quando uma já aberta puder
  receber a tarefa sem apagar ou interromper trabalho do usuário.
- Dê escopos estreitos, critérios objetivos e peça respostas compactas. Evite
  auditorias amplas repetidas, subauditorias redundantes, releituras integrais e
  novas execuções de testes quando não houve mudança relevante.
- Só aumente o nível do modelo após registrar o impedimento específico que o
  modelo atual não conseguiu resolver. Preferência ou conveniência não contam
  como insuficiência demonstrada.
