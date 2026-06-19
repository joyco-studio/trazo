/**
 * `/` — a React SERVER COMPONENT.
 *
 * Initial paint is PURE SSR: this module computes the seed layout on the server
 * and renders the <Graph> SVG into the initial HTML. View-source shows a real
 * graph with zero client JS on the static render path.
 *
 * The <Inspector> client island hydrates over the same markup and takes over
 * for live, in-browser edits. Both call the SAME layout() + <Graph> with the
 * SAME seed, so the server HTML and the first client render are identical.
 */

import { layout } from "rama";

import { Inspector } from "@/components/inspector";
import { Logo } from "@/components/logo";
import { Badge } from "@/components/ui/badge";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Kbd } from "@/components/ui/kbd";
import { parseDsl, SEED_PROGRAM } from "@/lib/dsl";

export default function Home() {
  // Pure, server-side layout of the seed program. Deterministic → the client
  // recomputes the exact same PositionedGraph on hydration.
  const { graph: seedGraph } = parseDsl(SEED_PROGRAM);
  const seedLayout = layout(seedGraph);

  return (
    // The page is the bento backdrop: a muted field whose gap-px seams show
    // through between the solid (bg-*) children of each Cluster.
    <div className="bg-muted flex min-h-dvh flex-col gap-px">
      <a
        href="#inspector"
        className="bg-primary text-primary-foreground focus-visible:ring-ring sr-only px-4 py-2 focus-visible:not-sr-only focus-visible:absolute focus-visible:z-50 focus-visible:ring-2"
      >
        Skip to inspector
      </a>

      {/* HEADER — pack content from the left, trailing <Filler/> absorbs the
          rest (no justify-between). Each child owns its background. */}
      <Cluster align="stretch" className="h-14 shrink-0 gap-px">
        <a
          href="https://joyco.studio"
          className="group/logo bg-primary text-primary-foreground focus-visible:ring-ring flex aspect-square h-full items-center justify-center focus-visible:ring-2 focus-visible:outline-none"
          aria-label="JOYCO"
        >
          <Logo className="size-5" />
        </a>

        <Cluster align="center" className="bg-card gap-2 px-4">
          <h1 className="text-sm font-semibold tracking-tight lowercase">
            mirador
          </h1>
          <Badge variant="muted" size="sm">
            rama inspector
          </Badge>
        </Cluster>

        <Cluster align="center" className="bg-card text-muted-foreground px-4 max-md:hidden">
          <p className="text-pretty text-xs">
            Programmatic SVG diagrams for the JOYCO logs — server-rendered.
          </p>
        </Cluster>

        <Filler className="bg-card" />

        <Cluster
          align="center"
          className="bg-card text-muted-foreground gap-2 px-4 max-md:hidden"
        >
          <span className="text-xs">view-source shows real</span>
          <Kbd>&lt;svg&gt;</Kbd>
        </Cluster>
      </Cluster>

      {/* MAIN — the inspector fills the remaining height. */}
      <main id="inspector" className="flex flex-1 scroll-mt-6 flex-col">
        <Inspector initialSource={SEED_PROGRAM} initialGraph={seedLayout} />
      </main>

      {/* FOOTER */}
      <Cluster align="stretch" className="h-9 shrink-0 gap-px">
        <Cluster
          align="center"
          className="bg-card text-muted-foreground px-4 font-mono text-xs"
        >
          <span>layout() · pure · deterministic</span>
        </Cluster>
        <Filler className="bg-card" />
        <Cluster align="center" className="group/logo bg-card gap-2 px-4">
          <Logo className="text-muted-foreground size-3.5" />
          <span className="text-muted-foreground text-xs">JOYCO</span>
        </Cluster>
      </Cluster>
    </div>
  );
}
