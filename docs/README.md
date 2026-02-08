# Documentation

This directory contains **project documentation** for the [WebSDR](../README.md) monorepo.

Documentation is organized by topic. Currently, the primary documentation set is the **[WebUSB](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) / [SDR](https://en.wikipedia.org/wiki/Software-defined_radio) interaction subsystem** under `docs/webusb/`.

---

## WebUSB / SDR Interaction Subsystem

Start here: [webusb/README.md](webusb/README.md)

Key entry points:

- [webusb/overview.md](webusb/overview.md) — high-level overview
- [webusb/architecture.md](webusb/architecture.md) — architecture and runtime boundaries
- [webusb/control-model.md](webusb/control-model.md) — control model and abstractions
- [webusb/commands.md](webusb/commands.md) — command protocol and dispatch
- [webusb/driver-development.md](webusb/driver-development.md) — adding / extending drivers

Diagrams live in [webusb/diagrams/](webusb/diagrams/) (Mermaid sources `.mmd` and rendered `.svg`).

---

## Diagram Rendering (Mermaid)

Diagrams are written in **[Mermaid](https://mermaid.js.org/) (`.mmd`)** and rendered to **SVG** for stable display in GitHub.
The SVG files are the rendered artifacts; Mermaid files are the editable sources.

Regenerate all diagrams under `docs/`:

- `npm run docs:diagrams`

Ubuntu (Chromium sandbox / AppArmor):

- `npm run docs:diagrams:ubuntu`

Notes:

- Diagram rendering is implemented in [scripts/render-mermaid.js](../scripts/render-mermaid.js) and uses `mmdc` from [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli).
- The Ubuntu workaround relies on running `mmdc` under an [AppArmor](https://apparmor.net/) profile via `aa-exec`.

---

## Scope

**In scope:**

- WebUSB device access and interaction patterns
- Driver architecture (JavaScript and/or WASM drivers)
- Control model, commands, and data flow relevant to the WebUSB subsystem

**Out of scope (for this docs folder):**

- CI/CD and release process details
- Developer environment setup beyond what is needed to understand the subsystem

---

## Audience

This documentation is intended for:

- Developers working on WebSDR frontend/backends
- Contributors implementing or integrating SDR drivers
- Reviewers evaluating architecture and protocol decisions
