# Iteración 1 — auditoría de robustez + fixes A2/A3

> 2026-07-02 · workstream A (Mati)

## Qué se hizo

1. **Stress harness** (25 casos) contra `layoutFlow`/`layoutGit` → el core es
   sólido; dos bugs reales encontrados ([01-robustness-findings.md](./01-robustness-findings.md)).
2. **A2 — edge labels dentro del canvas** (`layout-flow.ts`):
   - Los path strings ahora se construyen **al final** (`edgePoints` paralelo a
     `positionedEdges`), para poder desplazar toda la geometría después del
     leveling de labels.
   - Nuevo paso "Fold edge-label badges into the bounds": calcula el extent de
     cada badge (`badgeWidth × BADGE_H` centrado en `labelPoint`), desplaza todo
     a la derecha/abajo si un badge se va antes de `padding` (mismo patrón que
     el git leading badge) y agranda `width`/`height` por el spill derecho/abajo.
   - Antes: label de 502px en canvas de 112px (span −195→307). Ahora: canvas
     578px, label contenido (38→540).
3. **A3 — self-loops renderizados** (`layout-flow.ts`):
   - `A --> A` ya no se descarta: se separan (`selfLoops`) del pipeline de
     rank/order/dummies y se rutean como **corredor wrap-around**: cara forward
     → stub → corredor lateral cross-end → entrada por la cara cross-end.
   - Decisión de diseño: la entrada es por la cara **cross-end** (no backward)
     para que la flecha del loop no se apile sobre las flechas de los in-edges
     normales del nodo.
   - El packing reserva `Vertex.loopPad = nodeGap × #loops` en el lado trailing
     del nodo → el corredor nunca pisa al hermano de rank. Loops múltiples se
     anidan a intervalos de `nodeGap`.
   - Label del loop centrado en el corredor, excluido del leveling de siblings.
4. **A6 — `test/robustness.test.ts`**: 15 tests nuevos (self-loops, ciclos,
   labels largos, 100 nodos, fan-out 30, bipartito 10×10, git octopus/12
   branches/parents fantasma/ids duplicados) con checks de sanidad reutilizables
   (`expectSane`: finito, sin overlap, dentro del canvas, labels contenidos;
   `expectDeterministic`). **205 tests en verde.** `tsc --noEmit` limpio.

## Decisiones registradas

- **Entrada del self-loop por cross-end** (ver arriba) — evita colisión de
  arrowheads; costo: comparte anchor con edges same-rank (raro, aceptado).
- **Labels de edges pueden seguir colisionando con nodos vecinos** a nivel
  layout (dagre lo resuelve con label dummy nodes) — se difiere a A5; el fix de
  hoy solo garantiza que el canvas los contenga.
- Changeset **minor** agregado (`.changeset/thick-moons-attack.md`) — self-loop
  es feature nueva de la API observable.
- Docs actualizadas: `docs/engine-contract.md` documenta self-loops first-class.

## Pendiente inmediato (próximas iteraciones)

1. **B2/B3** — theming engine-side (spec en [02-theming-decisions.md](./02-theming-decisions.md)).
2. **A4** — verificación visual en el playground de los fixes de hoy
   (self-loop con elbow45 estilado) + comparación mermaid.
3. Ojo: el playground consume `packages/trazo/dist` — **rebuildear** antes de la
   verificación visual (`pnpm --filter @joycostudio/trazo build`).
