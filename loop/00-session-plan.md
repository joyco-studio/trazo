# Session plan — supervisión del loop

> Iteración 1 · 2026-07-02

## Objetivo de la sesión

Cumplir los requerimientos de los dos stakeholders sobre trazo:

- **Mati** — diagramas de flujo y git **predecibles y robustos**: edge cases de
  diagramas largos, textos largos, ciclos/auto-referencias, superposición.
  Verificación comparativa contra mermaid (playground + screenshots).
- **Joyboy** — **theming**: la lib soporta custom themes, el playground permite
  crear temas con presets. El theme JOYCO es el default y la cara visible.

## Workstream A — Robustez (Mati)

| # | Item | Estado |
| - | ---- | ------ |
| A1 | Stress harness del engine (ciclos, self-loops, labels largos, 100 nodos, fan-out, bipartito denso) | ✅ corrido — ver [01-robustness-findings.md](./01-robustness-findings.md) |
| A2 | Fix: edge labels fuera del canvas bounds (violación de invariante documentada) | ✅ it.1 — ver [03-iteration-1.md](./03-iteration-1.md) |
| A3 | Fix: self-loops (`A --> A`) se descartan silenciosamente — mermaid los renderiza como loop lateral | ✅ it.1 |
| A4 | Comparación visual vs mermaid playground con claude-in-chrome (screenshots de equivalentes) | ✅ it.4 — ver [06-iteration-4.md](./06-iteration-4.md); gap: auto-wrap (→ A7) |
| A5 | Revisar cómo mermaid/dagre maneja edge-label collision (label dummy nodes) y back-edge routing | ✅ it.4 — dagre usa label dummy nodes; backlog A8 |
| A6 | Promover el harness a `packages/trazo/test/robustness.test.ts` para que sea regresión permanente | ✅ it.1 — 15 tests nuevos, 205 total |
| A7 | Auto-wrap de labels largos (`maxNodeWidth`) — gap encontrado vs mermaid | ✅ it.5 — ver [07-iteration-5.md](./07-iteration-5.md) |
| A8 | Edge-label collision en grafos densos (label dummy nodes de dagre) | backlog (baja prio) |
| A9 | Bug parse-git: auto-ids (`m<N>`/`c<N>`) colisionaban con ids del usuario — commit perdido silenciosamente | ✅ it.6 — ver [08-iteration-6.md](./08-iteration-6.md) |
| A10 | Comparación git-mode vs mermaid gitGraph | ✅ it.6 — trazo más legible; backlog: truncado ellipsis de badges |

## Workstream B — Theming (Joyboy)

| # | Item | Estado |
| - | ---- | ------ |
| B1 | Spec del theme: knobs variabilizados + token set completo — ver [02-theming-decisions.md](./02-theming-decisions.md) | ✅ it.1 |
| B2 | Soporte en engine/renderer: roundness (rx), lanes mode (angular/bezier/rounded), lane style (solid/dashed/dotted), lane gap, padding presets, canvas bg/texture, border | ✅ it.2 — ver [04-iteration-2.md](./04-iteration-2.md) |
| B3 | Nuevos tokens semánticos: secondary, ghost, muted, info (+foregrounds); `streamed` → alias de `info` | ✅ it.2 |
| B4 | Playground: theme editor con presets + export | ✅ it.3 — ver [05-iteration-3.md](./05-iteration-3.md) |
| B5 | JOYCO theme preset (default): padding sm, roundness none, angular, solid, bg texture, lane gap 0, border large match bg | ✅ it.4 — validado vs mock; fix `--trazo-edge` de yapa |
| B6 | Frame con label + número (chips "Papoi generative principles" / "01") — decisión HTML vs SVG | ✅ it.3 — HTML en playground, `theme.frame` reservado para SVG |

## Orden elegido

1. **A2 + A3 primero** — bugs concretos ya confirmados, chicos y de alto valor
   para Mati. Robustez del engine es la base sobre la que se renderiza cualquier
   theme.
2. **B1 spec** en paralelo (documento, no código) para validar el vocabulario de
   tokens antes de tocar el renderer.
3. **B2→B5** implementación del theming (el grueso de la sesión).
4. **A4/A5** verificación visual comparativa al final de cada bloque — sirve
   también para validar el theming (screenshots del joyco theme vs los mocks de
   Joyboy).

## Conocimiento previo aplicado

- JOYCO logs escaneados: [Derive, Don't Mutate](https://hub.joyco.studio/logs/15-derive-dont-mutate)
  y [Color Spaces sRGB & Linear](https://hub.joyco.studio/logs/10-color-spaces-srgb-linear)
  son relevantes para la resolución de tokens del theme (un solo punto de
  resolución, no mutación incremental) y para el cálculo de contraste de
  foregrounds. Se leerán al implementar B2/B3.
- Docs del repo leídas: engine-contract, rendering-and-brand, playground.
  Invariantes a respetar: motor puro/determinista, token keys (no colores) desde
  el engine, cadena de fallback de 3 capas `--trazo-*` → shadcn → hex.
