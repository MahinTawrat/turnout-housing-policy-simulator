# Security and dependency record

The app serves public aggregate data and client-side calculations. Do not commit credentials, restricted data or raw source caches. The repository has no runtime account/database/AI credentials.

Workflows run analytical and interaction checks, rebuild the site, and scan Python/JavaScript with CodeQL. Pinned Actions and dependency manifests support review. Dependabot configuration proposes updates; dependency graph and Dependabot alerts are actual repository settings. Secret scanning and push protection must be enabled with no unresolved alerts. Applicable critical/high findings must be fixed or individually justified.

Export the GitHub-generated SBOM from **Insights → Dependency graph → Export SBOM**. Review vendored code and optional spatial tools too. NOTICE, font/service disclosures and data terms are separate from the first-party code license.

The published release includes a [GitHub-generated SBOM](github-sbom.spdx.json) and a [dated verification record](RELEASE_CHECKS.md). Regenerate the inventory when dependencies change.

[CodeQL finding 1](https://github.com/MahinTawrat/turnout-housing-policy-simulator/security/code-scanning/1) identified state selector text reaching the county script loader. County and tract asset paths now come from the build's state catalog. Unsupported states are rejected before loading an asset. The interaction check covers an unsupported selection and a valid county load. GitHub Security reports the scan status for the submitted branch.

Use an isolated Python environment for optional spatial processing. Install the pinned requirements from the official package registry. No paid AI scanning is required. Workflow permissions are restricted to their stated checking or public-deployment purposes.

The local check searches a narrow set of recognizable credential patterns and personal machine paths; it is not a replacement for GitHub scanning or a security certification. Invalid sources, unexpected revisions and conflicting duplicate records fail with reports instead of silently producing partial results.
