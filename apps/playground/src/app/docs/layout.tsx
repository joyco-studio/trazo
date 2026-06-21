import type { ReactNode } from "react";
import { NextProvider } from "fumadocs-core/framework/next";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import "fumadocs-ui/style.css";

import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <NextProvider>
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: "Trazo docs" }}
        links={[{ text: "Playground", url: "/" }]}
      >
        {children}
      </DocsLayout>
    </NextProvider>
  );
}
