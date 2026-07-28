# Cogito Operator Workbench

An evidence-first, project-scoped operator console for Cogito. It presents
authoritative Mission Control inventory, a server-projected workflow relay, and
a digest-bound evidence dossier. It is deliberately not a chat client and it
does not directly access object storage or Temporal.

## Local development

The Node relay is the only component that reads `COGITO_UPSTREAM_TOKEN`; it
forwards a small allowlist of Workbench API requests and never sends that token
to browser JavaScript. Copy `.env.example` into a local, untracked `.env` and
point it at a locally forwarded development API:

```sh
kubectl --context kind-cogito-observability -n cogito port-forward service/cogito-api 8000:8000
npm ci
npm run dev
```

Set `COGITO_UPSTREAM_TOKEN` only in the ignored `.env` file or server process
environment. The Vite development server mounts the same relay as `npm run
serve`, so browser requests to `/api/cogito` remain same-origin and the token
never enters browser code or the production build.

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

## Browser E2E

The hermetic browser suite starts the built Workbench with a constrained local
relay and a deterministic upstream fixture. It covers scoped inventory,
workflow navigation, evidence rendering, approval feedback, and the persisted
post-decision state:

```sh
npm run test:e2e
```

The opt-in Kind browser test remains in the repository test suite rather than
in an operator script. It requires a locally forwarded API, a non-production
development token, and the identifier of an existing scoped run. It is
read-only unless `COGITO_E2E_DECISION=request_revision` is set:

```sh
COGITO_KIND_E2E=1 \
COGITO_E2E_UPSTREAM_URL=http://127.0.0.1:8000 \
COGITO_E2E_UPSTREAM_TOKEN=<development-token> \
COGITO_E2E_RUN_ID=<run-id> \
npm run test:e2e:kind
```

Use a separate terminal for the local API forwarding command shown above. The
test never reads cluster credentials or passes the relay token to browser
JavaScript.
