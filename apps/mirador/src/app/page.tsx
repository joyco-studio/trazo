/**
 * `/` — a React SERVER COMPONENT.
 *
 * Initial paint is PURE SSR: this module computes the seed layout on the server
 * and renders the <Graph> SVG into the initial HTML. View-source shows a real
 * branch+merge graph with zero client JS on the static render path.
 *
 * The <Inspector> client island hydrates over the same markup and takes over for
 * live, in-browser edits. Because both call the SAME `layout()` + `<Graph>` with
 * the SAME seed, the server HTML and the first client render are identical.
 *
 * SWAP AT INTEGRATION: `layout` is imported from "@/lib/rama-stub" — change to
 * "rama" to use the real engine. The graph in `<Inspector>` swaps with it.
 */

import { Inspector } from "@/components/inspector";
import { Badge } from "@/components/ui/badge";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { parseDsl, SEED_PROGRAM } from "@/lib/dsl";
// SWAP AT INTEGRATION: replace "@/lib/rama-stub" with "rama".
import { layout } from "@/lib/rama-stub";

export default function Home() {
  // Pure, server-side layout of the seed program. Deterministic → the client
  // recomputes the exact same PositionedGraph on hydration.
  const { graph: seedGraph } = parseDsl(SEED_PROGRAM);
  const seedLayout = layout(seedGraph);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#inspector"
        className="bg-primary text-primary-foreground focus-visible:ring-ring sr-only px-4 py-2 focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:ring-2"
      >
        Skip to inspector
      </a>

      <header className="border-border/0 bg-background">
        <Cluster
          align="center"
          className="mx-auto w-full max-w-[1400px] gap-3 px-6 py-4"
        >
          <Cluster direction="col" align="start" className="gap-0">
            <Cluster align="baseline" className="gap-2">
              <h1 className="text-2xl font-semibold tracking-tight lowercase">
                mirador
              </h1>
              <Badge variant="muted" size="sm">
                rama inspector
              </Badge>
            </Cluster>
            <p className="text-muted-foreground text-pretty text-sm">
              A live, SSR-first inspector for the rama git-graph layout engine.
            </p>
          </Cluster>

          <Filler />

          <Cluster className="text-muted-foreground gap-2 max-md:hidden">
            <span className="text-xs">view-source shows real</span>
            <Kbd>&lt;svg&gt;</Kbd>
          </Cluster>
        </Cluster>
        <Separator />
      </header>

      <main
        id="inspector"
        className="mx-auto flex w-full max-w-[1400px] flex-1 scroll-mt-6 flex-col px-6 py-6"
      >
        <Inspector initialSource={SEED_PROGRAM} initialGraph={seedLayout} />
      </main>

      <footer className="bg-background">
        <Separator />
        <Cluster
          align="center"
          className="text-muted-foreground mx-auto w-full max-w-[1400px] gap-2 px-6 py-3 text-xs"
        >
          <span className="font-mono">layout() · pure · deterministic</span>
          <Filler />
          <span>JOYCO</span>
        </Cluster>
      </footer>
    </div>
  );
}
