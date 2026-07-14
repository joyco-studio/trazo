# Comparación vs mermaid.live — ¿alcanza el overhaul de robustez?

> 2026-07-14 · los 10 diagramas de [11-test-diagrams.md](./11-test-diagrams.md)
> renderizados lado a lado en el playground local (:3000) y en mermaid.live,
> mirando SOLO estructura/layout/routing (ignorando theming).

## Método

Cada snippet de trazo traducido a la sintaxis mermaid equivalente (flowchart /
gitGraph / sequenceDiagram / block-beta) y renderizado en mermaid.live vía URL
pako (deflate+base64url del envelope JSON). Zooms a los puntos de contacto y,
en los casos de routing, lectura directa de los `path` del SVG para confirmar
que cada edge existe (no alcanza el ojo con edges finos sobre corredores).

## Veredicto

**Suficiente en flowchart, sequence y block — a la par o mejor que mermaid.**
**El único lugar donde mermaid gana claramente es el layout git multi-branch, y
esa brecha es de LAYOUT, no de correctitud.**

## Flowchart / sequence / block: paridad (o trazo más limpio)

| # | Caso | Resultado |
| - | --- | --- |
| 1 | Papoi fan-out | Par. Raíz centrada sobre el fan-out de 3, hijos alineados. El median-alignment/PAVA matchea a mermaid. |
| 2 | Self-loop + 2 ciclos + label largo | **Trazo más limpio.** Ambos rendean los 6 edges incl. el self-loop `B→B` (fix A3 confirmado leyendo el path del SVG). Mermaid cruza edges (el par C↔B) y rutea C→A por izquierda; trazo anida todo en corredores ortogonales derechos SIN cruces. |
| 3 | 9 roles + shapes | Par. Stadium/diamond/cylinder OK, `streamed`=info pinta idéntico. Misma topología. |
| 4 | Edge labels + fan-out | Par. El label largo "Smoke tests…" queda dentro del canvas, no recortado por el viewBox (**fix A2 confirmado**). Mermaid wrappea a 3 líneas, trazo a 2. |
| 5 | Subgraphs + LR + edges variados | Par. Ambos containers, `==>`/`---`/`<-->` OK. Trazo colorea `==>` por rol del origen (feature); mermaid rutea `B---D` un toque más prolijo por el gap. |
| 6 | Denso | **Trazo más limpio.** Sin overlaps en ninguno, pero mermaid mete más cruces diagonales por el cuerpo; trazo baja el skip-edge por izquierda y mergea en puertos compartidos. |
| 9 | Sequence | Par. Lifelines, async punteado, self-message, notas spanning OK. Cosmético: el self-message de mermaid es arco curvo, el de trazo un gancho rectangular compacto. |
| 10 | Block | Par. Grid 4 col, todos los spans (`:4`/`:3`/`:2`) correctos. |

## Git (#7, #8): correcto pero NO a la par en legibilidad

Correctitud sólida: ambos preservan los **9 commits** (status bar: "9 commits ·
11 edges" — el bug A9 de colisión de ids está realmente arreglado, `m2` no pisa
un auto-id), y trazo trunca el subject que desborda con "…" (fix it.7).

**Pero el layout multi-branch es marcadamente menos legible que mermaid:**

1. **Sin labels de lane por branch.** Mermaid taggea cada lane (main /
   feature-one / feature-two / hotfix); trazo no tiene ninguno — no se puede
   saber qué columna es qué branch sin leer el texto del badge.
2. **Sin lane dedicada por branch.** Trazo empaca feature/one, feature/two y
   hotfix en un par de columnas superpuestas; mermaid le da a cada una su track,
   así se sigue visualmente "branché acá → commiteé → mergeé allá". Con 3+
   branches vivos en simultáneo es una brecha real de legibilidad.

### El self-assessment del loop estaba mal para multi-branch

El resumen (09-…md) afirmó: *"git: trazo más legible (badges horizontales vs ids
rotados 45°)."* Eso **vale para una historia de UNA sola lane** — los badges
horizontales sí le ganan a los ids rotados. **No vale para los grafos
multi-branch de #7/#8**, que son justo los casos de stress. El overhaul arregló
los bugs de *correctitud* pero dejó el *modelo de lanes* atrás de mermaid.

## Próximo trabajo (git multi-lane)

- (a) Labels de branch por lane.
- (b) Una lane por branch vivo (no reusar columnas mientras el branch no
  mergeó).

## Estado

Flowchart/sequence/block: overhaul **suficiente**, paridad; en #2 y #6 trazo es
más limpio que mermaid por los corredores ortogonales sin cruces. Git: **correcto
pero no a la par en legibilidad** — es una brecha conocida, no una regresión.
