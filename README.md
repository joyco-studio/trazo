# Trazo

Trazo turns diagram source into deterministic, themeable SVG. Build flowcharts, git histories, sequence diagrams, and block wireframes with a pure TypeScript layout engine and an optional React renderer.

[Live playground](https://trazo.joyco.studio/) · [Documentation](https://trazo.joyco.studio/docs)

| Diagram          | Use it for                                              |
| ---------------- | ------------------------------------------------------- |
| Flowchart        | Show decisions, steps, and paths through a process.     |
| Git history      | Show commits, branches, and merges.                     |
| Sequence diagram | Show messages exchanged between participants over time. |
| Block wireframe  | Sketch a page or component as a grid of labeled blocks. |

## Install

```bash
pnpm add @joycostudio/trazo
```

## Example

```tsx
import { flow, layoutFlow } from '@joycostudio/trazo'
import { Graph } from '@joycostudio/trazo/react'

export default function RequestFlow() {
  const graph = layoutFlow(flow`
    flow LR
    A(["Request"]):primary ==> B["Process"]
    B --> C(["Done"]):success
  `)

  return <Graph graph={graph} title="Request flow" />
}
```

The layout functions also work in plain TypeScript without React. In a React app, `<Graph>` can render in a Server Component and emit SVG in the initial HTML.

## More to explore

- **Deterministic layout:** the same source produces the same positioned graph on the server and client.
- **CSS-token theming:** `--trazo-*` variables override colors, with shadcn tokens and built-in colors as fallbacks.
- **Optional integrations:** `@joycostudio/trazo/remark` renders and validates diagram fences in Markdown; `@joycostudio/trazo/eslint` checks diagram templates in TypeScript.

Read the [DSL reference](https://trazo.joyco.studio/docs/dsl-reference) for diagram syntax and the [API reference](https://trazo.joyco.studio/docs/api-reference) for layouts, rendering, and themes. To work on the monorepo, see the [contributor quickstart](https://github.com/joyco-studio/trazo/blob/main/quickstart.md).
