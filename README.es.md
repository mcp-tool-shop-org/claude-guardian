<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/claude-guardian/readme.png" width="400" alt="claude-guardian" />
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/claude-guardian/actions"><img src="https://github.com/mcp-tool-shop-org/claude-guardian/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="MIT License" /></a>
  <a href="https://mcp-tool-shop-org.github.io/claude-guardian/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page" /></a>
</p>

Computadora de vuelo para Claude Code: rotación de registros, supervisión, paquetes de fallos y autoconciencia del MCP.

Claude Guardian es una capa de confiabilidad local que mantiene las sesiones de Claude Code en buen estado. Detecta el crecimiento excesivo de los registros, la presión en el disco y las interrupciones antes de que causen problemas, captura evidencia cuando algo sale mal y expone un servidor MCP para que Claude pueda realizar un automonitoreo durante la sesión.

## ¿Qué hace?

| Comando | Propósito |
|---------|---------|
| `preflight` | Escanea los registros del proyecto Claude, informa sobre directorios/archivos de gran tamaño, opcionalmente corrige automáticamente. |
| `doctor` | Genera un paquete de diagnóstico (zip) con información del sistema, fragmentos de registros y un registro. |
| `run -- <cmd>` | Ejecuta cualquier comando con supervisión, crea automáticamente un paquete en caso de fallo/interrupción. |
| `status` | Comprobación de estado: espacio libre en disco, tamaños de los registros, advertencias. |
| `watch` | Demonio en segundo plano: monitoreo continuo, seguimiento de incidentes, cumplimiento del presupuesto. |
| `budget` | Visualiza y gestiona el presupuesto de concurrencia (mostrar/obtener/liberar). |
| `mcp` | Inicia el servidor MCP (8 herramientas) para el automonitoreo de Claude Code. |

## Instalación

```bash
npm install -g claude-guardian
```

O ejecútelo directamente:

```bash
npx claude-guardian preflight
```

## Comienzo rápido

### Verifique su entorno

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

### Corrige automáticamente el crecimiento excesivo de los registros

```bash
claude-guardian preflight --fix
```

Rota los registros antiguos (gzip), recorta los archivos `.jsonl` y `.log` de gran tamaño a sus últimas N líneas. Cada acción se registra en un archivo de registro para facilitar el seguimiento.

### Genera un informe de fallo

```bash
claude-guardian doctor --out ./bundle.zip
```

Crea un archivo zip que contiene:
- `summary.json` — información del sistema, informe de tamaño de archivo, resultados de la verificación inicial.
- `log-tails/` — las últimas 500 líneas de cada archivo de registro.
- `journal.jsonl` — cada acción que ha realizado el guardián.

### Ejecute con supervisión

```bash
claude-guardian run -- claude
claude-guardian run --auto-restart --hang-timeout 120 -- node server.js
```

El sistema de supervisión:
1. Ejecuta su comando como un proceso secundario.
2. Supervisa la salida estándar/error estándar para detectar actividad.
3. Si no hay actividad durante `--hang-timeout` segundos, captura un paquete de diagnóstico.
4. Si el proceso falla, captura un paquete y, opcionalmente, se reinicia con un intervalo de reintento.

## Servidor MCP (la verdadera clave)

Registre el guardián como un servidor MCP local para que Claude pueda realizar un automonitoreo:

Agregue lo siguiente a `~/.claude.json`:

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

Luego, Claude puede llamar a:

| Herramienta | Lo que devuelve |
|------|----------------|
| `guardian_status` | Disco, registros, procesos, riesgo de interrupción, presupuesto, nivel de atención. |
| `guardian_preflight_fix` | Ejecuta la rotación/recorte de registros y devuelve un informe de antes y después. |
| `guardian_doctor` | Crea un paquete de diagnóstico (zip) y devuelve la ruta y un resumen. |
| `guardian_nudge` | Corrección automática segura: corrige los registros si están hinchados, captura un paquete si es necesario. |
| `guardian_budget_get` | Límite de concurrencia actual, espacios utilizados, concesiones activas. |
| `guardian_budget_acquire` | Solicita espacios de concurrencia (devuelve el ID de la concesión). |
| `guardian_budget_release` | Libera una concesión cuando hayas terminado con el trabajo intensivo. |
| `guardian_recovery_plan` | Plan de recuperación paso a paso que indica las herramientas exactas a utilizar. |

Esto permite que Claude diga: "La atención es de NIVEL DE ADVERTENCIA. Ejecutando `guardian_nudge`, luego reduciendo la concurrencia".

## Configuración

Tres opciones de configuración (todo lo demás está codificado con valores predeterminados razonables):

| Bandera | Valor predeterminado | Descripción |
|------|---------|-------------|
| `--max-log-mb` | `200` | Tamaño máximo del directorio de registros del proyecto en MB. |
| `--hang-timeout` | `300` | Segundos de inactividad antes de declarar una interrupción. |
| `--auto-restart` | `false` | Reiniciar automáticamente en caso de fallo/interrupción. |

Además, existe una restricción codificada:
- **Espacio libre en disco < 5 GB** → el modo agresivo se habilita automáticamente (menor retención, umbrales más bajos).

## Modelo de confianza

Claude Guardian es **solo local**. No tiene ningún listener de red, ni telemetría ni dependencia de la nube.

**Lo que lee:** `~/.claude/projects/` (archivos de registro, tamaños, tiempos de modificación), lista de procesos (CPU, memoria, tiempo de actividad, recuentos de identificadores para los procesos relacionados con Claude a través de `pidusage`).

**Lo que escribe:** `~/.claude-guardian/` (state.json, budget.json, journal.jsonl, paquetes de diagnóstico). Todos los archivos están ubicados en el directorio de inicio del usuario.

**¿Qué información recopila en los paquetes?** Información del sistema (sistema operativo, CPU, memoria, disco), fragmentos de archivos de registro (las últimas 500 líneas), instantáneas de procesos y el propio registro de Guardian. No recopila claves de API, tokens, credenciales ni contenido de usuario.

**Acciones peligrosas: lo que Guardian NO hará:**
- Matar procesos o enviar señales (no `SIGKILL`, no `SIGTERM`)
- Reiniciar Claude Code o cualquier otro proceso
- Eliminar archivos (la rotación es mediante compresión gzip, el recorte consiste en mantener las últimas N líneas)
- Realizar solicitudes de red o enviar información a un servidor central
- Aumentar privilegios o acceder a los datos de otros usuarios.

Si alguna vez se añadiera la función de matar procesos o el reinicio automático, estará habilitada mediante una opción explícita, documentada aquí, y estará desactivada de forma predeterminada.

## Principios de diseño

- **Evidencia sobre suposiciones** — cada acción genera una entrada en el registro; los paquetes de registro capturan el estado, no conjeturas.
- **Determinista** — no utiliza aprendizaje automático ni heurísticas más allá de la edad y el tamaño de los archivos. Tabla de decisiones que se puede leer en 60 segundos.
- **Seguro por defecto** — la rotación es mediante compresión gzip (reversible), el recorte consiste en mantener las últimas N líneas (los datos se conservan), no hay eliminaciones en la versión 1.
- **Dependencias básicas** — commander, pidusage, archiver, @modelcontextprotocol/sdk. Eso es todo.

## Desarrollo

```bash
npm install
npm run build
npm test
```

## Licencia

MIT

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
