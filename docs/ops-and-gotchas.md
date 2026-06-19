# Ops & gotchas

Traps that cost real time during this build. Read before re-treading them.

## pnpm `ERR_PNPM_IGNORED_BUILDS` failing CI (the big one)

**Symptom:** Vercel (or any clean CI) fails with
`ERR_PNPM_IGNORED_BUILDS: Ignored build scripts: esbuild, sharp, unrs-resolver`
and `pnpm install exited 1`.

**Root cause:** pnpm 10.26+ defaults **`strictDepBuilds: true`**, which makes
unreviewed dependency build scripts (postinstall) a **hard error (exit 1)**, not
a warning. On a clean clone there's no recorded approval, so it errors.

**The real fix** (in the workspace-root `pnpm-workspace.yaml`):

```yaml
# Current mechanism (pnpm 10.26+). REPLACES onlyBuiltDependencies.
allowBuilds:
  esbuild: true
  sharp: true
  unrs-resolver: true

# Safety net: downgrade an unlisted build script from error → warning,
# so install never fails the build.
strictDepBuilds: false
```

**Gotchas that wasted time:**

- `onlyBuiltDependencies` (the older key) was **not honored** by pnpm 11.1.3
  here — `allowBuilds: { pkg: true }` is the current, correct mechanism.
- The `pnpm` field in **package.json is no longer read** by pnpm 11 — it prints
  `The "pnpm" field in package.json is no longer read`. Put settings in
  `pnpm-workspace.yaml`.
- A local tool kept injecting an `allowBuilds:` block with the placeholder value
  `set this to true or false` (invalid). That invalid value — not the key — was
  the problem. The key was right all along; it just needed `true`.
- **Verify the fix locally** by simulating a clean clone:
  `rm -rf node_modules && pnpm install` → should print
  `... postinstall: Done` for the native deps and **exit 0**.

**Vercel note:** root dir can be `apps/playground`; Vercel still detects the
monorepo ("Scope: all 3 workspace projects") and installs from the root, so the
root `pnpm-workspace.yaml` settings apply.

## JOYCO `@joyco/ui` kit pitfalls

- **`shadcn add @joyco/ui` aborts on a fresh app** with the same ignored-builds
  error (shadcn's internal `pnpm add` exits 1). Fix: run
  `pnpm rebuild esbuild sharp unrs-resolver` first to clear the state, *then*
  re-run the add. Don't use `dangerouslyAllowAllBuilds`.
- **Some kit components shipped a radix/base-ui `render`-prop type skew** that
  broke `next build` (`Property 'render' does not exist on ...Props`) — e.g.
  `media-player`, `select`, `mention`, `chart`. If unused, delete them from
  `src/components/ui/` (re-addable from the registry) rather than patching
  generated kit source.
- **`shadcn init` sometimes omits `@/lib/utils`** (`cn` helper). Create it:
  `cn(...inputs) = twMerge(clsx(inputs))`.
- **The current Cluster API** is richer than older JOYCO apps (`audio`,
  `atlas-cropper`): it exports `Cluster` + `Filler` with `direction` / `align` /
  `bg` / `wrap` props and a `--cluster-bg` cascade. Use it for the bento look
  (transparent containers, `gap-px` seams, children own `bg-*`). Don't reach for
  `justify-between` or borders — pack-left + trailing `<Filler/>`.
- **Don't work from memory on the kit** — read the installed
  `src/components/ui/<name>.tsx` for real props, and `cluster.md` on the hub for
  the layout system. (See the `joyco-ui` skill.)

## Engine / renderer traps

- **Tailwind v4 tree-shakes `--color-*` aliases.** A renderer that paints with
  `var(--color-chart-1)` alone goes **colorless** in apps that don't reference
  that utility. Always use the layered fallback
  `var(--color-x, var(--x, #hex))`. (See
  [rendering-and-brand.md](./rendering-and-brand.md).)
- **`measure()` ignores letter-spacing.** Labels render with `0.02em` tracking;
  if you measure without it, labels overflow by ~1.5 chars. Use `measureLabel`
  and keep `LABEL_TRACKING_EM` in sync with the rendered `letter-spacing`.
- **The app consumes the engine's built `dist/`.** After changing engine source,
  rebuild `packages/trazo` or the app shows stale output.
- **Git label width must include label widths in `width`/`height`.** The git
  layout's bounds must reach the rightmost *label* (not just the last lane), or
  labels clip. Already handled — don't regress it.

## Git / repo

- `main` has **branch protection** (PRs required). Pushes from an account with
  bypass permission succeed but skip the PR flow — prefer branch + PR if the team
  expects it.
- Commit messages end with the project's `Co-Authored-By:` trailer.
