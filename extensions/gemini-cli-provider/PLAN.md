---
phase: 01-gemini-cli-extension-restore
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - .pi/extensions/gemini-cli-provider/index.ts
  - .pi/extensions/gemini-cli-provider/provider.ts
  - .pi/extensions/gemini-cli-provider/oauth.ts
  - .pi/extensions/gemini-cli-provider/stream.ts
  - .pi/extensions/gemini-cli-provider/doctor.ts
  - .pi/extensions/gemini-cli-provider/types.ts
  - .pi/extensions/gemini-cli-provider/redaction.ts
  - .pi/extensions/gemini-cli-provider/README.md
  - .pi/extensions/gemini-cli-provider/test/provider.test.ts
  - .pi/extensions/gemini-cli-provider/test/doctor.test.ts
  - .pi/extensions/gemini-cli-provider/test/stream.test.ts
autonomous: true
---

<objective>
## Goal
Restaurar el provider `google-gemini-cli` como extensión local de proyecto en `.pi/extensions/gemini-cli-provider/`, con OAuth-only, catálogo reducido de 3 modelos, streaming dedicado, contrato `/gemini-cli-doctor` completo, y tests de regresión (phase 1.1) inmediatamente después de estabilización funcional.

## Purpose
Recuperar compatibilidad operativa (`--model google-gemini-cli/<id>`) sin tocar el flujo global instalado de Pi y sin reintroducir lógica `google-antigravity`.

## Output
1) Extensión funcional modular (8 archivos requeridos).
2) Contrato de doctor implementado (`/gemini-cli-doctor`, `--json`, `--live`, `--timeout`, `--verbose`, redacción estricta, estados/exit policy).
3) Suite de tests de regresión de fase 1.1 para provider/model-policy/doctor/stream behavior.
4) README local con uso, límites y troubleshooting.
</objective>

<context>
- Referencias obligatorias:
  - `docs/technical-interviews/gemini-cli-extension-restore_log.md`
  - `docs/technical-interviews/gemini-cli-extension-restore_plan.md`
- Commit de remoción a auditar para extracción histórica:
  - `fe66edd943691f8eac295fef68ce36930c35fa05`
  - y su padre `fe66edd943691f8eac295fef68ce36930c35fa05^`
- Decisiones cerradas y vinculantes:
  - Provider ID exacto: `google-gemini-cli`
  - Sin `google-antigravity`
  - OAuth-only (almacenamiento estándar Pi)
  - Display name `/login`: `Google Gemini CLI`
  - Modelos v1:
    - `gemini-3-flash-preview`
    - `gemini-3.1-flash-lite-preview`
    - `gemini-3.1-pro-preview`
  - Modelo default: `gemini-3.1-pro-preview`
  - Endpoint fijo: `https://cloudcode-pa.googleapis.com`
  - Sin override de endpoint
  - Unsupported model => fail explícito y accionable (sin fallback)
  - Stream dedicado de `google-gemini-cli` (no sustituir por `google-generative-ai`)
  - Compatibilidad CLI: `--model google-gemini-cli/<id>`
  - Doctor command contractual: `/gemini-cli-doctor` (sin alias), modo humano + `--json`, status ternario, política de salida, redacción estricta, `--live` opcional, stateless, determinista en no-interactivo.
- Riesgo técnico central: extracción limpia de lógica compartida histórica, eliminando ramas antigravity sin romper semántica gemini-cli.
- Validación acordada:
  - Tests en `.pi/extensions/gemini-cli-provider/test/*.test.ts`.
  - Validación de doctor con enfoque mixto: tests automáticos + smoke manual interactivo (tmux).
</context>

<acceptance_criteria>
## AC-1: Identidad y registro del provider
Given la extensión cargada localmente
When se lista/selecciona el provider
Then existe exactamente `google-gemini-cli` y no existe `google-antigravity`.

## AC-2: Autenticación OAuth-only con storage estándar
Given entorno sin credenciales OAuth
When se intenta usar el provider o correr doctor
Then falla con remediación explícita para login OAuth; no existe fallback API-key ni storage paralelo.

## AC-3: Catálogo y política de modelos
Given el provider activo
When se solicita un modelo soportado
Then acepta solo los 3 IDs aprobados y default `gemini-3.1-pro-preview`.

Given se solicita un modelo no soportado
When se resuelve `google-gemini-cli/<id>`
Then falla explícitamente con mensaje accionable que incluye requested model + lista soportada (sin remap silencioso).

## AC-4: Endpoint y transporte
Given una ejecución de stream del provider
When se construye la request
Then usa base URL fija `https://cloudcode-pa.googleapis.com` sin opción de override en v1.

