# Contributor quickstart

Trazo is a pnpm and Turbo monorepo. From the repository root:

```bash
pnpm install
pnpm build
pnpm --filter playground dev
```

Open <http://localhost:3000> to edit and preview flowcharts, git histories, sequence diagrams, and block wireframes in the playground.

## Workspace map

| Workspace                            | What it contains                                               |
| ------------------------------------ | -------------------------------------------------------------- |
| [`packages/trazo`](packages/trazo)   | Pure TypeScript layout engine and optional React SVG renderer. |
| [`apps/playground`](apps/playground) | Next.js editor and live diagram preview.                       |

## Root scripts

Run these from the repository root; Turbo runs the relevant workspace scripts.

| Command          | Purpose                                               |
| ---------------- | ----------------------------------------------------- |
| `pnpm build`     | Build Trazo, then the playground in dependency order. |
| `pnpm dev`       | Run workspace development servers.                    |
| `pnpm test`      | Run the Trazo test suite.                             |
| `pnpm typecheck` | Type-check workspace packages.                        |
| `pnpm lint`      | Lint workspace packages.                              |

For package use and diagram syntax, see the [README](README.md), [DSL reference](https://trazo.joyco.studio/docs/dsl-reference), and [API reference](https://trazo.joyco.studio/docs/api-reference).
