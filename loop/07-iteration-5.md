# Iteración 5 — auto-wrap de labels (A7)

> 2026-07-02 · workstream A (Mati) · el gap principal encontrado vs mermaid

## Qué se hizo

- **`wrapLabel(label, maxTextWidth)`** en `geometry.ts`: greedy word-wrap
  midiendo cada línea con el glyph table (uppercase + tracking, igual que el
  render). Preserva `\n` explícitos como límites duros; una palabra sola más
  ancha que el presupuesto queda entera (sin hyphenation) — en ese edge case la
  caja puede exceder el máximo, documentado.
- **`FlowLayoutOptions.maxNodeWidth`** (off por default — no cambia ningún
  output existente): el wrap pasa UNA vez en el build de vértices; el mismo
  texto wrappeado dimensiona la caja (`sizeShape`) y se emite en
  `PositionedNode.label` → lo que se mide es exactamente lo que se dibuja.
- **Playground**: `maxNodeWidth: 260` en el `build()` del inspector Y en el
  layout del seed en `page.tsx` (ambos lados idénticos o la hidratación
  rompería).

## Verificación

- 2 tests nuevos en `robustness.test.ts` (caja ≤ 260 y `\n` presente vs >400px
  sin wrap; palabra única sobre-presupuesto queda entera) — **221 tests
  verdes**, tsc limpio, builds de lib y playground OK.
- Visual en browser: el caso "Process with a very long label…" que contra
  mermaid daba una caja de 638px ahora renderiza **3 líneas en ~220px**
  (canvas 309×365 vs 638×526). Self-loop y los 2 back-edges siguen ruteando
  por sus corredores sin pisar la caja más alta.

## Decisiones

- **Default off en el engine** (cambiar el default alteraría el output de todos
  los consumidores existentes — determinismo es contrato); el playground opta
  a 260px, en línea con el ~200px de mermaid.
- Edge labels NO wrappean aún (mermaid sí) — se agrega al backlog si aparece la
  necesidad real en los logs.
- Changeset: sumado al minor pendiente (`lucky-panthers-sing`), release note
  única coherente. Docs: `engine-contract.md` actualizado.

## Estado de la sesión tras 5 iteraciones

- **Mati**: harness permanente (21 casos robustness), self-loops, edge labels
  en bounds, auto-wrap, comparación mermaid documentada. Queda: comparación
  git-mode vs mermaid gitGraph, A8 (label dummy nodes, baja prio).
- **Joyboy**: theming completo lib + playground + presets validados vs ambos
  mocks. Queda: URL-sync (nuqs), overshoot bezier (cosmético).
