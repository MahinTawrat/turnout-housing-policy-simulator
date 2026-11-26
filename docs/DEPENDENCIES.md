# Dependencies and licenses

This inventory covers the declared project packages and the complete npm lockfile package closure. Versions come from `package.json`, `pnpm-lock.yaml`, `requirements-spatial.txt` and `pyproject.toml`; licenses were checked against primary registry metadata and upstream notices on November 18, 2026. Ignored local tooling and unrequested test/documentation extras are excluded.

First-party code uses **Apache-2.0**. The core model/build uses the Python standard library, and interaction tests use Node built-ins. D3 is vendored for browser charts and maps. Installing the optional spatial requirements is only necessary to reconstruct official geometry/transit exposure.

## JavaScript packages

The lockfile resolves **38 packages: 1 direct and 37 transitive**. A full npm installation includes these packages; this does not mean every command-line helper is shipped in the browser bundle. D3’s retained notice is [here](../src/web/licenses/D3_LICENSE.txt).

| Package | Locked version | Relationship | License |
|---|---|---|---|
| [commander](https://registry.npmjs.org/commander/7.2.0) | 7.2.0 | transitive | MIT |
| [d3-array](https://registry.npmjs.org/d3-array/3.2.5) | 3.2.5 | transitive | ISC |
| [d3-axis](https://registry.npmjs.org/d3-axis/3.0.1) | 3.0.1 | transitive | ISC |
| [d3-brush](https://registry.npmjs.org/d3-brush/3.0.1) | 3.0.1 | transitive | ISC |
| [d3-chord](https://registry.npmjs.org/d3-chord/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-color](https://registry.npmjs.org/d3-color/3.1.1) | 3.1.1 | transitive | ISC |
| [d3-contour](https://registry.npmjs.org/d3-contour/4.0.3) | 4.0.3 | transitive | ISC |
| [d3-delaunay](https://registry.npmjs.org/d3-delaunay/6.0.6) | 6.0.6 | transitive | ISC |
| [d3-dispatch](https://registry.npmjs.org/d3-dispatch/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-drag](https://registry.npmjs.org/d3-drag/3.0.1) | 3.0.1 | transitive | ISC |
| [d3-dsv](https://registry.npmjs.org/d3-dsv/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-ease](https://registry.npmjs.org/d3-ease/3.0.2) | 3.0.2 | transitive | BSD-3-Clause |
| [d3-fetch](https://registry.npmjs.org/d3-fetch/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-force](https://registry.npmjs.org/d3-force/3.0.1) | 3.0.1 | transitive | ISC |
| [d3-format](https://registry.npmjs.org/d3-format/3.1.3) | 3.1.3 | transitive | ISC |
| [d3-geo](https://registry.npmjs.org/d3-geo/3.1.2) | 3.1.2 | transitive | ISC |
| [d3-hierarchy](https://registry.npmjs.org/d3-hierarchy/3.1.3) | 3.1.3 | transitive | ISC |
| [d3-interpolate](https://registry.npmjs.org/d3-interpolate/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-path](https://registry.npmjs.org/d3-path/3.1.1) | 3.1.1 | transitive | ISC |
| [d3-polygon](https://registry.npmjs.org/d3-polygon/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-quadtree](https://registry.npmjs.org/d3-quadtree/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-random](https://registry.npmjs.org/d3-random/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-scale-chromatic](https://registry.npmjs.org/d3-scale-chromatic/3.1.1) | 3.1.1 | transitive | ISC |
| [d3-scale](https://registry.npmjs.org/d3-scale/4.0.3) | 4.0.3 | transitive | ISC |
| [d3-selection](https://registry.npmjs.org/d3-selection/3.0.1) | 3.0.1 | transitive | ISC |
| [d3-shape](https://registry.npmjs.org/d3-shape/3.2.1) | 3.2.1 | transitive | ISC |
| [d3-time-format](https://registry.npmjs.org/d3-time-format/4.1.1) | 4.1.1 | transitive | ISC |
| [d3-time](https://registry.npmjs.org/d3-time/3.1.1) | 3.1.1 | transitive | ISC |
| [d3-timer](https://registry.npmjs.org/d3-timer/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-transition](https://registry.npmjs.org/d3-transition/3.0.2) | 3.0.2 | transitive | ISC |
| [d3-zoom](https://registry.npmjs.org/d3-zoom/3.0.1) | 3.0.1 | transitive | ISC |
| [d3](https://registry.npmjs.org/d3/7.9.0) | 7.9.0 | direct | ISC |
| [delaunator](https://registry.npmjs.org/delaunator/5.1.0) | 5.1.0 | transitive | ISC |
| [iconv-lite](https://registry.npmjs.org/iconv-lite/0.6.3) | 0.6.3 | transitive | MIT |
| [internmap](https://registry.npmjs.org/internmap/2.0.3) | 2.0.3 | transitive | ISC |
| [robust-predicates](https://registry.npmjs.org/robust-predicates/3.0.3) | 3.0.3 | transitive | Unlicense |
| [rw](https://registry.npmjs.org/rw/1.3.3) | 1.3.3 | transitive | BSD-3-Clause |
| [safer-buffer](https://registry.npmjs.org/safer-buffer/2.1.2) | 2.1.2 | transitive | MIT |

## Optional spatial reconstruction

| Component | Version | License | Role / evidence |
|---|---|---|---|
| [PyClipper](https://pypi.org/pypi/pyclipper/1.4.0/json) | 1.4.0 | MIT | Python wrapper; [retained notice](../licenses/PYCLIPPER_LICENSE.txt). |
| [Clipper](https://raw.githubusercontent.com/fonttools/pyclipper/1.4.0/src/clipper.hpp) | 6.4.2 | BSL-1.0 | C++ clipping engine included in PyClipper; [retained notice](../licenses/CLIPPER_BOOST_LICENSE.txt). |
| [PyShp](https://pypi.org/pypi/pyshp/2.3.1/json) | 2.3.1 | MIT | Shapefile reading; [retained notice](../licenses/PYSHP_LICENSE.txt). |
| [GeographicLib](https://pypi.org/pypi/geographiclib/2.1/json) | 2.1 | MIT | Python geodesic calculations; [retained notice](../licenses/GEOGRAPHICLIB_LICENSE.txt). |

These three Python distributions declare no further runtime Python package requirements. Clipper is a bundled native component and therefore appears separately. Platform C/C++ runtime libraries retain their platform distribution terms; they are not relicensed by this project.

## Build/runtime infrastructure

Python ≥3.12 and Node.js ≥22 are required by the project; CI selects Python 3.13 and Node 22. Their distributions retain their own licenses and bundled notices. `pyproject.toml` declares the optional packaging backend `setuptools>=77` (MIT), without a resolved version; direct script-based rebuilding does not need a third-party Python build backend. `pnpm-lock.yaml` uses lockfile format 9.0; no pnpm executable version is pinned by `package.json`.

## Fonts, data and services

- **Fonts:** the browser can request Source Sans 3 and Libre Caslon Display from Google Fonts. Both are [SIL OFL-1.1](https://openfontlicense.org/); the upstream notices are [Source Sans 3](https://raw.githubusercontent.com/google/fonts/main/ofl/sourcesans3/OFL.txt) and [Libre Caslon Display](https://raw.githubusercontent.com/google/fonts/main/ofl/librecaslondisplay/OFL.txt). These are font assets, not Apache-licensed project code. The CSS request is not version locked; local system fallbacks work without it.
- **Data:** Census, HUD, BTS and state projection data keep their agency/source terms. See [DATA.md](DATA.md) and the [source catalog](../config/sources.json). The code license does not relicense the inputs.
- **Hosting/development services:** GitHub provides source hosting, Actions, Pages, CodeQL, Dependabot, the dependency graph and SBOM export. Workflow actions are pinned in `.github/workflows/`; actual remote outcomes are checked separately. Registry services supply npm/PyPI packages during installation.
- **AI assistance:** OpenAI Codex assisted research, programming, documentation and tests. No runtime AI API, AI SDK, pretrained model or model weights are included. See [DISCLOSURES.md](DISCLOSURES.md).

## Machine-readable record

[GitHub's SPDX export](github-sbom.spdx.json) contains 49 entries. On November 26, 2026, the exported package identifiers and versions matched all 38 npm lockfile packages, the three pinned spatial Python distributions, and the seven distinct pinned workflow action references. The remaining entry is the repository itself. The export records its creation time and the dependency graph's branch reference. Regenerate it when dependency manifests or workflow action pins change.

[components.json](components.json) supplements that export with dependency edges, integrity values, bundled Clipper, the unresolved setuptools build constraint, fonts, and hosted services. Use both records to identify runtime and optional components. The GitHub export leaves the repository and workflow action licenses blank. The repository license is [Apache-2.0](../LICENSE). The upstream license files at the exact action revisions are listed below.

| Pinned workflow action | License |
|---|---|
| `actions/checkout` | [MIT](https://raw.githubusercontent.com/actions/checkout/3d3c42e5aac5ba805825da76410c181273ba90b1/LICENSE) |
| `actions/setup-node` | [MIT](https://raw.githubusercontent.com/actions/setup-node/949feb2413d6458794dcd2491c4babbbce0c15c1/LICENSE) |
| `actions/setup-python` | [MIT](https://raw.githubusercontent.com/actions/setup-python/6d4fd22b20465ccc0f7354476588e8df7c9ca0e0/LICENSE) |
| `github/codeql-action/init` and `github/codeql-action/analyze` | [MIT](https://raw.githubusercontent.com/github/codeql-action/33d7b85da1a04171e211befe2c739303b9a4c066/LICENSE) |
| `actions/upload-pages-artifact` | [MIT](https://raw.githubusercontent.com/actions/upload-pages-artifact/fc324d3547104276b827a68afc52ff2a11cc49c9/LICENSE) |
| `actions/deploy-pages` | [MIT](https://raw.githubusercontent.com/actions/deploy-pages/368f82528645a54fb793d4d04e342629a3f51346/LICENSE) |

The GitHub export describes `robust-predicates` as `LicenseRef-scancode-public-domain AND Unlicense`. The pinned upstream [license](https://raw.githubusercontent.com/mourner/robust-predicates/v3.0.3/LICENSE) is the [OSI-approved Unlicense](https://opensource.org/license/unlicense), which permits commercial use and redistribution. It applies to the transitive D3 component. The first-party code retains Apache-2.0. PyClipper's combined MIT and BSL-1.0 entry covers its MIT Python wrapper and bundled Boost-licensed Clipper.

Workflow actions run on GitHub for verification and deployment. The CodeQL analysis binaries have [separate CodeQL terms](https://raw.githubusercontent.com/github/codeql-cli-binaries/main/LICENSE.md). Those binaries are used for hosted scanning and are outside the distributed simulator and its rebuild requirements.
