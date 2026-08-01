/** @jest-environment node */

import { readFile } from "node:fs/promises";
import path from "node:path";

const repositoryRoot = process.cwd();

test("publishes the same GHCR image configured by the Helm chart", async () => {
  const [workflow, chartValues] = await Promise.all([
    readFile(path.join(repositoryRoot, ".github/workflows/verify.yml"), "utf8"),
    readFile(path.join(repositoryRoot, "chart/values.yaml"), "utf8")
  ]);
  const chartRepository = chartValues.match(/^\s*repository:\s*(\S+)\s*$/m)?.[1];

  expect(chartRepository).toBeDefined();
  expect(workflow).toContain("packages: write");
  expect(workflow).not.toContain("ecr-repository:");
  expect(workflow).toContain("container-registry: ghcr");
  expect(workflow).toContain(`ghcr-repository: ${chartRepository?.replace(/^ghcr\.io\//, "")}`);
  expect(workflow).toMatch(
    /uses: crmagz\/forge\/\.github\/workflows\/build-node\.yml@releases\/v\d+\.\d+\.\d+/
  );
});
