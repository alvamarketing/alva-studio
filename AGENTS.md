# Alva Studio — regra de execução

## Regra master do Codex: execução pelo CLI com subagentes

O Codex opera diretamente neste repositório pelo CLI e coordena subagentes
internos para acelerar o trabalho. O Maestri não faz parte do fluxo deste
projeto.

- **Codex coordena e executa.** Pode ler e editar arquivos, rodar comandos,
  testes e builds, além de revisar e integrar o trabalho dos subagentes.
- **Subagentes internos executam tarefas delimitadas.** Use as ferramentas de
  colaboração disponíveis nesta sessão, com escopo, critérios e saída claros.
- **Seleção de modelos:** Luna para tarefas mecânicas e localizadas; Terra para
  integração, depuração e revisão complexa; Sol somente quando Luna e Terra
  demonstrarem insuficiência concreta e registrada.
- **Git e produção:** subagentes não fazem push, publicação ou alteração em
  produção sem autorização explícita. O Codex consolida e verifica antes dessas
  ações.

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
- O agente principal decompõe, distribui e valida; também pode executar
  diretamente quando isso for mais eficiente ou necessário para integrar o
  resultado.
- Reutilize um subagente interno disponível e adequado ao escopo antes de criar
  outro, sem interromper trabalho em andamento.
- Dê escopos estreitos, critérios objetivos e peça respostas compactas. Evite
  auditorias amplas repetidas, subauditorias redundantes, releituras integrais e
  novas execuções de testes quando não houve mudança relevante.
- Só aumente o nível do modelo após registrar o impedimento específico que o
  modelo atual não conseguiu resolver. Preferência ou conveniência não contam
  como insuficiência demonstrada.

## Regra de fidelidade visual

A referência única de interface do Alva Studio é
`docs/wireframes/alva-studio-ui-reference.html`. Toda tela do produto deve
segui-la exatamente. Não é inspiração: é o contrato visual.

- **Toda tarefa que cria ou altera tela cita a seção do wireframe** que ela
  implementa, pelo título exato da seção (por exemplo "Visitas nos últimos 7
  dias", "Conteúdos do projeto", "Estrutura do projeto", "Configure sua VSL").
  Tarefa de tela sem seção citada não entra no plano.
- **Reutilize os tokens da seção "Biblioteca visual"** — tipografia, botões,
  cores, campos, item da árvore e opção visual. Eles já existem como custom
  properties em `packages/studio/public/styles.css` (bloco `:root`, a partir da
  linha 1) e nos demais `packages/studio/public/*.css`. Não crie cor, raio,
  sombra, família ou tamanho novo: se faltar um token, isso é uma pergunta para
  o dono, não uma decisão de quem implementa.
- **Pronto exige verificação visual em navegador**, não só teste verde. Abra a
  tela implementada e a seção correspondente do wireframe lado a lado, no mesmo
  viewport, em desktop e em celular, e compare blocos, textos, espaçamento e
  estados. Anexe o screenshot da comparação.
- **Registre a verificação na certificação do nó** em `.estado/<id>.md`,
  nomeando a seção do wireframe conferida e o caminho do screenshot. Sem esse
  registro o nó não é `feito`. Como em todo o resto, quem constrói a tela não
  é quem confere.
