<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Computador de bordo para Claude Code — rotação de logs, monitoramento, pacotes de informações em caso de falha e autoconsciência do MCP.

Claude Guardian é uma camada de confiabilidade local que mantém as sessões do Claude Code saudáveis. Ele detecta problemas como excesso de logs, falta de espaço em disco e travamentos antes que causem problemas, coleta evidências quando algo dá errado e disponibiliza um servidor MCP para que o Claude possa se monitorar durante a sessão.

## O que ele faz

| Comando | Propósito |
|---------|---------|
| `preflight` | Verifica os logs do projeto Claude, reporta diretórios/arquivos muito grandes, opcionalmente corrige automaticamente. |
| `doctor` | Gera um pacote de diagnóstico (zip) com informações do sistema, trechos de logs e um registro de eventos. |
| `run -- <cmd>` | Executa qualquer comando com monitoramento, cria automaticamente um pacote em caso de falha ou travamento. |
| `status` | Verificação rápida de status: espaço livre em disco, tamanho dos logs, avisos. |
| `watch` | Daemon em segundo plano: monitoramento contínuo, rastreamento de incidentes, aplicação de limites. |
| `budget` | Visualiza e gerencia o limite de concorrência (exibir/adquirir/liberar). |
| `mcp` | Inicia o servidor MCP (8 ferramentas) para o automonitoramento do Claude Code. |

## Instalação

```bash
npm install -g claude-guardian
```

Ou execute diretamente:

```bash
npx claude-guardian preflight
```

## Início rápido

### Verifique seu ambiente

```bash
claude-guardian status
```

```
=== Claude Guardian Preflight ===

Disk free: 607.13GB [OK]
Claude projects: C:\Users\you\.claude\projects
Total size: 1057.14MB

Project directories (by size):
  my-project: 1020.41MB

Issues found:
  [WARNING] Project log dir is 1020.41MB (limit: 200MB)
  [WARNING] File is 33.85MB (limit: 25MB)

[guardian] disk=607.13GB | logs=1057.14MB | issues=2
```

### Corrige automaticamente o excesso de logs

```bash
claude-guardian preflight --fix
```

Rotaciona logs antigos (gzip), remove trechos grandes de arquivos `.jsonl` e `.log` para manter apenas as últimas N linhas. Cada ação é registrada em um arquivo de registro para rastreabilidade.

### Gera um relatório de falha

```bash
claude-guardian doctor --out ./bundle.zip
```

Cria um arquivo zip contendo:
- `summary.json` — informações do sistema, relatório de tamanho de arquivos, resultados de verificação inicial.
- `log-tails/` — últimas 500 linhas de cada arquivo de log.
- `journal.jsonl` — todas as ações que o guardian executou.

### Executa com monitoramento

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

O monitoramento:
1. Executa seu comando como um processo filho.
2. Monitora a saída padrão (stdout) e a saída de erro (stderr) para verificar a atividade.
3. Se não houver atividade por `--hang-timeout` segundos, captura um pacote de diagnóstico.
4. Se o processo falhar, captura um pacote e, opcionalmente, reinicia com um intervalo crescente.

## Servidor MCP (a verdadeira funcionalidade)

Registre o guardian como um servidor MCP local para que o Claude possa se monitorar:

Adicione ao arquivo `~/.claude.json`:

```json
{
  "mcpServers": {
    "guardian": {
      "command": "npx",
      "args": ["claude-guardian", "mcp"]
    }
  }
}
```

Então, o Claude pode chamar:

| Ferramenta | O que ele retorna |
|------|----------------|
| `guardian_status` | Espaço em disco, logs, processos, risco de travamento, limite, nível de atenção. |
| `guardian_preflight_fix` | Executa a rotação/remoção de trechos de logs e retorna um relatório de antes e depois. |
| `guardian_doctor` | Cria um pacote de diagnóstico (zip) e retorna o caminho e um resumo. |
| `guardian_nudge` | Correção automática segura: corrige logs se estiverem muito grandes e captura um pacote se necessário. |
| `guardian_budget_get` | Limite de concorrência atual, slots em uso, licenças ativas. |
| `guardian_budget_acquire` | Solicita slots de concorrência (retorna o ID da licença). |
| `guardian_budget_release` | Libera uma licença quando terminar uma tarefa pesada. |
| `guardian_recovery_plan` | Plano de recuperação passo a passo, indicando as ferramentas exatas a serem usadas. |

Isso permite que o Claude diga: "Atenção está em AVISO. Executando `guardian_nudge`, e então reduzindo a concorrência."

## Configuração

Três opções de configuração (o resto é codificado com valores padrão razoáveis):

| Opção | Valor padrão | Descrição |
|------|---------|-------------|
| `--max-log-mb` | `200` | Tamanho máximo do diretório de logs do projeto em MB. |
| `--hang-timeout` | `300` | Tempo de inatividade em segundos antes de declarar um travamento. |
| `--auto-restart` | `false` | Reinicia automaticamente em caso de falha ou travamento. |

Além de uma proteção adicional:
- **Espaço livre em disco < 5GB** → o modo agressivo é ativado automaticamente (retenção mais curta, limites mais baixos).

## Modelo de confiança

Claude Guardian é **local**. Ele não possui nenhum listener de rede, telemetria ou dependência de serviços em nuvem.

**O que ele lê:** `~/.claude/projects/` (arquivos de log, tamanhos, horários de modificação), lista de processos (CPU, memória, tempo de atividade, contagem de handles para processos relacionados ao Claude, via `pidusage`).

**O que ele escreve:** `~/.claude-guardian/` (state.json, budget.json, journal.jsonl, pacotes de diagnóstico). Todos os arquivos estão no diretório inicial do usuário.

**O que é coletado nos pacotes:** Informações do sistema (sistema operacional, CPU, memória, disco), trechos dos arquivos de log (últimas 500 linhas), instantâneos de processos e o próprio registro do Guardian. Não são coletadas chaves de API, tokens, credenciais ou conteúdo do usuário.

**Ações perigosas — o que o Guardian NÃO fará:**
- Matar processos ou enviar sinais (nenhum `SIGKILL`, nenhum `SIGTERM`)
- Reiniciar o Claude Code ou qualquer outro processo
- Excluir arquivos (rotação = gzip, corte = manter as últimas N linhas)
- Fazer requisições de rede ou enviar informações para um servidor central
- Elevar privilégios ou acessar dados de outros usuários

Se a funcionalidade de matar processos ou reinicialização automática for adicionada, ela estará disponível apenas por meio de uma opção explícita, documentada aqui, e estará desativada por padrão.

## Princípios de design

- **Evidências em vez de suposições** — cada ação gera uma entrada no registro; os pacotes de erro capturam o estado, não suposições.
- **Determinístico** — sem aprendizado de máquina, sem heurísticas além da idade e do tamanho do arquivo. Uma tabela de decisões que você pode ler em 60 segundos.
- **Seguro por padrão** — rotação = gzip (reversível), corte = manter as últimas N linhas (dados preservados), sem exclusões na versão 1.
- **Dependências simples** — commander, pidusage, archiver, @modelcontextprotocol/sdk. Só isso.

## Desenvolvimento

```bash
npm install
npm run build
npm test
```

## Licença

MIT

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a
