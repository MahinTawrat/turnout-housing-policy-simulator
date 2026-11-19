/* Plain-language explanation of the released model. No model outputs are changed. */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TurnoutHowItWorks=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const number=value=>value===null||value===undefined||value===''?null:
    Number.isFinite(Number(value))?Number(value):null;
  const escape=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const format=(value,places=0)=>number(value)===null?'Not available':Number(value).toLocaleString('en-US',{maximumFractionDigits:places});
  const money=value=>number(value)===null?'Not available':'$'+format(value,2);
  const percent=(value,places=1)=>number(value)===null?'Not available':format(value,places)+'%';
  const share=(value,places=2)=>number(value)===null?'Not available':percent(Number(value)*100,places);
  const sum=values=>values.length&&values.every(value=>number(value)!==null)?values.reduce((total,value)=>total+Number(value),0):null;
  const divide=(top,bottom,scale=1)=>number(top)!==null&&number(bottom)>0?Number(top)/Number(bottom)*scale:null;
  const times=(...values)=>values.every(value=>number(value)!==null)?values.reduce((total,value)=>total*Number(value),1):null;
  const titles={adu:'Accessory dwelling units (ADUs)',missing_middle:'Missing middle / small buildings',fee:'Development fee reduction',tod:'Transit-oriented density',parking:'Parking requirement reduction'};
  const source={stock:'Census ACS 2020–2024 · B25024',households:'Census ACS 2020–2024 · B11016 and B25003',burden:'Census ACS 2020–2024 · B25070',crowding:'Census ACS 2020–2024 · B25014',structure:'Census ACS 2020–2024 · B25124',permits:'Census Building Permits Survey · final 2025',demographic:'Census Population Estimates · Vintage 2025; ACS B25010'};
  const selected=c=>c.level==='low'?'Low':c.level==='high'?'High':'Default';
  function assumption(c,name){
    const all=c.assumptions?.parameters||c.assumptions||{};
    const row=Array.isArray(all)?all.find(item=>item.parameter===name):all[name];
    return number(row?.[c.level||'default']);
  }
  const row=(id,label,value,classification,origin,derivation,meaning)=>({id,label,value,classification,source:origin,derivation,meaning});
  function householdOutlook(record){
    const values=record?.demand?.hhChange||{};
    const low=number(values.low),high=number(values.high);
    if(low===null||high===null)return 'Not available';
    if(low<0&&high<0)return format(Math.abs(high))+'–'+format(Math.abs(low))+' fewer households';
    if(low>=0&&high>=0)return format(low)+'–'+format(high)+' more households';
    return format(Math.abs(low))+' fewer to '+format(high)+' more households';
  }
  function contextRows(c){
    const record=c.record||{},e=record.evidence||{},stock=e.stock||{},facts=c.assessment?.facts||{},d=record.demand||{};
    const rows=[row('existing-homes','Existing homes',format(stock.total),'Census survey estimate',source.stock,
      'The survey’s total housing-unit estimate includes occupied and vacant homes.','Existing housing stock is separate from five years of new-building permits.')];
    if(c.policy==='adu'){
      const sizes=e.householdSize||[],small=sum(sizes.slice(0,2)),rate=divide(small,d.hhACS,100);
      rows.push(row('small-households','Households with 1 or 2 people',percent(rate),'Census survey estimate',source.households,
        format(sizes[0])+' one-person + '+format(sizes[1])+' two-person households = '+format(small)+'; '+format(small)+' ÷ '+format(d.hhACS)+' total households × 100.',
        'This describes household size. It does not prove that these households want an ADU.'));
    }
    if(c.policy==='missing_middle'){
      rows.push(row('small-buildings','Homes in buildings with 2–4 homes',format(stock.twoFour),'Census survey estimate',source.stock,
        format(stock.duplex)+' homes in duplexes + '+format(stock.threeFour)+' in buildings with 3–4 homes.',
        'These buildings already exist; this is not unmet demand.'));
      rows.push(row('large-renter-households','Renter households with 3 or more people',format(e.householdStructure?.largeRenter),'Census survey estimate',source.structure,
        'Add the survey’s 3-person, 4-person and 5-or-more-person renter-household categories (B25124 cells 53, 60 and 67).',
        'This counts existing households, not new homes required.'));
      const crowded=number(e.crowding?.renter),margin=number(e.crowding?.renterMOE);
      rows.push(row('crowded-renters','Renter homes with crowding',format(crowded)+(crowded!==null&&margin!==null?' ± '+format(margin):''),'Census survey estimate',source.crowding,
        'Add renter households with more than one person per room (cells 11–13). To combine the published survey error margins, square each one, add the squares, then take the square root. This approximation cannot account for how the categories vary together.',
        'The ± figure is an approximate 90% margin of error: survey uncertainty around the estimate, not extra households to add.'));
    }
    if(c.policy==='tod')rows.push(row('large-buildings','Homes in buildings with 5 or more homes',format(stock.fivePlus),'Census survey estimate',source.stock,
      format(stock.fiveNine)+' in 5–9-unit buildings + '+format(stock.tenNineteen)+' in 10–19 + '+format(stock.twentyFortynine)+' in 20–49 + '+format(stock.fiftyPlus)+' in 50-or-more.',
      'These homes may be anywhere in the selected area; they are not necessarily near transit.'));
    const burden=e.burden||{};
    rows.push(row('rent-burden','Renters paying 30% or more of income for housing',percent(divide(burden.above30,burden.denominator,100)),'Census survey estimate',source.burden,
      format(burden.above30)+' renter households paying at least 30% ÷ '+format(burden.denominator)+' with a calculable rent-to-income ratio × 100. Categories with no calculable ratio are excluded.',
      'This describes current housing costs. It does not predict lower rents from the selected policy.'));
    const p=record.population||{},groupShare=divide(p.groupQuarters2025,p.p2025);
    const lowPopulation=number(p.p2030?.low),highPopulation=number(p.p2030?.high);
    const householdDerivation=lowPopulation!==null&&highPopulation!==null&&number(p.p2025)!==null&&groupShare!==null&&number(d.householdSize)>0?
      'Population in 2030: '+format(lowPopulation)+'–'+format(highPopulation)+', compared with '+format(p.p2025)+' in 2025. Household change ≈ (2030 population − '+format(p.p2025)+') × (1 − '+format(p.groupQuarters2025)+' ÷ '+format(p.p2025)+') ÷ '+format(d.householdSize,2)+' people per household.':
      'Household change ≈ population change × the share living outside group quarters ÷ average household size. A missing required input leaves the outlook unavailable.';
    rows.push(row('household-outlook','Possible household change by 2030',householdOutlook(record),'Separate demographic scenario',source.demographic,
      householdDerivation+' Population scenarios continue births, deaths and migration under 2023–2025, 2021–2025 and latest-year windows; household size and group-quarter share stay fixed. Group quarters are group-living places such as dormitories.',
      'This range is separate from the selected policy and its Low/Default/High response. It is not a count of homes required, or a statistical confidence interval. Housing problems can persist when household counts fall.'));
    return rows;
  }
  function factTable(rows,caption){
    return '<div class="hiw-table-wrap pv-table-scroll"><table class="pv-data-table"><caption>'+escape(caption)+'</caption><thead><tr><th scope="col">Value</th><th scope="col">Source and calculation</th><th scope="col">What it means</th></tr></thead><tbody>'+rows.map(item=>
      '<tr data-hiw-fact="'+escape(item.id)+'"><th scope="row"><span class="hiw-value">'+escape(item.value)+'</span><span class="hiw-label">'+escape(item.label)+'</span><small class="hiw-classification">'+escape(item.classification)+'</small></th><td data-label="Source and calculation"><b>'+escape(item.source)+'</b><p>'+escape(item.derivation)+'</p></td><td data-label="What it means">'+escape(item.meaning)+'</td></tr>').join('')+'</tbody></table></div>';
  }
  function policyDescription(c){
    return {
      adu:'Allow one smaller separate home on a property with an existing single-family house, such as a backyard cottage. The benchmark permits a detached or semi-detached ADU of at least 600 square feet without additional required parking. The main home stays.',
      missing_middle:'Allow two to six homes, up to three stories, on sites formerly limited to one home. Examples include duplexes, triplexes, townhouses and small apartment buildings. Count net additional homes: replacing one house with three adds two homes.',
      fee:'Reduce total planning, environmental review, building and impact fees. The standardized example cuts an assumed $50,000 fee per home by half. This is an example to compare places; it is not a measured local fee schedule.',
      tod:'Allow more homes or taller residential buildings near qualifying transit, including trains, trams and other listed services that follow a fixed guideway. The model screens areas within half a mile (804.672 metres). The selected transit types do not include every bus stop or all transportation service.',
      parking:'Reduce or remove minimum parking requirements for new housing. Builders could provide fewer spaces when rules previously required more than they would choose. Builders may still provide parking voluntarily.'
    }[c.policy];
  }
  function baselineHtml(c){
    const m=c.metric||{},p=c.production||{},raw=c.policyRecord||{};
    if(c.scope==='tract')return '<div class="hiw-baseline"><h5>Where the baseline comes from</h5><p>This tract receives an allocation of the existing county/state model: <b>'+format(m.baseline)+' starting units</b>. This is not an observed tract permit count or an independently tested tract construction forecast.</p><p class="hiw-source">Calculated model allocation · released county/state permit model</p></div>';
    const county=c.scope==='county'||c.scope==='tract';
    const annual=county?number(raw.baseline_annual_units):number(p.history?.find(item=>item.year===2025)?.total??p.annual?.[0]?.total);
    let formula;
    if(number(m.baseline)===null)formula='The five-year starting point is unavailable because a required permit input is missing.';
    else if(annual!==null&&Math.abs(annual*5-Number(m.baseline))<1e-8)formula=format(annual)+' housing units permitted in 2025 × 5 years = '+format(m.baseline)+' five-year starting units.';
    else if(county)formula='The county’s 2025 permit share × '+format(p.fiveYear)+' state starting units = '+format(m.baseline)+' county starting units after rounding.';
    else formula='Add the state and DC five-year starting points = '+format(m.baseline)+' reference units.';
    const banner=number(m.baseline)===null?'Not available':annual!==null&&Math.abs(annual*5-Number(m.baseline))<1e-8?format(annual)+' × 5 = '+format(m.baseline):county?'State share → '+format(m.baseline):'State/DC sum: '+format(m.baseline);
    return '<div class="hiw-baseline"><h5>Where the baseline comes from</h5><p>A <b>baseline</b> is the starting point for comparison. We continue the 2025 permit pace for five years, 2026–2030.</p><div class="pv-baseline-banner"><strong>'+escape(banner)+'</strong><small>'+escape(formula)+'</small></div><p class="hiw-source pv-small">Census permit record · '+escape(source.permits)+'</p><p>A building permit gives permission to build; it does not show that the home was finished. This starting point is separate from existing homes.</p>'+
      (county?'<p>The county receives a share of its state’s starting point using its 2025 permits. This county continuation has not been independently tested.</p>':'<p>Four methods were compared using state permit history from 2000–2025. Repeating the latest year was selected; the flat future line reflects that choice. The supporting methods below retain the historical tests.</p>')+'</div>';
  }
  function inputRows(c){
    const m=c.metric||{},facts=c.assessment?.facts||{},raw=c.policyRecord||{},e=c.record?.evidence||{};
    const rows=[];
    if(c.scope==='tract')return [row('tract-allocation','Allocated tract starting point',format(m.baseline),'Calculated model allocation','Released county/state model and documented tract weights',
      c.tractDescription||'Distribute the parent geography’s existing model result using the selected policy’s documented spatial weights.',
      'This supports geographic exploration. It is not an independently observed or validated tract production forecast.')];
    if(c.policy==='adu'||c.policy==='missing_middle')rows.push(row('detached-input','Stand-alone houses used as the starting pool',format(number(facts.detached)??number(raw.sf_detached_units)??number(e.stock?.detached)),'Census survey estimate',source.stock+' · one-unit detached (cell 2)',
      'Use the survey estimate of existing homes that are not joined to another home.',c.policy==='adu'?'This is a pool of possible ADU opportunities, not a count of lots confirmed to qualify.':'This is a pool of possible redevelopment opportunities; the model has not verified single-family-only zoning or suitable sites.'));
    if(c.policy==='tod')rows.push(row('transit-input','Housing near qualifying transit',share(facts.transit,3),'Mapped estimate','BTS National Transit Map; Census TIGER/Line 2024; ACS B25024 tract totals',
      'Combine overlapping half-mile stop areas so overlaps count once. A tract is a small Census area. Multiply each tract’s housing count by the share of its full area inside the stop areas; add those housing estimates, then divide by housing in all included tracts.',
      'Housing is assumed to be spread evenly across each tract, including water geometry. This screens exposure, not walking access or buildable parcels. A missing housing count remains unavailable; it is not zero.'));
    if(c.policy==='fee'||c.policy==='parking'){
      if(c.scope==='county'||c.scope==='tract'){
        const cost=number(raw.scenario_cost_base),local=number(raw.avg_permit_value_per_unit);
        const valuation=number(raw.permit_valuation_total),annual=number(raw.baseline_annual_units);
        rows.push(row('cost-input','Permit-reported building value per home',money(cost),'Calculated comparison input',source.permits,
          local!==null&&local>0&&valuation!==null&&annual>0?money(valuation)+' reported building value ÷ '+format(annual)+' permitted housing units.':local!==null&&local>0?'The local reported building value divided by permitted units.':'The local value is unavailable. The model uses a state comparison: add building values for counties with both usable values and permit counts, then divide by their permitted units.',
          'Permit valuation is a comparison value. It is not a full development budget, selling price, market value or the actual cost to build a home.'));
      }else rows.push(row('county-costs','Building-value comparisons','One value for each county','Calculated comparison input',source.permits,
        'Each county uses reported permit valuation divided by authorized housing units, with the documented state fallback where required.',
        'There is no single representative state or U.S. project cost. County calculations and state coverage adjustments are kept separate.'));
    }
    if(!rows.length)rows.push(row('starting-input','Five-year permit starting point',format(m.baseline),'Calculated model result',source.permits,'Continue the observed 2025 pace for five years.','This is a comparison of permit authorizations, not existing housing stock.'));
    return rows;
  }
  function assumptionsRows(c){
    const a=name=>assumption(c,name),result=[];
    const add=(label,value,note)=>result.push({label,value,note});
    if(c.policy==='adu'){
      const rate=a('ADU 5-year take-up');
      add('Houses assumed to add an ADU over five years',share(rate,2),'That is '+format(times(rate,1000),2)+' out of every 1,000 stand-alone houses.');
      add('Additional homes at each participating property','1 home','One ADU is added while the main home stays.');
    }else if(c.policy==='missing_middle'){
      add('Houses assumed to redevelop over five years',share(a('Missing-middle 5-year redevelopment share'),2),'This participation is chosen, not measured locally.');
      add('Net extra homes at each redevelopment',format(a('Missing-middle net additional units per redevelopment'))+' homes','Net means new homes after subtracting the original home.');
    }else if(c.policy==='tod'){
      add('Extra housing in the exposed part',share(a('TOD production uplift in exposed areas'),0),'The uplift applies only to the share near qualifying stops.');
      add('Fixed proximity screen','½ mile (804.672 m)','The mapped exposure in Step 2 is an input, not a chosen future response.');
    }else if(c.policy==='fee'){
      const saving=a('Development fee savings per unit');
      add('Standardized starting fee per home','$50,000','Challenge benchmark; not a measured local fee.');
      add('Fee cut in the standardized example',share(divide(saving,50000),0),money(saving)+' assumed savings per home.');
      add('Housing response to each 1% saving',percent(a('Development fee cost-to-supply elasticity'),1),'A response of '+format(a('Development fee cost-to-supply elasticity'),1)+' means '+percent(a('Development fee cost-to-supply elasticity'),1)+' more housing for each modeled 1% saving.');
      add('Maximum saving ratio used','30%','A model cap limits the formula input; it is not a measured saving.');
    }else{
      const spaces=a('Parking spaces avoided per affected unit'),cost=a('Parking construction cost per avoided space');
      add('Development assumed to be affected',share(a('Parking reform share of baseline development affected'),0),'The model has not measured how often local parking rules bind.');
      add('Parking spaces avoided per affected home',format(spaces,1)+' spaces','An average across projects, not a physical fraction of a space.');
      add('Assumed cost of each avoided space',money(cost),'A scenario cost, not an observed local project cost.');
      add('Assumed saving per affected home',money(times(spaces,cost)),format(spaces,1)+' × '+money(cost)+'.');
      add('Housing response to each 1% saving',percent(a('Parking cost-to-supply elasticity'),1),'Apply this response only to the affected part.');
      add('Maximum saving ratio used','30%','A cap on the formula input, not a measured fall in full project costs.');
    }
    return result;
  }
  function assumptionsHtml(c){
    const selectedRows=assumptionsRows(c),levels=['low','default','high'],alternatives=levels.map(level=>assumptionsRows({...c,level}));
    return '<div class="hiw-assumptions pv-assumptions"><p class="hiw-assumption-heading"><b>'+selected(c)+' response selected</b> · Model assumptions</p><div class="pv-table-scroll"><table class="pv-selected-table"><caption>Selected what-if assumptions</caption><thead><tr><th scope="col">Assumption</th><th scope="col">Selected value</th><th scope="col">Meaning</th></tr></thead><tbody>'+selectedRows.map(item=>'<tr><th scope="row">'+escape(item.label)+'</th><td data-label="Selected value">'+escape(item.value)+'</td><td data-label="Meaning">'+escape(item.note)+'</td></tr>').join('')+'</tbody></table></div><p>Low, Default and High test different responses. They are not probabilities, confidence intervals or guaranteed limits. Census observations stay fixed; the actual extra housing could be zero.</p></div><h5>Compare Low, Default and High inputs</h5><div class="pv-table-scroll"><table class="pv-alternative-table"><thead><tr><th scope="col">What changes</th>'+levels.map(level=>'<th scope="col">'+(level==='low'?'Low':level==='high'?'High':'Default')+'</th>').join('')+'</tr></thead><tbody>'+selectedRows.map((row,index)=>'<tr><th scope="row">'+escape(row.label)+'</th>'+alternatives.map((rows,i)=>'<td'+(levels[i]===(c.level||'default')?' class="pv-selected-assumption"':'')+'>'+escape(rows[index].value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
  }
  function stateTrace(c){
    const forecasts=c.stateForecasts||{},level=c.level||'default';
    const values=Object.entries(forecasts).sort(([left],[right])=>left.localeCompare(right)).map(([abbr,r])=>({abbr,value:number(r?.scenarios?.central?.[c.policy]?.[level])}));
    if(!values.length)return '';
    if(values.some(item=>item.value===null))return '<p>At least one required state/DC result is unavailable. We keep the national total unavailable instead of adding only the available states.</p>';
    const first=values.slice(0,2),rest=values.slice(2),restTotal=sum(rest.map(item=>item.value));
    return '<p class="hiw-equation">'+first.map(item=>escape(item.abbr)+': '+format(item.value)).join(' + ')+' + remaining '+format(rest.length)+' state/DC results: '+format(restTotal)+' = '+format(c.metric?.added)+' possible extra homes.</p><p>Each state keeps its own inputs and rounding. This adds state results; it does not multiply one national average.</p>';
  }
  function calculationHtml(c){
    const m=c.metric||{},p=c.forecast||{},facts=c.assessment?.facts||{},raw=c.policyRecord||{};
    const county=c.scope==='county'||c.scope==='tract',national=c.scope==='national';
    const a=name=>assumption(c,name);
    if(number(m.added)===null){
      const nySuppression=c.scope==='national'||((c.stateCode||raw.state_abbr)==='NY'&&(!county||raw.fips==='36103'));
      const why=number(m.baseline)===null?'A required permit input is unavailable, so the five-year starting point is missing.':
        c.policy==='tod'&&number(facts.transit)===null?(nySuppression&&c.dataRelease?.transitMissingReason?c.dataRelease.transitMissingReason:'A required transit-exposure input is unavailable.'):
        'A required housing or building-value input is unavailable.';
      return '<div class="hiw-calculation pv-math-panel"><p>'+escape(why)+'</p><p>We cannot finish this calculation. Missing data stays <b>Not available</b>; it is not replaced with zero.</p>'+(number(m.baseline)!==null?'<p>The known five-year starting point is still <b>'+format(m.baseline)+'</b>.</p>':'')+'</div>';
    }
    if(c.scope==='tract')return '<div class="hiw-calculation pv-math-panel"><p>The model first calculates county/state policy results. It then assigns a tract share using the released allocation weights; it does not run the county formula against observed tract permits.</p><p>'+escape(c.tractDescription||'The selected policy determines the spatial allocation weights.')+'</p>'+answerHtml(c)+'</div>';
    let html='';
    if(c.policy==='adu'||c.policy==='missing_middle'){
      const rate=a(c.policy==='adu'?'ADU 5-year take-up':'Missing-middle 5-year redevelopment share'),net=c.policy==='adu'?1:a('Missing-middle net additional units per redevelopment');
      const detached=number(facts.detached)??number(raw.sf_detached_units)??number(c.record?.evidence?.stock?.detached);
      if(county)html='<p>Multiply the starting pool by the selected five-year response'+(c.policy==='missing_middle'?' and the net gain at each site':'')+'.</p><p class="hiw-equation">'+format(detached)+' × '+format(rate,6)+(c.policy==='missing_middle'?' × '+format(net):'')+' = '+format(times(detached,rate,net),4)+' → <strong>+'+format(m.added)+'</strong></p>';
      else{
        const roundedSum=number(p.countySums?.central?.[c.policy]?.[c.level||'default']);
        html='<ol class="hiw-math pv-calc-list"><li>For each county: stand-alone houses × '+share(rate,2)+(c.policy==='missing_middle'?' redeveloped × '+format(net)+' net extra homes':' adding one ADU')+'.</li><li>Round each county’s answer to whole homes.</li><li>Add the rounded county answers'+(national?' within each state, then add the states and DC':'')+': <b>'+format(roundedSum)+' possible extra homes</b>.</li></ol><p>Multiplying the combined housing stock once could give a different answer because rounding happens separately in every county.</p>';
      }
      if(c.policy==='missing_middle')html+='<p>For example, three homes replacing one existing home gives <b>two net extra homes</b>.</p>';
    }else if(c.policy==='tod'){
      const uplift=a('TOD production uplift in exposed areas'),exposure=number(facts.transit);
      if(national)html='<ol class="hiw-math pv-calc-list"><li>For each state/DC: its five-year starting point × its own mapped housing share × '+share(uplift,0)+' assumed uplift.</li><li>Round each state/DC answer, then add all state results.</li></ol>';
      else html='<p>Apply the uplift only to the mapped exposed share.</p><p class="hiw-equation">'+format(m.baseline)+' × '+format(exposure,8)+' × '+format(uplift,4)+' = '+format(times(m.baseline,exposure,uplift),4)+' → <strong>+'+format(m.added)+'</strong></p><p>Mapped exposure: '+share(exposure,3)+'. The calculation retains its full stored precision.</p>';
      if(!county&&!national)html+='<p>The state uses its own exposure directly. Its result can differ from the sum of rounded supporting county transit results.</p>';
      if(exposure===0)html+='<p>A measured exposure of zero gives zero in this scenario. It does not prove that the area has no transit or that reform is useless.</p>';
    }else{
      const parking=c.policy==='parking',spaces=parking?a('Parking spaces avoided per affected unit'):null,costPer=parking?a('Parking construction cost per avoided space'):null;
      const saving=parking?times(spaces,costPer):a('Development fee savings per unit'),affected=parking?a('Parking reform share of baseline development affected'):1,response=a(parking?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
      html='<ol class="hiw-math pv-calc-list"><li><b>Find the assumed saving.</b><p class="hiw-equation">'+(parking?format(spaces,1)+' avoided spaces × '+money(costPer)+' per space':'$50,000 benchmark fee × '+share(divide(saving,50000),0)+' cut')+' = '+money(saving)+' saved per '+(parking?'affected ':'')+'home.</p></li>';
      if(county){
        const cost=number(raw.scenario_cost_base),ratio=divide(saving,cost),used=ratio===null?null:Math.min(.30,ratio),unrounded=times(m.baseline,affected,used,response);
        html+='<li><b>Compare the saving with the building-value input.</b><p class="hiw-equation">'+money(saving)+' ÷ '+money(cost)+' × 100 = '+percent(ratio===null?null:ratio*100,2)+'.</p><p>'+(ratio!==null&&ratio>.30?'This exceeds the model’s 30% cap, so use 30%. The cap limits the calculation; it does not prove a real 30% drop in full project costs.':'This is below or equal to the model’s 30% cap, so the ratio is used without further reduction.')+'</p></li><li><b>Apply the selected response.</b><p class="hiw-equation">'+format(m.baseline)+(parking?' × '+format(affected,4):'')+' × '+format(used,8)+' × '+format(response,2)+' = '+format(unrounded,4)+' → <strong>+'+format(m.added)+'</strong></p><p>The factors are the starting permits'+(parking?', affected share':'')+', capped saving share and housing response.</p></li>';
      }else{
        html+='<li><b>Calculate each county separately.</b> Divide '+money(saving)+' by that county’s building-value input. Use at most 30%. Multiply its starting permits'+(parking?' × '+share(affected,0)+' affected':'')+' × that saving share × '+format(response,1)+' response; round.</li>';
        const countySum=number(p.countySums?.central?.[c.policy]?.[c.level||'default']);
        if(national)html+='<li><b>Reconcile within each state, then add states/DC.</b> The rounded county answers total '+format(countySum)+'. Each state applies its own permit-coverage factor and rounds. The final state/DC results add to '+format(m.added)+'.</li>';
        else html+='<li><b>Match official state permit coverage.</b> Rounded county answers total '+format(countySum)+'. Multiply by the state’s coverage factor '+format(p.coverageFactors?.central,8)+' and round: <strong>'+format(m.added)+' possible extra homes</strong>.</li>';
        html+='</ol><p>The coverage factor compares the state permit reference with assigned county permits. There is no single averaged state or national project cost.</p>';
      }
      if(county)html+='</ol>';
      html+='<p>A response of '+format(response,1)+' means we assume '+percent(response,1)+' more housing for each 1% of the comparison building value saved'+(parking?' in the affected part':'')+'.</p>';
    }
    if(national)html+=stateTrace(c);
    html+='<p class="hiw-rounding">Model counts are rounded to whole homes. An exact half rounds to the nearest even whole number; displayed intermediate decimals are shortened for reading.</p>';
    return '<div class="hiw-calculation pv-math-panel">'+html+answerHtml(c)+'</div>';
  }
  function answerHtml(c){
    const m=c.metric||{},extra=number(m.added),base=number(m.baseline);
    if(extra===null)return '';
    let html='<div class="hiw-answer pv-calculation-answer"><span>Possible additional homes · 2026–2030</span><strong>+'+format(extra)+'</strong><small>Calculated model result · '+selected(c)+' response</small></div>';
    if(base!==null)html+='<p class="hiw-equation">'+format(base)+' starting point + '+format(extra)+' possible extra = '+format(m.total)+' in the scenario comparison.</p>';
    if(base===null)html+='<p>The permit starting point is missing, so its total and percentage comparison are unavailable. The stock-based extra-home result can still be shown.</p>';
    else if(base===0)html+='<p>The starting point is zero, so a percentage cannot be calculated. This does not turn missing data into zero.</p>';
    else html+='<p>'+format(extra)+' ÷ '+format(base)+' × 100 = <b>'+percent(divide(extra,base,100))+'</b> relative to the five-year starting point.'+(divide(extra,base,100)>100?' The percentage is large because the permit starting point is small.':'')+'</p>';
    return html;
  }
  function limits(c){
    const content={
      adu:['The model has not verified eligible lots, enough space, owner willingness, utilities, financing, completion or affordable rents.','Check local ADU rules, lot dimensions, water and sewers, owner interest, construction costs and financing.'],
      missing_middle:['The model has not verified eligible zoning, which properties will redevelop, demolition, displacement, unit sizes, financing or affordable rents.','Check zoning, suitable properties, current residents, infrastructure, project costs and the bedrooms and rents households need.'],
      fee:['The model has not verified current local fees, full project budgets, actual developer response, completion, lower rents or affordability.','Check the fee schedule, complete development costs, financing and how roads, water and sewer systems would be funded.'],
      tod:['The model does not capture every transit service, identify development-ready sites, verify binding density rules or establish project feasibility and affordability.','Check useful existing and planned transit, station access, land, local zoning, infrastructure, costs, financing and intended rents.'],
      parking:['The model has not verified whether local parking minimums bind, how many spaces builders would voluntarily provide, full project costs, completion or affordable rents.','Check the ordinance, actual parking demand, spaces builders would avoid, complete costs, finance and project feasibility.']
    }[c.policy];
    return '<p>'+escape(content[0])+'</p><p><b>What to check locally:</b> '+escape(content[1])+'</p><p>'+((c.policy==='adu'||c.policy==='missing_middle')?'The possible additions use existing properties; the starting point counts new-building permits. Their sum is a scenario comparison, not a forecast of future total housing stock or completed homes.':'These are possible permit authorizations under chosen assumptions. Permission does not establish finished homes or lower rents.')+'</p><p>Housing, rent, crowding and household-change facts describe separate conditions. They do not set the policy response or count new homes required. The five policy scenarios overlap, so do not add their results.</p>';
  }
  function render(c){
    c=c||{};
    if(!Object.prototype.hasOwnProperty.call(titles,c.policy))throw new Error('Unsupported policy for How It Works');
    const steps=[
      ['What the policy changes','<p>'+escape(policyDescription(c))+'</p>'],
      ['What information we start with',baselineHtml(c)+'<h5>Data used to calculate the policy result</h5>'+factTable(inputRows(c),'Inputs to the selected policy calculation')+'<h5>Local facts and household outlook</h5><p>Includes the local indicators behind Results and supporting context; none enters the extra-home formula. Census survey figures are estimates from a sample of households, rather than an exact list of every property.</p>'+factTable(contextRows(c),'Separate housing and household context')],
      ['What assumptions we make',assumptionsHtml(c)],
      ['How we calculate the effect',calculationHtml(c)],
      ['What this result cannot tell us',limits(c)]
    ];
    return '<article class="how-it-works pv-how"><header class="hiw-header pv-how-header"><p class="pv-overline">'+escape(c.place||'Selected place')+' · '+escape(c.policyName||titles[c.policy])+' · 2026–2030 · '+selected(c)+' response</p><h3>How we estimate the impact</h3><p>Follow five simple steps to see where the numbers come from and what they mean.</p></header>'+steps.map(([title,body],index)=>'<section class="hiw-step pv-how-step" data-hiw-step="'+(index+1)+'"><div class="pv-stephead"><span class="dc-step-number" aria-hidden="true">'+(index+1)+'</span><h4>'+escape(title)+'</h4></div>'+body+'</section>').join('')+'<footer class="hiw-footer">Additional methodology and validation follow below. Data &amp; Sources provides official links and downloads.</footer></article>';
  }
  return {render,contextRows,inputRows,assumptionsRows};
});
