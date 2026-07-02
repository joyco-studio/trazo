# Robustez del engine — hallazgos del stress harness

> Iteración 1 · 2026-07-02 · harness: `/tmp/trazo-stress/stress.ts` (a promover a test)

## Qué se probó

25 casos contra `layoutFlow` / `layoutGit` (src, no dist): self-loops, ciclos
(2, 3 nodos, con cola), labels larguísimos (nodo, edge, multiline), cadena de
100 nodos, fan-out de 30, bipartito denso 10×10, skip-edges largos, edges
duplicados, componentes desconectados, nodos aislados, grafos vacíos, LR y TD,
git con octopus merge, 12 branches, parent inexistente, ids duplicados.

Checks por caso: crash, NaN/Infinity, overlap nodo-nodo, nodo fuera del canvas,
determinismo (doble corrida + deep equal).

## Resultado general: el core es sólido ✅

Cero crashes, cero NaN, cero overlaps nodo-nodo, todo determinista. El ranking
Kahn ya rompe ciclos por "lowest input index" (documentado en el header de
`layout-flow.ts`). Diagramas largos y densos posicionan bien.

## Hallazgo 1 — edge labels desbordan el canvas ⚠️

```
canvas: 112 x 176
label spans x: -195.2 → 307.2  | canvas width: 112  *** OVERFLOWS ***
```

`layoutFlow` calcula `labelPoint` (midpoint del edge) y `labelWidth`, pero **no
los incorpora a `width`/`height`**. Un edge label largo queda recortado por el
viewBox. Esto **viola la invariante documentada** en `engine-contract.md`:
"width/height bound ALL geometry **incl. labels**".

**Fix (A2):** expandir bounds con `labelPoint.x ± labelWidth/2` (y alto de
línea) de cada edge, y desplazar la geometría si el label se va a negativo
(mismo patrón de normalización que ya usa el git badge leading).

## Hallazgo 2 — self-loops se descartan silenciosamente ⚠️

```
self-loop: 1 node, edges: []   // A --> A produce CERO edges
```

El paso 0 del pipeline ("drop edges to unknown nodes") o el ranking descarta el
edge `a → a`. No hay error ni warning: el usuario escribe `A --> A` y el edge
desaparece. Mermaid renderiza self-loops como un lacito lateral con label.

**Fix (A3):** rutear el self-loop como stub → vuelta rectangular (estilo
elbow45/orthogonal según edgeStyle) por el lado cross-axis del nodo, con
`labelPoint` al costado. Reservar espacio en bounds.

## No probado aún (queda para A4/A5)

- Calidad visual del routing de **back-edges** (el edge de retorno de un ciclo
  puede cruzar nodos — el harness no chequea edge-through-node).
- Colisión edge-label vs nodos/edges (dagre lo resuelve con label dummy nodes).
- Comparación de screenshots vs mermaid playground.
