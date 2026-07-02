# Theming (Joyboy) — decisiones de diseño

> Iteración 1 · 2026-07-02 · estado: DRAFT — se valida contra el código en B2

## Contexto

Ya existe la capa `--trazo-*` (commit `cd62478`): cadena de 3 capas
`var(--trazo-X, var(--color-X, var(--X, #hex)))`. El theming de **color** está;
falta el theming de **geometría/estilo** (knobs) y ampliar el vocabulario de
tokens.

## Decisión 1 — el theme se parte en dos mitades

Un `TrazoTheme` tiene una mitad **paint** (colores → CSS vars, las resuelve el
renderer) y una mitad **layout** (geometría → opciones de `layout*`, el engine
es puro y no lee CSS). Motivo: la invariante "pure TS engine" impide que el
padding/gap vivan en CSS; y la invariante "token keys, not colors" impide que
los colores viajen por el layout.

```ts
interface TrazoTheme {
  paint: { tokens: Partial<Record<TokenSlot, string>>, laneStyle, roundness, background, border, frame? }
  layout: { padding: "sm" | "default" | "lg", lanesMode, laneGap: 0-10 }
}
```

Consumo: `layout(input, themeToLayoutOptions(theme))` + `<Graph theme={theme}>`.
El playground esconde esta partición detrás del editor.

## Decisión 2 — mapeo de knobs de Joyboy a mecanismos

| Knob Joyboy | Mecanismo | Nota |
| --- | --- | --- |
| Padding (default/sm/lg) | preset → `padding` de LayoutOptions | escala también layerGap/nodeGap proporcionalmente |
| Roundness rx (none/sm/default/lg) | renderer: `rx` en boxes (stadium mantiene pill; diamond/cylinder sin cambio) | JOYCO = none |
| Lanes mode (angular/bezier/rounded) | extiende `EdgeStyle`: angular=`elbow45` (actual), rounded=orthogonal con esquinas redondeadas, bezier=curvas | bezier/rounded son geometría nueva en `geometry.ts` |
| Lane style (solid/dashed/dotted) | renderer: `stroke-dasharray` | puro paint |
| Canvas bg color/texture | renderer: `<rect>` + `<pattern>` de SVG opcionales | ver Decisión 4 |
| Lane gap (0–10) | separación entre corredores de edges paralelos (layout) | verificar semántica exacta al implementar |
| Border (large, match bg) | ya existe el chip-lift `stroke = BG`; se variabiliza el ancho | JOYCO = large |

## Decisión 3 — vocabulario de tokens final

Joyboy pide **semánticos y prácticos separados** (en el joyco theme pueden
repetir color codes, pero separados para flexibilidad):

```
primary, secondary, ghost, muted, neutral, success, warning, error, info
(cada uno con su -foreground)
```

Contra el estado actual (`primary, success, error, warning, streamed, neutral`):

- **Se agregan**: `secondary`, `ghost`, `info` (+foregrounds).
- **`streamed` se degrada a alias de `info`**: el tipo `SemanticRole` sigue
  aceptando `"streamed"` (no breaking) pero resuelve al slot `--trazo-info`.
  Motivo: "streamed" era vocabulario ad-hoc de los logs; "info" es el término
  estándar y cubre el mismo rol visual.
- **`muted` ya existe como surface** — se promueve a rol asignable a nodos.
- Los `lane-1…6` de git quedan como están (son prácticos, no semánticos).

## Decisión 4 — frame (label + número) y background: SVG opcional, HTML primero

Joyboy dudaba entre HTML fuera del diagrama vs SVG dentro del theme. Decisión:

1. **Fase 1 (playground)**: frame como HTML del playground — chips con el
   estilo del theme activo. Cero riesgo para el engine, rápido de iterar.
2. **El schema del theme ya reserva `frame?: { label, number }`** para que
   embeberlo en el SVG después no sea breaking. El caso de uso SSR
   (ilustraciones de los logs) va a querer el frame embebido en el `<svg>`
   final — pero no bloquea esta sesión.

El background sí va al SVG desde el arranque (Decisión 2): es un `<rect>` +
`<pattern>` triviales y el mock JOYCO (textura diagonal) lo usa como parte
integral de la pieza.

## Decisión 5 — presets del playground

- **`joyco`** (default): padding sm, roundness none, lanes angular, lane style
  solid, bg con textura diagonal, lane gap 0, border large match bg. Es la cara
  visible — debe reproducir el mock 1 de Joyboy (Papoi oscuro).
- **`soft`**: el opuesto de prueba (mock 2 — beige, rounded, serif-ish): padding
  lg, roundness lg, lanes rounded/bezier, tokens pastel. Valida que el sistema
  cubre ambos extremos.
- Editor: knobs + color pickers por token + export (JSON del theme y/o CSS de
  `--trazo-*`).

## Logs JOYCO aplicables

- [Derive, Don't Mutate](https://hub.joyco.studio/logs/15-derive-dont-mutate):
  la resolución theme → CSS vars/opciones debe pasar por **un solo punto**
  (`resolveTheme()`), no por parches incrementales en el renderer.
- [Color Spaces sRGB & Linear](https://hub.joyco.studio/logs/10-color-spaces-srgb-linear):
  si generamos foregrounds automáticos por contraste, el cálculo de luminancia
  debe hacerse en espacio lineal, no sobre los bytes sRGB.
