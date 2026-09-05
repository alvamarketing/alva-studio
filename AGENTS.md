# Alva Studio — regra de execução

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
