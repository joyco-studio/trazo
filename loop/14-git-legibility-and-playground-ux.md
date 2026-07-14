# Git legibility overhaul + playground UX + branch hygiene

> 2026-07-14 · seguimiento de [13-mermaid-comparison.md](./13-mermaid-comparison.md):
> cerrar la única brecha real vs mermaid (git multi-branch) y pulir el playground.

## Qué se hizo

### Robustez (lib · va en feat/robustness)

| Entrega | Detalle |
| --- | --- |
| **Una lane por branch** | `assignLanes` ahora asigna una columna dedicada por nombre de branch (orden de primera aparición, main→lane 0). Fallback al algoritmo compacto legacy si algún commit no trae `branch` (preserva el contrato para consumidores no-DSL). Cierra la brecha de #7/#8 del mermaid-compare. |
| **Labels de branch por lane** | `LaneLabel[]` — tags `main:` / `feature-x:` en el gutter izquierdo, teñidos por color de lane. **Solo en horizontal**: en vertical las columnas son angostas (`laneWidth`≈28px) y los nombres horizontales se pisan → se omite el texto (el color de lane desambigua) en vez de rotarlo (rotado ya había sido rechazado). |
| **Notes free-form** | `note "S = squash of x"` — leyenda del chart, apilada abajo. `CommitGraph.notes` → `PositionedNote[]`. |
| **Group brackets** | `group "Elvira's commits" … end` — bracket sobre un rango contiguo de commits. Labels que se solaparían se **escalonan en filas** (no se pisan). `CommitGraph.commitGroups` → `CommitBracket[]`. |

Verificado en browser contra el sketch de referencia (main/homero-receipts con
Elvira's/Homero's commits + la nota del squash). 255 tests en theming, 233 en
robustness (ambos tsc/build limpios).

### Playground UX (va en feat/theming)

- **Zoom fit-relativo**: el diagrama llena el panel por default y ESO lee 100%
  (antes mostraba 200% para diagramas chicos tras el fill). `fitZoom` guardado
  como referencia; el % es `zoom/fitZoom`.
- **Git default horizontal**: es donde viven los lane labels → un historial
  multi-branch se lee como `git log`.
- **Theme drawer**: abre por izquierda, backdrop transparente (`seeThrough` en
  SheetContent) → el preview no se blurea mientras editás el theme.
- **Editor con highlight + line numbers**: `CodeEditor` — textarea transparente
  sobre un `<pre>` pintado (mismas métricas) + gutter scroll-locked. Tokenizer
  puro por modo. Sin dependencia de editor.
- **Tooltips**: `TooltipButton` compone Tooltip+Button para los icon-only
  (zoom/fit/copy/download/add-doc/delete-doc) sin ensuciar el Button base.
- **Grid responsive**: `flex flex-col` abajo de `lg`, `lg:grid` de dos columnas
  en `lg+`. Arregla el break sub-lg (ver learning abajo).

## Learnings

### 1. Branch stacking: cherry-pick sí, rebase de theming NO

feat/robustness ← feat/theming es un stack. El trabajo de lib (lanes + notes)
salió commiteado en theming por conveniencia. Al querer moverlo al branch
correcto:

- **Cherry-pick de los 2 commits de lib sobre robustness: limpio** (tocan solo
  `packages/trazo/*`, additivos al contrato frozen). ✅
- **Rebase de theming sobre el robustness aumentado: se rompe.** Los commits
  VIEJOS de theming (`eccabdf` first-class-theming, etc.) son ANTERIORES a
  helpers que robustness introdujo después (`parsePolyline`, el edge-routing
  overhaul de `2ecc2b7`). Al replayear esos commits viejos encima, git
  auto-resuelve tomando la versión vieja del archivo y **pierde silenciosamente**
  helpers → `parsePolyline is not defined`, comparaciones de tipo imposibles.
  El rebase "termina bien" pero deja código roto que solo se ve con `tsc`.

**Regla**: en branches apilados, mover trabajo hacia abajo (a la base) con
cherry-pick es seguro; **rebasar la rama de arriba sobre una base reescrita es
peligroso** cuando los commits viejos de arriba preceden APIs nuevas de la base.
Dejar los duplicados y deduplicar en el merge/PR final (cuando controlás el
orden) es más seguro que reescribir historia apilada. Siempre `git branch
backup/...` antes, y `tsc` DESPUÉS de cualquier rebase con conflictos resueltos
(el build es el único juez — "sin markers de conflicto" no alcanza).

Estado actual: lib work está en robustness (cherry-picked) Y en theming (donde
nació). La deduplicación queda para el merge final de theming, no para un rebase
preventivo.

### 2. Lane labels horizontales, no verticales

Intentar labels de branch en git vertical fue un callejón: columnas de ~28px no
sostienen nombres horizontales → colisión. Mermaid usa horizontal por eso mismo.
La decisión honesta fue emitir labels solo en horizontal y hacerlo el default,
no forzar texto rotado en vertical.

### 3. Grid responsive: no mezclar Cluster flex con `grid` base

El `<Cluster>` siempre emite `flex` desde sus variants; poner `grid` en el
className deja `flex-row flex-wrap` como clases muertas y `grid-flow-col` sin
template abajo de `lg` rompe el stack. Fix: `direction="col"` (stack flex nativo
abajo de lg) + `lg:grid` (la grilla de 2 col recién en lg+). Nada de
`grid grid-flow-col` en la base.

### 4. Bug encontrado por la comparación, no por el harness

El self-assessment del loop decía "git más legible que mermaid". Era falso para
multi-branch. Lo agarró la comparación visual lado-a-lado, no la suite de tests
(que solo chequea correctitud: sin crashes/NaN/overlaps). Correctitud ≠
legibilidad; hacen falta ambas.
