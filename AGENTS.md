# Private inventory data

The user does not authorize sending company inventory records to the model. Source Excel/CSV and generated reports in `%LOCALAPPDATA%/IT-Hardware/imports` and `import-reports` must not be opened, printed, sampled, or viewed with browser/screenshot tools by the assistant without explicit authorization to disclose that content. Do not search these private directories for context. Develop and test import tooling using synthetic fixtures only. The user runs `Inspect-Inventory.ps1` locally and may choose sanitized headers or fictional examples to share. See `docs/LOCAL_IMPORT.md`. This restriction also applies to company inventory files placed elsewhere.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
