# Rewrite Trazo’s README for the Hub toolbox

The root README is the body of Trazo’s Hub library page, so it should help a package user install Trazo and render a first diagram. Contributor setup belongs in a separate root quickstart. The Hub index description should name the same four diagram types as the README.

1. Check the current README, exported API, live documentation routes, and the Hub’s README fetch and render path. Keep existing workspace edits intact.
2. Rewrite the root README with the requested introduction, playground and documentation links, four diagram use cases, install command, and a complete `tsx` example using `flow`, `layoutFlow`, and `Graph`. Keep feature notes brief and link to the DSL and API references with absolute URLs.
3. Move the existing monorepo setup commands, localhost address, workspace map, and root scripts into `quickstart.md`. Update the Hub’s Trazo description to name flowcharts, git histories, sequence diagrams, and block wireframes.
4. Inspect the final example against the exports and parser, check every new URL, format and inspect the Markdown, then preview `/toolbox/trazo` and `/toolbox/trazo.md` locally with the Hub reading the rewritten README. Record the publication limit for the live routes.

## Verification outcome

The local Hub preview returned 200 for both routes and rendered the heading, `tsx` code block, and absolute quickstart link. The example produced a three-node, two-edge SVG with its title. The playground and documentation URLs returned 200. The new GitHub quickstart URL and both live Hub routes currently return 404 because these changes have not been published. No test suite is needed for these documentation changes; formatting and focused inspection cover the change.
