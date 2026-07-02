# Iteración 4 — verificación visual: joyco theme vs mock + trazo vs mermaid

> 2026-07-02 · B5 + A4/A5 · claude-in-chrome sobre `next start` (build de prod)

## B5 — el theme JOYCO reproduce el mock ✅ (con un bug encontrado y arreglado)

Reproduje el diagrama Papoi del mock 1 en el playground
(`A[PAPOI]:neutral → B[PAPOI]:primary → achieved:ghost / Papoi?:warning /
died:error → WINS:success / PAPOI:error`):

- ✅ Canvas `#171717` con textura hatch 45°, negro/blanco (neutral), azul
  `#0011ff` (primary), amarillo (warning), naranja-rojo (error), verde
  (success), ghost sutil, edges grises con elbows 45°, densidad `sm`.
- ✅ Preset **soft** con el mismo diagrama: canvas beige, roundness lg, lanes
  rounded, paleta pastel — el "opuesto" del mock 2 sale de los mismos knobs.
- ✅ El theme panel renderiza todos los knobs con estados activos correctos.

**Bug encontrado en el screenshot inicial: edges negros.** `EDGE_ACCENT`
(color default de edges flow) usaba el slot `--trazo-neutral`; el preset JOYCO
pinta neutral **negro** para los nodos → todos los edges se volvieron negros
sobre canvas oscuro. **Fix**: slot propio `--trazo-edge`
(→ `muted-foreground` → `#a1a1a1`), agregado a `TrazoSurfaceSlot`, al panel y
a ambos presets (`#6f6f6f` joyco / `#8a8271` soft). Es exactamente la clase de
acoplamiento que Joyboy quería evitar con tokens separados.

## A4 — comparación con mermaid (self-loop + 2 ciclos + label largo)

Mismo grafo en ambos: `Start → Process(label larguísimo) → Retry? {→Process,
→Start}, Process → Process, Retry? → Done`.

| Aspecto | trazo | mermaid 11.15 (dark) |
| --- | --- | --- |
| Self-loop | corredor compacto al costado del nodo ✅ | arco bezier larguísimo que baja un rank entero y vuelve — peor |
| Back-edges (2 ciclos) | corredores laterales anidados, sin pisar nodos ✅ | arcos con flechas que se cruzan cerca del diamante |
| Label largo | **una sola línea** → caja de 638px | **auto-wrap a ~200px en 3 líneas** ✅ mermaid |
| Edges | estilo elegido (angular/rounded/bezier) | bezier siempre |

**Conclusión**: la geometría de trazo ya es competitiva o mejor en ciclos y
self-loops. El gap real es el **auto-wrap de labels largos** → tarea A7
(propuesta: `maxNodeWidth` opcional que parte por palabras con `measure()`,
puro y determinista).

## A5 — edge labels (dagre)

dagre reserva espacio de rank para edge labels insertando **label dummy
nodes**; trazo hoy: midpoint de la diagonal + leveling de siblings + bounds
del canvas (fix A2). Suficiente para los diagramas de los logs; en grafos
densos un label podría pisar un nodo vecino → tarea A8 (baja prioridad, no
reproducido visualmente).

## Estado de infraestructura

- Playground servido con `next start` en :3000 (task background `b634d38c7`)
  para no interferir con un dev server del usuario.
- Los screenshots quedaron inline en la sesión; el guardado a disco en
  localhost no tiene permiso del extension — no bloqueante.
- Rebuild de lib + playground con el fix `--trazo-edge`; 219 tests verdes.

## Próximo

1. **A7** — auto-wrap de labels (el gap más valioso para Mati).
2. Comparación git-mode vs mermaid gitGraph (pendiente de A4, menor).
3. Follow-ups abiertos: URL-sync del theme (nuqs), overshoot bezier, A8.
