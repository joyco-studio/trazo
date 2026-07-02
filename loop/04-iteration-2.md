# Iteración 2 — theming engine-side (B2 + B3)

> 2026-07-02 · workstream B (Joyboy)

## Qué se hizo

1. **B3 — tokens semánticos nuevos**:
   - `SemanticRole` suma `secondary`, `ghost`, `muted`, `info`. `streamed`
     queda como **alias deprecado de `info`**: sigue en el union y en los DSLs
     (no breaking), pero `ROLE_VARS` lo resuelve al slot `--trazo-info` — themear
     info recolorea streamed legacy.
   - Lista de keywords centralizada: `SEMANTIC_ROLES` exportada desde types.ts;
     los parsers flow/block/sequence derivan su set de ahí (antes: 3 copias).
   - Defaults shadcn de los nuevos: secondary→`secondary`, ghost→`accent`,
     muted→`muted`, info→`chart-3` (los que tenía streamed), con cadena de 3
     capas y foregrounds pareados.
2. **B2 — knobs de theme**:
   - `EdgeStyle` suma `"rounded"` (geometría ortogonal + esquinas arqueadas con
     `Q`, radio 8 clampeado por segmento) y `"bezier"` (Catmull-Rom → cúbicas
     `C`, dedup de puntos coincidentes). En `geometry.ts` — `turnKnees` /
     `pathThrough` / `roundedPath` / `bezierPath`.
   - **Nuevo módulo `src/theme.ts`**: `TrazoTheme` (tokens tipados
     `TrazoTokenSlot` + knobs padding/roundness/lanesMode/laneStyle/laneGap/
     background/border/frame), mitad layout (`themeFlowOptions`/
     `themeGitOptions`) y mitad paint (`resolveThemePaint`) — resolución en un
     único punto cada una (patrón del log 15-derive-dont-mutate).
   - Renderer: `<Graph theme={…}>` — vars `--trazo-*` en el style del root,
     dasharray/linecap por laneStyle, `rx` por roundness, stroke width por
     border, y background canvas + textura hatch 45°.
   - `joycoTheme` exportado (padding sm, roundness none, angular, solid,
     texture, laneGap 0, border large) — **sin colores**: los toma de los
     shadcn tokens de la app consumidora.

## Decisiones registradas

- **Hatch como un solo path, no `<pattern>`**: los patterns necesitan un id de
  DOM y dos `<Graph>` en la misma página colisionarían. Un path determinista
  `f(w,h)` es id-free y SSR-safe. Slots nuevos: `--trazo-canvas` y
  `--trazo-canvas-hatch`.
- **`insetPathEnds` reescrito command-aware (M/L/Q/C)**: el original parseaba
  todos los números como pares x,y y reconstruía `M/L` — un path bezier/rounded
  quedaba aplanado a polyline. Ahora recorta el extremo tirando hacia el
  control point de la curva (tangente) o el vértice previo (línea).
- **`laneGap` aplica solo a git** (`laneWidth += gap*4px`); la densidad de flow
  ya la maneja el preset `padding`. Documentado en el tipo — revisar con Joyboy
  si esperaba otra semántica.
- **Bezier puede desbordar el canvas por control-point overshoot** (~pocos px
  en back-edges). Mermaid tiene el mismo issue. Pendiente de evaluar en la QA
  visual (A4); si molesta, se suma un fudge de padding en modo bezier.
- `base` options > theme options en los helpers de layout (quien pasa un
  override explícito sabe más que el preset).

## Verificación

- `tsc --noEmit` limpio · **219 tests en verde** (13 nuevos: theme mapping,
  paint resolution, estilos rounded/bezier, layouts sanos en los 4 estilos).
- `pnpm build` OK (dist regenerado — el playground ya puede consumir el theme).
- Changeset minor `.changeset/lucky-panthers-sing.md`.
- Docs: `rendering-and-brand.md` (sección TrazoTheme), `engine-contract.md`
  (EdgeStyle ×4).

## Próximo

- **B4**: theme editor del playground (knobs + pickers + presets joyco/soft +
  export JSON/CSS) con el frame label+número como HTML.
- **B5**: validar contra el mock oscuro de Joyboy con screenshot.
- Luego **A4/A5** (comparación mermaid con claude-in-chrome).