## AC-5: Semántica de streaming dedicada
Given una invocación del stream del provider
When procesa request/response
Then usa implementación dedicada de `google-gemini-cli` (no path genérico de `google-generative-ai`) y mantiene contrato de eventos Pi esperado.

## AC-6: Contrato `/gemini-cli-doctor`
Given ejecución de `/gemini-cli-doctor`
When sin flags
Then no hace red, reporta status global `ok|warn|fail`, aplica redacción estricta, incluye remediación por warning/fail.

Given ejecución con `--json`
When termina
Then imprime una sola línea JSON final con `status`, `provider`, `timestamp`, `checks[]`, `summary`, con check IDs estables.

Given ejecución con `--live`
When no se indica `--model`
Then hace probe E2E mínimo con default `gemini-3.1-pro-preview` y timeout default 20s (override con `--timeout <s>`).

Given status final fail
When termina en modo no-interactivo
Then exit code es 1; para ok/warn es 0.

## AC-7: Compatibilidad CLI contractual
Given un usuario selecciona `--model google-gemini-cli/<id>`
When el id es soportado
Then la resolución funciona con ese formato exacto.

## AC-8: Validación fase 1.1
Given estabilización funcional manual completada
When se agregan tests de regresión
Then existen y pasan tests automáticos para identidad provider, policy de modelos, doctor contract (json/status/redaction/sin-red por defecto), y path de stream dedicado.
</acceptance_criteria>

<tasks>
<task type="auto">
  <name>Extraer e implementar núcleo del provider local gemini-cli (sin antigravity)</name>
  <files>
    .pi/extensions/gemini-cli-provider/types.ts,
    .pi/extensions/gemini-cli-provider/provider.ts,
    .pi/extensions/gemini-cli-provider/oauth.ts,
    .pi/extensions/gemini-cli-provider/stream.ts,
    .pi/extensions/gemini-cli-provider/index.ts
  </files>
  <action>
    1) Auditar el código histórico en `fe66edd...^` para identificar:
       - lógica gemini-cli necesaria,
       - ramas antigravity a excluir,
       - parámetros OAuth históricos y mapping de thinking-level.
    2) Implementar provider `google-gemini-cli` OAuth-only con display name `Google Gemini CLI` y almacenamiento estándar de credenciales Pi.
    3) Fijar base URL a `https://cloudcode-pa.googleapis.com` (sin override).
    4) Declarar catálogo exacto de 3 modelos y default `gemini-3.1-pro-preview`.
    5) Implementar fail explícito de modelo no soportado con error accionable:
       - incluir provider,
       - requested model,
       - lista soportada.
    6) Preservar compatibilidad de selección `google-gemini-cli/<id>`.
    7) Implementar stream dedicado de gemini-cli; no reutilizar ruta genérica `google-generative-ai`.
    8) Mantener determinismo y eliminar cualquier branch antigravity.
  </action>
  <verify>
    - Búsqueda de código confirma ausencia de referencias antigravity en la extensión.
    - Selección de modelos soportados funciona; uno no soportado falla con mensaje contractual.
    - Verificación de request confirma base URL fija esperada.
    - Flujo OAuth se registra en `/login` con display name exacto.
  </verify>
  <done>AC-1, AC-2, AC-3, AC-4, AC-5, AC-7 satisfechos.</done>
</task>

<task type="auto">
  <name>Implementar `/gemini-cli-doctor` con contrato estable y redacción estricta</name>
  <files>
    .pi/extensions/gemini-cli-provider/doctor.ts,
    .pi/extensions/gemini-cli-provider/redaction.ts,
    .pi/extensions/gemini-cli-provider/index.ts,
    .pi/extensions/gemini-cli-provider/types.ts
  </files>
  <action>
    1) Registrar comando exacto `/gemini-cli-doctor` sin aliases.
    2) Implementar checks con IDs estables (constantes versionadas en código), incluyendo:
       - registro/provider identity,
       - credenciales OAuth presentes,
       - modelo activo soportado,
       - configuración endpoint fija,
       - (opcional por flag) probe live E2E.
    3) Definir agregación de estado global `ok|warn|fail`.
    4) Implementar salida humana por defecto con remediación por warning/fail.
    5) Implementar `--json` de una sola línea final con schema contractual:
       `status`, `provider`, `timestamp`, `checks[]`, `summary`.
    6) Implementar `--live`, `--model <id>`, `--timeout <s>` (default 20), `--verbose`.
    7) Sin red por defecto (solo con `--live`).
    8) Redacción estricta en humano y JSON (tokens, headers sensibles, IDs sensibles).
    9) Stateless y sin mutación de estado global UI.
    10) Política de salida no-interactiva: ok/warn=0, fail=1.
  </action>
  <verify>
    - `/gemini-cli-doctor` sin `--live` no emite tráfico de red.
    - `--json` produce una única línea JSON válida con campos obligatorios.
    - Falta de OAuth => status fail + remediation + exit 1.
    - Modelo no soportado activo => status fail + remediation + exit 1.
    - Salida redacta secretos en todos los modos.
  </verify>
  <done>AC-6 satisfecho.</done>
