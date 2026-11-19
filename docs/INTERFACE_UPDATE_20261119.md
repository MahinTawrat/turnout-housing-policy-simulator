# Plain-language explanations

The interface now follows this order: **Results → How It Works → More Details → Impact Comparison → Data & Sources**.

Results shows the possible increment, five-year comparison, two policy-relevant facts and a local action. Worked equations move to How It Works; buttons connect the result to its explanation and supporting facts.

How It Works displays one selected policy in five open steps:

1. What the policy changes.
2. What information we start with.
3. What assumptions we make.
4. How we calculate the effect.
5. What this result cannot tell us.

Calculation inputs and local housing context are identified separately. Each value has its source, derivation and interpretation. State and national views explain aggregation rather than substituting one average cost. Source names reflect the actual reconstruction: transit housing weights use ACS B25024, and intersections use full tract area, including water.

More Details preserves the full assumptions, sensitivity tables, historical baseline checks, survey uncertainty, coverage, additional housing facts and demographic scenarios. Original source links and downloads remain in Data & Sources.

## Validation

The existing 77 Python tests passed. JavaScript regression checks cover 47,940 central-baseline metric cases, 1,725 representative result/explanation/comparison views, tab keyboard controls, Results actions and five independent Cass County fixtures. The explanation renderer was also exercised across all 47,940 geography/policy/response combinations.

| Cass County, Illinois · Default | Extra homes | Five-year starting point | Comparison total | Relative increase |
|---|---:|---:|---:|---:|
| ADU | 46 | 10 | 56 | 460% |
| Missing middle | 23 | 10 | 33 | 230% |
| Fees | 2 | 10 | 12 | 20% |
| Transit | 0 | 10 | 10 | 0% |
| Parking | 1 | 10 | 11 | 10% |

Cases include a zero permit baseline, missing permits with a calculable stock-based increment, a genuine transit zero, withheld New York transit observations, and New Mexico’s state permit-coverage adjustment. Missing data remains unavailable. Rounded published policy answers are used in the explanation; the interface does not replace the model’s ties-to-even rounding.

## Unchanged numerical outputs

Canonical JSON SHA-256 fingerprints before and after the interface update are identical. Canonicalization uses sorted keys, compact separators, UTF-8 and no non-finite numbers.

| Model output | Unchanged SHA-256 |
|---|---|
| Policy scenarios | `c718682f11cbbd21197ddc27173ddd91b878570d4dcc573805dc0ae98798aff6` |
| Production baseline | `13479a6b3b1c82f0ebe07d19291372d41d01ac7b543c79e3c57cdef7526a3609` |
| Housing and demographic evidence | `577cf54fc0bbe8c6cf146bad0330ce63ca5adb72765d3324fa8d132f79aa30f2` |

This update changes presentation and navigation. The numerical inputs, policy equations, rounding, aggregation, maps, forecast series and historical test results are unchanged.
