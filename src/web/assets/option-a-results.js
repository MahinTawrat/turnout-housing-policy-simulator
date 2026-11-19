/* Option A's compact Results presentation, using the repository's selected data. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TurnoutOptionA=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const num=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=(value,places=0)=>num(value)===null?'Not available':Number(value).toLocaleString('en-US',{maximumFractionDigits:places});
  const money=value=>num(value)===null?'Not available':'$'+fmt(value);
  const pct=(value,places=1)=>num(value)===null?'Not available':fmt(value,places)+'%';
  const fraction=(value,places=1)=>num(value)===null?'Not available':pct(Number(value)*100,places);
  const level=c=>c.level==='low'?'Low':c.level==='high'?'High':'Default';
  function ass(c,name){
    const rows=c.assumptions?.parameters||c.assumptions||{};
    const row=Array.isArray(rows)?rows.find(item=>item.parameter===name):rows[name];
    return num(row?.[c.level||'default']);
  }
  const multiply=(a,b)=>num(a)===null||num(b)===null?null:Number(a)*Number(b);
  const policyDetails={
    adu:{title:'Accessory Dwelling Units (ADUs)',summary:'Allows homeowners to add one smaller, separate home beside an existing single-family house, such as a backyard cottage. The scenario permits an ADU of at least 600 square feet without requiring extra parking.',reason:'Homeowners could create housing without replacing their main home. The model estimates participation among existing stand-alone houses.',housing:'One detached or semi-detached ADU of at least 600 square feet.',check:'Property space, owner interest, water and sewer connections, local ADU rules, building costs and financing.',caution:'Detached housing counts do not verify property eligibility or willingness to build. These additions use existing properties; the permit starting point measures new-building authorizations. Their sum is a comparison, not a forecast of completed homes.'},
    missing_middle:{title:'Missing Middle / Gentle Density',summary:'Allows buildings containing two to six homes, up to three stories, on properties previously limited to single-family housing. Examples include duplexes, townhouses and small apartment buildings.',reason:'Some properties with one home could be redeveloped into buildings containing several homes. The model counts only homes added after accounting for the original house.',housing:'Duplexes, triplexes, fourplexes, townhouses and other small multifamily buildings.',check:'Local zoning, eligible properties, development costs, existing residents, displacement and water or sewer capacity.',caution:'Detached homes are a starting pool, not confirmed single-family-only sites. Redevelopment and displacement are unverified. The additions use existing properties; their sum with new-building permits is a comparison, not a forecast of completed homes.'},
    tod:{title:'Transit-Oriented Density',summary:'Allows more housing near qualifying major transit stops by increasing permitted building height or residential density. The model considers areas within half a mile of qualifying fixed-guideway transit.',reason:'The model increases production only for the housing share mapped near qualifying major transit, not across the entire selected area.',housing:'Housing near major transit, where local rules and development conditions permit.',check:'Actual transit service, station locations, local density rules, sites, infrastructure, safe access and affordable rents.',caution:'Transit exposure is a mapped screening estimate, not verified buildable land. No qualifying exposure does not mean that no transit service or housing need exists.'},
    parking:{title:'Parking Requirement Reduction',summary:'Allows builders to provide fewer parking spaces when local rules previously required more. Reducing unnecessary parking construction could lower development costs.',reason:'Parking spaces cost money to build. The model assumes some development would benefit from no longer having to provide as many mandatory spaces.',housing:'Potentially multiple housing types where minimum parking requirements affect development.',check:'Binding parking regulations, spaces builders would voluntarily provide, complete development budgets, financing and demand.',caution:'Parking costs and the share of projects affected are assumptions. Developers can still provide parking voluntarily; lower costs do not guarantee more homes or lower rents.'},
    fee:{title:'Development Fee Reduction',summary:'Reduces major fees paid during housing development, including planning, building, environmental review and impact fees. The standardized challenge example cuts fees by half.',reason:'Lower fees could reduce upfront development costs and potentially make additional housing projects financially feasible.',housing:'Several housing types, where fees materially affect project economics.',check:'Actual local fees, complete project budgets, construction feasibility and funding for roads, water and sewer infrastructure.',caution:'The $50,000 starting fee and the selected saving are challenge assumptions, not observed local charges. Lower fees do not automatically mean affordable rents.'}
  };
  const row=(value,title,note,status='Census survey estimate')=>({value,title,note,status});
  const fact=item=>'<div class="pv-local-fact"><strong>'+esc(item.value)+'</strong><div><b>'+esc(item.title)+'</b><small>'+esc(item.note)+'</small><em>'+esc(item.status)+'</em></div></div>';
  const step=(number,title)=>'<div class="pv-stephead"><span class="dc-step-number" aria-hidden="true">'+number+'</span><h4>'+esc(title)+'</h4></div>';
  function householdOutlook(c){
    const changes=c.record?.demand?.hhChange||{};
    const values=[changes.low,changes.central,changes.high].map(num);
    if(values.some(value=>value===null))return 'Not available';
    const low=Math.min(...values),high=Math.max(...values);
    if(low===0&&high===0)return 'No household change in these scenarios';
    if(high<0)return fmt(Math.abs(high))+'–'+fmt(Math.abs(low))+' fewer households';
    if(low>=0)return fmt(low)+'–'+fmt(high)+' more households';
    return fmt(Math.abs(low))+' fewer to '+fmt(high)+' more households';
  }
  function keyFacts(c){
    const f=c.assessment?.facts||{},a=name=>ass(c,name);
    if(c.policy==='adu')return [
      row(fmt(f.detached),'Stand-alone houses','Census estimate; not verified eligible lots','Census survey estimate'),
      row(fraction(a('ADU 5-year take-up')),'Assumed five-year participation',fmt(multiply(a('ADU 5-year take-up'),1000),2)+' per 1,000 homes in the selected '+level(c)+' example','Model assumption')
    ];
    if(c.policy==='missing_middle')return [
      row(fraction(a('Missing-middle 5-year redevelopment share'),2),'Properties assumed to redevelop','Five-year scenario assumption','Model assumption'),
      row(num(a('Missing-middle net additional units per redevelopment'))===null?'Not available':'+'+fmt(a('Missing-middle net additional units per redevelopment')),'Net homes per redevelopment','Extra units after subtracting the original home','Model assumption')
    ];
    if(c.policy==='tod')return [
      row(fraction(f.transit),'Housing near qualifying transit','Mapped half-mile exposure estimate','Mapped estimate'),
      row(fraction(a('TOD production uplift in exposed areas')),'Assumed production increase','Only for the transit-exposed share','Model assumption')
    ];
    if(c.policy==='parking')return [
      row(money(multiply(a('Parking spaces avoided per affected unit'),a('Parking construction cost per avoided space'))),'Assumed savings per affected home','Avoided spaces × assumed cost per space','Model assumption'),
      row(fraction(a('Parking reform share of baseline development affected')),'Development assumed affected','Assumed share where parking rules matter','Model assumption')
    ];
    const saving=a('Development fee savings per unit');
    return [row(fraction(num(saving)===null?null:saving/50000,0),'Benchmark fee reduction','$50,000 in assumed fees is reduced in this example','Model assumption'),row(money(saving),'Assumed savings per home','Standardized challenge input; not actual local fees','Model assumption')];
  }
  function contextRows(c){
    const e=c.record?.evidence||{},s=e.stock||{},f=c.assessment?.facts||{},raw=c.policyRecord||{};
    const rows=[row(fmt(s.total),'Existing housing units','ACS 2020–2024, B25024; occupied and vacant homes in this area, separate from new permits.')];
    if(c.policy==='adu')rows.push(row(pct(f.oneTwoRate),'Households with 1–2 people','ACS B11016; household mix, not measured demand for an ADU.'));
    if(c.policy==='missing_middle'){
      const count=num(e.crowding?.renter),margin=num(e.crowding?.renterMOE);
      rows.push(row(count===null?'Not available':fmt(count)+(margin===null?'':' ± '+fmt(margin)),'Crowded renter households','ACS B25014; more than 1 person per room. ± is the approximate 90% survey margin.'));
      rows.push(row(fmt(e.householdStructure?.largeRenter),'Renter households with 3+ people','ACS B25124; existing households, not new homes required.'));
      rows.push(row(fmt(s.twoFour),'Homes in 2–4-unit buildings','ACS B25024; existing small multifamily housing.'));
    }
    if(c.policy==='tod')rows.push(row(fmt(s.fivePlus),'Homes in buildings with 5+ units','ACS B25024; these homes are not necessarily near transit.'));
    if(c.policy==='fee'||c.policy==='parking'){
      if(c.scope==='county'){
        const fallback=!(num(raw.avg_permit_value_per_unit)>0);
        rows.push(row(money(raw.scenario_cost_base),'Permit-reported building value per unit','Census Building Permits Survey; '+(fallback?'documented state fallback used.':'local valuation divided by permitted units.')+' This is not a full project budget.','Model comparison input'));
      }else rows.push(row('County-specific','Building-value comparisons','Each county uses its own permit-reported value or documented state fallback.','Model comparison input'));
    }
    rows.push(row(pct(f.burdenRate),'Renters spending 30%+ of income on housing','ACS B25070; share among renters with a calculable rent-to-income ratio.'));
    return rows;
  }
  function annualPermits(c){
    if(c.scope==='county')return num(c.policyRecord?.baseline_annual_units);
    return num(c.production?.history?.find(item=>item.year===2025)?.total??c.production?.annual?.[0]?.total);
  }
  function missingReason(c){
    const m=c.metric||{},raw=c.policyRecord||{},f=c.assessment?.facts||{};
    if(num(m.baseline)===null)return 'The five-year starting point is unavailable because a required permit input is missing.';
    const affected=c.scope==='national'||(c.stateCode==='NY'&&(c.scope==='state'||raw.fips==='36103'));
    if(c.policy==='tod'&&num(f.transit)===null)return affected&&c.dataRelease?.transitMissingReason?c.dataRelease.transitMissingReason:'A required mapped transit-exposure input is unavailable.';
    return 'A required model input is unavailable. Missing data does not mean zero.';
  }
  function render(c){
    if(!c||!Object.prototype.hasOwnProperty.call(policyDetails,c.policy))throw new Error('Unsupported policy for Option A Results');
    const m=c.metric||{},d=policyDetails[c.policy],added=num(m.added),base=num(m.baseline),annual=annualPermits(c);
    const badge=added===null?'Not available':'+'+fmt(added);
    let helper;
    if(base===null)helper='The five-year starting point is unavailable for this geography. A permit is permission to build.';
    else if(c.scope==='county'&&annual!==null&&Math.abs(annual*5-base)<1e-8)helper=fmt(annual)+' units permitted in 2025 × five years = '+fmt(base)+' starting point. A permit is permission to build.';
    else if(c.scope==='county')helper='The county receives an allocated share of its state’s permit starting point. A permit is permission to build, not a completed home.';
    else helper='The five-year starting point continues the 2025 permit pace. '+(c.scope==='national'?'The national result adds states and DC.':'The state result follows the documented model.')+' A permit is permission to build.';
    const change=added===null?'Required input missing, not zero.':num(m.pct)===null?'Percentage not available for a zero or missing starting point.':pct(m.pct)+' above the five-year starting point'+(m.pct>100?'; the starting point is small':'')+'.';
    let meaning=added===null?'A required input is missing, so the selected '+level(c)+' scenario cannot give an extra-home estimate.':
      'The selected '+level(c)+' scenario estimates +'+fmt(added)+' possible additional housing '+(added===1?'unit':'units')+' over five years.';
    if(added===0&&c.policy==='tod')meaning+=' '+(num(c.assessment?.facts?.transit)===0?'This source records zero exposure to the model’s qualifying transit.':'The calculated change rounds to zero whole homes.');
    const notice=added===null?'<p class="pv-note pv-unavailable">'+esc(missingReason(c))+'</p>':'';
    const housingFacts=contextRows(c).map(fact).join('');
    return '<div class="decision-story pv-results tv-compact" aria-label="Compact housing policy results">'+
      '<header class="pv-policy-intro"><p class="pv-overline">'+esc(c.place)+' · 2026–2030 · '+level(c)+' assumptions</p><h3>'+esc(d.title)+'</h3><h4>What does this policy do?</h4><p>'+esc(d.summary)+'</p></header>'+
      '<section class="dc-section pv-section tv-impact" aria-label="Housing impact">'+step(1,'How many additional homes could this policy support?')+
      '<div class="dc-effect-main"><div class="dc-impact"><strong>'+esc(badge)+'</strong><span>'+(added===1?'possible extra home':'possible extra homes')+'<small>Modeled over five years</small></span></div><div class="dc-comparison"><div><span>Without policy change<small>Five-year permit baseline</small></span><b>'+fmt(base)+'</b></div><div><span>With policy change<small>Baseline + possible addition</small></span><b>'+fmt(m.total)+'</b></div></div></div><p class="pv-small">'+esc(helper)+'</p><p class="pv-percent"><b>'+esc(change)+'</b></p>'+notice+'</section>'+
      '<section class="dc-section dc-focus pv-section pv-burgundy tv-burgundy" aria-label="Policy mechanism">'+step(2,c.policy==='tod'&&added===0?'Why does the model show no increase?':'Why could this policy make a difference?')+'<p>'+esc(d.reason)+'</p><div class="pv-focus-pair">'+keyFacts(c).map(fact).join('')+'</div><p class="pv-housing-type"><b>Housing it could add:</b> '+esc(d.housing)+'</p></section>'+
      '<section class="dc-section pv-section tv-meaning" aria-label="Local interpretation">'+step(3,'What does this mean for '+c.place+'?')+'<p>'+esc(meaning)+' '+esc(d.caution)+'</p><p class="pv-local-check"><b>What to check locally:</b> '+esc(d.check)+'</p><p class="pv-details-hint">See <button type="button" class="pv-view-link" data-open-view="calculation">How It Works</button> for every input, source, assumption and calculation.</p></section>'+
      '<section class="dc-section pv-section pv-context tv-context" aria-label="Housing context">'+step(4,'Local Housing & Development Context')+'<div class="pv-context-grid">'+housingFacts+'</div><p class="pv-households"><b>2030 household outlook:</b> '+esc(householdOutlook(c))+'; a separate demographic scenario, not a policy effect or homes required.</p></section>'+
      '<p class="pv-bottom-note tv-foot">Actual extra housing could be zero.</p></div>';
  }
  return {render,keyFacts,contextRows,householdOutlook};
});