</task>

<task type="auto">
  <name>Fase 1.1: tests de regresión + documentación operativa local</name>
  <files>
    .pi/extensions/gemini-cli-provider/test/provider.test.ts,
    .pi/extensions/gemini-cli-provider/test/doctor.test.ts,
    .pi/extensions/gemini-cli-provider/test/stream.test.ts,
    .pi/extensions/gemini-cli-provider/README.md
  </files>
  <action>
    1) Agregar tests de regresión enfocados a contrato:
       - identidad provider y ausencia antigravity,
       - resolución de modelos + default + unsupported fail message contractual,
       - doctor json one-line schema y IDs estables,
       - doctor status/exit mapping,
       - doctor sin red por defecto y live opt-in,
       - redacción de campos sensibles,
       - confirmación de uso de stream dedicado.
    2) Añadir README local con:
       - instalación/activación local,
       - OAuth login (`Google Gemini CLI`),
       - modelos soportados y default,
       - política de unsupported models,
       - uso de `/gemini-cli-doctor` y flags,
       - troubleshooting y límites de v1.
    3) Ejecutar tests creados/modificados e iterar hasta pasar.
  </action>
  <verify>
    - Ejecución verde de los tests de la extensión.
    - README refleja exactamente decisiones aprobadas (sin scope extra).
  </verify>
  <done>AC-8 satisfecho y evidencia documental completada.</done>
</task>
</tasks>

<boundaries>
## DO NOT CHANGE
- No modificar providers core existentes para “restaurar” gemini-cli en paquetes globales.
- No tocar `packages/ai/src/models.generated.ts` directamente.
- No introducir `google-antigravity` en ningún archivo nuevo.
- No añadir endpoint override en v1.
- No implementar fallback API-key en v1.
- No mutar estado global UI desde doctor en v1.
- No usar import dinámico/inline imports.

## SCOPE LIMITS
- Este plan implementa solo restauración local por extensión.
- Sin empaquetado `pi install` en esta fase.
- Sin ampliación de catálogo más allá de 3 modelos aprobados.
- Sin cambios de flujo global instalado de Pi del usuario.
</boundaries>

<verification>
1) Verificación estática
- Revisar diffs para confirmar:
  - provider id exacto,
  - 3 modelos exactos + default,
  - endpoint fijo,
  - ausencia de antigravity.
2) Verificación funcional manual guiada
- Login OAuth visible como `Google Gemini CLI`.
- Ejecución con `--model google-gemini-cli/gemini-3.1-pro-preview` funciona.
- Ejecución con modelo no soportado falla con mensaje accionable contractual.
- `/gemini-cli-doctor`:
  - default: sin red,
  - `--json`: línea única,
  - `--live`: probe E2E con timeout controlable.
3) Verificación automática (phase 1.1)
- Ejecutar tests de regresión creados para provider/doctor/stream.
4) Calidad de repo tras cambios de código
- Ejecutar `npm run check` y resolver errores/warnings/infos.
</verification>

<success_criteria>
- 100% de AC-1..AC-8 satisfechos.
- `google-gemini-cli` usable localmente sin tocar instalación global.
- `/gemini-cli-doctor` cumple contrato completo (incluyendo salida/exit/redacción/live policy).
- Tests de regresión añadidos y en verde antes de declarar fase completa.
- No scope creep (sin antigravity, sin API-key fallback, sin endpoint override).
</success_criteria>

<output>
Generar `SUMMARY.md` al cerrar ejecución con:

1) **Files changed**
- Lista exacta de archivos creados/modificados.

2) **Decision mapping**
- Mapeo breve archivo -> decisiones obligatorias que implementa.

3) **Manual validation checklist + results**
- Checklist de pasos ejecutados, resultado PASS/FAIL por paso y evidencia mínima.

4) **Automated regression results (phase 1.1)**
- Tests añadidos, comando ejecutado, resultado.

5) **Contract gaps/blockers**
- Cualquier desvío respecto al contrato aprobado, con impacto y siguiente acción propuesta.
</output>
