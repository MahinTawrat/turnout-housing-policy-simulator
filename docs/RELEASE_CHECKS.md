# Published release checks

Checked November 18, 2026, for source commit [`cf6835201c3a9b3a33006c57e0afe6d762d76bad`](https://github.com/MahinTawrat/turnout-housing-policy-simulator/commit/cf6835201c3a9b3a33006c57e0afe6d762d76bad).

[Open the published simulator](https://mahintawrat.github.io/turnout-housing-policy-simulator/).

| Check | Observed result |
|---|---|
| [GitHub rebuild and tests](https://github.com/MahinTawrat/turnout-housing-policy-simulator/actions/runs/44431282605) | Passed from a fresh checkout |
| [CodeQL Python and JavaScript analysis](https://github.com/MahinTawrat/turnout-housing-policy-simulator/actions/runs/44431282550) | Both analysis jobs completed successfully |
| [Website build and deployment](https://github.com/MahinTawrat/turnout-housing-policy-simulator/actions/runs/44431282398) | Passed |
| Local Python suite with spatial tools | 77 tests passed |
| JavaScript logic/rendering harness | 47,940 central-baseline cases; 1,725 result and graph views; no reported issues |
| Published-site browser checks | Desktop 1280 × 720 and phone 390 × 844; five tabs, county selection, Minnesota and unavailable national transit checked |
| Published-site errors | No console errors, page errors, failed requests or horizontal page overflow in those checks |
| Local documentation/download links | 133 references checked; no missing targets |
| npm registry audit | 38 packages; no reported advisories at the time checked |
| PyPI version metadata | No reported vulnerabilities for the three pinned optional spatial packages at the time checked |
| [GitHub-generated SPDX SBOM](github-sbom.spdx.json) | 49 entries: npm packages, optional Python packages, workflow actions and the repository |

The published build is `7628a685e80d`. The local Windows fingerprint is `eabcfc810393`; the difference is generated JavaScript line endings. Normalizing those generated files to LF reproduces the published fingerprint exactly. Calculations and tested behavior agree.

These checks establish the recorded implementation and deployment outcomes. They do not validate causal policy responses, guarantee construction, certify accessibility or establish future security. CodeQL job success records execution; open alerts and their disposition belong in GitHub Security. Registry advisory feeds and dependency graphs can change.

Minnesota Default results are ADU 16,803; missing middle 8,398; fees 4,528; parking 1,086; transit 647. The official transit reconstruction and withheld New York observations are explained in [release notes](RELEASE_NOTES.md). These are separate conditional scenarios and must not be summed.
