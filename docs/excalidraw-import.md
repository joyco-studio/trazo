# Importing Excalidraw drawings

`importExcalidraw` converts an Excalidraw JSON drawing into a `PositionedGraph`
for Trazo's inline React SVG renderer. It preserves the drawing's positions
and paint order. Connector endpoints bound to rectangles meet their borders;
other connector points keep their authored coordinates. It does not run the
flowchart layout engine.

```tsx
import { readFileSync } from "node:fs";
import { importExcalidraw, joycoTheme } from "@joycostudio/trazo";
import { Graph } from "@joycostudio/trazo/react";

const drawing = readFileSync(new URL("./frame-buffer.excalidraw", import.meta.url), "utf8");
const graph = importExcalidraw(drawing);

export function FrameBufferDiagram() {
  return (
    <Graph
      graph={graph}
      title="Decoded frame buffer timeline"
      theme={{ ...joycoTheme, textCase: "none" }}
      className="max-w-full h-auto"
    />
  );
}
```

The [reference drawing](../examples/frame-buffer.excalidraw) is a normal
Excalidraw export for a JOYCO log. Read it as text in a server component or
build step; no filename change or JSON conversion is needed. Render `<Graph>`
inline so it can inherit `--trazo-*` CSS variables from the hub. An external SVG
`<img>` cannot inherit the page's theme variables.

`joycoTheme` supplies the dark textured canvas and Trazo's house geometry.
Pass the hub's selected `TrazoTheme` to `<Graph theme={...}>` when its exact
palette should be used; the preview for this example uses the playground's
`JOYCO_PRESET` colors with `textCase: "none"` to preserve code labels.

The tracked example uses the updated source with arrows bound to their boxes.
It moves the arrow-bound `frame` label beneath its connector because its
exported position overlapped `[1] decoded`. All other positions are unchanged.

The importer accepts a parsed document or its JSON string. It supports live
`rectangle`, `text`, `line`, and `arrow` elements. It ignores deleted elements,
uses a 24px padded viewBox, and converts element opacity to SVG opacity. Imported
canvases are limited to 32,768px per side so textured rendering stays bounded. Text
stays editable and accessible inside the SVG. Filled rectangles use Trazo's
normal role fill and backdrop-colored border; bound text uses the paired role
foreground. Standalone text and paths use the role color.
Trazo's theme controls font, case, roundness, border width, and the pattern of
solid source lines. Explicit Excalidraw dashes and dots stay dashed and dotted
on paths and rectangle borders. Imported arrowheads support the standard `arrow`
shape; other shapes are rejected because Trazo cannot preserve them yet.

The reference palette maps Excalidraw green to `success`, purple to `primary`,
orange to `warning`, red to `error`, and blue to `info`. Other stroke colors
default to `neutral`. Override or extend the mapping with `roleByColor`:

```ts
const graph = importExcalidraw(drawing, {
  roleByColor: { "#123456": "secondary", "#2f9e44": "info" },
});
```

The color keys are case-insensitive. Nonzero rotation, unsupported live element
types, invalid geometry, and unsupported text alignment or stroke style throw
an error naming the element ID. Excalidraw roughness, freehand strokes, images,
and font sizes are not preserved; this import targets clean explanatory diagrams
that Trazo can reskin. Rectangle bindings use their Excalidraw fixed point, or
the nearest rectangle border when that point is unavailable. Text bindings
keep their authored endpoints. Later edits to the original drawing require
another import.
