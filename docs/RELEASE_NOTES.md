# Official-source release notes

The approved interface and five-year model are retained. The current release replaces inherited transit exposure with the documented official-source reconstruction. The earlier figures remain reproducible with `python scripts/build.py --mode frozen`.

All ADU, missing-middle, fees and parking additions match the approved reference across states, counties and the United States. The historical permit baseline is unchanged. Transit exposure changes are recorded in [the comparison CSV](../data/release/policy_changes.csv).

## Minnesota, Default assumptions

| Conditional scenario | Possible extra homes |
|---|---:|
| ADU | 16,803 |
| Missing middle | 8,398 |
| Fees | 4,528 |
| Parking | 1,086 |
| Transit | 647 |

Transit changes from 653 to 647 under the documented reconstruction; the ranking is unchanged. This ranks modeled additions under chosen assumptions, not the best local policy. Materials using the earlier transit figure describe the frozen reference version and should be updated if presenting the current official-source release.

## Withheld New York tract data

[Census Errata 148](https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html) explains withheld observations for 14 tracts. Transit point estimates that depend on them—Suffolk County, New York State and the national transit aggregate—remain unavailable. They are not filled with zero, another vintage or an undisclosed partial sum. The other four reforms remain available.

The source manifests record the exact missing IDs and processing. The published-area minus available-tract difference is not a separately observed missing-tract count or a confidence interval.
