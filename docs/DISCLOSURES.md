# Components and disclosures

First-party Python/JavaScript uses Apache-2.0. Core rebuilding uses Python's standard library; interaction tests use Node built-ins. D3 7.9.0 is vendored, declared in package.json/pnpm-lock.yaml and ISC licensed. Its notice is retained. Optional spatial packages are pinned in requirements-spatial.txt and inventoried separately.

The interface optionally requests Source Sans 3 and Libre Caslon Display from Google Fonts. These font families use the SIL Open Font License. System fallbacks work offline; typography requests may reach Google. Fonts do not enter analytical equations.

Codex assisted research, programming, reviews, explanations and tests. There is no runtime AI service, pretrained model, embedding, paid data service, secret API, database or account system. The team remains responsible for understanding and explaining all code and assumptions.

GitHub Actions, CodeQL, Dependabot, the dependency graph and GitHub Pages provide hosted verification and deployment. The [dependency review](DEPENDENCIES.md) reconciles the GitHub SPDX export with the pinned packages and workflow actions. It also records the CodeQL service terms and the Unlicense terms of the transitive D3 package `robust-predicates`. GitHub Security records the current alert status.

Census, HUD, BTS and official state projections provide public aggregated inputs. The [data documentation](DATA.md) and [source configuration](../config/sources.json) identify their terms and transformation steps. The code license applies to first-party software. The raw source cache is excluded from distribution.
