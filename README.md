# Housing Policy Impact Simulator

The Turnout helps communities compare five housing reforms, understand the assumptions behind each result, and identify local evidence to check before acting. Choose the United States, a state or a county, then compare ADUs, missing middle, fees, transit and parking over 2026–2030.

[Open the interactive tool](https://mahintawrat.github.io/turnout-housing-policy-simulator/)

The four tabs are **Results**, **How It Works**, **Impact Comparison** and **Data & Sources**. Results uses the selected compact Option A design. How It Works follows five open steps through sources, assumptions, calculations and limits, with further methodology and validation below. The GitHub model, maps, charts and source downloads remain authoritative.

Results are **conditional possible additions**, not promised construction, a shortage estimate or a ranking of the best policy. Reforms can affect the same projects and must not be added together. A permit is permission to build, not a completed home.

## Run the verified release

Use Python 3.12+ and Node.js 22+. Core rebuilding uses their standard libraries and compact processed inputs. No API key, paid data, database or account is required.

```text
python scripts/build.py
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open **http://127.0.0.1:8765/**. The build recomputes the evidence, historical baseline and five-policy results from the pinned official reconstruction. Expected answers are used only by regression tests, never as calculation inputs.

Census withheld 14 New York tract observations. The affected Suffolk County, New York and national transit point estimates are unavailable; the other four reforms remain available. The app explains this and links the [official Census notice](https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html). It does not invent zeros for suppressed observations.

To reproduce the earlier approved figures exactly, run `python scripts/build.py --mode frozen`. This is a clearly labeled regression/reference version; the verified release uses the documented official reconstruction.

## Verify and package

```text
python -m unittest discover -s tests -p "test_*.py" -v
python scripts/build.py
node tests/test_tool.cjs
python scripts/verify.py
python scripts/package.py
```

The static-host package is `build/The_Turnout_Hostinger.zip`. Extract its contents into the host's `public_html`, with `index.html` at the root. The host serves files and does not run the research pipeline. Test the actual deployed site separately.

## Rebuild from official data

Create and activate a Python virtual environment, then run:

```text
python -m pip install -r requirements-spatial.txt
python scripts/refresh.py
```

The command downloads and verifies official Census, HUD, BTS and state projection inputs, cleans and joins them, rebuilds the model and map layers, then builds the same interface in `dist/`. Large raw files require several gigabytes of space and stay in the ignored `data/raw/` cache. Generated inputs and reports go to `data/generated/official/`.

Verified cached files are reused. `--refresh-sources` explicitly permits revised upstream data and retains replaced cached bytes. Use a new `--output` directory if the spatial input version changes. `python scripts/acquire.py --group all` runs acquisition separately.

**The official transit/map reconstruction is a new version.** The original extraction trail was incomplete. Its documented replacement can change transit results and map boundaries; differences are exported and frozen inputs are preserved. Do not describe the replacement as exact recovery of the inherited exposure. See [data](docs/DATA.md) and [model](docs/MODEL.md).

## Repository guide

| Path | Purpose |
|---|---|
| `src/turnout/` | Acquisition, cleaning, evidence, baseline, policies and browser adapters |
| `src/web/` | Approved interface, styles, maps and vendored D3 |
| `config/` | Authoritative source catalog, geographic identities and explicit assumptions |
| `data/snapshot/` | Compact processed inputs, observations and separate regression expectations |
| `data/release/` | Pinned official reconstruction, source provenance and release differences |
| `scripts/` | Rebuild, refresh, verification and packaging commands |
| `tests/` | Independent arithmetic, missing-data, historical-test and interaction checks |
| `.github/` | Rebuild checks, CodeQL, dependency updates and website deployment |

Baseline backtesting does not validate causal policy effects. County references are allocations, not separately tested local forecasts. Stock-based additions and permit-based responses have different outcome definitions; sums with permits are reference comparisons.

## License and disclosures

First-party code uses **Apache-2.0**. D3 uses ISC, with its notice retained. Data terms are separate. Read [NOTICE](NOTICE), [disclosures](docs/DISCLOSURES.md) and [security](docs/SECURITY.md).

Codex assisted research, implementation, documentation and tests. No runtime AI model or AI API is used. The team remains responsible for understanding and explaining the work. This repository does not submit a competition entry or replace its other required materials.
