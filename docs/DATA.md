# Data and reconstruction

`config/sources.json` records authoritative URLs, vintages, formats, hashes where available and terms. `config/source_catalog.json` is the shorter catalog shown in the tool. The [data provenance record](DATA_PROVENANCE.md) and [portable CSV](data-provenance.csv) document the official release's source versions, access dates, terms, processing and limitations. The processing code and generated manifests show how to reproduce the data.

| Source | Use |
|---|---|
| Census final 2025 state/county BPS | Permit baseline, building types, county valuations and reconciliation |
| Census state BPS history 2000–2025 | Historical method selection, evaluation and future reference |
| Census county BPS 1990–2025 | Observed permit/building-type charts |
| ACS 2020–2024, 18 detailed tables | Detached stock and household, rent, crowding, vacancy, income and structure context |
| Census population estimates, Vintage 2025 | Demographic components and household continuations |
| HUD CHAS 2018–2022 | Income-specific housing problems |
| California DOF / North Carolina OSBM | Independent population projections, not observed forecast accuracy |
| BTS National Transit Map / TIGER 2024 | Versioned transit-exposure reconstruction |
| Census cartographic 2024, 1:20,000,000 | Compact display boundaries; full analytical tract geometry is separate |

CoStar, FHFA and BLS QCEW are not active model inputs. Some ACS cells provide context without entering production equations. A recommended-data list does not require every listed source.

## Cleaning

FIPS remain zero-padded strings. ACS special/suppressed negative cells become missing; migration remains signed. BPS estimated counts including imputation are separate from later reported-only blocks. State valuations use thousands of dollars; county valuations use dollars. State cost fallbacks use matched county valuation totals divided by matched county units. County000 balances are reported rather than assigned to counties.

County names/codes and boundaries change. History retains each year's records and does not claim a harmonized panel. Identical numeric rename duplicates are audited and deduplicated; conflicting duplicates fail.

## Frozen and official modes

Compact processed inputs reproduce the approved release without large downloads. Expected results are separate test fixtures and never calculation inputs. Official acquisition recovers ACS, demographic, HUD, permit and benchmark inputs.

The inherited transit/display layers lacked a complete original extraction trail. Official mode makes a separately versioned reconstruction: selected BTS fixed-guideway mode tokens, unioned 804.672-metre geodesic stop buffers, equal-area tract intersections, and ACS tract housing weights. This assumes uniform housing distribution across the full tract, including its water geometry. It is neither a walking catchment nor parcel eligibility. Missing tract weights propagate missing exposure.

The exact geometry method, projection assumptions, dependencies, source hashes and deltas are exported. This is a documented replacement, not an assertion of exact original recovery. Review numerical changes before adopting the new version or updating briefs/slides.

## Cache, revisions and terms

Raw national datasets stay in an ignored local cache. Downloads use HTTPS, atomic writes, format/hash checks and explicit revision handling. Replaced bytes are retained. Revised upstream data can change results and must be versioned rather than forced to match a snapshot.

Source attribution and agency notices remain applicable. BTS item and state projection terms are recorded separately. The code license does not license third-party data. The model uses public aggregate data, with no restricted microdata, paid dataset or secret credential.

## Suppressed Suffolk County tract estimates

[Census ACS Errata 148](https://www.census.gov/programs-surveys/acs/technical-documentation/errata/148.html) explains a collection error affecting Wyandanch and Brentwood, New York. The Census Bureau suppresses 2020–2024 ACS estimates for 14 nested census tracts. The acquisition manifest includes the official workbook listing these exact geographies.

These are genuine missing source estimates. The official reconstruction leaves the Suffolk County, New York State and U.S. transit point results unavailable; it does not insert zero or substitute an older survey. The other four reforms remain calculable. The spatial manifest lists all 14 tract IDs, the suppression source and its hash, and the affected exposure records.

Suffolk County's published housing estimate is 580,772; available tract estimates sum to 561,436. The difference, 19,336, is an arithmetic coverage gap, not an independently measured missing-tract count, housing shortage or statistical uncertainty interval.

Spatial version 3 uses only PyClipper, PyShp and GeographicLib. WGS84 geodesic buffers are clipped after an explicit spherical equal-area projection; spherical areas approximate ellipsoidal areas, and NAD83 source coordinates are treated as WGS84 without correcting datum offsets. Projected coordinates use 1 mm integer precision. Even-odd tract fill preserves holes, and nonzero buffer fill unions overlapping stops. Display exports normalize outer rings counterclockwise and holes clockwise, including a geodesic check at the antimeridian, before the browser's D3 reversal.

The display map uses official Census 2024 cartographic polygons at 1:20,000,000, preserving all 51 state/DC and 3,144 county identifiers. No further polygon simplification is applied. This compact display layer has its own version and source hashes. It does not change the full TIGER/Line tract geometry or any transit-exposure calculation. Earlier 1:500,000 display sources remain declared as archived provenance inputs.
