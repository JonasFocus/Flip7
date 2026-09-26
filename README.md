# Flip 7 · Family scorekeeper

A mobile-first family scorekeeper and virtual Flip 7 card table.

This repository contains the current deployed frontend build from the Sites app. The Sites project exposes the built page and browser assets, but not its original editable React, TypeScript, Worker, or test source files. The files here are the exact public frontend assets served by the live app, kept in their original paths.

The live app is available at <https://flip-seven-family.jonasinfocus.chatgpt.site>.

## Serving the build

Serve this repository from the domain root. The page loads its JavaScript and CSS from `/_next/static/` and calls the live app's `/api/` endpoints, so it needs a compatible Worker backend to provide full gameplay.

This build is a deployment snapshot. It is not a replacement for the missing editable source project or a standalone GitHub Pages deployment.

Flip 7 is a trademark of its respective owner. This is an independent family project.
