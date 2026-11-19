/* Four policy-specific facts. Pure display interpretation; no production changes. */
(function(root,factory){
  'use strict';
  const build=factory();
  if(typeof module==='object'&&module.exports)module.exports={buildPolicyEvidence:build};
  else root.buildPolicyEvidence=build;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const n=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const first=(...values)=>{for(const value of values){const x=n(value);if(x!==null)return x;}return null;};
  const ratio=(a,b)=>n(a)!==null&&n(b)>0?100*n(a)/n(b):null;
  const sum=values=>values.length&&values.every(v=>n(v)!==null)?values.reduce((a,v)=>a+n(v),0):null;
  const product=(a,b)=>n(a)!==null&&n(b)!==null?n(a)*n(b):null;

  /**
   * Input: {policy,level,record,policyRecord,assessment,assumptions,scope}.
   * assumptions is a dictionary keyed by parameter with {low,default,high};
   * the original [{parameter,low,default,high}] array is also accepted.
   * Output cards have raw numeric/null values. kind:'pct' uses 0–100 units,
   * never a 0–1 fraction. Notes carry observed/assumed status wherever rendered.
   * Exactly four cards are returned for each supported policy. No HTML is emitted.
   */
  return function buildPolicyEvidence(input){
    input=input||{};
    const policy=input.policy,level=input.level||'default',r=input.record||{},p=input.policyRecord||{};
    if(!['low','default','high'].includes(level))throw new Error('Unsupported assumption level: '+level);
    if(!['adu','missing_middle','tod','parking','fee'].includes(policy))throw new Error('Unsupported policy: '+policy);
    const e=r.evidence||{},stock=e.stock||{},facts=input.assessment?.facts||{};
    const scope=/county/i.test(input.scope||'')||String(r.fips||'').length===5?'county':
      /national/i.test(input.scope||'')||r.fips==='US'?'national':'state';
    const getAssumption=name=>{
      const all=input.assumptions||{};
      const row=Array.isArray(all)?all.find(a=>a.parameter===name):all[name];
      return row&&typeof row==='object'?n(row[level]):null;
    };
    const card=(label,value,kind,note,basis)=>({label,value,kind,note,basis});
    const observed=(label,value,kind,note)=>card(label,value,kind,'Observed · '+note,'Observed');
    const assumed=(label,value,kind,note)=>card(label,value,kind,'Assumed · '+note,'Assumed');
    const detached=first(facts.detached,p.adu_stock_base,p.sf_detached_units,p.detached_sf_units,stock.detached);
    const householdSizes=e.householdSize||[];
    const oneTwoRate=first(facts.oneTwoRate,ratio(householdSizes.length>=2?sum(householdSizes.slice(0,2)):null,r.demand?.hhACS));
    const burdenRate=first(facts.burdenRate,ratio(e.burden?.above30,e.burden?.denominator));
    const transit=Object.prototype.hasOwnProperty.call(facts,'transit')?n(facts.transit):
      Object.prototype.hasOwnProperty.call(p,'tod_housing_share_new')?n(p.tod_housing_share_new):n(p.tod_housing_share);
    const annual=first(facts.annual,p.baseline_annual_units);
    const baseline=first(p.baseline_5yr_units,product(annual,5));
    const burden=()=>observed('Renters spending 30%+ on housing',burdenRate,'pct',
      'ACS 2020–2024; renters with a computable rent-to-income ratio. This counts current cost burden, not missing homes.');
    const permitBenchmark=()=>card('Five years at the 2025 permit pace',baseline,'count',
      'Reference · 2025 authorized units multiplied by five; permits are not completed or occupied homes.','Reference');
    const costProxy=()=>scope==='county'?
      card('Construction value used by the model',n(p.scenario_cost_base),'currency',
        'Model proxy · permit valuation per unit, with model fallbacks. It is not a full project budget or a measure of local fees.','Modeled proxy'):
      permitBenchmark();
    let cards,needText,limitations;

    if(policy==='adu'){
      cards=[
        observed('Existing detached homes',detached,'count','ACS 2020–2024 stock used to screen ADU exposure; these are not verified eligible lots.'),
        observed('Households with one or two people',oneTwoRate,'pct','ACS 2020–2024 household sizes; size alone does not establish an ADU or bedroom preference.'),
        burden(),
        assumed('Detached stock adding an ADU',product(getAssumption('ADU 5-year take-up'),100),'pct','Selected five-year take-up assumption, not measured local owner participation.')
      ];
      needText='ADUs could add a separate home on an existing lot. Household sizes and rent burden help frame the choices to investigate; they do not establish who wants an ADU or whether its rent would be affordable.';
      limitations=['Parcel eligibility, utilities, financing and owner participation remain unverified.',
        'The benchmark permits an ADU of at least 600 square feet; it does not establish its bedroom count, tenure or income restriction.'];
    }else if(policy==='missing_middle'){
      cards=[
        observed('Renter homes with crowding',first(facts.crowdedRenters,e.crowding?.renter),'count','ACS 2020–2024; more than one person per room. Affected households are not a count of new homes required.'),
        observed('Renter households with 3+ people',n(e.householdStructure?.largeRenter),'count','ACS 2020–2024; larger households can occupy several building forms and bedroom sizes.'),
        observed('Existing detached homes',detached,'count','ACS stock proxy for possible redevelopment; single-family-only zoning and available sites are unmeasured.'),
        observed('Homes in 2–4 unit buildings',first(facts.twoFour,stock.twoFour),'count','Existing ACS housing stock shows use of this form; it does not measure unmet demand or legal capacity.')
      ];
      const crowded=first(facts.crowdedRenters,e.crowding?.renter);
      needText=crowded!==null&&crowded>0?
        'Crowding and household-size evidence make suitable, affordable bedroom choices worth checking in any new small building. Duplexes, triplexes, fourplexes and townhouses can serve different households; these data do not select a required mix.':
        'Small buildings could offer more housing choices where single-family-only rules bind. Existing household and building counts do not establish unmet demand, the required bedroom mix or the affordability of new homes.';
      limitations=['The 2–6 unit reform needs verification of local zoning, project economics and net additions after replacement.',
        'Crowding, cost burden and larger-household counts overlap; do not add them into a construction requirement.'];
    }else if(policy==='tod'){
      cards=[
        card('Housing near qualifying transit',product(transit,100),'pct','Measured proxy · tract housing weighted by land within half a mile of qualifying transit; not developable land.','Measured proxy'),
        observed('Homes in 5+ unit buildings',first(facts.fivePlus,stock.fivePlus),'count','ACS 2020–2024 existing multifamily stock, including homes outside the measured transit areas.'),
        burden(),
        permitBenchmark()
      ];
      needText=transit===null?
        'Qualifying transit exposure is unavailable, so this evidence cannot establish a local transit-density opportunity. Housing needs and the affordability of potential station-area homes still require local review.':transit===0?
        'This model measures no qualifying transit exposure here. Other transit service and housing needs may still exist, but the data do not establish a local opportunity under this transit definition.':
        'Measured transit exposure identifies areas to investigate for more homes with useful transit access. Current multifamily stock and rent burden describe the location, but do not establish station-area capacity or affordable rents.';
      limitations=['The exposure proxy does not verify parcels, current service quality, safe access, legal density or infrastructure.',
        'Housing near transit can have different bedroom counts and rents; the reform does not guarantee income-restricted homes.'];
    }else if(policy==='parking'){
      const spaces=getAssumption('Parking spaces avoided per affected unit');
      const perSpace=getAssumption('Parking construction cost per avoided space');
      cards=[
        assumed('Parking cost avoided per affected home',product(spaces,perSpace),'currency','Selected avoided spaces × cost per space. Savings occur only if a project actually provides fewer spaces.'),
        assumed('New development affected by reform',product(getAssumption('Parking reform share of baseline development affected'),100),'pct','Selected share assumed to face binding parking minimums; local ordinances and project exposure are unverified.'),
        costProxy(),
        burden()
      ];
      needText='Rent burden describes current affordability pressure. Lower parking requirements could reduce construction costs where the rules require more parking than a project would otherwise provide; those savings do not by themselves set rents or bedroom sizes.';
      limitations=['Avoided spaces, parking costs and the supply response are assumptions, not measured local effects.',
        scope==='county'?'The permit-value proxy omits important project costs; a local development budget is still needed.':
          'State and national results aggregate county cost calculations; they do not use a representative statewide project budget.'];
    }else{
      const response=getAssumption('Development fee cost-to-supply elasticity');
      cards=[
        assumed('Fee saving per new home',getAssumption('Development fee savings per unit'),'currency','Challenge benchmark: $50,000 in total fees reduced by 50%; this is not an observed local charge.'),
        costProxy(),
        burden(),
        assumed('Housing increase per 1% modeled saving',response,'pct','Assumed extra housing when savings equal 1% of the construction-value proxy; this response is not locally estimated.')
      ];
      needText='Lower fees could help a project proceed when upfront charges are a material constraint. Current rent burden shows an affordability concern to address separately; a fee cut alone does not guarantee lower rents or income-restricted homes.';
      limitations=['Actual local fees, project budgets and infrastructure funding consequences remain unverified.',
        scope==='county'?'Permit valuation is a cost proxy, not a full development budget or a local fee schedule.':
          'State and national results aggregate county cost calculations; no single statewide cost or fee observation is implied.'];
    }
    const changes=r.demand?.hhChange||{};
    const changeValues=[changes.low,changes.central,changes.high].map(n);
    if(changeValues.every(v=>v!==null)&&changeValues.every(v=>v<0))
      needText+=' Conditional household scenarios decline by 2030; affordability and repair needs can still persist.';
    else if(changeValues.every(v=>v!==null)&&Math.min(...changeValues)<0&&Math.max(...changeValues)>0)
      needText+=' The household scenarios do not agree on growth by 2030.';
    const sourceNote=policy==='tod'?
      'ACS 2020–2024 · 2025 Census permits · supplied BTS/tract transit exposure. The exposure proxy has not been rebuilt from its original geospatial inputs.':
      policy==='parking'||policy==='fee'?
      'ACS 2020–2024 · 2025 Census permits/valuation · selected policy assumptions. Observations stay fixed when the policy assumption changes.':
      'ACS 2020–2024 · selected five-year policy assumptions. Observed households and housing stock stay fixed when the policy changes.';
    return {cards,needText,sourceNote,limitations};
  };
});
