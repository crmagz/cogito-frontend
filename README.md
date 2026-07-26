# Cogito Operator Workbench

An evidence-first, project-scoped operator console for Cogito. It presents
authoritative Mission Control inventory, a server-projected workflow relay, and
a digest-bound evidence dossier. It is deliberately not a chat client and it
does not directly access object storage or Temporal.

## Local development

The Node relay is the only component that reads `COGITO_UPSTREAM_TOKEN`; it
forwards a small allowlist of Workbench API requests and never sends that token
to browser JavaScript. Copy `.env.example` into a local, untracked `.env` and
run:

```sh
npm ci
npm run dev
```

To serve a built application through the development relay, run `npm run build`
then `npm run serve`. Production startup intentionally fails until a real OIDC
session relay is configured. Do not use a static upstream token in production.

## Validation

```sh
npm run typecheck
npm test
npm run build
npm run lint
```

Tests are native Jest component and HTTP-integration tests. The reusable Forge
workflow runs the same locked install, build, lint, typecheck, and test steps;
it has no ECR or CodeArtifact publish target for this repository. The release
workflow builds qualifying conventional-commit changes on `main`, then creates
the matching `frontend/vX.Y.Z` tag and GitHub release through Forge.
