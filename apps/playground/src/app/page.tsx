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

import Image from "next/image";
import { layoutFlow } from "trazo";

import { Inspector } from "@/components/inspector";
import { Badge } from "@/components/ui/badge";
import { Cluster, Filler } from "@/components/ui/cluster";
import { Kbd } from "@/components/ui/kbd";
import { directionOf, parseFlow, SEED_FLOW } from "@/lib/flow-dsl";

import joycoIcon from "../../public/joyco-icon-128.png";

export default function Home() {
  // Pure, server-side layout of the SSR seed. Flowchart is the default mode
  // (the logs' most-used diagram). Deterministic → the client recomputes the
  // exact same PositionedGraph on hydration, so view-source shows the real SVG.
  const { graph: seedGraph } = parseFlow(SEED_FLOW);
  const seedLayout = layoutFlow(seedGraph, { direction: directionOf(seedGraph) });

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
          className="focus-visible:ring-ring relative flex aspect-square h-full items-center justify-center focus-visible:ring-2 focus-visible:outline-none"
          aria-label="JOYCO"
        >
          <Image
            src={joycoIcon}
            alt=""
            width={56}
            height={56}
            className="h-full w-full object-cover"
            priority
          />
        </a>

        <Cluster align="center" className="bg-card gap-2 px-4">
          <h1 className="text-sm font-semibold tracking-wide uppercase">
            Trazo
          </h1>
          <Badge variant="muted" size="sm">
            playground
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
        <Inspector
          initialMode="flow"
          initialSource={SEED_FLOW}
          initialGraph={seedLayout}
        />
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
        <Cluster align="center" className="bg-card gap-2 px-4">
          <Image
            src={joycoIcon}
            alt=""
            width={14}
            height={14}
            className="size-3.5"
          />
          <span className="text-muted-foreground text-xs tracking-wide uppercase">
            JOYCO
          </span>
        </Cluster>
      </Cluster>
    </div>
  );
}
