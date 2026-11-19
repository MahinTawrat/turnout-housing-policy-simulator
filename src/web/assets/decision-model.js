/* Transparent evidence predicates. No suitability weights or predicted bedroom mix. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.QuiesceDecision=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const number=v=>v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null);
  const rate=(a,b)=>number(a)!==null&&number(b)>0?100*number(a)/number(b):null;
  const states={positive:'Proxy present',zero:'No measured exposure',missing:'Unavailable'};
  function exposure(value){const v=number(value);return v===null?states.missing:v>0?states.positive:states.zero;}
  function assess(input){
    const policy=input.policy,record=input.record||{},e=record.evidence||{},stock=e.stock||{};
    const detached=number(input.detached),transit=number(input.transit),annual=number(input.annual);
    const facts={detached,transit,annual,
      oneTwoRate:rate((e.householdSize||[]).length>=2&&e.householdSize.slice(0,2).every(v=>number(v)!==null)?number(e.householdSize[0])+number(e.householdSize[1]):null,record.demand?.hhACS),
      largerRate:rate(e.householdSize?.[2],record.demand?.hhACS),
      burdenRate:rate(e.burden?.above30,e.burden?.denominator),
      crowdedRenters:number(e.crowding?.renter),twoFour:number(stock.twoFour),fivePlus:number(stock.fivePlus)};
    const rules=[];
    const add=(test,status,meaning)=>rules.push({test,status,meaning});
    if(policy==='adu'){
      add('Detached housing stock > 0',exposure(detached),'Detached units screen potential policy exposure; they do not count eligible lots.');
      add('Legal, serviced ADU sites verified','Unverified','Parcel size, setbacks, utilities, financing and owner participation must be checked.');
    }else if(policy==='missing_middle'){
      add('Detached housing stock > 0',exposure(detached),'This is the redevelopment stock proxy; single-family-only zoning is not observed.');
      add('Net redevelopment and displacement checked','Unverified','Replacement of existing homes and project feasibility determine net additions.');
    }else if(policy==='tod'){
      add('Qualifying-transit exposure > 0',exposure(transit),transit===0?'The frozen transit dataset gives this scenario no exposure. Transit service outside its definition may still exist.':'Area-weighted tract exposure screens transit proximity; station-area developable capacity is unmeasured.');
      add('Station-area legal capacity verified','Unverified','Local envelopes, infrastructure, safe access and displacement must be checked.');
    }else if(policy==='parking'){
      add('Binding local parking minimum measured','Unverified','The affected-development share is assumed, not measured from local ordinances.');
      add('Avoided cost and voluntary parking checked','Unverified','Savings require a binding rule and a project that actually reduces parking.');
    }else if(policy==='fee'){
      add('Local fees match the challenge benchmark','Unverified','The $50,000 fee and 50% reduction are scenario assumptions, not local fee observations.');
      add('Cost savings change project feasibility','Unverified','A project pro forma and infrastructure funding plan are required.');
    }else throw new Error('Unknown policy: '+policy);
    add('Permits demonstrate completed homes','Unverified',annual===0?'A zero permit baseline suppresses flow-based scenarios; it does not prove no housing need or opportunity.':'Building permits authorize construction; completion, occupancy and net additions are not verified.');
    add('Income-restricted affordability secured','Unverified','None of these five reforms alone establishes tenant eligibility, rent restrictions or subsidy.');
    const problemSignals=[];
    if(facts.crowdedRenters!==null&&facts.crowdedRenters>0)problemSignals.push('crowding');
    if(number(e.burden?.above30)>0)problemSignals.push('affordability');
    const hh=record.demand?.hhChange||{};
    const finiteChanges=[hh.low,hh.central,hh.high].map(number).filter(v=>v!==null);
    const demandStatus=finiteChanges.length!==3?'Unavailable':Math.max(...finiteChanges)<0?'Declining across scenarios':Math.min(...finiteChanges)>0?'Growing across scenarios':'Direction uncertain';
    return {policy,facts,rules,problemSignals,demandStatus,constructionAvailable:false,
      readiness:'Screening only',
      recommendation:'A strongest need-matching reform cannot be identified from these data alone. Local policy exposure, project feasibility and affordability or bedroom delivery remain unverified.'};
  }
  return {assess,number,rate,exposure};
});
