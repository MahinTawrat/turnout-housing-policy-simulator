# Model and assumptions

The observed cutoff is 2025 and the scenario period is 2026–2030. The outcome is privately owned housing units authorized by permits. The baseline is a historical continuation under unchanged-policy assumptions, not an independently verified inventory of current laws or a causal no-reform forecast.

## Baseline

Four candidates—latest year, three-year mean, five-year mean and damped five-year trend—are compared on declared historical development folds. Model selection, initial calibration and the 2021–2025 holdout are separate. A later refreshed historical-error stress range has no independent coverage test and is not a confidence interval. Revised history is not a real-time-vintage experiment.

The selected frozen method holds the latest annual pace flat: national 1,431,616 × 5 = 7,158,080; Minnesota 20,947 × 5 = 104,735. A flat path is the selected model, not a chart error. Mean state holdout error is about 12.0%; Minnesota's is about 6.4%. These are different summaries. County baselines allocate state totals using 2025 permit shares and retain unavailable/unallocated balances.

## Policy alternatives

| Policy | Rule and equation |
|---|---|
| ADU | One detached/semi-detached ADU of at least 600 sq ft on a property with an existing single-family building, with no extra required parking. Detached housing stock × assumed five-year participation. |
| Missing middle | Allow 2–6 homes, up to three stories, on single-family-only properties; assume setbacks/coverage nonbinding. Detached stock × redevelopment share × net extra homes. |
| Transit | Increase density near defined major transit stops. Permit reference × housing exposure near qualifying stops × uplift. The reconstruction records stop modes and half-mile geometry. |
| Parking | Reduce/eliminate minimums while developers may retain voluntary parking. Reference × affected share × min(30%, avoided spaces × cost / value proxy) × response. Remaining voluntary parking is not observed. |
| Fees | Cut major fees 50% from $50,000 per home. Reference × min(30%, $25,000 / value proxy) × response. The saving is standardized, not a measured local fee. |

`config/assumptions.json` contains all Low/Default/High inputs and units. They are sensitivity assumptions, not fitted causal coefficients, probabilities or guaranteed bounds. Zero extra production remains possible.

Counties are rounded first using ties-to-even. ADU/missing-middle state results sum rounded counties. Cost reforms additionally use permit-coverage reconciliation. State transit uses state exposure directly and need not equal summed county transit. National results sum states/DC. Missing observations remain unavailable rather than becoming zero.

## Context and limits

ACS describes household size, rents, crowding, stock, income and vacancy. Survey margins are retained; combined margins use an approximate root-sum-square without covariance. HUD CHAS describes income-specific housing problems, not missing homes. Population scenarios continue observed births, deaths and migration under alternative windows; household changes hold size and group-quarter share constant. They are not construction requirements.

Detached units are a stock proxy, not verified parcels or single-family-only zoning. Local legal changes, owner interest, finance, infrastructure, physical sites, demolition, timing, affordability, bedrooms and completions are not established. Permit valuation omits full costs. Original parking savings and 2025 valuations lack a common-dollar correction. Fee reductions can affect infrastructure funding.

Use the tool to inspect assumptions, compare alternatives and plan local checks. Do not sum policies, promise delivery, infer causal effects, claim that a shortage is closed, or treat the largest result as proof of the best policy.
