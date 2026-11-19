(function(){
"use strict";

const STATES=window.STATE_DATA||[];
const ASSUMPTIONS=window.ASSUMPTIONS||[];
const BASE={...(window.NATIONAL_BASELINE||{}),fiveYear:window.PRODUCTION_FORECAST.national.fiveYear};
const BY_ABBR=new Map(STATES.map(d=>[d.state_abbr,d]));
const BY_FIPS=new Map(STATES.map(d=>[d.state_fips,d]));
const MAP_CLASSES=[
  {max:0,color:"#F7F2EE",label:"0%",meaning:"No modeled added production"},
  {max:1,color:"#DEC8B4",label:">0–1%",meaning:"Very small modeled impact"},
  {max:2,color:"#CBAE93",label:"1–2%",meaning:"Small modeled impact"},
  {max:5,color:"#BE9B7B",label:"2–5%",meaning:"Moderate modeled impact"},
  {max:10,color:"#A66F68",label:"5–10%",meaning:"Meaningful modeled impact"},
  {max:25,color:"#854442",label:"10–25%",meaning:"Large modeled impact"},
  {max:Infinity,color:"#3C2F2F",label:">25%",meaning:"Very large modeled impact"}
];
const MAP_MISSING="#A8A09E";
const SELECTED="#854442";

const POLICIES={
  adu:{name:"Accessory dwelling units",short:"ADU",benchmark:"Allow one detached or semi-detached ADU of at least 600 square feet on parcels with existing single-family buildings, with no additional parking requirement.",observed:"ACS detached single-family housing stock.",proxy:"Detached single-family housing stock is a nationally consistent proxy for potentially affected properties; the model does not claim every unit is on an eligible parcel.",formula:"Detached single-family stock × selected five-year ADU take-up assumption.",limitation:"Actual production also depends on parcel configuration, utilities, financing, homeowner participation, permitting and construction conditions."},
  missing_middle:{name:"Missing middle / gentle density",short:"Missing middle",benchmark:"Allow 2–6 dwelling units on properties currently restricted to single-family use, with heights up to three stories.",observed:"ACS detached single-family housing stock.",proxy:"Detached single-family stock is used as a national proxy for potentially affected single-family-only properties because complete nationwide parcel zoning is not observed.",formula:"Detached single-family stock × redevelopment share × net additional units per redevelopment.",limitation:"Legal capacity does not imply immediate redevelopment; financing, parcel conditions, market feasibility and owner decisions remain important."},
  tod:{name:"Transit-oriented density",short:"Transit density",benchmark:"Increase allowable residential density near major transit stops.",observed:"Final Census permit baseline, ACS tract housing stock, BTS National Transit Map, and detailed Census tract geography.",proxy:"Housing exposure is area-weighted according to the share of tract area within one-half mile of qualifying major transit.",formula:"Five-year baseline × TOD housing exposure share × selected production-uplift assumption.",limitation:"Transit exposure is not parcel-level zoning eligibility and does not mean every exposed property can or will be redeveloped."},
  parking:{name:"Parking requirement reduction",short:"Parking",benchmark:"Reduce or eliminate minimum parking requirements for new residential development.",observed:"Five-year permit baseline and development-cost proxy.",proxy:"Only a share of development is assumed to face binding parking minimums, while developers may still provide parking voluntarily.",formula:"Baseline × affected share × avoided spaces × parking cost ÷ project-value proxy × supply-response elasticity.",limitation:"Parking costs and voluntary parking provision vary substantially by project type and market."},
  fee:{name:"Development fee reduction",short:"Fees",benchmark:"Reduce total development fees by 50% from the challenge benchmark of $50,000 per unit.",observed:"Five-year permit baseline and project-value proxy.",proxy:"The model compares $25,000 in per-unit fee savings with a development-value proxy and applies a conditional supply response.",formula:"Baseline × ($25,000 ÷ project-value proxy) × selected supply-response elasticity.",limitation:"The model does not assume every dollar of fee savings becomes additional housing."}
};
const POLICY_KEYS=["adu","missing_middle","tod","parking","fee"];

let stateAbbr="US";
let countyFips=null;
let tractGeoid=null;
let nationalMapMode="states"; // states | counties | tracts
let stateMapMode="counties"; // counties | tracts
let countryCountyLoad=null;
const overviewLoads=new Map();
window.TRACT_OVERVIEW=window.TRACT_OVERVIEW||{};
let previewHit=null;let overviewZoom=null;let mapRenderToken=0;
const tractLoading=new Map();
window.TRACT_DATA=window.TRACT_DATA||{};
let policyKey="adu";
let level="default";
let currentTab="result";
const countyLoading=new Map();

const $=id=>document.getElementById(id);
function n(v){if(v===null||v===undefined||v==="")return null;const x=Number(v);return Number.isFinite(x)?x:null;}
function fmt(v,d=0){const x=n(v);if(x===null)return "Not available";return x.toLocaleString("en-US",{maximumFractionDigits:d,minimumFractionDigits:d});}
function pct(v,d=1){const x=n(v);return x===null?"Not available":fmt(x,d)+"%";}
function fractionPct(v,d=1){const x=n(v);return pct(x===null?null:x*100,d);}
function yes(v){return v===true||v===1||String(v).toUpperCase()==="TRUE"||String(v)==="1";}
function capital(x){return x?x.charAt(0).toUpperCase()+x.slice(1):"";}
function original_added(rec,key,lev){return rec?n(rec[`${key}_added_${lev}`]):null;}
function original_baseline(rec){return rec?n(rec.baseline_5yr_units):null;}
function original_changePct(rec,key,lev){if(!rec)return null;const e=n(rec[`${key}_pct_vs_baseline_${lev}`]);if(e!==null)return e;const b=baseline(rec),a=added(rec,key,lev);return b&&a!==null?100*a/b:null;}
function nationalAdded(key,lev){const values=window.FORECAST_POLICY?.national?.scenarios?.central?.[key];if(values&&Object.prototype.hasOwnProperty.call(values,lev))return n(values[lev]);const valuesByState=STATES.map(d=>added(d,key,lev));return valuesByState.some(v=>v===null)?null:valuesByState.reduce((sum,v)=>sum+v,0);}
function stateRec(){return stateAbbr==="US"?null:BY_ABBR.get(stateAbbr);}
function countyRows(){return stateAbbr==="US"?[]:(window.COUNTY_DATA[stateAbbr]||[]);}
function countyRec(){return countyFips?countyRows().find(d=>d.fips===countyFips)||null:null;}
function tractRec(){return tractGeoid&&countyFips?(window.TRACT_DATA[countyFips]?.records||[]).find(d=>d.geoid===tractGeoid)||null:null;}
function policyRecord(){return tractRec()||countyRec()||stateRec();}
function recordTransitExposure(record){
  if(!record)return null;
  return n(Object.prototype.hasOwnProperty.call(record,'tod_housing_share_new')?record.tod_housing_share_new:record.tod_housing_share);
}
function placeName(){if(tractRec())return `Census tract ${tractRec().name} · ${countyRec()?.county_name||countyFips}`;const c=countyRec();if(c)return c.county_full_name||c.county_name;const s=stateRec();return s?s.state_name:"United States";}
function placeBadge(){if(tractRec())return "Tract scenario allocation";if(countyRec())return "County supporting evidence";if(stateRec())return "Authoritative state result";return "National comparison";}

function prepareGeo(geo){
  if(!geo||!geo.features||geo.__d3WindingFixed)return geo;
  const rev=g=>{if(!g)return;if(g.type==="Polygon")g.coordinates.forEach(r=>r.reverse());if(g.type==="MultiPolygon")g.coordinates.forEach(p=>p.forEach(r=>r.reverse()));};
  geo.features.forEach(f=>rev(f.geometry));
  Object.defineProperty(geo,"__d3WindingFixed",{value:true,enumerable:false});
  return geo;
}

function metric(){
  const t=tractRec();if(t){const b=n(t.b),a=n(t.x?.[policyKey]?.[level]);return{baseline:b,added:a,total:b!==null&&a!==null?b+a:null,pct:b>0&&a!==null?100*a/b:null,low:n(t.x?.[policyKey]?.low),high:n(t.x?.[policyKey]?.high),scope:"Tract spatial allocation"};}
  if(stateAbbr==="US"){const b=BASE.fiveYear,a=nationalAdded(policyKey,level);return{baseline:b,added:a,total:b!==null&&a!==null?b+a:null,pct:b>0&&a!==null?100*a/b:null,low:nationalAdded(policyKey,"low"),high:nationalAdded(policyKey,"high"),scope:"National aggregate"};}
  const r=policyRecord(),b=baseline(r),a=added(r,policyKey,level);return{baseline:b,added:a,total:b!==null&&a!==null?b+a:null,pct:changePct(r,policyKey,level),low:added(r,policyKey,"low"),high:added(r,policyKey,"high"),scope:countyFips?"County supporting estimate":"Authoritative state result"};
}

function findAssumption(name){return ASSUMPTIONS.find(d=>d.parameter===name)||null;}
function assumptionNumber(name){const r=findAssumption(name);return r?n(r[level]):null;}
function assumptionText(){
  if(policyKey==="adu")return `${pct(assumptionNumber("ADU 5-year take-up")*100,1)} five-year take-up of detached single-family stock.`;
  if(policyKey==="missing_middle")return `${pct(assumptionNumber("Missing-middle 5-year redevelopment share")*100,2)} redevelopment share and ${fmt(assumptionNumber("Missing-middle net additional units per redevelopment"))} net additional unit(s) per redevelopment.`;
  if(policyKey==="tod")return `${pct(assumptionNumber("TOD production uplift in exposed areas")*100,0)} production uplift applied only to modeled TOD-exposed housing.`;
  if(policyKey==="parking")return `${pct(assumptionNumber("Parking reform share of baseline development affected")*100,0)} of baseline development affected; ${fmt(assumptionNumber("Parking spaces avoided per affected unit"),1)} avoided space(s) per affected unit; $${fmt(assumptionNumber("Parking construction cost per avoided space"))} per avoided space; elasticity ${fmt(assumptionNumber("Parking cost-to-supply elasticity"),1)}.`;
  return `$${fmt(assumptionNumber("Development fee savings per unit"))} modeled savings per unit with supply-response elasticity ${fmt(assumptionNumber("Development fee cost-to-supply elasticity"),1)}.`;
}

function loadScript(src){return new Promise((resolve,reject)=>{const s=document.createElement("script");s.src=src;s.async=true;s.onload=resolve;s.onerror=()=>reject(new Error("Could not load "+src));document.head.appendChild(s);});}
async function ensureCounties(abbr){
  if(window.COUNTY_DATA[abbr]&&window.COUNTY_GEO[abbr])return true;
  if(countyLoading.has(abbr))return countyLoading.get(abbr);
  const p=(async()=>{try{const v=window.APP_VERSION||"1";$('mapStatus').textContent=`Loading ${BY_ABBR.get(abbr).state_name} county evidence…`;await Promise.all([window.COUNTY_DATA[abbr]?Promise.resolve():loadScript(`assets/counties/data/${abbr}.js?v=${v}`),window.COUNTY_GEO[abbr]?Promise.resolve():loadScript(`assets/counties/geo/${abbr}.js?v=${v}`)]);return true;}catch(e){console.error(e);$('mapStatus').textContent="County detail could not load. State result is unaffected.";return false;}finally{countyLoading.delete(abbr);}})();
  countyLoading.set(abbr,p);return p;
}


async function ensureTracts(){return false;}
function setLoader(message){const host=$('mapLoader');if(host){host.hidden=!message;host.textContent=message||'';}}
async function ensureCountryCounties(){
 if(window.NATIONAL_COUNTY_OVERVIEW)return true;
 if(!countryCountyLoad)countryCountyLoad=loadScript('assets/national-county-overview.js?v=20261117-b4').then(()=>true,()=>false);
 return countryCountyLoad;
}
async function ensureTractOverview(abbr){
 if(window.TRACT_OVERVIEW[abbr])return true;
 if(overviewLoads.has(abbr))return overviewLoads.get(abbr);
 const p=loadScript(`assets/tracts/overview/${abbr}.js?v=20261117-b4`).then(()=>true,()=>false);
 overviewLoads.set(abbr,p);return p;
}
async function ensureAllTractOverviews(){
 const states=STATES.filter(s=>s.state_abbr&&s.state_abbr!=='US').map(s=>s.state_abbr);
 let failures=0;let index=0;
 async function worker(){while(index<states.length){const abbr=states[index++];if(!await ensureTractOverview(abbr))failures++;}}
 await Promise.all(Array.from({length:8},worker));return failures===0;
}
function addOption(sel,value,label){const o=document.createElement('option');o.value=value;o.textContent=label;sel.appendChild(o);}
async function setNationalMapMode(mode){
 if(stateAbbr!=='US')return;
 nationalMapMode=mode;countyFips=null;tractGeoid=null;
 fillCountySelect();fillTractSelect();syncHash();renderAll();
 if(mode==='counties') {setLoader('Loading all U.S. counties…');await ensureCountryCounties();}
 if(mode==='tracts'){setLoader('Preparing all U.S. tract boundaries…');await ensureAllTractOverviews();}
 if(stateAbbr==='US'&&nationalMapMode===mode){setLoader(null);renderAll();}
}
async function setStateMapMode(mode){
 if(stateAbbr==='US')return;
 countyFips=null;tractGeoid=null;stateMapMode=mode;
 fillCountySelect();fillTractSelect();syncHash();renderAll();
 if(mode==='tracts'){setLoader(`Loading ${stateRec()?.state_name||stateAbbr} census tracts…`);await ensureTractOverview(stateAbbr);}
 if(stateAbbr!=='US'&&stateMapMode===mode){setLoader(null);renderAll();}
}
function fillTractSelect(){}
function chooseTract(geoid){tractGeoid=geoid||null;fillTractSelect();syncHash();renderAll();}
function fillCountySelect(){
 const sel=$('countySelect');sel.innerHTML='';
 if(stateAbbr==='US'){
   addOption(sel,'@all-us','All counties — United States');
   addOption(sel,'@states','All states — national map');
   sel.value=nationalMapMode==='counties'?'@all-us':'@states';sel.disabled=false;return;
 }
 addOption(sel,'','All counties — state map');
 countyRows().slice().sort((a,b)=>String(a.county_name).localeCompare(String(b.county_name))).forEach(d=>addOption(sel,d.fips,d.county_full_name||d.county_name));
 sel.disabled=false;sel.value=countyFips||'';
}
async function chooseState(abbr){
 stateAbbr=abbr;countyFips=null;tractGeoid=null;stateMapMode='counties';nationalMapMode='states';
 $('stateSelect').value=abbr;fillCountySelect();fillTractSelect();syncHash();renderAll();
 if(abbr!=='US'&&await ensureCounties(abbr)){fillCountySelect();fillTractSelect();renderAll();}
}
async function chooseCounty(fips){
 countyFips=fips||null;tractGeoid=null;stateMapMode='counties';
 $('countySelect').value=countyFips||'';fillTractSelect();syncHash();renderAll();
 if(countyFips){await ensureTracts(countyFips);if(countyFips===fips){fillTractSelect();renderAll();}}
}
function goBack(){if(tractGeoid){chooseTract(null);return;}if(countyFips){chooseCounty(null);return;}if(stateAbbr!=='US')chooseState('US');else setNationalMapMode('states');}

function syncHash(){const p=new URLSearchParams();if(stateAbbr==='US'&&nationalMapMode!=='states')p.set('view',nationalMapMode);if(stateAbbr!=='US'&&!countyFips&&stateMapMode==='tracts')p.set('view','tracts');if(stateAbbr!=="US")p.set("s",stateAbbr);if(countyFips)p.set("c",countyFips);if(tractGeoid)p.set("tr",tractGeoid);if(policyKey!=="adu")p.set("p",policyKey);if(level!=="default")p.set("l",level);for(const [id,key,def] of [["endYear","y","2030"],["building","t","total"],["production","o","central"],["population","g","trend"],["model","f","constant_2025_reference"]]){const control=document.getElementById(id);if(control&&control.value!==def)p.set(key,control.value);}history.replaceState(null,"",p.toString()?`#${p}`:location.pathname+location.search);}
async function applyHash(){
 const p=new URLSearchParams(location.hash.replace(/^#/,''));
 const s=p.get('s');if(s&&BY_ABBR.has(s)){
   stateAbbr=s;$('stateSelect').value=s;await ensureCounties(s);fillCountySelect();
   const c=p.get('c');if(c&&countyRows().some(d=>d.fips===c)){
     countyFips=c;$('countySelect').value=c;await ensureTracts(c);

   }
 }else if(p.get('view')==='counties'){nationalMapMode='counties';await ensureCountryCounties();}
 const pk=p.get('p');if(POLICY_KEYS.includes(pk)){policyKey=pk;$('policySelect').value=pk;}
 const lv=p.get('l');if(['low','default','high'].includes(lv))level=lv;
 fillCountySelect();fillTractSelect();
}

function showTip(event,html){const t=$('tooltip');t.innerHTML=html;t.style.display="block";t.style.left=Math.min(window.innerWidth-295,event.clientX+14)+"px";t.style.top=Math.min(window.innerHeight-130,event.clientY+14)+"px";}
function hideTip(){$('tooltip').style.display="none";}
function impactClass(value){
  const x=n(value);
  if(x===null)return null;
  if(x<=0)return MAP_CLASSES[0];
  return MAP_CLASSES.find(c=>x<=c.max)||MAP_CLASSES[MAP_CLASSES.length-1];
}
function mapColor(value){const c=impactClass(value);return c?c.color:`url(#missingHatch)`;}
function impactLabel(value){const c=impactClass(value);return c?`${c.label} · ${c.meaning}`:"No usable local baseline";}
function addMapDefs(svg){
  const defs=svg.append("defs");
  const p=defs.append("pattern").attr("id","missingHatch").attr("width",8).attr("height",8).attr("patternUnits","userSpaceOnUse").attr("patternTransform","rotate(45)");
  p.append("rect").attr("width",8).attr("height",8).attr("fill",MAP_MISSING);
  p.append("line").attr("x1",0).attr("y1",0).attr("x2",0).attr("y2",8).attr("stroke","#F7F2EE").attr("stroke-width",2);
}
function policyMapMeaning(key){
  if(key==="adu")return "Where ADU reform could add the most housing relative to the area's current housing-production pace. Darker areas have a larger detached single-family stock relative to how much housing they currently permit.";
  if(key==="missing_middle")return "Where allowing 2–6 unit housing could have the greatest modeled effect relative to current production. The result reflects detached single-family redevelopment opportunity, the redevelopment assumption, and net added units.";
  if(key==="tod")return "Where increasing density near major transit could increase housing production the most relative to the current baseline. Darker areas combine stronger transit exposure with a larger modeled TOD production effect.";
  if(key==="parking")return "Where reducing parking requirements could create the largest percentage increase in housing production. The result reflects baseline development, affected-project share, avoided parking cost, project-value proxy, and supply response.";
  return "Where reducing development fees could have the largest percentage effect on housing production. The result reflects the $25,000 modeled savings relative to development value and the supply-response assumption.";
}
function updateMapLegend(scopeLabel){
  const lt=$("legendText"),pm=$("legendPolicyMeaning");
  if(lt)lt.textContent=`${scopeLabel} shading = possible added homes ÷ five-year current-rules baseline.`;
  if(pm)pm.textContent=policyMapMeaning(policyKey);
}

const TRACT_COLOR_RAMP=['#EDD9CF','#D7AE9F','#B78277','#96584F','#74403D'];
function computeTractShades(numbers){
 const positive=numbers.filter(v=>v>0&&Number.isFinite(v)).sort((a,b)=>a-b);
 const cuts=positive.length?[.20,.40,.60,.80].map(q=>d3.quantileSorted(positive,q)):[];
 return v=>{
   if(v===null||v===undefined||!Number.isFinite(+v))return MAP_MISSING;
   if(+v<=0)return '#F7F2EE';
   let bin=0;while(bin<cuts.length&&v>cuts[bin])bin++;
   return TRACT_COLOR_RAMP[bin];
 };
}
function updateGeographyLegend(tractMode){
 const p=$('percentLegend'),t=$('tractColorLegend'),title=document.querySelector('.legend-title');
 if(p)p.hidden=!!tractMode;if(t)t.hidden=!tractMode;
 if(title)title.innerHTML=tractMode?'MODELED ADDITIONAL HOMES <span>· relative tract ranking within this displayed geography</span>':'POSSIBLE INCREASE <span>for 2026–2030 · five-year policy scenario</span>';
 const hint=document.querySelector('.zoom-hint');if(hint)hint.textContent=tractMode?'Zoom to inspect · click a tract':'Scroll to zoom · drag to pan · click to inspect';
}
function overviewAdditional(r){const policyIndex=POLICY_KEYS.indexOf(policyKey),levelIndex=['low','default','high'].indexOf(level);return +(r[4]?.[policyIndex*3+levelIndex]||0);}
async function focusOverviewRecord(r){
 const code=r[1],s=BY_FIPS.get(code.slice(0,2));if(!s)return;
 await chooseState(s.state_abbr);
 await chooseCounty(code);
 if(window.TRACT_DATA[code]?.records.some(d=>d.geoid===r[0]))chooseTract(r[0]);
}
let visibleCanvasRecords=[];
let nationalCanvasZoom=null;
function showTractCanvas(scope){
 const cv=$('nationalTractCanvas'),sv=$('mapSvg'),stage=cv.parentElement;
 cv.hidden=false;sv.style.display='none';
 const records=scope==='US'?Object.values(window.TRACT_OVERVIEW).flat():window.TRACT_OVERVIEW[scope]||[];
 setLoader(`Drawing ${records.length.toLocaleString('en-US')} census tracts…`);
 visibleCanvasRecords=records;
 const fc={type:'FeatureCollection',features:records.map(r=>({type:'Feature',geometry:r[5]}))};
 const projection=scope==='US'?d3.geoAlbersUsa().fitExtent([[18,18],[982,622]],window.STATE_GEO):projectionFor(fc);
 const W=1000,H=650;cv.width=W;cv.height=H;
 const ctx=cv.getContext('2d');const hit=document.createElement('canvas');hit.width=W;hit.height=H;
 const hitctx=hit.getContext('2d',{willReadFrequently:true});const path=d3.geoPath(projection,ctx),hitpath=d3.geoPath(projection,hitctx);
 const color=computeTractShades(records.map(overviewAdditional));
 let drawToken=++mapRenderToken;
 ctx.clearRect(0,0,W,H);hitctx.clearRect(0,0,W,H);
 ctx.fillStyle='#f5ebe3';ctx.fillRect(0,0,W,H);
 // At national zoom, many real census tracts are subpixel polygons. Draw the
 // geography beneath them so the U.S. outline stays legible at any zoom.
 const contextGeo=scope==='US'?window.STATE_GEO:window.COUNTY_GEO[scope];
 if(contextGeo&&contextGeo.features){
   const bgPath=d3.geoPath(projection,ctx);
   for(const feature of contextGeo.features){
     ctx.beginPath();bgPath(feature);ctx.fillStyle='#eadad0';ctx.fill();
     ctx.strokeStyle='#d7bfb3';ctx.lineWidth=scope==='US'?.75:.45;ctx.stroke();
   }
 }
 let k=0;
 const step=()=>{
  if(drawToken!==mapRenderToken||cv.hidden)return;
  const end=Math.min(records.length,k+650);
  for(;k<end;k++){
    const r=records[k],f={type:'Feature',geometry:r[5]};
    ctx.beginPath();path(f);ctx.fillStyle=color(overviewAdditional(r));ctx.fill();
    // Subpixel national shapes need a fine stroke; without it they disappear.
    ctx.strokeStyle=scope==='US'?ctx.fillStyle:'#fff6ee';ctx.lineWidth=scope==='US'?.85:.55;ctx.stroke();
    const id=k+1;hitctx.beginPath();hitpath(f);hitctx.fillStyle=`rgb(${id&255},${(id>>8)&255},${(id>>16)&255})`;hitctx.fill();
    hitctx.strokeStyle=hitctx.fillStyle;hitctx.lineWidth=scope==='US'?1.25:.9;hitctx.stroke();
  }
  if(k<records.length)requestAnimationFrame(step);else setLoader(null);
 };
 requestAnimationFrame(step);
 previewHit=hitctx;overviewZoom=d3.zoomIdentity;
 d3.select(cv).on('.zoom',null).call(d3.zoom().scaleExtent([1,24]).on('zoom',ev=>{
    overviewZoom=ev.transform;cv.style.transform=`translate(${overviewZoom.x}px,${overviewZoom.y}px) scale(${overviewZoom.k})`;
 })).on('dblclick.zoom',null);
 cv.style.transform='none';
 const getRecord=ev=>{
   if(!previewHit)return null;
   const rect=stage.getBoundingClientRect();const tr=overviewZoom||d3.zoomIdentity;
   const x=(ev.clientX-rect.left-tr.x)/tr.k/rect.width*W;
   const y=(ev.clientY-rect.top-tr.y)/tr.k/rect.height*H;
   if(x<0||y<0||x>=W||y>=H)return null;
   const px=previewHit.getImageData(Math.floor(x),Math.floor(y),1,1).data;
   const id=px[0]+(px[1]<<8)+(px[2]<<16)-1;
   return records[id]||null;
 };
 cv.onmousemove=ev=>{
   const r=getRecord(ev);if(!r){hideTip();return;}
   const a=overviewAdditional(r);
   showTip(ev,`<strong>Census tract ${uiEscape(r[2])}</strong><br>GEOID ${r[0]}<br>${uiEscape(POLICIES[policyKey].short)} · ${capital(level)}<br><b>Modeled extra homes:</b> +${fmt(a)}<br><b>Five-year allocated baseline:</b> ${fmt(r[3])}<br><span class="tip-muted">Click to open detailed county and tract view.</span>`);
 };
 cv.onmouseleave=hideTip;
 cv.onclick=ev=>{const r=getRecord(ev);if(r){setLoader('Loading selected tract…');focusOverviewRecord(r).finally(()=>setLoader(null));}};
 return records.length;
}
async function renderNationalCounties(svg){
 const obj=window.NATIONAL_COUNTY_OVERVIEW;
 if(!obj){renderNational(svg);setLoader('Loading all 3,144 U.S. counties…');return;}
 const geo=prepareGeo(obj.geo),val=obj.values;
 $('mapKicker').textContent='ALL U.S. COUNTIES';$('mapTitle').textContent='United States · counties';
 $('mapSubtitle').textContent=`${POLICIES[policyKey].name} · ${capital(level)} · county-level scenario`;
 const proj=d3.geoAlbersUsa().fitExtent([[18,18],[982,622]],window.STATE_GEO),path=d3.geoPath(proj),layer=svg.append('g').attr('class','zoom-layer');
 layer.selectAll('path').data(geo.features).enter().append('path')
  .attr('class','map-shape').attr('d',path)
  .attr('fill',f=>{const r=val[f.properties.GEOID];if(!r||!r.b)return `url(#missingHatch)`;const a=r.a?.[policyKey]?.[['low','default','high'].indexOf(level)];return mapColor(100*(a||0)/r.b);})
  .attr('stroke','#fff4e6').attr('stroke-width',.56)
  .on('click',(e,f)=>{const r=val[f.properties.GEOID];if(r)chooseState(r.state).then(()=>chooseCounty(f.properties.GEOID));})
  .on('mousemove',(e,f)=>{const r=val[f.properties.GEOID];if(!r)return;const a=r.a?.[policyKey]?.[['low','default','high'].indexOf(level)];showTip(e,`<strong>${uiEscape(r.name)}</strong><br>Policy-added homes: +${fmt(a)}<br>Current rules: ${fmt(r.b)}<br><span class="tip-muted">Click to inspect county-level housing policy results.</span>`);})
  .on('mouseleave',hideTip);
 $('mapStatus').textContent='Click a county to see its policy impact and supporting evidence.';
 updateMapLegend('County');enableMapZoom(svg,layer);
}
function enableMapZoom(svg,layer){
  const zoom=d3.zoom()
    .scaleExtent([1,10])
    .extent([[0,0],[1000,650]])
    .translateExtent([[-250,-200],[1250,850]])
    .on("zoom",event=>layer.attr("transform",event.transform));
  svg.call(zoom).on("dblclick.zoom",null);
}

function projectionFor(geo){
  const extent=[[18,18],[982,622]];
  if(stateAbbr==="AK"){
    return d3.geoConicEqualArea().parallels([55,65]).rotate([154,0]).center([-2,58.5]).fitExtent(extent,geo);
  }
  if(stateAbbr==="HI"){
    return d3.geoMercator().fitExtent([[115,80],[885,555]],geo);
  }
  return d3.geoMercator().fitExtent(extent,geo);
}

function renderMap(){
 const svg=d3.select('#mapSvg');svg.selectAll('*').remove();hideTip();
 const canvas=$('nationalTractCanvas');canvas.hidden=true;canvas.style.transform='none';canvas.onmousemove=null;canvas.onclick=null;
 mapRenderToken++;previewHit=null;svg.style('display','block');
 svg.attr('viewBox','0 0 1000 650').attr('preserveAspectRatio','xMidYMid meet');addMapDefs(svg);
 const overview=(stateAbbr==='US'&&nationalMapMode==='tracts')||(stateAbbr!=='US'&&!countyFips&&stateMapMode==='tracts');
 updateGeographyLegend(overview||!!(countyFips&&window.TRACT_DATA[countyFips]?.geo?.features?.length));
 if(overview){
    const target=stateAbbr==='US'?'US':stateAbbr;
    const ready=target==='US'?STATES.every(s=>!!window.TRACT_OVERVIEW[s.state_abbr]):!!window.TRACT_OVERVIEW[target];
    if(ready){
      $('mapKicker').textContent='CENSUS TRACT OVERVIEW';
      $('mapTitle').textContent=target==='US'?'United States · all census tracts':`${stateRec()?.state_name} · census tracts`;
      $('mapSubtitle').textContent=`${POLICIES[policyKey].name} · ${capital(level)} · model allocation`;
      showTractCanvas(target);return;
    }
    if(target==='US')renderNational(svg);else renderStateCounties(svg);
    setLoader('Preparing tract overview…');return;
 }
 setLoader(null);
 if(stateAbbr==='US')return nationalMapMode==='counties'?renderNationalCounties(svg):renderNational(svg);
 if(countyFips&&window.TRACT_DATA[countyFips]?.geo?.features?.length)return renderCountyTracts(svg);
 return renderStateCounties(svg);
}

function renderNational(svg){
  const geo=prepareGeo(window.STATE_GEO);
  $('mapKicker').textContent="NATIONAL VIEW";
  $('mapTitle').textContent="United States";
  $('mapSubtitle').textContent=`${POLICIES[policyKey].name} · ${capital(level)} assumption · modeled impact vs five-year baseline`;
  $('mapStatus').textContent="Select a state to explore authoritative results and local evidence.";
  if(!geo||!geo.features){svg.append('text').attr('x',480).attr('y',310).attr('text-anchor','middle').text('National map unavailable.');return;}
  const projection=d3.geoAlbersUsa().fitExtent([[18,18],[982,622]],geo),path=d3.geoPath(projection),layer=svg.append('g').attr('class','zoom-layer');
  layer.selectAll('path').data(geo.features).enter().append('path')
    .attr('class','map-shape').attr('d',path)
    .attr('fill',f=>{const r=BY_FIPS.get(String(f.properties.STATEFP).padStart(2,'0'));return r?mapColor(changePct(r,policyKey,level)):`url(#missingHatch)`;})
    .attr('stroke','#fff4e6').attr('stroke-width',1).attr('tabindex',0).attr('role','button')
    .attr('aria-label',f=>{const r=BY_FIPS.get(String(f.properties.STATEFP).padStart(2,'0'));return r?`Select ${r.state_name}`:'State';})
    .on('click',(e,f)=>{const r=BY_FIPS.get(String(f.properties.STATEFP).padStart(2,'0'));if(r)chooseState(r.state_abbr);})
    .on('keydown',(e,f)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const r=BY_FIPS.get(String(f.properties.STATEFP).padStart(2,'0'));if(r)chooseState(r.state_abbr);}})
    .on('mousemove',(e,f)=>{const r=BY_FIPS.get(String(f.properties.STATEFP).padStart(2,'0'));if(!r)return;const a=added(r,policyKey,level),b=baseline(r),cp=changePct(r,policyKey,level);showTip(e,`<strong>${r.state_name}</strong><br>${POLICIES[policyKey].name} · ${capital(level)}<br><b>Possible added:</b> ${a===null?'Not available':'+'+fmt(a)+' homes'}<br><b>5-year baseline:</b> ${fmt(b)} homes<br><b>Modeled impact:</b> ${pct(cp)}<br><span class="tip-muted">${impactLabel(cp)} · authoritative state result</span>`);})
    .on('mouseleave',hideTip);
  updateMapLegend('State');
  enableMapZoom(svg,layer);
}
function renderStateCounties(svg){
  const s=stateRec(),geo=prepareGeo(window.COUNTY_GEO[stateAbbr]);
  $('mapKicker').textContent="STATE VIEW";
  $('mapTitle').textContent=s.state_name;
  $('mapSubtitle').textContent=`${POLICIES[policyKey].name} · county supporting evidence · same impact scale`;
  if(!geo||!geo.features){svg.append('text').attr('x',480).attr('y',310).attr('text-anchor','middle').text('Loading county evidence…');return;}
  const rows=countyRows(),by=new Map(rows.map(d=>[d.fips,d])),projection=projectionFor(geo),path=d3.geoPath(projection),layer=svg.append('g').attr('class','zoom-layer');
  layer.selectAll('path').data(geo.features).enter().append('path')
    .attr('class','map-shape').attr('d',path)
    .attr('fill',f=>{const c=by.get(String(f.properties.GEOID).padStart(5,'0'));return c?mapColor(changePct(c,policyKey,level)):`url(#missingHatch)`;})
    .attr('stroke',f=>String(f.properties.GEOID).padStart(5,'0')===countyFips?'#3c2f2f':'#fff4e6')
    .attr('stroke-width',f=>String(f.properties.GEOID).padStart(5,'0')===countyFips?2.4:.7)
    .attr('tabindex',0).attr('role','button')
    .attr('aria-label',f=>{const c=by.get(String(f.properties.GEOID).padStart(5,'0'));return `Select ${c?(c.county_full_name||c.county_name):(f.properties.NAME||f.properties.GEOID)} · supporting county evidence`;})
    .on('click',(e,f)=>{const fips=String(f.properties.GEOID).padStart(5,'0');if(by.has(fips))chooseCounty(fips);})
    .on('keydown',(e,f)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();const fips=String(f.properties.GEOID).padStart(5,'0');if(by.has(fips))chooseCounty(fips);}})
    .on('mousemove',(e,f)=>{const c=by.get(String(f.properties.GEOID).padStart(5,'0'));if(!c)return;const a=added(c,policyKey,level),b=baseline(c),cp=changePct(c,policyKey,level),stateImpact=changePct(s,policyKey,level);if(cp===null){const baselineDisplay=b===0?'0 homes (percentage cannot be calculated)': 'Not available';showTip(e,`<strong>${c.county_full_name||c.county_name}</strong><br>${POLICIES[policyKey].name} · ${capital(level)}<br><b>Possible added:</b> ${a===null?'Not available':'+'+fmt(a)+' homes'}<br><b>5-year baseline:</b> ${baselineDisplay}<br><b>Normalized impact:</b> Not shown<br><span class="tip-muted">No usable county production baseline for a percentage comparison. County evidence is supporting only; ${s.state_name}'s ${pct(stateImpact)} state impact is authoritative.</span>`);}else{showTip(e,`<strong>${c.county_full_name||c.county_name}</strong><br>${POLICIES[policyKey].name} · ${capital(level)}<br><b>Possible added:</b> +${fmt(a)} homes<br><b>5-year baseline:</b> ${fmt(b)} homes<br><b>Modeled impact:</b> ${pct(cp)}<br><span class="tip-muted">${impactLabel(cp)} · county supporting evidence; state result remains authoritative</span>`);}})
    .on('mouseleave',hideTip);
  $('mapStatus').textContent="Select a county to view supporting local evidence.";
  updateMapLegend('County');
  enableMapZoom(svg,layer);
}

function renderCountyTracts(svg){
 const blob=window.TRACT_DATA[countyFips],geo=blob.geo,rows=blob.records; // Original winding: do NOT reverse tract rings
 const by=new Map(rows.map(r=>[r.geoid,r]));
 const shade=computeTractShades(rows.map(r=>n(r.x?.[policyKey]?.[level])||0));
 $('mapKicker').textContent='CENSUS TRACT VIEW';$('mapTitle').textContent=tractRec()?`Tract ${tractRec().name} · ${countyRec()?.county_name||countyFips}`:countyRec()?.county_full_name||countyRec()?.county_name||countyFips;
 $('mapSubtitle').textContent=`${POLICIES[policyKey].name} · ${capital(level)} · five-year tract allocation`;
 const projection=projectionFor(geo),path=d3.geoPath(projection),layer=svg.append('g').attr('class','zoom-layer');
 layer.selectAll('path').data(geo.features).enter().append('path')
 .attr('class','map-shape tract-shape').attr('d',path)
 .attr('fill',f=>{const t=by.get(String(f.properties.GEOID));return t?shade(n(t.x?.[policyKey]?.[level])):`url(#missingHatch)`;})
 .attr('stroke',f=>String(f.properties.GEOID)===tractGeoid?'#3c2f2f':'#fff4e6')
 .attr('stroke-width',f=>String(f.properties.GEOID)===tractGeoid?2.4:.65)
 .attr('tabindex',0).attr('role','button')
 .attr('aria-label',f=>`Select Census tract ${by.get(String(f.properties.GEOID))?.name||f.properties.GEOID}`)
 .on('click',(e,f)=>chooseTract(String(f.properties.GEOID)))
 .on('keydown',(e,f)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseTract(String(f.properties.GEOID));}})
 .on('mousemove',(e,f)=>{const t=by.get(String(f.properties.GEOID));if(!t)return;const b=n(t.b),a=n(t.x?.[policyKey]?.[level]);const p=b>0&&a!==null?100*a/b:null;showTip(e,`<strong>Census tract ${t.name}</strong><br>${POLICIES[policyKey].short} · ${capital(level)}<br><b>Five-year tract allocation:</b> ${fmt(b)} baseline + ${fmt(a)} modeled additional units<br><b>Percentage:</b> ${p===null?'Not calculable':pct(p)}<br><span class="tip-muted">Census tract estimates allocated from the state/county model, not observed tract permits or verified zoning eligibility.</span>`);})
 .on('mouseleave',hideTip);
 $('mapStatus').textContent='Click a tract to inspect its five-year scenario. County and state totals remain the modeling anchors.';
 updateMapLegend('Tract');enableMapZoom(svg,layer);
}
function tractResultHtml(){
  const t=tractRec(),m=metric(),c=countyRec();
  if(!t)return '';
  // Tracts use the same three-step decision card as counties.  The tract figures
  // are allocated from the county/state model, never independently observed permits.
  const cb=c?baseline(c):null, ca=c?added(c,policyKey,level):null;
  const share=(num,den)=>n(num)!==null&&n(den)>0?pct(100*n(num)/n(den),1):'Not calculable';
  const facts={
    adu:{
      title:'Check the homes that might support an ADU',
      mechanism:'An ADU is an extra small home on an existing property. The one-unit housing count helps locate possible opportunities, but it includes attached and detached homes; no individual lot has been checked.',
      forms:'A backyard cottage, a garage conversion or another permitted accessory home.',
      a:['Homes in one-unit buildings',t.single,'ACS 2020–24 estimate; includes attached and detached'],
      b:['Existing housing units',t.housing,'Occupied and vacant homes; not eligible parcels']
    },
    missing_middle:{
      title:'Check opportunity for smaller multi-home buildings',
      mechanism:'Missing-middle reform could allow 2–6 homes where fewer homes were previously allowed. Existing housing types help us spread the county scenario across tracts, but they do not prove a site can be redeveloped.',
      forms:'Duplexes, triplexes, fourplexes or other small residential buildings.',
      a:['Homes in one-unit buildings',t.single,'ACS 2020–24 estimate; not a count of eligible lots'],
      b:['Homes in 2–9-unit buildings',t.multi2_9,'Existing housing units, not building counts']
    },
    tod:{
      title:'Check the modeled transit-density opportunity',
      mechanism:'The reform allows more housing near qualifying transit. The state/county model uses transit exposure; its tract allocation uses housing and recent-construction proxies, not verified station distances for this tract.',
      forms:'Additional housing in transit-accessible areas where local rules allow it.',
      a:['Existing housing units',t.housing,'ACS 2020–24 estimate'],
      b:['Recently built housing proxy',t.recent,'ACS housing-age indicator; not tract permits']
    },
    parking:{
      title:'Check where parking-cost reform may matter',
      mechanism:'Reducing required parking could lower construction costs. The local model uses existing and recently built housing to distribute that possible effect; this tract’s actual parking rules have not been checked.',
      forms:'More homes in projects that become feasible with fewer required parking spaces.',
      a:['Recently built housing proxy',t.recent,'ACS housing-age indicator; not tract permits'],
      b:['Homes in buildings with 2+ units',(n(t.multi2_9)||0)+(n(t.multi10)||0),'Existing homes; not confirmed parking-constrained projects']
    },
    fee:{
      title:'Check where lower development fees may help',
      mechanism:'Lower fees could make some projects less expensive to build. We use the tract’s existing and recent housing to distribute a county scenario; we have not verified its local fee schedule.',
      forms:'Additional homes in projects that may become financially workable.',
      a:['Recently built housing proxy',t.recent,'ACS housing-age indicator; not tract permits'],
      b:['Existing housing units',t.housing,'ACS 2020–24 housing stock estimate']
    }
  };
  const g=facts[policyKey]||facts.adu;
  const card={
    level:capital(level),
    added:m.added===null?'Not available':'+'+fmt(m.added),
    baseline:fmt(m.baseline),
    total:fmt(m.total),
    pct:pct(m.pct),
    baselineLabel:'2026–30 tract baseline (allocated)',
    totalLabel:'With selected reform',
    totalHelp:m.baseline===null||m.added===null?'Model result unavailable':`${fmt(m.baseline)} + ${fmt(m.added)}`,
    baselineHelp:'This tract baseline is a share of the county/state five-year permit model. It is not a count of observed permits in this census tract.',
    percentExplanation:m.pct===null?'The percentage change cannot be calculated with a zero or missing tract baseline.':`${fmt(m.added)} possible added units ÷ ${fmt(m.baseline)} baseline units = ${pct(m.pct)} modeled increase over five years.`,
    currentHomes:fmt(t.housing)+' housing units (ACS 2020–24 estimate)',
    focusTitle:g.title,
    mechanism:g.mechanism,
    forms:g.forms,
    observations:[
      {label:g.a[0],value:fmt(g.a[1]),note:g.a[2]},
      {label:g.b[0],value:fmt(g.b[1]),note:g.b[2]}
    ],
    evidenceCards:[
      {label:'Tract share of county baseline',value:share(m.baseline,cb),note:`${fmt(m.baseline)} of ${fmt(cb)} modeled county units`},
      {label:'Tract share of county policy addition',value:share(m.added,ca),note:`${fmt(m.added)} of ${fmt(ca)} modeled county additions`}
    ],
    localNeed:`Census/ACS estimates: ${fmt(t.population)} residents, ${fmt(t.vacant)} vacant housing units, ${fmt(t.renter)} renter-occupied units and ${fmt(t.crowded)} overcrowded occupied units. These describe local conditions; they are not a count of homes that must be built.`,
    assumptionMeaning:`${assumptionMeaning()} This assumption determines the county/state total; it is not applied directly to each tract's homes.`,
    calculationSteps:[
      `Start with the ${(c?.county_full_name||c?.county_name||'county')} model: ${fmt(cb)} baseline units and +${fmt(ca)} possible ${POLICIES[policyKey].short} units over 2026–2030.`,
      `Distribute those county figures using tract-specific housing weights: ${fmt(m.baseline)} baseline + ${fmt(m.added)} policy additions = ${fmt(m.total)} modeled units in tract ${t.name}.`
    ],
    limitations:[`Local zoning, parcel eligibility and costs are not independently verified. ${POLICIES[policyKey].limitation} The five separate policy results must not be added together.`],
    sourceNote:'Sources: Census 2026 Planning Database (2020 Census and ACS 2020–24), Census tract geography, and the existing Census permit-based county/state policy model. Tract production is allocated, not observed.',
    isMissing:m.added===null||m.baseline===null,
    isZeroBaseline:!m.baseline
  };
  return window.renderDecisionCard(card);
}
function tractMethodHtml(){
 const t=tractRec(),m=metric(),p=POLICIES[policyKey];
 return `<section class="final-explain"><h3>${uiEscape(p.name)} · tract method</h3><p><b>What it means:</b> ${uiEscape(p.benchmark)}</p><p><b>Data:</b> Census 2026 Planning Database (ACS 2020–2024 estimates), 2020 Census tract geography, and the existing 2025 Census county/state permit model.</p><p><b>Model calculation:</b> First use observed county permit totals and existing policy assumptions to create each state's five-year baseline and added-unit scenarios. Assign a reconciled county share, then distribute each county's units across tracts using this reform's specified weights.</p><p><b>Tract allocation weights:</b> ${uiEscape(tractWeightDescription())}</p><p><b>Interpretation:</b> this is a disaggregation of an existing county/state model, not an independent tract-level construction forecast.</p><p><b>Limitations:</b> ${uiEscape(p.limitation)} ${uiEscape(t?.allocation_note||'Local zoning and parcel eligibility are not established nationally.')}</p><p><b>Assumptions:</b> ${uiEscape(assumptionText())}</p></section>`;
}
function tractWeightDescription(){
 return {adu:'Single-unit housing in the tract. Includes both detached and attached structures in this source; eligibility is not verified.',missing_middle:'Single-unit housing with a modest observed renter/occupied-housing pressure weight; not a zoning eligibility calculation.',tod:'Existing housing and recently built housing as a geographic proxy. DOES NOT measure distance to rail or a legal TOD overlay.',parking:'Recent housing development and multifamily stock as an affected-development proxy; local parking minimums are not verified.',fee:'Recent housing development and housing stock as a fee-response allocation proxy; actual local development-fee schedules are not verified.'}[policyKey];
}
function tractCalculationHtml(){
 const t=tractRec(),m=metric();
 return `<section class="final-explain"><h3>Tract allocation calculation</h3><p><b>Selected area:</b> Census tract ${uiEscape(t?.name||'')} · ${uiEscape(countyRec()?.county_name||'')}</p><p><b>Step 1.</b> Preserve the existing state's five-year current-rules baseline and the separately selected ${uiEscape(POLICIES[policyKey].short)} response.</p><p><b>Step 2.</b> Allocate the state amount across counties using the project's county scenario weights, adjusting for county coverage.</p><p><b>Step 3.</b> Within each county, distribute the five-year baseline and each policy response to tracts in proportion to policy-specific weights. Integer units are apportioned by the largest-remainder method so the tract sums reconcile exactly.</p><p><b>Step 4.</b> This tract: ${fmt(m.baseline)} current-rules units + ${fmt(m.added)} policy scenario units = <b>${fmt(m.total)}</b> units over 2026–2030.</p><p><b>Assumption:</b> ${uiEscape(tractWeightDescription())}</p><p><b>Important:</b> Percent changes can be undefined when the allocated tract baseline is zero. Neither projected permits nor additional policy production are confirmed building completions.</p></section>`;
}
function updateTractGraph(){
 const host=$('tractGraph');if(!host)return;const t=tractRec();
 document.body.classList.toggle('is-tract-view',!!t);
 if(!t){host.hidden=true;host.innerHTML='';return;}
 const b=n(t.b)||0,a=n(t.x?.[policyKey]?.[level])||0;
 const m=Math.max(1,b+a),esc=uiEscape;
 const row=(label,value,max,color)=>`<div class="tract-data-bar"><span>${esc(label)}</span><div class="tract-data-track"><i style="width:${Math.max(0,Math.min(100,100*(value||0)/Math.max(1,max))).toFixed(1)}%;background:${color}"></i></div><strong>${fmt(value)}</strong></div>`;
 const stocks=[['One-unit homes',t.single],['2–9-unit homes',t.multi2_9],['10+ unit homes',t.multi10],['Vacant homes',t.vacant],['Renter-occupied homes',t.renter]];
 host.hidden=false;
 host.innerHTML=`<div class="tract-focus-header"><h3>Tract ${esc(t.name)} · Housing and five-year policy impact</h3><p>${esc(countyRec()?.county_full_name||countyRec()?.county_name||'')} · ${esc(POLICIES[policyKey].name)} · ${capital(level)} response</p></div>
 <section class="tract-graph-section"><h4>Permitted housing units, 2026–2030 · modeled tract allocation</h4>
 ${row('Current rules',b,m,'#b78277')}${row('With reform',b+a,m,'#854442')}
 <div class="tract-graph-grid"><div class="tract-graph-box"><span>Current rules</span><strong>${fmt(b)}</strong></div><div class="tract-graph-box"><span>Policy addition</span><strong>+${fmt(a)}</strong></div><div class="tract-graph-box"><span>With policy</span><strong>${fmt(b+a)}</strong></div></div></section>
 <section class="tract-graph-section"><h4>Existing housing in this tract · Census/ACS 2020–2024</h4>
 ${stocks.map(([label,v])=>row(label,n(v),Math.max(1,n(t.housing)||1),'#9e7169')).join('')}
 <div class="tract-graph-grid"><div class="tract-graph-box"><span>Population estimate</span><strong>${fmt(t.population)}</strong></div><div class="tract-graph-box"><span>Housing units</span><strong>${fmt(t.housing)}</strong></div><div class="tract-graph-box"><span>Overcrowded occupied units</span><strong>${fmt(t.crowded)}</strong></div></div></section>
 <p class="tract-graph-description">This graph shows <b>only the selected census tract</b>. The 2026–2030 bars allocate the existing state/county permit scenario; they are not observed tract construction. Existing housing and population are ACS estimates, not a tract time series. The five reforms are alternative scenarios and their additions should not be summed.</p>`;
}
function renderBreadcrumb(){
  const b=$('breadcrumb');let html='<button data-crumb="US">United States</button>';if(stateRec())html+=`<button data-crumb="state">${stateRec().state_name}</button>`;if(countyRec())html+=`<button data-crumb="county">${countyRec().county_full_name||countyRec().county_name}</button>`;if(tractRec())html+=`<button data-crumb="tract">Tract ${tractRec().name}</button>`;b.innerHTML=html;b.querySelectorAll('button').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.crumb;if(k==='US')chooseState('US');else if(k==='state')chooseCounty(null);else if(k==='county')chooseTract(null);});$('backBtn').disabled=stateAbbr==='US';
}
// Rank by modeled five-year additional units for the CURRENT geography and sensitivity.
// When the same baseline is defined, this is equivalent to impact-percentage order.
// Do not force a ranked comparison where one or more policy outputs are unavailable.
function rankedPolicies(){
  const r=policyRecord();
  return POLICY_KEYS.map((key,index)=>({key,index,value:stateAbbr==='US'?nationalAdded(key,level):added(r,key,level)}))
    .sort((a,b)=>a.value===null?(b.value===null?a.index-b.index:1):b.value===null?-1:(b.value-a.value||a.index-b.index));
}

function decisionBrief(){
  const p=POLICIES[policyKey],m=metric();
  if(stateAbbr==='US')return `Across all 50 states and the District of Columbia, the final 2025 Census permit total is ${fmt(BASE.annual)} housing units. Carrying that pace forward creates a five-year current-rules benchmark of ${fmt(BASE.fiveYear)} homes. Under the ${capital(level)} ${p.name} assumptions, the simulator models ${fmt(m.added)} additional homes, or ${pct(m.pct)} above the benchmark. This is a conditional scenario, not a forecast.`;
  const s=stateRec(),c=countyRec();
  if(c){if(yes(c.bps_available))return `${c.county_full_name||c.county_name} has approximately ${fmt(c.housing_units)} housing units and an observed 2025 county permit benchmark of ${fmt(c.baseline_annual_units)} units. Under the ${capital(level)} ${p.name} assumptions, the county supporting model shows +${fmt(m.added)} homes. The authoritative ${s.state_name} result is +${fmt(added(s,policyKey,level))}.`;return `${c.county_full_name||c.county_name} has approximately ${fmt(c.housing_units)} housing units, but its county permit benchmark is unavailable. County values are supporting geographic evidence; the authoritative ${s.state_name} result is +${fmt(added(s,policyKey,level))} homes.`;}
  return `${s.state_name} authorized ${fmt(s.baseline_annual_units)} homes in 2025. Carrying that final Census permit pace forward produces a five-year benchmark of ${fmt(s.baseline_5yr_units)} homes. Under the ${capital(level)} ${p.name} assumptions, the simulator models +${fmt(m.added)} homes, or ${pct(m.pct)} above the benchmark. The result is conditional on the stated assumptions.`;
}
function whyResult(){
  if(stateAbbr==='US')return "The national result aggregates the same transparent state-level framework across all 50 states and DC. Differences among reforms reflect different stock bases, transit exposure, cost assumptions, and sensitivity parameters.";
  const s=stateRec(),selected=changePct(s,policyKey,level),vals=STATES.map(d=>changePct(d,policyKey,level)).filter(v=>v!==null).sort((a,b)=>a-b),median=d3.quantile(vals,.5);let rel='near';if(selected>median*1.25)rel='above';else if(selected<median*.75)rel='below';let driver='';if(policyKey==='adu')driver="The main driver is detached single-family stock relative to the state's permit pace.";if(policyKey==='missing_middle')driver="The main drivers are detached single-family stock, the redevelopment assumption, and net units per redevelopment.";if(policyKey==='tod')driver=`The result is strongly influenced by the state's corrected TOD housing exposure share of ${fractionPct(recordTransitExposure(s),1)}.`;if(policyKey==='parking')driver="The result depends on current production, the affected-development share, avoided parking spaces, parking cost, and the supply response.";if(policyKey==='fee')driver="The result depends on the $25,000 benchmark fee savings relative to modeled project value and the supply response.";return `${s.state_name}'s modeled percentage effect is ${rel} the median state result under the same assumptions. ${driver}`;
}
function comparisonTable(){
  let rows='';POLICY_KEYS.forEach(key=>{const r=policyRecord();const lo=stateAbbr==='US'?nationalAdded(key,'low'):added(r,key,'low'),de=stateAbbr==='US'?nationalAdded(key,'default'):added(r,key,'default'),hi=stateAbbr==='US'?nationalAdded(key,'high'):added(r,key,'high'),b=stateAbbr==='US'?BASE.fiveYear:baseline(r),cp=b&&de!==null?100*de/b:null;rows+=`<tr><td>${POLICIES[key].short}</td><td>${lo===null?'N/A':'+'+fmt(lo)}</td><td>${de===null?'N/A':'+'+fmt(de)}</td><td>${hi===null?'N/A':'+'+fmt(hi)}</td><td>${pct(cp)}</td></tr>`;});return `<details><summary>Compare all five reforms</summary><div class="compare-wrap"><table class="compare"><thead><tr><th>Reform</th><th>Low</th><th>Default</th><th>High</th><th>Default change</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
}

// ---------- Integrated housing evidence: OBSERVED, never alters production model ----------
function typeRecord(){
  const src=window.HOUSING_TYPES||{};
  if(countyFips)return (src.county||{})[countyFips]||null;
  if(stateAbbr==='US')return src.national||null;
  const s=stateRec();return s?(src.state||{})[s.state_fips]||null:null;
}
function nationalPosition(field){
  if(stateAbbr==='US')return null;
  const t=typeRecord(),p=t&&t.pctile&&t.pctile[field];
  if(p===undefined||p===null)return null;
  if(p>=75)return `upper national quartile among ${countyFips?'counties':'states/DC'}`;
  if(p<=25)return `lower national quartile among ${countyFips?'counties':'states/DC'}`;
  return null;
}
function signedPercent(v){const x=n(v);return x===null?'Not available':(x>0?'+':'')+pct(x);}
function typeIndicator(label,value,support){
 return `<div class="integrated-indicator"><span>${label}</span><strong>${value}</strong>${support?`<small>${support}</small>`:''}</div>`;
}
function integratedEvidenceHtml(){
  const d=hnRecord(),t=typeRecord();
  if(!d||!t)return '<p class="local-no-evidence">Detailed housing characteristics are unavailable here; this does not affect the policy estimate.</p>';
  const ag=d.ages||[];
  const age25=hnRate(ag[2],d.pa),age65=hnRate(ag.slice(6).reduce((a,b)=>a+(n(b)||0),0),d.pa);
  const h1=hnRate(d.h1,d.hh),h3=hnRate(d.h3,d.hh),burden=hnRate(d.burden,d.burdenDenom);
  const smallRental=t.renter>0?hnRate((t.renterBeds[0]||0)+(t.renterBeds[1]||0),t.renter):null;
  const ageLabels=['0–17','18–24','25–34','35–44','45–54','55–64','65–74','75–84','85+'];
  const ages=ageLabels.map((label,i)=>`<div class="integrated-data-row"><span>${label} years</span><strong>${pct(hnRate(ag[i],d.pa))}</strong></div>`).join('');
  const beds=['Studio','1 bedroom','2 bedrooms','3 bedrooms','4 bedrooms','5+ bedrooms'].map((name,i)=>`<tr><td>${name}</td><td>${fmt(t.renterBeds[i])}</td><td>${fmt(t.ownerBeds[i])}</td><td>${t.rents[i]===null?'N/A':'$'+fmt(t.rents[i])}</td></tr>`).join('');
  return `<section class="integrated-evidence" aria-label="Observed demographic and housing evidence">
    <div class="integrated-heading"><h3>Population, households & existing homes</h3><span>Census / ACS · observed conditions</span></div>
    <div class="integrated-stats">
      ${typeIndicator('Ages 25–34 / 65+',`${pct(age25)} / ${pct(age65)}`,'ACS 2020–2024 age shares')}
      ${typeIndicator('1-person / 3+ households',`${pct(h1)} / ${pct(h3)}`,'ACS 2020–2024 household mix')}
      ${typeIndicator('Renter cost burden ≥30%',pct(burden),nationalPosition('burden'))}
      ${typeIndicator('Rental studios + 1-bedroom',pct(smallRental),'Share of occupied rental units')}
      ${typeIndicator('Overcrowded renter homes',pct(t.crowdedRRate),nationalPosition('crowding'))}
    </div>
    <details class="integrated-more"><summary>All nine age groups, bedroom counts & median rents</summary>
      <div class="integrated-details-grid"><div><h4>Age groups · ACS 2020–2024</h4>${ages}</div><div><h4>Occupied units by bedrooms · ACS 2020–2024</h4><div class="compare-wrap"><table class="compare"><thead><tr><th>Size</th><th>Renter</th><th>Owner</th><th>Median rent</th></tr></thead><tbody>${beds}</tbody></table></div>${stateAbbr==='US'?'<p>National bedroom-specific median rents are not obtained by averaging state medians.</p>':''}</div></div>
    </details>
    <p class="integrated-disclaimer">Population growth uses Census 2020–2025 estimates; age, household size, rent and bedroom data use ACS 2020–2024. These are observations, not responses to the selected policy.</p>
  </section>`;
}

// ---- Observed ACS 2020-2024 structure and occupancy (NOT forecast requirements) ----
function structureEvidenceRecord(){
  const src=window.QUIESCE_STRUCTURE_EVIDENCE;if(!src)return null;
  if(countyFips)return (src.county||{})[countyFips]||null;
  if(stateAbbr==='US')return src.US||null;
  const state=stateRec();return state?(src.state||{})[state.state_fips]||null:null;
}
function structureEvidencePreviewHtml(){
  const t=structureEvidenceRecord();if(!t)return '';
  const summary=`Existing stock (ACS 2020–2024): <strong>${pct(t.detachedPct)}</strong> detached, <strong>${pct(t.twoFourPct)}</strong> in 2–4-unit buildings, <strong>${pct(t.fivePlusPct)}</strong> in 5+-unit buildings.`;
  const flags=(t.smallSample||t.highMoe)?'<p class="planning-alert">Some building-type categories have small counts or high ACS sampling uncertainty; do not rank small locations on these measures alone.</p>':'';
  return `<div class="structure-evidence" aria-label="Observed structure and household-size evidence">
   <p class="structure-summary">${summary}</p>
   <div class="structure-mini-grid">
      <div><span>Detached units</span><b>${fmt(t.detached)}</b></div>
      <div><span>Units in 2–4-unit buildings</span><b>${fmt(t.twoFour)}</b></div>
      <div><span>Units in 5+-unit buildings</span><b>${fmt(t.fivePlus)}</b></div>
   </div>
   <p><strong>Who occupies which structures:</strong> ${fmt(t.oneRenter2to4)} one-person renter households live in 2–4-unit buildings (${pct(t.oneRenter2to4Pct)} of one-person renters); ${fmt(t.largeRenter2to4)} renter households with 3+ people live in those buildings (${pct(t.largeRenter2to4Pct)} of larger renter households).</p>
   <p class="structure-caveat">These are existing homes and households, not forecast homes or bedrooms required. B25124 does not identify ADUs or distinguish five- from six-unit buildings within its wider structure categories.</p>
   ${flags}</div>`;
}

// ---- HUD CHAS 2018–2022 affordability context, NOT modeled new unit demand ----
function chasAffordabilityRecord(){
  const source=window.QUIESCE_CHAS_AFFORDABILITY;if(!source)return null;
  if(countyFips)return (source.county||{})[countyFips]||null;
  if(stateAbbr==='US')return source.US||null;
  const state=stateRec();return state?(source.state||{})[state.state_fips]||null:null;
}
function chasAffordabilityPreviewHtml(){
  const x=chasAffordabilityRecord();if(!x)return '';
  const label=x.approx?'Approximate sum of rounded county CHAS estimates; not an official state/national tabulation.':'HUD CHAS 2018–2022 survey estimates, with separately rounded income bands.';
  const caution=x.highMoe||x.small?'<p class="planning-alert">Small local counts or a high relative CHAS margin of error for renter housing problems; interpret and compare cautiously.</p>':'';
  const comparative=x.percentile===null||x.percentile===undefined?'':`<p class="chas-footnote">National comparison: about the ${fmt(x.percentile,0)}th percentile among U.S. counties with non-small denominators and a usable original renter-problem margin of error. This is descriptive context, not a policy rank.</p>`;
  return `<section class="chas-preview" aria-label="Income-specific housing problems HUD CHAS 2018 to 2022">
    <p class="chas-heading"><strong>Existing affordability problems</strong> <span>HUD CHAS · 2018–2022</span></p>
    <div class="chas-mini-grid">
      <div><span>Lower-income renter households with 1+ problems</span><b>${fmt(x.lowProblem)}</b></div>
      <div><span>Share of lower-income renter households</span><b>${pct(x.rate)}</b></div>
    </div>
    <p class="chas-footnote">Lower-income = at or below 80% of HUD area median family income. A housing problem can be excessive housing costs, overcrowding, or incomplete kitchen/plumbing. These households may need rental assistance, housing improvements, or more affordable options; the figure is <strong>not</strong> new units required.</p>
    <details class="chas-extra"><summary>Income-specific affordability evidence and limits</summary>
      <p><strong>Lower-income renter households in CHAS:</strong> ${fmt(x.lowTotal)}. <strong>With severe housing problems:</strong> ${fmt(x.lowSevere)}. <strong>All renters with a housing problem:</strong> ${fmt(x.allProblem)} out of ${fmt(x.renterTotal)} renter households.</p>
      ${x.pre1980Pct===null||x.pre1980Pct===undefined?'':`<p><strong>Existing housing built before 1980 (ACS 2020–2024):</strong> ${pct(x.pre1980Pct)}. Older housing is not proof of required demolition.</p>`}
      <p>${label} Rounding and ACS sampling uncertainty apply. This older income-specific snapshot must not be compared to ACS 2020–2024 as a trend or projected forward as a 2030 shortage.</p>
      <p><strong>How to use:</strong> screen for targeted housing assistance, rehabilitation, and affordability support. Separately investigate whether new housing supply is required and what types may be feasible. This evidence does not imply that ADU, missing-middle, TOD, parking, or fee reforms directly produce income-restricted homes.</p>
      ${comparative}${caution}
    </details>
  </section>`;
}


// ---- V9: audited demand scenarios and explicit evidence predicates ----
function decisionRecord(){
  const source=window.QUIESCE_DECISION||{};
  if(countyFips)return (source.county||{})[countyFips]||null;
  if(stateAbbr==='US')return source.national||null;
  const s=stateRec();return s?(source.state||{})[s.state_fips]||null:null;
}
function decisionAssessment(){
  const r=policyRecord();
  const sum=key=>STATES.reduce((a,s)=>a+(n(s[key])||0),0);
  const detached=stateAbbr==='US'?sum('detached_sf_units'):r?n(r.adu_stock_base??r.sf_detached_units??r.detached_sf_units):null;
  const completeTransit=STATES.every(s=>recordTransitExposure(s)!==null&&n(s.tod_housing_base_new)!==null&&n(s.tod_housing_den_new)!==null);
  const transit=stateAbbr==='US'?(completeTransit&&sum('tod_housing_den_new')>0?sum('tod_housing_base_new')/sum('tod_housing_den_new'):null):recordTransitExposure(r);
  return window.QuiesceDecision.assess({policy:policyKey,record:decisionRecord(),detached,transit,annual:stateAbbr==='US'?BASE.annual:r?n(r.baseline_annual_units):null});
}
function signedUnits(v){const x=n(v);return x===null?'Not available':(x>0?'+':'')+fmt(x);}
function scenarioRange(s,signed=false){
  if(!s||[s.low,s.central,s.high].some(v=>n(v)===null))return 'Not available';
  const f=signed?signedUnits:fmt;return `${f(s.low)} to ${f(s.high)}`;
}
function decisionStat(label,value,note=''){return `<div class="decision-stat"><span>${label}</span><strong>${value}</strong>${note?`<small>${note}</small>`:''}</div>`;}
function decisionWhyHtml(a){
  const f=a.facts;
  const why={
    adu:'Adding a second dwelling on an existing residential property can expand local choices without replacing the main home. Detached stock is the exposure proxy; household composition does not establish ADU preference.',
    missing_middle:'Allowing more homes on residential sites can broaden the range of apartments and townhouses. Adequate space and affordability depend on the units actually delivered, including any homes removed.',
    tod:a.facts.transit===0?'The frozen transit analysis measures no qualifying exposure here. This scenario therefore offers no measured TOD pathway, even if housing pressures remain.':'Higher density around qualifying transit can allow more homes close to service. Area-weighted exposure does not measure spare station-area capacity or household travel needs.',
    parking:'Reducing a binding parking mandate can lower required project costs. The model assumes the affected share; it has not measured whether local mandates bind or how much parking developers would still provide.',
    fee:'Fee relief can change project economics when fees are material to a development decision. The challenge fee benchmark is assumed; local charges, public infrastructure costs and supply response require verification.'
  }[policyKey];
  const driver=policyKey==='adu'||policyKey==='missing_middle'?decisionStat('Detached stock proxy',fmt(f.detached),'Housing units; legal lots unmeasured'):policyKey==='tod'?decisionStat('Transit exposure proxy',fractionPct(f.transit),'Tract-area-weighted housing share'):decisionStat('2025 permitted units',fmt(f.annual),'Authorizations; not completions');
  const need=policyKey==='missing_middle'?decisionStat('Overcrowded renter homes',fmt(f.crowdedRenters),'ACS 2020–2024 estimate'):decisionStat('Renters with cost burden ≥30%',pct(f.burdenRate),'ACS 2020–2024; calculable costs');
  return `<section class="decision-section" aria-label="Policy relevance"><h3><span>2</span> Why this policy may matter</h3><p>${why}</p><div class="decision-stats">${driver}${need}</div><p class="decision-caution">Potential contribution: ${metric().added===null?'no modeled increment is available':signedUnits(metric().added)+' permit-equivalent units'}. Completion, net additions, bedroom mix and affordable rents have not been established.</p></section>`;
}
function decisionTypesHtml(){
  const forms={adu:'One detached or semi-detached ADU of at least 600 square feet on an existing single-family parcel, with no additional parking required, under the challenge benchmark.',missing_middle:'Duplexes, triplexes, fourplexes, townhouses and small multifamily buildings within the 2–6-unit scenario.',tod:'Small and larger multifamily buildings near qualifying transit, where local density rules and project economics permit.',parking:'ADUs, townhouses and multifamily projects could be affected when parking requirements bind; the reform specifies no building type.',fee:'Potentially several building types where actual fee savings change feasibility; the reform specifies no building type.'}[policyKey];
  const q=decisionRecord(),e=q?.evidence||{},beds=e.bedrooms||{},t=typeRecord();
  const owner=beds.owner||t?.ownerBeds||[],renter=beds.renter||t?.renterBeds||[],rents=e.rents||t?.rents||[];
  const rows=['Studio','1 bedroom','2 bedrooms','3 bedrooms','4 bedrooms','5+ bedrooms'].map((label,i)=>`<tr><td>${label}</td><td>${fmt(renter[i])}</td><td>${fmt(owner[i])}</td><td>${n(rents[i])===null?'N/A':'$'+fmt(rents[i])}</td></tr>`).join('');
  return `<section class="decision-section" aria-label="Potential housing types"><h3><span>3</span> Homes it could enable</h3><p>${forms}</p><p class="decision-muted">Studios through larger-bedroom homes are possible design choices. Building type, bedroom count, tenure and income restrictions are separate. No numerical future mix is justified by the available evidence.</p><details><summary>Existing bedroom supply, rents & building stock</summary><p class="decision-muted">ACS 2020–2024 occupied homes; these are existing units, not units needed. Gross rents are medians, not new-construction asking rents.</p><div class="compare-wrap"><table class="compare"><thead><tr><th>Bedrooms</th><th>Rented</th><th>Owned</th><th>Median rent</th></tr></thead><tbody>${rows}</tbody></table></div>${structureEvidencePreviewHtml()}<p class="decision-muted">ACS structure categories do not separately identify ADUs, triplexes or fourplexes. Household size and age do not determine a preferred bedroom count or building type.</p></details></section>`;
}
function decisionDemandHtml(a){
  const q=decisionRecord();
  if(!q)return `<section class="decision-section"><h3><span>4</span> Demand evidence & unmet needs</h3><p>Audited demographic evidence is unavailable for this geography. Construction requirements are unavailable.</p></section>`;
  const p=q.population||{},d=q.demand||{},e=q.evidence||{},v=e.vacancy||{},b=q.backtest||{},x=chasAffordabilityRecord();
  const market=n(v.market),crowd=e.crowding||{},burden=e.burden||{},benchmark=q.benchmark;
  const benchmarkHtml=benchmark?`<p><strong>Independent published benchmark:</strong> ${benchmark.source} (${benchmark.vintage}) projects ${fmt(benchmark.published2030)} people in 2030. Rescaling its published 2025–2030 growth to the current 2025 estimate gives ${fmt(benchmark.rebased2030)}; the current central scenario differs by ${pct(benchmark.differencePct)}. This rebasing is a comparison, not independent validation. <a href="${benchmark.url}" target="_blank" rel="noopener">Published source</a>.</p>`:'';
  const direction=a.demandStatus==='Declining across scenarios'?'Household growth is negative across these scenarios. Decline does not remove affordability, repair or replacement needs.':a.demandStatus==='Direction uncertain'?'The scenarios disagree on the direction of household change. Avoid a single point claim about future demand.':a.demandStatus==='Growing across scenarios'?'Household growth is positive in these scenarios; how much requires new construction remains unverified.':'A usable household-change scenario is unavailable.';
  return `<section class="decision-section" aria-label="Demand and housing problems"><h3><span>4</span> Demand evidence & unmet needs</h3><div class="decision-stats">${decisionStat('Population · 2025',fmt(p.p2025),'Census estimate')}${decisionStat('Population · 2030',scenarioRange(p.p2030),'Conditional continuation envelope')}${decisionStat('Household change · 2025–2030',scenarioRange(d.hhChange,true),'Conditional scenarios; not unit requirements')}${decisionStat('Construction required','Unavailable','Completions and net supply not verified')}</div><p>${direction}</p><div class="decision-problem"><strong>Existing problems, counted separately</strong><p>${fmt(crowd.renter)} renter homes are overcrowded${n(crowd.renterMOE)===null?'':` (90% margin of error ±${fmt(crowd.renterMOE)})`}; ${fmt(burden.above30)} renter households have cost burden ≥30%. ${x?`${fmt(x.lowProblem)} lower-income renter households have HUD CHAS housing problems${x.approx?' (approximate rounded-county sum)':''}.`:''} These groups overlap and must not be added or converted to new homes required.</p></div><details><summary>Demand method, vacancies, backtest & observed households</summary><p><strong>Scenario method:</strong> ${d.householdAssumption||'Household size and group-quarters share held constant; historical demographic components continued.'} These scenarios are independent of the selected policy and its Low / Default / High assumptions.</p><p>ACS households: ${fmt(d.hhACS)}. Synthetic 2025 household base: ${fmt(d.hh2025Proxy)}; this is not a published 2025 household estimate. Each geography is estimated directly: county and state household proxies do not sum exactly because household size and group-quarters shares differ; population components reconcile separately. Central scenario: ${fmt(p.p2030?.central)} people and ${signedUnits(d.hhChange?.central)} household change.</p><p><strong>2025 population components:</strong> births ${fmt(p.births2025)}; deaths ${fmt(p.deaths2025)}; domestic migration ${signedUnits(p.domesticMigration2025)}; international migration ${signedUnits(p.internationalMigration2025)}. Age structure is observed context; this is not a cohort-component forecast.</p><p><strong>Vacancies:</strong> ${fmt(market)} for rent or for sale; ${fmt(v.seasonal)} seasonal; ${fmt(v.other)} other vacant. Listed market vacancies are not verified usable, affordable or available to projected households. Seasonal and other vacancies are not automatically available supply.</p><p><strong>Requirement accounting:</strong> household growth + justified replacement + independently measured suppressed formation + vacancy adjustment − usable existing supply − verified expected net completions. Several terms are missing, so no new-construction total or shortage is reported. Crowding and CHAS problems are diagnostic evidence, not additive construction terms.</p><p><strong>Historical backtest:</strong> ${n(b.ape)===null?'Unavailable here':`2021–2022 component continuation from the 2022 population base to 2025 absolute percentage error: ${pct(b.ape)}; no-growth benchmark: ${pct(b.naiveAPE)}.`} This short, same-vintage holdout does not validate the current component scenarios or establish prediction intervals.</p>${benchmarkHtml}${integratedEvidenceHtml()}${chasAffordabilityPreviewHtml()}</details></section>`;
}
function decisionFeasibilityHtml(a){
  const flags=decisionRecord()?.flags||[];
  const uncertainty=flags.length?`<ul class="decision-flags">${flags.map(f=>`<li>${f}</li>`).join('')}</ul>`:'<p class="decision-muted">No local validation is supplied. ACS estimates are sampled; scenario bounds are not confidence intervals.</p>';
  return `<section class="decision-section" aria-label="Development feasibility"><h3><span>5</span> Feasibility & uncertainty <small>${a.readiness}</small></h3><p>Neither a housing-pressure signal nor modeled production verifies a legal, financeable development. No parcel has been certified as buildable.</p><details><summary>Show evidence rules & missing local checks</summary><div class="decision-rules">${a.rules.map(r=>`<div><strong>${r.test}</strong><span class="rule-status ${r.status==='Proxy present'?'proxy':''}">${r.status}</span><p>${r.meaning}</p></div>`).join('')}</div><p class="decision-muted">Rules use presence, absence or missingness of measured inputs. They are not weighted scores, causal effect estimates or a ranking of policy suitability.</p>${uncertainty}</details></section>`;
}

function profileHtml(){
  const c=countyRec(),s=stateRec();
  if(stateAbbr==='US')return `<div class="section"><h3>National profile</h3><p>The simulator applies one consistent state-level framework across all 50 states and the District of Columbia.</p></div><div class="info-list"><div class="info-row"><span>Final 2025 permits</span><span>${fmt(BASE.annual)}</span></div><div class="info-row"><span>Five-year benchmark</span><span>${fmt(BASE.fiveYear)}</span></div><div class="info-row"><span>States + DC</span><span>51</span></div><div class="info-row"><span>Counties represented</span><span>3,144</span></div></div>`;
  if(c){const jobs=yes(c.construction_qcew_disclosed)&&n(c.construction_employment)!==null?fmt(c.construction_employment):'Not available';return `<div class="section"><h3>${c.county_full_name||c.county_name}</h3><p>County estimates are supporting local evidence inside ${s.state_name}; the state result remains authoritative.</p></div><div class="info-list"><div class="info-row"><span>Housing units</span><span>${fmt(c.housing_units)}</span></div><div class="info-row"><span>2025 county permits</span><span>${yes(c.bps_available)?fmt(c.baseline_annual_units):'Not available'}</span></div><div class="info-row"><span>Detached single-family share</span><span>${fractionPct(c.sf_detached_share)}</span></div><div class="info-row"><span>Five-year house-price change</span><span>${pct(c.hpi_5yr_change_pct)}</span></div><div class="info-row"><span>Corrected TOD housing exposure</span><span>${fractionPct(recordTransitExposure(c))}</span></div><div class="info-row"><span>Construction employment</span><span>${jobs}</span></div></div><div class="callout"><strong>Context only:</strong> FHFA house-price movement and BLS construction employment help describe local conditions but do not directly determine every policy result.</div>`;}
  const jobs=yes(s.construction_qcew_state_disclosed)&&n(s.construction_employment_state)!==null?fmt(s.construction_employment_state):'Not available',sf=n(s.detached_sf_units)&&n(s.housing_units)?100*n(s.detached_sf_units)/n(s.housing_units):null;return `<div class="section"><h3>${s.state_name}</h3><p>The state profile combines observed housing stock, final permit production, market context, transit exposure, and data coverage.</p></div><div class="info-list"><div class="info-row"><span>Housing units</span><span>${fmt(s.housing_units)}</span></div><div class="info-row"><span>Detached single-family share</span><span>${pct(sf)}</span></div><div class="info-row"><span>Final 2025 permits</span><span>${fmt(s.baseline_annual_units)}</span></div><div class="info-row"><span>Five-year benchmark</span><span>${fmt(s.baseline_5yr_units)}</span></div><div class="info-row"><span>Five-year house-price change</span><span>${pct(s.hpi_5yr_change_pct)}</span></div><div class="info-row"><span>Corrected TOD housing exposure</span><span>${fractionPct(recordTransitExposure(s))}</span></div><div class="info-row"><span>Major-transit records</span><span>${fmt(s.major_transit_points??s.major_transit_stop_count)}</span></div><div class="info-row"><span>Construction employment</span><span>${jobs}</span></div><div class="info-row"><span>County BPS stock coverage</span><span>${fractionPct(s.bps_housing_coverage_share)}</span></div></div>`;
}
function policySourceHtml(key){
  if(key==="adu"||key==="missing_middle")return `U.S. Census Bureau, American Community Survey 2024 5-Year, Table B25024, variable B25024_E002 (1-unit detached housing units).`;
  if(key==="tod")return `U.S. Census Bureau Building Permits Survey (Final Annual 2025); ACS 2024 5-Year Table B25001, variable B25001_E001 (tract housing units); BTS National Transit Map 2026; and Census TIGER/Line tract geography.`;
  return `U.S. Census Bureau Building Permits Survey 2025: permitted housing units and permit valuation. County permit valuation per unit is the development-value proxy; final Census state permit totals define the authoritative state baseline.`;
}
function fullFormulaText(key){
  if(key==="adu")return `County ADU additions = round(detached stock × 5-year take-up). State = sum of individually rounded county additions; national = sum of states/DC. Rounding uses nearest integer, ties to even.`;
  if(key==="missing_middle")return `County missing-middle additions = round(detached stock × 5-year redevelopment share × net added units per redevelopment). State = sum of individually rounded county additions; national = sum of states/DC. Rounding uses nearest integer, ties to even.`;
  if(key==="tod")return `County and state TOD additions = round(5-year permit baseline × TOD exposure share × uplift), independently at each level; state TOD is not a sum of county rounded outputs. National = sum of state outputs. Rounding is nearest integer, ties to even. TOD exposure share = Σ(tract housing units × tract land-area share within 0.5 mile of qualifying transit) ÷ Σ(tract housing units).`;
  if(key==="parking")return `County parking additions = round(5-year baseline × affected share × min[30%, (spaces avoided × cost per space) ÷ project-value proxy] × elasticity). State = round(sum of rounded county additions × state reconciliation factor); national = sum of states/DC. Rounding is nearest integer, ties to even.`;
  return `County fee additions = round(5-year baseline × min[30%, fee savings ÷ project-value proxy] × elasticity); savings = $50,000 × 50% = $25,000. State = round(sum of rounded county additions × state reconciliation factor); national = sum of states/DC. Rounding is nearest integer, ties to even.`;
}
function actualEquationHtml(){
  const r=policyRecord(),m=metric();
  if(stateAbbr==="US")return `<div class="equation-box"><strong>For the United States</strong><span>National result = sum of the 51 state/DC results calculated under the same selected assumptions.</span><code>Σ state modeled additions = ${m.added===null?'N/A':'+'+fmt(m.added)} homes</code></div>`;
  if(!r)return '';
  if(policyKey==="adu"){
    const stock=countyFips?n(r.adu_stock_base??r.sf_detached_units):n(r.detached_sf_units),rate=assumptionNumber("ADU 5-year take-up");
    if(!countyFips)return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>Σ county round(detached county stock × ${pct(rate*100,2)}) = ${fmt(m.added)} added units</code><span>The state stock is ${fmt(stock)}. Summing county rounded outputs differs from directly rounding this state stock. Rounding uses nearest integer, ties to even.</span></div>`;
    return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>round(${fmt(stock)} × ${pct(rate*100,2)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code></div>`;
  }
  if(policyKey==="missing_middle"){
    const stock=countyFips?n(r.missing_middle_stock_base??r.sf_detached_units):n(r.detached_sf_units),rate=assumptionNumber("Missing-middle 5-year redevelopment share"),net=assumptionNumber("Missing-middle net additional units per redevelopment");
    if(!countyFips)return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>Σ county round(detached county stock × ${pct(rate*100,3)} × ${fmt(net,1)}) = ${fmt(m.added)} added units</code><span>The state stock is ${fmt(stock)}. County outputs are rounded before aggregation; rounding uses nearest integer, ties to even.</span></div>`;
    return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>round(${fmt(stock)} × ${pct(rate*100,3)} × ${fmt(net,1)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code></div>`;
  }
  if(policyKey==="tod"){
    const b=baseline(r),share=recordTransitExposure(r),uplift=assumptionNumber("TOD production uplift in exposed areas");
    return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>round(${fmt(b)} × ${fractionPct(share,2)} × ${pct(uplift*100,1)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code><span>The exposure share uses the final area-weighted tract-polygon method.</span></div>`;
  }
  if(policyKey==="parking"){
    const affected=assumptionNumber("Parking reform share of baseline development affected"),spaces=assumptionNumber("Parking spaces avoided per affected unit"),cost=assumptionNumber("Parking construction cost per avoided space"),elasticity=assumptionNumber("Parking cost-to-supply elasticity");
    if(countyFips){
      const b=baseline(r),value=n(r.scenario_cost_base),costShare=value?Math.min(.30,(spaces*cost)/value):null;
      return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>round(${fmt(b)} × ${pct(affected*100,1)} × min[30%, (${fmt(spaces,1)} × $${fmt(cost)}) ÷ $${fmt(value)}] × ${fmt(elasticity,2)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code><span>Modeled project-cost reduction share: ${fractionPct(costShare,2)}.</span></div>`;
    }
    return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><span>State results aggregate county-level cost calculations and are reconciled to the final 2025 Census state permit baseline.</span><code>round(Σ rounded county parking additions × ${fmt(r.reconciliation_factor,10)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code><span>Selected assumptions: ${pct(affected*100,0)} affected; ${fmt(spaces,1)} spaces avoided; $${fmt(cost)} per space; elasticity ${fmt(elasticity,2)}.</span></div>`;
  }
  const savings=assumptionNumber("Development fee savings per unit"),elasticity=assumptionNumber("Development fee cost-to-supply elasticity");
  if(countyFips){
    const b=baseline(r),value=n(r.scenario_cost_base),costShare=value?Math.min(.30,savings/value):null;
    return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><code>round(${fmt(b)} × min[30%, $${fmt(savings)} ÷ $${fmt(value)}] × ${fmt(elasticity,2)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code><span>Modeled project-cost reduction share: ${fractionPct(costShare,2)}.</span></div>`;
  }
  return `<div class="equation-box"><strong>Using ${placeName()}'s values</strong><span>State results aggregate county-level cost calculations and are reconciled to the final 2025 Census state permit baseline.</span><code>round(Σ rounded county fee additions × ${fmt(r.reconciliation_factor,10)}) = ${m.added===null?'N/A':fmt(m.added)} added homes</code><span>Selected assumptions: $${fmt(savings)} savings per unit; elasticity ${fmt(elasticity,2)}.</span></div>`;
}
function calculationHtml(){const p=POLICIES[policyKey];return `<div class="section"><h3>1. What the reform changes</h3><p>${p.benchmark}</p></div><div class="section"><h3>2. Data used + exact source</h3><p><span class="chip observed">Observed</span>${policySourceHtml(policyKey)}</p></div><div class="section"><h3>3. Proxy / model bridge</h3><p>${p.proxy}</p></div><div class="section"><h3>4. Selected assumption</h3><p><span class="chip assumed">Assumed</span>${capital(level)}: ${assumptionText()}</p></div><div class="section"><h3>5. Full formula</h3><p>${fullFormulaText(policyKey)}</p>${actualEquationHtml()}</div><div class="section"><h3>6. Result</h3><p><span class="chip modeled">Modeled</span>${decisionBrief()}</p></div><div class="section"><h3>7. Limitation</h3><p>${p.limitation}</p></div>`;}
function methodologyTerms(key){
  if(key==="adu")return [["Detached single-family stock","ACS count of existing 1-unit detached housing; used as the nationally consistent eligibility proxy."],["5-year take-up rate","Assumed share of that stock adding one ADU over five years."],["Added homes","Conditional additional dwelling-unit equivalents; completed net additions are not verified."]];
  if(key==="missing_middle")return [["Detached single-family stock","Nationally consistent proxy for properties potentially affected by single-family-only reform."],["Redevelopment share","Assumed portion of the proxy stock redeveloping during the five-year horizon."],["Net additional units","New units created after subtracting the original home; e.g., replacing one home with a triplex creates +2 net units."]];
  if(key==="tod")return [["5-year baseline","Final 2025 permit pace carried forward for five years."],["TOD housing exposure share","Housing-weighted share derived from the portion of each tract's land area within 0.5 mile (804.672 m) of qualifying fixed-guideway transit."],["Production uplift","Conditional increase applied only to the modeled transit-exposed portion of baseline production."]];
  if(key==="parking")return [["5-year baseline","Baseline housing production over five years."],["Affected share","Assumed share of baseline development for which parking minimums are binding."],["Spaces avoided","Parking spaces not required per affected unit."],["Cost per space","Modeled construction cost avoided for each parking space."],["Project-value proxy","County permit valuation per permitted unit, with state fallback where needed."],["Elasticity","Conditional conversion of project-cost reduction into additional housing supply."],["30% cap","Maximum cost-reduction share allowed in the model to prevent extreme ratios."]];
  return [["5-year baseline","Baseline housing production over five years."],["Fee savings","Challenge benchmark: $50,000 total fees reduced by 50%, yielding $25,000 savings per unit."],["Project-value proxy","County permit valuation per permitted unit, with state fallback where needed."],["Elasticity","Conditional conversion of fee-related cost reduction into additional housing supply."],["30% cap","Maximum modeled cost-reduction share."]];
}
function methodologySteps(key){
  if(key==="adu")return ["Read ACS detached single-family housing stock.","Select Low, Default, or High five-year take-up rate.","Calculate each county stock × take-up and round to nearest integer, ties to even. Sum the county rounded additions for a state; sum states for the nation.","Add modeled homes to the five-year baseline for the with-policy total."];
  if(key==="missing_middle")return ["Read ACS detached single-family housing stock.","Apply the selected five-year redevelopment share.","Multiply redevelopments by the selected net additional units per redevelopment.","Round county additions to nearest integer, ties to even. State increments sum these rounded counties; national increments sum states. Add the increment to the five-year benchmark."];
  if(key==="tod")return ["Create 0.5-mile buffers around qualifying National Transit Map fixed-guideway transit records.","Intersect those buffers with Census tract polygons in an equal-area projection.","For each tract, multiply housing units by the share of tract land inside the buffer; aggregate this to the state/county TOD housing exposure share.","Multiply the five-year permit baseline by the exposure share and selected production uplift, then round to nearest integer, ties to even. Calculate the state TOD formula directly, rather than summing county TOD outputs; national increments sum states."];
  if(key==="parking")return ["Start with the five-year permit baseline.","Apply the selected share of development assumed to face a binding parking requirement.","Estimate avoided parking cost as spaces avoided per unit × cost per space.","Divide avoided cost by the project-value proxy and cap the ratio at 30%.","Apply the selected supply-response elasticity and round to whole homes. State = round(sum of individually rounded county additions × state reconciliation factor). Round nearest integer, ties to even; the factor is final state annual permits divided by the county annual sum."];
  return ["Start with the five-year permit baseline.","Use the challenge benchmark of $25,000 fee savings per unit.","Divide savings by the project-value proxy and cap the cost-reduction ratio at 30%.","Apply the selected supply-response elasticity and round to whole homes. State = round(sum of individually rounded county additions × state reconciliation factor). Round nearest integer, ties to even; the factor is final state annual permits divided by the county annual sum."];
}
function methodologyParagraph(key){
  if(key==="adu")return `The ADU scenario estimates the number of additional homes that could be created if accessory dwelling units are allowed and a portion of existing detached single-family properties choose to add one. The model uses ACS 2024 5-Year Table B25024 one-unit detached housing as a nationally consistent proxy for potentially affected housing stock. Each county increment is the stock multiplied by a five-year ADU take-up assumption and rounded, ties to even. A state sums its county rounded increments; the nation sums states. This is a conditional policy scenario rather than a forecast because actual production also depends on local rules, parcel conditions, utilities, financing, permitting, construction costs, and homeowner participation.`;
  if(key==="missing_middle")return `The Missing Middle scenario estimates additional housing that could result from allowing 2–6 unit forms on properties represented by existing detached single-family housing. Because complete nationwide parcel-level zoning is not available, ACS detached single-family stock is used as a transparent national proxy. Each county increment is the proxy stock multiplied by a five-year redevelopment share and net additional units per redevelopment, then rounded ties to even. States sum county rounded increments; the nation sums states. Legal capacity does not imply immediate redevelopment, so the result should be interpreted as a sensitivity scenario rather than a forecast.`;
  if(key==="tod")return `The Transit-Oriented Density scenario estimates additional housing associated with greater allowable residential density near major fixed-guideway transit. It combines the 2025 Census permit baseline, ACS tract housing units, BTS National Transit Map records, and Census tract geography. The final method is area-weighted: each tract's housing is weighted by the share of tract land within one-half mile of qualifying transit, producing a housing exposure share. Added homes equal the five-year baseline multiplied by that exposure share and the selected production uplift. Transit exposure is not parcel-level zoning eligibility and does not mean every exposed property will redevelop.`;
  if(key==="parking")return `The Parking Reform scenario estimates additional housing associated with reducing or eliminating residential parking minimums. The model begins with the five-year permit baseline and assumes only a selected share of development faces a binding parking requirement. Avoided parking costs are estimated from spaces avoided and cost per space, compared with a permit-valuation-based project-value proxy, capped at a 30% cost reduction, and translated into a conditional production response with an elasticity assumption. The scenario does not assume developers provide zero parking or that all cost savings become housing.`;
  return `The Development Fee scenario estimates the potential housing-production response to a 50% reduction in development fees. Consistent with the challenge benchmark, the model begins with $50,000 in fees per unit and therefore uses $25,000 in modeled savings. The savings are compared with a permit-valuation-based project-value proxy, capped at a 30% cost reduction, and converted into a conditional production response using the selected elasticity. The result does not assume every dollar of fee savings directly creates a new home.`;
}
function mapMethodologyHtml(){
  const rows=[
    ["ADU","Where ADU reform could add the most housing relative to that area's current housing-production pace.","Darker areas have a larger detached single-family stock relative to how much housing they currently permit."],
    ["Missing Middle","Where allowing 2–6 unit housing could have the greatest modeled effect relative to current production.","It uses the detached single-family redevelopment opportunity, redevelopment assumption, and net added units."],
    ["Transit Density","Where increasing density near major transit could increase housing production the most relative to the current baseline.","Darker areas combine stronger transit exposure with a larger modeled TOD production effect."],
    ["Parking","Where reducing parking requirements could create the largest percentage increase in housing production.","It reflects baseline development, affected-project share, avoided parking cost, project-value proxy, and supply response."],
    ["Fees","Where reducing development fees could have the largest percentage effect on housing production.","It reflects the $25,000 modeled savings relative to development value and the supply-response assumption."]
  ].map(r=>`<tr><th>${r[0]}</th><td><strong>${r[1]}</strong> ${r[2]}</td></tr>`).join('');
  const swatches=MAP_CLASSES.map(c=>`<span class="method-swatch"><i style="background:${c.color}"></i><b>${c.label}</b><small>${c.meaning.replace(' modeled impact','')}</small></span>`).join('');
  return `<section class="map-methodology"><h3>How to read the maps</h3><p>The map uses one comparable measure for every reform: <strong>modeled policy impact = possible added homes ÷ five-year current-rules housing-production baseline × 100</strong>. The same class breaks and the same colors are used for ADU, Missing Middle, Transit Density, Parking, and Fees, so a darker geography always means a larger modeled percentage increase relative to its current production pace.</p><div class="method-map-scale">${swatches}<span class="method-swatch"><i class="missing-demo"></i><b>No baseline</b><small>Not comparable</small></span></div><p class="map-method-note"><strong>Why some maps can still look similar:</strong> that can be a real model result. ADU and Missing Middle share detached single-family housing as a key geographic base; Parking and Fees both depend on baseline development and a project-value proxy. The common scale preserves those real similarities while making differences in magnitude visible.</p><div class="map-meaning-table-wrap"><table class="map-meaning-table"><thead><tr><th>Policy</th><th>What the map tells the user</th></tr></thead><tbody>${rows}</tbody></table></div><p class="map-method-note"><strong>County treatment:</strong> county maps are supporting local evidence. If a usable county Building Permits Survey baseline is unavailable, the county is shown with a gray hatch rather than treated as zero. State results remain authoritative.</p><p class="map-method-note"><strong>Cartographic presentation:</strong> the tool uses a normalized percentage for choropleth shading and a consistent light-to-dark scale across comparable maps, following U.S. Census Bureau and Esri visualization guidance. <a href="https://www.census.gov/about/policies/quality/standards/standarde2.html" target="_blank" rel="noopener">Census reporting standard</a> · <a href="https://www.esri.com/arcgis-blog/products/arcgis-online/mapping/normalization-for-choropleth-maps" target="_blank" rel="noopener">Esri normalization guidance</a>.</p></section>`;
}

function methodologyHtml(){
  const blocks=POLICY_KEYS.map(key=>{const p=POLICIES[key],terms=methodologyTerms(key).map(([a,b])=>`<div class="term-row"><dt>${a}</dt><dd>${b}</dd></div>`).join(''),steps=methodologySteps(key).map(x=>`<li>${x}</li>`).join('');return `<details class="method-policy" ${key===policyKey?'open':''}><summary>${p.name}</summary><div class="method-policy-body"><h4>What the policy means</h4><p>${p.benchmark}</p><h4>What its map tells the user</h4><p>${policyMapMeaning(key)}</p><h4>Full formula</h4><div class="formula-box">${fullFormulaText(key)}</div><h4>What every term means</h4><dl class="term-grid">${terms}</dl><h4>Source data</h4><p>${policySourceHtml(key)}</p><h4>How the calculation works</h4><ol class="method-steps">${steps}</ol><h4>Methodology paragraph</h4><p>${methodologyParagraph(key)}</p><h4>Key limitation</h4><p>${p.limitation}</p></div></details>`;}).join('');
  return `<div class="methodology-intro"><h3>Model methodology</h3><p>All outputs are conditional five-year estimates under transparent Low, Default, and High assumptions; they are not guaranteed forecasts. State results are authoritative and county estimates are supporting local evidence. The sections below document the comparable maps and five benchmark reforms, including formulas, terms, source data, mechanics, and limitations. Policies are ranked by modeled five-year additional units within the selected geography; no demographic weights enter the policy impacts. Census population, household, age, bedrooms, rents and overcrowding are interpreted separately in Result.</p></div>${mapMethodologyHtml()}${blocks}`;
}
// ---------- Population & housing-needs evidence layer ----------
// Census population estimates (2025) + ACS 2020-2024 five-year. This layer
// does not modify baseline permits or any policy output / sensitivity formula.
function hnRecord(){
  const source=window.HOUSING_NEEDS||{};
  if(countyFips)return (source.county||{})[countyFips]||null;
  if(stateAbbr==='US')return source.national||null;
  const s=stateRec();return s?(source.state||{})[s.state_fips]||null:null;
}
function hnRate(a,b){const x=n(a),y=n(b);return x===null||y===null||y<=0?null:100*x/y;}
function hnMoney(v){const x=n(v);return x===null?'Not available':'$'+fmt(x);}
function hnRow(label,value){return `<div class="info-row"><span>${label}</span><span>${value}</span></div>`;}
/* Display adapter for the selected Decision Card. Production functions are unchanged. */
const FINAL_NAMES={adu:'ADU · an extra home on a lot',missing_middle:'Missing middle · small buildings',fee:'Fees · lower building charges',tod:'Transit · homes near major stops',parking:'Parking · fewer required spaces'};
const FINAL_PARAMETERS={
  adu:[['ADU 5-year take-up','Detached homes adding an ADU','share']],
  missing_middle:[['Missing-middle 5-year redevelopment share','Detached homes redeveloped','share'],['Missing-middle net additional units per redevelopment','Net extra homes per redevelopment','count']],
  tod:[['TOD production uplift in exposed areas','Extra production in the transit-exposed portion','share']],
  parking:[['Parking reform share of baseline development affected','New development affected','share'],['Parking spaces avoided per affected unit','Spaces avoided per affected home','decimal'],['Parking construction cost per avoided space','Cost per avoided space','money'],['Parking cost-to-supply elasticity','Extra housing for each 1% of modeled cost saved','response']],
  fee:[['Development fee savings per unit','Fee saving per home','money'],['Development fee cost-to-supply elasticity','Extra housing for each 1% of modeled cost saved','response']]
};
function uiEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function assumptionMeaning(atLevel=level){
  const a=name=>n(findAssumption(name)?.[atLevel]);
  if(policyKey==='adu')return `Assume ${fmt(a('ADU 5-year take-up')*1000,atLevel==='low'?0:0)} in every 1,000 detached homes adds an ADU over five years.`;
  if(policyKey==='missing_middle')return `Assume ${fmt(a('Missing-middle 5-year redevelopment share')*2000)} in 2,000 detached homes redevelop, adding ${fmt(a('Missing-middle net additional units per redevelopment'))} net home(s) each over five years.`;
  if(policyKey==='tod')return `Assume ${pct(a('TOD production uplift in exposed areas')*100,0)} more housing in the transit-exposed part of the permit benchmark.`;
  const response=a(policyKey==='parking'?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
  if(policyKey==='parking')return `Assume ${pct(a('Parking reform share of baseline development affected')*100,0)} of projects is affected; each 1% modeled cost saving brings ${fmt(response,1)}% more housing in that part.`;
  return `The fee saving stays $25,000 per home. Assume ${fmt(response,1)}% more housing for each 1% of modeled costs saved.`;
}
function original_numericCalculationSteps(){
  const m=metric(),a=decisionAssessment(),r=policyRecord(),county=Boolean(countyFips);
  const suffix=m.added===null?'Not available':fmt(m.added);
  if(m.added===null)return ['A required local model input is missing.','No production estimate is reported; missing does not mean zero.'];
  if(stateAbbr==='US')return ['Calculate each state and DC using the same selected assumptions.',`Add the 51 state/DC results: ${suffix} possible extra homes.`];
  if(!county&&['adu','missing_middle'].includes(policyKey))return [`Calculate and round each county’s ${policyKey==='adu'?'ADU':'redevelopment'} result.`,`Add the rounded county results: ${suffix} possible extra homes.`];
  if(!county&&['parking','fee'].includes(policyKey))return ['Calculate each county’s cost-saving response separately.',`Adjust the county sum to the state permit benchmark: ${suffix} possible extra homes.`];
  if(policyKey==='adu')return [`${fmt(a.facts.detached)} detached homes × ${pct(assumptionNumber('ADU 5-year take-up')*100,1)} assumed take-up.`,`Round the model result to ${suffix} additional homes.`];
  if(policyKey==='missing_middle')return [`${fmt(a.facts.detached)} × ${pct(assumptionNumber('Missing-middle 5-year redevelopment share')*100,2)} redevelopment × ${fmt(assumptionNumber('Missing-middle net additional units per redevelopment'))} net extra homes.`,`Round the model result to ${suffix} additional homes.`];
  if(policyKey==='tod')return [`${fmt(m.baseline)} × ${fractionPct(a.facts.transit,2)} transit exposure × ${pct(assumptionNumber('TOD production uplift in exposed areas')*100,0)} uplift.`,a.facts.transit===0?'No qualifying exposure is measured here, so this scenario gives zero additions.':`Round the model result to ${suffix} additional homes.`];
  const cost=n(r?.scenario_cost_base);
  if(cost===null||cost<=0||m.baseline===null)return ['A usable local permit benchmark or cost comparison is missing.','The cost-based result cannot be estimated from these inputs.'];
  const saving=policyKey==='fee'?assumptionNumber('Development fee savings per unit'):assumptionNumber('Parking spaces avoided per affected unit')*assumptionNumber('Parking construction cost per avoided space');
  const share=Math.min(.30,saving/cost),response=assumptionNumber(policyKey==='fee'?'Development fee cost-to-supply elasticity':'Parking cost-to-supply elasticity');
  return [`$${fmt(saving)} ÷ $${fmt(cost)} ≈ ${pct(share*100,2)} modeled saving${saving/cost>.3?' (30% cap applied)':''}.`,`${fmt(m.baseline)} × ${policyKey==='parking'?pct(assumptionNumber('Parking reform share of baseline development affected')*100,0)+' affected × ':''}${pct(share*100,2)} × ${fmt(response,1)} ≈ ${suffix} extra homes after rounding.`];
}
function shortCardNote(card,index){
  const labels={
    'Existing detached homes':'ACS 2020–24 · stock proxy, not checked sites.',
    'Households with one or two people':'ACS 2020–24 · size does not establish preference.',
    'Renters spending 30%+ on housing':'ACS 2020–24 · among renters with calculable costs.',
    'Detached stock adding an ADU':'Assumed share over five years.',
    'Renter homes with crowding':'ACS 2020–24 · more than one person per room.',
    'Renter households with 3+ people':'ACS 2020–24 · observed households.',
    'Homes in 2–4 unit buildings':'ACS 2020–24 · existing stock, not unmet need.',
    'Housing near qualifying transit':'Area-weighted proxy · not developable land.',
    'Homes in 5+ unit buildings':'ACS 2020–24 · existing multifamily stock.',
    'Five years at the 2025 permit pace':'Reference: 2025 permitted units × five.',
    'Parking cost avoided per affected home':'Assumed spaces avoided × cost per space.',
    'New development affected by reform':'Assumed share; binding local rules unverified.',
    'Construction value used by the model':'Permit valuation per unit; not a full budget.',
    'Fee saving per new home':'Assumed: $50,000 fee reduced by half.',
    'Housing increase per 1% modeled saving':'Assumed response, not an observed local effect.'
  };
  return labels[card.label]||card.note;
}
function original_finalResultView(){
  const m=metric(),assessment=decisionAssessment(),record=decisionRecord(),r=policyRecord();
  const guide=window.buildPolicyEvidence({policy:policyKey,level,record,policyRecord:r,assessment,assumptions:ASSUMPTIONS,scope:countyFips?'county':stateAbbr==='US'?'national':'state'});
  const format=card=>{
    let value=card.kind==='pct'?pct(card.value):card.kind==='currency'?(n(card.value)===null?'Not available':'$'+fmt(card.value)):card.kind==='decimal'?fmt(card.value,1):card.kind==='text'?card.value:fmt(card.value);
    let note=shortCardNote(card);
    if(card.label==='Renter homes with crowding'&&n(record?.evidence?.crowding?.renterMOE)!==null){value+=' ±'+fmt(record.evidence.crowding.renterMOE);note='ACS estimate ±90% margin; more than one person per room.';}
    return {...card,value,note};
  };
  const facts=guide.cards.map(format);
  const names={adu:{focusTitle:'Check suitable lots and owner interest',mechanism:'An ADU adds a separate home on an existing lot.',forms:'One detached or semi-detached ADU, at least 600 sq ft.',check:'Lot eligibility, utilities, finance and affordable rents still need local checks.'},missing_middle:{focusTitle:'Match small buildings to household needs',mechanism:'Allow 2–6 homes where single-family-only rules apply.',forms:'Duplexes, triplexes, fourplexes, townhouses and small apartments.',check:'Check local zoning, net additions, costs and displacement of current residents.'},tod:{focusTitle:assessment.facts.transit===0?'No qualifying transit measured here':'Check places near useful transit',mechanism:assessment.facts.transit===0?'The measured exposure is zero; other transit and housing needs can still exist.':'More density near qualifying major stops could allow more housing.',forms:'Small or larger apartment buildings near transit.',check:'Proximity does not verify site capacity, legal density, safe access or affordable rents.'},parking:{focusTitle:'Check whether parking rules add costs',mechanism:'Allow less parking where builders would otherwise provide fewer spaces.',forms:'Several housing types; parking relief does not choose bedrooms or rents.',check:'Check binding parking rules, actual parking reduction and a complete project budget.'},fee:{focusTitle:'Check fees and project costs',mechanism:'Reduce the challenge’s assumed $50,000 fee by half.',forms:'Several housing types; lower fees do not set rents.',check:'Check actual local fees, full project costs and infrastructure funding.'}};
  const g=names[policyKey];
  const annual=assessment.facts.annual;
  let baselineHelp=annual===null?'The five-year permit benchmark is unavailable; it is not existing housing stock.':`${fmt(annual)} units permitted in 2025 × 5 years = ${fmt(m.baseline)}. This is not the number of existing homes.`;
  let percentExplanation=m.pct===null?'A percentage needs a nonzero permit benchmark; it cannot be calculated here.':`${fmt(m.added)} extra ÷ ${fmt(m.baseline)} reference units × 100 = ${pct(m.pct)} more than the benchmark.`;
  if(m.pct!==null&&m.pct>100)percentExplanation+=' A small reference number can make this percentage very large.';
  let localNeed='New construction needed is unverified; affordability problems do not equal missing homes.';
  if(assessment.demandStatus==='Declining across scenarios')localNeed='Household scenarios decline by 2030; affordability and repair needs may remain.';
  else if(assessment.demandStatus==='Direction uncertain')localNeed='Household growth is uncertain. Existing affordability and space needs still matter.';
  else if(assessment.demandStatus==='Growing across scenarios')localNeed='Households may grow by 2030; the number requiring new construction is unverified.';
  const hh=record?.demand?.hhChange;
  if(n(hh?.low)!==null&&n(hh?.high)!==null){
    const change=x=>x<0?fmt(Math.abs(x))+' fewer':x>0?fmt(x)+' more':'no change';
    localNeed=`2030 household scenarios: ${change(hh.low)} to ${change(hh.high)}. New-building need: unknown.`;
  }
  const stock=n(record?.evidence?.stock?.total??r?.housing_units);
  return {place:placeName(),scope:m.scope,policyKey,policyTitle:FINAL_NAMES[policyKey],level:capital(level),
    added:m.added===null?'Not available':'+'+fmt(m.added),baseline:fmt(m.baseline),total:fmt(m.total),pct:pct(m.pct),
    baselineLabel:'Five-year permit benchmark',baselineHelp,totalHelp:m.baseline!==null&&m.added!==null?`${fmt(m.baseline)} + ${fmt(m.added)}`:'Benchmark + possible extra homes',percentExplanation,
    currentHomes:stock===null?'':fmt(stock)+' (ACS 2020–24)',focusTitle:g.focusTitle,mechanism:g.mechanism,forms:g.forms,
    observations:facts.slice(0,2),evidenceCards:facts.slice(2),assumptionMeaning:assumptionMeaning(),calculationSteps:numericCalculationSteps(),
    localNeed,limitations:[g.check],sourceNote:policyKey==='tod'?'Sources: ACS 2020–24 · Census permits 2025 · supplied transit exposure.':'Sources: ACS 2020–24 · Census permits 2025 · stated policy assumptions.',
    isMissing:m.added===null,isZeroBaseline:m.baseline===0||m.baseline===null};
}
function resultHtml(){return window.renderDecisionCard(finalResultView());}
function assumptionTableHtml(){
  const rows=FINAL_PARAMETERS[policyKey].map(([name,label,type])=>{
    const values=['low','default','high'].map(l=>{const x=n(findAssumption(name)?.[l]);return type==='money'?'$'+fmt(x):type==='share'?pct(x===null?null:x*100,type==='share'&&x<.01?2:1):type==='response'?pct(x,1):type==='decimal'?fmt(x,1):fmt(x);});
    return `<tr><th>${uiEscape(label)}</th>${values.map(v=>`<td>${uiEscape(v)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="assumption-intro"><p><b>Low, Default and High are three “what if” cases.</b> They use smaller, middle or larger assumed responses. They are not probabilities or confidence levels.</p><p>The model combines published data with these stated assumptions. A successful calculation does not prove the response will happen locally.</p></div><div class="compare-wrap"><table class="assumption-table"><thead><tr><th>Assumption</th><th>Low</th><th>Default</th><th>High</th></tr></thead><tbody>${rows}</tbody></table></div><p class="assumption-selected"><b>${capital(level)} selected:</b> ${uiEscape(assumptionMeaning())}</p>`;
}
function original_finalCalculationHtml(){
  const v=finalResultView();
  return `<section class="final-explain"><h3>How this estimate is calculated</h3><p>${uiEscape(FINAL_NAMES[policyKey])} · ${uiEscape(placeName())}</p>${assumptionTableHtml()}<h4>Selected inputs and calculation</h4><ol class="final-math">${numericCalculationSteps().map(s=>`<li>${uiEscape(s)}</li>`).join('')}</ol>${actualEquationHtml()}<p><b>Percentage increase:</b> ${uiEscape(v.percentExplanation)}</p><p><b>With policy:</b> ${uiEscape(v.totalHelp)} = ${uiEscape(v.total)}. This is a modeled five-year comparison, not future total housing stock.</p><p><b>Limits:</b> ${uiEscape(POLICIES[policyKey].limitation)} Reforms can affect the same projects, so their separate results must not be added.</p></section>`;
}
function original_finalSourcesHtml(){
  const guide=window.buildPolicyEvidence({policy:policyKey,level,record:decisionRecord(),policyRecord:policyRecord(),assessment:decisionAssessment(),assumptions:ASSUMPTIONS,scope:countyFips?'county':stateAbbr==='US'?'national':'state'});
  const defs=guide.cards.map(c=>`<div class="source-definition"><strong>${uiEscape(c.label)}</strong><p>${uiEscape(c.note)}</p></div>`).join('');
  return `<section class="final-explain"><h3>Sources and definitions</h3><p>For ${uiEscape(FINAL_NAMES[policyKey])} in ${uiEscape(placeName())}.</p>${defs}<div class="source-links"><a href="https://www.census.gov/construction/bps/" target="_blank" rel="noopener">Census building permits · 2025</a><a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener">Census ACS · 2020–2024</a>${policyKey==='tod'?'<a href="https://www.bts.gov/national-transit-map" target="_blank" rel="noopener">BTS National Transit Map</a>':''}</div><p>Permits authorize new units; they do not verify completion. ACS counts are survey estimates. Cost assumptions do not establish affordable rents or feasible projects.</p><p><b>Household scenarios:</b> Change is measured from a synthetic 2025 base to 2030. Historical births, deaths and migration continue under alternative time windows, holding household size and the group-quarters share constant. These conditional scenarios are independent of the policy response switch; they are not validated local forecasts or new-home requirements.</p><p>State results are the main policy estimates. County results provide supporting local evidence. National policy results sum all states and DC. Different source periods must not be read as a time trend.</p></section>`;
}
function renderPolicyRail(){document.querySelectorAll('[data-policy]').forEach(button=>{const active=button.dataset.policy===policyKey;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});}
function renderPanel(){
  const previousMethods=$('supportingMethods');
  if(previousMethods)supportingMethodsExpanded=previousMethods.open;
  if(tractRec()){ $('placeBadge').textContent='Tract scenario allocation';$('detailTitle').textContent=placeName();$('detailSub').textContent=FINAL_NAMES[policyKey]+' · '+capital(level)+' response';$('resultPane').innerHTML=tractResultHtml();$('methodologyPane').innerHTML=tractMethodHtml();$('calculationPane').innerHTML=tractCalculationHtml();$('dataPane').innerHTML=combinedSourcesHtml();return;}
  $('placeBadge').textContent=countyFips?'County supporting estimate':stateAbbr==='US'?'States + DC':'State model result';
  $('detailTitle').textContent=placeName();$('detailSub').textContent=FINAL_NAMES[policyKey]+' · '+capital(level)+' response';
  $('mapSubtitle').textContent=FINAL_NAMES[policyKey]+' · '+capital(level)+' response';
  $('resultPane').innerHTML=resultHtml();$('methodologyPane').innerHTML='';$('calculationPane').innerHTML=finalCalculationHtml();$('dataPane').innerHTML=combinedSourcesHtml();
}
function initFinalEvents(){
  document.querySelectorAll('[data-policy]').forEach(button=>button.addEventListener('click',()=>{policyKey=button.dataset.policy;$('policySelect').value=policyKey;syncHash();renderAll();}));
  const dialog=$('assumptionDialog');
  $('assumptionHelp').addEventListener('click',()=>{$('assumptionDialogContent').innerHTML=assumptionTableHtml();dialog.showModal();});
  $('closeAssumptions').addEventListener('click',()=>dialog.close());
  document.addEventListener('click',event=>{
    const button=event.target.closest?.('[data-open-view]');
    if(!button)return;
    const target=button.dataset.openView==='methodology'?'calculation':button.dataset.openView;
    if(!['result','calculation','methodology','graph','data'].includes(target))return;
    currentTab=target;renderTabs();
    const pane=document.querySelector(`[data-pane="${target}"]`);
    if(pane)pane.scrollTop=0;
    document.querySelector(`[data-tab="${target}"]`)?.focus();
  });
}

function renderTabs(){document.querySelectorAll('.tab').forEach(b=>{const a=b.dataset.tab===currentTab;b.classList.toggle('active',a);b.setAttribute('aria-selected',a?'true':'false');});document.querySelectorAll('.tab-pane').forEach(p=>p.classList.toggle('active',p.dataset.pane===currentTab));}
function renderLevels(){document.querySelectorAll('[data-level]').forEach(b=>{const a=b.dataset.level===level;b.classList.toggle('active',a);b.setAttribute('aria-pressed',a?'true':'false');});}
function renderAll(){renderLevels();renderBreadcrumb();renderPolicyRail();renderMap();renderPanel();renderTabs();updateTractGraph();
  const view=metric();const tr=tractRec(),rec=countyRec()||stateRec();
  const policyComparisons=POLICY_KEYS.map(key=>({key,added:tr?n(tr.x?.[key]?.[level]):stateAbbr==='US'?nationalAdded(key,level):added(rec,key,level)}));
  document.dispatchEvent(new CustomEvent('turnout:simulator-changed',{detail:{state:stateAbbr,county:countyFips,tract:tractGeoid,policy:policyKey,level:level,place:placeName(),fiveYearBaseline:view.baseline,fiveYearAdded:view.added,policies:policyComparisons}}));
}

function initEvents(){
  $('stateSelect').addEventListener('change',e=>chooseState(e.target.value));
  $('countySelect').addEventListener('change',e=>{if(stateAbbr==='US'){setNationalMapMode(e.target.value==='@all-us'?'counties':'states');}else{chooseCounty(e.target.value);}});
  $('policySelect').addEventListener('change',e=>{policyKey=e.target.value;syncHash();renderAll();$('resultPane').scrollTop=0;});
  document.querySelectorAll('[data-level]').forEach(b=>b.addEventListener('click',()=>{level=b.dataset.level;syncHash();renderAll();$('resultPane').scrollTop=0;}));
  document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{currentTab=b.dataset.tab;renderTabs();}));
  $('backBtn').addEventListener('click',goBack);
  $('resetBtn').addEventListener('click',()=>{stateAbbr='US';countyFips=null;tractGeoid=null;nationalMapMode='states';stateMapMode='counties';policyKey='adu';level='default';currentTab='result';$('stateSelect').value='US';$('policySelect').value='adu';fillCountySelect();fillTractSelect();syncHash();renderAll();});
  $('shareBtn').addEventListener('click',async()=>{syncHash();try{await navigator.clipboard.writeText(location.href);$('shareBtn').textContent='Copied';setTimeout(()=>$('shareBtn').textContent='Copy view',1400);}catch(e){prompt('Copy this link',location.href);}});
}

async function init(){initEvents();initFinalEvents();fillCountySelect();await applyHash();fillTractSelect();renderAll();if(stateAbbr!=="US")fillCountySelect();}
/* Historical baseline and policy sensitivity. Raw source assets stay unchanged. */
const FORECAST=window.PRODUCTION_FORECAST;
const FORECAST_POLICY=window.FORECAST_POLICY;
const POLICY_EVIDENCE=window.POLICY_EVIDENCE;
if(window.DATA_RELEASE){
  POLICY_EVIDENCE.tod={...POLICY_EVIDENCE.tod,
    source:'Census permit history, ACS 2020–2024 tract housing counts, selected BTS fixed-guideway transit stops and TIGER/Line 2024 tract boundaries. The official reconstruction uses unioned half-mile buffers and tract-area housing weights; its version and source hashes are downloadable.',
    status:'Official exposure reconstruction documented; the assumed production response remains uncalibrated.',
    formula:'Round each state’s baseline × transit-exposure share × uplift. Sum states and DC only when all required estimates are available. Missing exposure remains unavailable.'};
}
const FORECAST_VALIDATION=window.FORECAST_VALIDATION;
function forecastPolicyRecord(rec){return rec?.fips?FORECAST_POLICY.counties[rec.fips]:rec?.state_abbr?FORECAST_POLICY.states[rec.state_abbr]:null;}
function selectedPolicyForecast(){return countyFips?FORECAST_POLICY.counties[countyFips]:stateAbbr==='US'?FORECAST_POLICY.national:FORECAST_POLICY.states[stateAbbr];}
function selectedProductionForecast(){return stateAbbr==='US'?FORECAST.national:FORECAST.states[stateAbbr];}
function added(rec,key,lev){const f=forecastPolicyRecord(rec);return f?n(f.scenarios.central[key][lev]):original_added(rec,key,lev);}
function baseline(rec){const f=forecastPolicyRecord(rec);return f?n(f.bases.central):original_baseline(rec);}
function changePct(rec,key,lev){const b=baseline(rec),a=added(rec,key,lev);return b>0&&a!==null?100*a/b:null;}
function numericCalculationSteps(){
  if(countyFips)return original_numericCalculationSteps();
  const m=metric(),suffix=fmt(m.added),national=stateAbbr==='US';
  if(policyKey==='adu')return [`Each county: detached homes × ${pct(assumptionNumber('ADU 5-year take-up')*100,1)} take-up; round.`,`Add ${national?'all states and DC':'the rounded county results'}: ${suffix} possible extra homes.`];
  if(policyKey==='missing_middle')return [`Each county: detached homes × ${pct(assumptionNumber('Missing-middle 5-year redevelopment share')*100,2)} redevelopment × ${fmt(assumptionNumber('Missing-middle net additional units per redevelopment'))} net extra.`,`Add ${national?'all states and DC':'the rounded county results'}: ${suffix} possible extra homes.`];
  if(policyKey==='tod'&&national)return [`Each state: baseline × transit exposure × ${pct(assumptionNumber('TOD production uplift in exposed areas')*100,0)} uplift.`,`Round states and add DC: ${suffix} possible extra homes.`];
  if(policyKey==='tod')return original_numericCalculationSteps();
  const response=assumptionNumber(policyKey==='fee'?'Development fee cost-to-supply elasticity':'Parking cost-to-supply elasticity');
  return [policyKey==='fee'?`Each county: baseline × min(30%, $25,000 ÷ value/home) × ${fmt(response,1)}.`:`Each county: baseline × affected share × capped saving share × ${fmt(response,1)}.`,`Round counties, adjust state coverage${national?' and add states/DC':''}: ${suffix} extra homes.`];
}
function finalResultView(){
  const v=original_finalResultView(),pf=selectedPolicyForecast(),f=selectedProductionForecast();
  const low=pf?.bases.lower,high=pf?.bases.upper;
  v.baselineLabel='2026–30 permit baseline';
  v.totalLabel=['adu','missing_middle'].includes(policyKey)?'Reference + scenario':'With assumed response';
  v.baselineHelp=countyFips?`Allocated from the state forecast; not separately tested. Historical stress: ${fmt(low)}–${fmt(high)} permits.`:`2000–25 history tested; latest-year pace selected. Historical stress: ${fmt(low)}–${fmt(high)} permits.`;
  if(low===null||low===undefined)v.baselineHelp='County permit allocation unavailable; missing does not mean zero.';
  v.percentExplanation=v.percentExplanation.replace('more than the benchmark','relative to the permit baseline');
  for(const cards of [v.observations,v.evidenceCards])for(const card of cards){
    if(card.label==='Five years at the 2025 permit pace'){
      card.label='Baseline permits · 2026–30';card.value=fmt(pf?.bases.central);
      card.note=countyFips?'Allocated from state forecast; county history untested.':'Selected using historical state permit tests.';
    }
  }
  v.sourceNote='Census housing · permit history 2000–25 · assumed policy response.';
  return v;
}
function forecastChartHtml(){
  const f=selectedProductionForecast(),history=f.history,years=f.annual;
  const w=660,h=230,left=60,right=17,top=18,bottom=34;
  const max=Math.max(...history.map(r=>r.total),...years.map(r=>r.total))*1.1||1;
  const x=y=>left+(y-2000)/30*(w-left-right),y=v=>h-bottom-v/max*(h-top-bottom);
  const path=rows=>rows.map((r,i)=>`${i?'L':'M'}${x(r.year).toFixed(2)},${y(r.total).toFixed(2)}`).join(' ');
  const scale=v=>v>=1e6?fmt(v/1e6,1)+'m':v>=1000?fmt(v/1000,0)+'k':fmt(v);
  const ticks=[0,.5,1].map(q=>`<line x1="${left}" y1="${y(max*q)}" x2="${w-right}" y2="${y(max*q)}" stroke="#e5d6ca"/><text x="${left-8}" y="${y(max*q)+4}" text-anchor="end">${scale(max*q)}</text>`).join('');
  const points=[...history,...years].map(r=>`<circle cx="${x(r.year)}" cy="${y(r.total)}" r="2.5" fill="${r.year>2025?'#854442':'#be9b7b'}"><title>${r.year}: ${fmt(r.total)} authorized units${r.year>2025?' (forecast)':''}</title></circle>`).join('');
  const label=countyFips?`${stateRec().state_name} state history; the county forecast is an allocation.`:`${placeName()}: housing units authorized per year.`;
  return `<figure class="forecast-chart"><figcaption>${uiEscape(label)}</figcaption><svg viewBox="0 0 ${w} ${h}" role="img" aria-label="Observed annual permits from 2000 to 2025 and baseline projections from 2026 to 2030"><rect x="${x(2025.5)}" y="${top}" width="${w-right-x(2025.5)}" height="${h-top-bottom}" fill="#f3e7df"/>${ticks}<path d="${path(history)}" fill="none" stroke="#a66f68" stroke-width="2.5"/><path d="${path([history[history.length-1],...years])}" fill="none" stroke="#854442" stroke-width="2.5" stroke-dasharray="6 4"/>${points}${[2000,2005,2010,2015,2020,2025,2030].map(t=>`<text x="${x(t)}" y="${h-12}" text-anchor="middle">${t}</text>`).join('')}</svg><p>Solid: observed Census permits. Dashed: selected baseline. Hover a point for its value. The shaded area marks future years, not an uncertainty interval.</p></figure>`;
}
function finalMethodologyHtml(){
  const f=selectedProductionForecast(), national=stateAbbr==='US', scores=FORECAST_VALIDATION.development_scores;
  const methods={last_year:'2025 pace repeated',mean_3:'Previous 3-year mean',mean_5:'Previous 5-year mean',damped_trend_5:'Damped five-year trend'};
  const candidates=Object.entries(scores).map(([k,s])=>`<tr${k===FORECAST.method?' class="forecast-selected"':''}><th>${uiEscape(methods[k]||k)}${k===FORECAST.method?' · selected':''}</th><td>${pct(s.mean_state_APE)}</td><td>${pct(s.WAPE)}</td></tr>`).join('');
  const selectedScore=scores[FORECAST.method];
  const specific=countyFips?`<p><b>County qualification:</b> the chart and historical tests refer to ${uiEscape(stateRec().state_name)}, not to the selected county. Its county baseline is allocated using its 2025 share of state permits. County performance was not independently backtested.</p>`:'';
  return `<section class="final-explain forecast-methodology">
    <h3>Methodology · five-year production baseline</h3>
    <div class="forecast-highlight"><strong>Why the projected line is flat</strong><p>Each state repeats its observed <b>2025 permit authorization pace</b> in every year from 2026 through 2030. The horizontal projection is a deliberate modeling assumption, not a chart error or a prediction that construction will remain unchanged.</p></div>
    <p><b>Measured outcome:</b> newly privately owned housing units authorized by permits. Permits are not housing starts, completions, net additions, or verified homes available to households. The forecast excludes Puerto Rico and territories.</p>
    <p>The linked observed and modeled time series appear in the <b>Graph</b> tab.</p>
    <h4>Why this method was selected</h4>
    <p>Four candidates were compared on six historical five-year prediction origins (2005–2010). The selected method had the lowest <b>equal-weight mean state five-year absolute percentage error</b> (${pct(selectedScore.mean_state_APE)}) in that development evaluation. One common method was selected nationally; it was not optimized separately for each state.</p>
    <div class="compare-wrap"><table class="assumption-table"><thead><tr><th>Five-year baseline candidate</th><th>Mean state absolute % error</th><th>Volume-weighted absolute % error</th></tr></thead><tbody>${candidates}</tbody></table></div>
    <p>The development period includes the housing crash, which contributes to unusually large errors. The selected method is an empirical reference choice under the stated tests, not a universally best forecast.</p>
    <h4>Independent final test and stress range</h4>
    <p>After model selection and calibration, the frozen 2021–2025 holdout produced a <b>${pct(FORECAST_VALIDATION.final_test.mean_state_APE)}</b> mean state absolute percentage error and <b>${pct(FORECAST_VALIDATION.final_test.WAPE)}</b> volume-weighted absolute percentage error across 51 jurisdictions. ${national?'The national aggregate holdout error was':`For ${uiEscape(stateRec().state_name)}, the state holdout error was`} <b>${pct(f.test.absolute_percentage_error)}</b>. These are retrospective test results, not a promise of accuracy in 2026–2030.</p>
    <p>The initial calibration-only historical-error range covered <b>${Math.round(FORECAST_VALIDATION.final_test_range_coverage_pct*51/100)} of 51</b> state holdouts (${pct(FORECAST_VALIDATION.final_test_range_coverage_pct)}). The currently displayed stress endpoints were subsequently refreshed using all completed historical folds and have <b>no independent coverage test</b>. They are not a statistical confidence interval.${national?' Summing state bounds into a national bound does not establish a national coverage probability.':''}</p>
    <h4>What the model does and does not test</h4>
    <p>Historical tests evaluate the permit baseline only. ADU, missing-middle, transit, parking and fee response rates are conditional policy assumptions, <b>not</b> causal policy effects validated by those tests. The separate housing-need scenarios describe possible demographic pressure and do not directly alter the permit baseline or prove a quantity of homes that must be built. The 2026–2050 scenarios use the same selected place, reform and policy response. Its default 2030 production path repeats the 2025 pace, matching this panel; optional longer-run supply, population, bedroom and completion estimates are separately labeled conditional assumptions.</p>
    ${specific}
    <details class="forecast-method"><summary>Historical data and evaluation limitations</summary><p>The history is a revised 2000–2025 Census snapshot rather than archived information exactly as observed at every test date. Rolling five-year targets overlap, some calibration years overlap earlier development targets, and coverage changes can affect comparisons. The 2021–2025 final test was excluded from model selection and calibration. Final 2025 data were released in May 2026, so this is not a forecast that could have been issued in 2025; it does not use observed 2026 values.</p><p>The model does not forecast future interest rates, economic cycles, supply constraints, permitting law, or construction completion rates. Five-year stress bounds are sensitivity indicators; they must not be treated as statistical probability statements.</p></details>
  </section>`;
}
function baselineExplanationHtml(){
  const f=selectedProductionForecast(),pf=selectedPolicyForecast(), annual=f.annual;
  const observed=f.history.find(r=>r.year===2025),records=annual.map(r=>`<tr><th>${r.year}</th><td>${fmt(r.single_family)}</td><td>${fmt(r.multifamily)}</td><td>${fmt(r.total)}</td></tr>`).join('');
  const countyInfo=countyFips?`<p><b>County allocation:</b> the selected county uses its 2025 share of state permits to allocate the state's five-year forecast, rounded. The county's baseline is ${fmt(pf?.bases.central)} units; it is not independently forecast or backtested. Some state permits remain unallocated where county records are missing.</p>`:'';
  return `<section class="forecast-baseline"><h3>Where the baseline comes from</h3><p><b>Observed data:</b> U.S. Census Bureau Building Permits Survey, revised annual state history 2000–2025; final 2025 totals were released May 14, 2026. The measured quantity is housing units authorized by permits, not completions.</p><p><b>Selected method:</b> retain each state's observed 2025 annual rate for five successive years. The state data are divided into single-family and multifamily permits and then recombined. No growth factor is applied.</p><p class="forecast-equation">${uiEscape(countyFips?stateRec().state_name:placeName())}: ${fmt(observed.total)} permits (2025) × 5 years = ${fmt(f.fiveYear)} baseline permits (2026–2030).</p><p><b>For each year:</b> annual permitted units in 2026, 2027, 2028, 2029 and 2030 are identical to the 2025 total; the constant line is expected. The 2025 pace should not be interpreted as guaranteed construction activity. The method choice and historical evaluation are in the <b>Methodology</b> tab.</p>${countyInfo}<details class="forecast-method"><summary>Show annual baseline by building type</summary><div class="compare-wrap"><table class="assumption-table"><thead><tr><th>Year</th><th>Single-family units</th><th>Multifamily units</th><th>Total authorized units</th></tr></thead><tbody>${records}</tbody></table></div></details></section>`;
}
function policyMathHtml(){
  const m=metric(),a=decisionAssessment(),pf=selectedPolicyForecast(),e=POLICY_EVIDENCE[policyKey];
  const rate=assumptionNumber(policyKey==='adu'?'ADU 5-year take-up':'Missing-middle 5-year redevelopment share');
  let text='';
  if(['adu','missing_middle'].includes(policyKey)){
    const net=policyKey==='adu'?1:assumptionNumber('Missing-middle net additional units per redevelopment');
    const raw=a.facts.detached===null?null:a.facts.detached*rate*net;
    text=countyFips?`${fmt(a.facts.detached)} × ${fmt(rate*100,policyKey==='adu'?1:2)}%${net===1?'':' × '+fmt(net)} = ${fmt(raw,2)} → ${fmt(m.added)} extra homes.`:`Combined detached stock: ${fmt(a.facts.detached)}. Multiplying it directly gives approximately ${fmt(raw,2)} units; the exact reported ${fmt(m.added)} sums separately rounded county results.`;
  }else if(policyKey==='tod'){
    text=a.facts.transit===null?'A required transit-exposure estimate is unavailable. We keep the answer unavailable instead of using a partial sum.':stateAbbr==='US'?`Compute each state separately: baseline × that state's transit share × ${pct(assumptionNumber('TOD production uplift in exposed areas')*100,0)}. Round each state, then sum states/DC to ${fmt(m.added)}.`:`${fmt(m.baseline)} baseline × ${fractionPct(a.facts.transit,3)} exposure × ${pct(assumptionNumber('TOD production uplift in exposed areas')*100,0)} uplift → ${fmt(m.added)}. Full stored exposure precision is used.`;
  }else if(countyFips){
    text=numericCalculationSteps().join(' ');
  }else{
    const sum=pf.countySums.central[policyKey][level];
    text=`Calculate each county with its own valuation denominator; rounded county sum ${fmt(sum)}. State permit-coverage adjustment and rounding change this by ${fmt(m.added-sum)} units, producing ${fmt(m.added)}. A single national or state average construction cost is not used.`;
  }
  return `<div class="forecast-chain"><p><b>1. Where the inputs come from:</b> ${uiEscape(e.source)}</p><p><b>2. Why these inputs are used:</b> ${uiEscape(e.why)}</p><p><b>3. What is assumed:</b> ${uiEscape(assumptionMeaning())}</p><p><b>4. Calculation:</b> ${uiEscape(e.formula)}</p><p class="forecast-equation">${uiEscape(text)}</p><p><b>5. Output:</b> ${fmt(m.added)} possible extra homes under the selected assumptions. ${m.baseline===null||m.added===null?'A baseline comparison is unavailable.':`${fmt(m.baseline)} + ${fmt(m.added)} = ${fmt(m.total)} in the reference comparison.`}</p></div>`;
}
function policySensitivityHtml(){
  const p=selectedPolicyForecast();
  const cell=value=>value===null?'Not available':'+'+fmt(value);
  return `<details class="forecast-method"><summary>Separate baseline uncertainty from policy assumptions</summary><p>These are crossed sensitivity cases, not a joint confidence interval. The main card uses the central baseline and the selected policy response. Zero extra production is also possible; for fees, fiscal/infrastructure channels could make net effects negative and are not quantified here.</p><div class="compare-wrap"><table class="assumption-table"><thead><tr><th>Baseline case</th><th>Baseline permits</th><th>No extra response</th><th>Low extra</th><th>Default extra</th><th>High extra</th></tr></thead><tbody>${['lower','central','upper'].map(k=>`<tr><th>${capital(k)}</th><td>${fmt(p.bases[k])}</td><td>0</td>${['low','default','high'].map(l=>`<td>${cell(p.scenarios[k][policyKey][l])}</td>`).join('')}</tr>`).join('')}</tbody></table></div><p>ADU and Missing Middle scenarios use housing stock; their added counts stay fixed across baseline cases. The model does not simulate how a weaker housing market changes owner participation. Transit, Parking and Fees scale with the permit baseline. The five reforms can affect the same projects and must not be added together.</p></details>`;
}
function finalCalculationHtml(){
  const v=finalResultView(),e=POLICY_EVIDENCE[policyKey];
  return `<section class="final-explain">${baselineExplanationHtml()}<div class="forecast-policy-math"><h3>How policy results are calculated</h3><p>${uiEscape(placeName())} · ${uiEscape(FINAL_NAMES[policyKey])}</p>${policyMathHtml()}<p><b>Meaning of the total:</b> ${uiEscape(e.outcome_limit)}</p><p><b>Percentage:</b> ${uiEscape(v.percentExplanation)}</p>${assumptionTableHtml()}<p><b>Where the response numbers came from:</b> ${uiEscape(e.assumption_basis)}</p><p><b>What research supports:</b> ${uiEscape(e.evidence)}</p><p><b>What remains unmeasured:</b> ${uiEscape(e.eligibility)}</p>${policySensitivityHtml()}</div></section>`;
}
function dataHtml(){
 return `<div class="section"><h3>Source definitions</h3>
 <p><b>Census Population Estimates:</b> July 1 population and demographic components. <b>ACS 2020–2024 five-year:</b> survey estimates of households, occupied bedrooms, rents, vacancies, crowding and existing homes; 90% margins of error where available. <b>HUD CHAS 2018–2022:</b> housing problems by income group, not a count of missing units. Different source periods should not be treated as a continuous time series.</p>
 <p>National medians are not averages of state medians. County and state records are joined using zero-padded Census geographic codes. The selected policy's modeled five-year results are assumptions, not observed construction.</p></div>
 <div class="source"><strong>Census Building Permits Survey</strong><p>The 2025 baseline measures units authorized by building permits, not completed homes.</p><a href="https://www.census.gov/construction/bps/" target="_blank" rel="noopener noreferrer">Official Census Building Permits website</a></div>
 <div class="source"><strong>Census Population Estimates &amp; ACS</strong><p>Population, households, existing housing types, bedrooms, rents and vacancy evidence.</p><a href="https://www.census.gov/programs-surveys/popest.html" target="_blank" rel="noopener noreferrer">Population Estimates website</a> · <a href="https://www.census.gov/programs-surveys/acs" target="_blank" rel="noopener noreferrer">American Community Survey website</a></div>
 <div class="source"><strong>HUD CHAS</strong><p>Income-specific housing problems and affordability evidence.</p><a href="https://www.huduser.gov/portal/datasets/cp.html" target="_blank" rel="noopener noreferrer">HUD CHAS website</a></div>
 <div class="source"><strong>BTS National Transit Map &amp; Census TIGER/Line</strong><p>Transit proximity and geographic boundaries; mapped exposure is not verified zoning capacity.</p><a href="https://www.bts.gov/national-transit-map" target="_blank" rel="noopener noreferrer">National Transit Map website</a> · <a href="https://www.census.gov/geographies/mapping-files/time-series/geo/tiger-line-file.html" target="_blank" rel="noopener noreferrer">Census TIGER/Line website</a></div>
 <div class="source"><strong>FHFA House Price Index &amp; BLS QCEW</strong><p>House-price and construction-employment context; these sources do not directly measure policy feasibility.</p><a href="https://www.fhfa.gov/reports/house-price-index" target="_blank" rel="noopener noreferrer">FHFA website</a> · <a href="https://www.bls.gov/cew/" target="_blank" rel="noopener noreferrer">BLS QCEW website</a></div>`;
}
function combinedMethodologyHtml(){return methodologyHtml();}
function combinedSourcesHtml(){return dataHtml();}
function finalSourcesHtml(){
  const e=POLICY_EVIDENCE[policyKey];
  const rows=[
    ['State permit history · 2000–2025','data/state_permit_history_2000_2025.csv'],
    ['Annual state forecasts · 2026–2030','data/forecast_2026_2030.csv'],
    ['Five-year state baseline and stress range','data/state_forecast_summary.csv'],
    ['Historical method comparison','data/forecast_method_test_scores.csv'],
    ['Frozen state holdout · 2021–2025','data/forecast_final_state_holdout.csv'],
    ['State policy sensitivity results','data/policy_state_comparisons.csv'],
    ['County model inputs','data/policy_county_inputs.csv'],
    ['Policy response assumptions','data/policy_parameter_assumptions.csv'],
    ['County historical permit series · 1990–2025','data/county_permits_history_1990_2025.csv'],
    ['County 2026–2050 base production reference','data/county_2026_2050_central_model.csv'],
    ['County population / bedrooms / affordability inputs','data/county_2050_model_inputs.csv'],
    ['Historical county model evaluation by building type','data/holdout_by_building_type.csv'],
    ['Extended outlook model QA','data/OUTLOOK_2050_QA.json']
  ];
  const list=rows.map(([label,href])=>`<li><a href="${href}" download>${uiEscape(label)} <span aria-hidden="true">↓</span></a></li>`).join('');
  const links=e.sources.map(s=>`<li><a href="${uiEscape(s.url)}" target="_blank" rel="noopener noreferrer">${uiEscape(s.title)}</a></li>`).join('');
  return `<section class="final-explain forecast-sources"><h3>Sources &amp; downloads</h3><p>Download the numbers behind this view as CSV files. The downloadable state forecasts and historical tests use the fixed 2025 observation cutoff; policy results are conditional sensitivity estimates.</p><ul class="forecast-download-list">${list}</ul><p><b>Primary original source:</b> <a href="https://www.census.gov/construction/bps/xls/state_history.xlsx" target="_blank" rel="noopener noreferrer">U.S. Census annual permit history workbook</a> (<a href="https://www.census.gov/construction/bps/annual.html" target="_blank" rel="noopener noreferrer">publication page</a>).</p><details class="forecast-method"><summary>Other evidence sources and data limitations</summary><p><b>${uiEscape(FINAL_NAMES[policyKey])}:</b> ${uiEscape(e.status)}</p><p>${uiEscape(e.evidence)}</p><ul class="forecast-evidence-list">${links}</ul><p><b>Policy calibration:</b> ${uiEscape(e.assumption_basis)}</p><p><b>Scope:</b> the original ACS and transit extraction pipeline is not fully recoverable in this deployment package. Housing-need and affordability context is displayed in the tool, but these CSV downloads are not a complete raw-data reproduction of those layers. The separate research/source ZIP is required for full model regeneration.</p><p><b>Interpretation:</b> 2025 permit authorizations are not completions. Existing policy permissions, project financing, infrastructure needs and policy overlap remain incompletely measured. The baseline backtest cannot establish causal responses to new laws.</p></details></section>`;
}


/* Challenge release: explanation only. Insert inside the simulator's app closure.
 * No production baseline, policy coefficient, Result or Graph calculation changes.
 */
let challengeComparisonExpanded=false;
const CHALLENGE_BENCHMARKS={
  adu:'Allow one detached or semi-detached ADU of at least 600 square feet on a lot with an existing single-family building, with no additional parking required.',
  missing_middle:'Allow 2–6 homes on lots currently restricted to single-family use, up to three stories. Assume setbacks and lot coverage do not prevent this building form; that is a scenario assumption, not verified local zoning.',
  tod:window.DATA_RELEASE?'Increase allowable height and/or floor area near major transit. The documented official reconstruction selects fixed-guideway stops and uses unioned 0.5-mile (804.672 m) geodesic buffers to screen exposure. Housing is weighted by intersected tract area. This is not a walking-network catchment or verified development capacity. Missing tract housing counts leave affected estimates unavailable.':'Increase allowable height and/or floor area near major transit. This scenario treats the inherited qualifying fixed-guideway stops as major stops and uses a 0.5-mile (804.672 m) straight-line station-area screen to limit exposure. Housing is weighted by intersected tract area. This is not a walking-network catchment. The original stop filters, vintage and overlay processing are only partly recovered.',
  parking:'Reduce or remove minimum parking requirements for new residential development. Developers can still provide parking voluntarily. Low/Default/High assume 0.2/0.4/0.6 spaces avoided per affected home, not 20/40/60% less parking. Remaining parking provision is not measured.',
  fee:'Reduce planning, environmental-review, building and impact fees by 50% across all major categories. The challenge assumes $50,000 total fees per home, so every response case saves $25,000. Actual local fees and infrastructure funding consequences are unverified.'
};
function challengePolicyComparisonHtml(){
  const previous=$('challengePolicyComparison');
  if(previous)challengeComparisonExpanded=previous.open;
  const record=selectedPolicyForecast(),base=n(record?.bases?.central);
  const order=['adu','missing_middle','tod','parking','fee'];
  const rows=order.map(key=>{
    const values=record?.scenarios?.central?.[key]||{};
    const ratio=base>0&&n(values.default)!==null?100*n(values.default)/base:null;
    const kind=['adu','missing_middle'].includes(key)?'Net unit potential':'Permit-equivalent production';
    return `<tr data-challenge-comparison="${key}"${key===policyKey?' class="challenge-comparison-selected"':''}><th scope="row"><button type="button" data-challenge-compare-policy="${key}" aria-label="View ${uiEscape(POLICIES[key].short)} assumptions" aria-pressed="${key===policyKey}">${uiEscape(POLICIES[key].short)}</button><small>${kind}</small></th>${['low','default','high'].map(response=>`<td>${n(values[response])===null?'Not available':'+'+fmt(values[response])}</td>`).join('')}<td>${pct(ratio)}</td></tr>`;
  }).join('');
  return `<details id="challengePolicyComparison" class="forecast-method challenge-policy-comparison"${challengeComparisonExpanded?' open':''}><summary>Compare all five policies and assumptions</summary><p>Same place: <b>${uiEscape(placeName())}</b>. Same 2026–2030 permit baseline: <b>${fmt(base)}</b>. Select a policy name to read its explanation.</p><div class="compare-wrap"><table class="assumption-table challenge-comparison-table" aria-label="Five-policy comparison for ${uiEscape(placeName())}"><thead><tr><th>Policy / what is counted</th><th>Low extra</th><th>Default extra</th><th>High extra</th><th>Default / baseline</th></tr></thead><tbody>${rows}</tbody></table></div><p>The order is fixed; it is not a suitability ranking. ADU and Missing middle count net unit potential. The other policies count permit-equivalent production. Percentages compare these scenarios with a common permit reference, not completed homes. A larger number does not prove that a policy best meets local needs. The reforms overlap: do not add their results.</p></details>`;
}
function challengeCoverageHtml(){
  const coverage=window.DATA_COVERAGE;
  const scope=stateAbbr==='US'?coverage?.national:coverage?.states?.[stateAbbr];
  if(!scope)return '';
  const raw=countyFips?countyRec():null,decision=decisionRecord();
  const permit=countyFips?(n(raw?.baseline_annual_units)===null?'The county permit input is unavailable. Missing permits are not zero permits.':`${fmt(raw.baseline_annual_units)} units permitted in 2025${Number(raw.baseline_annual_units)===0?' (an observed zero)':''}. The county baseline allocates the state forecast; it is not independently backtested.`):`${fmt(scope.permit_available)} of ${fmt(scope.counties)} county permit inputs available; ${fmt(scope.permit_missing)} unavailable; ${fmt(scope.permit_zero)} observed zeros. State history contains 26 annual observations, 2000–2025.`;
  const cost=countyFips?(n(raw?.avg_permit_value_per_unit)===null?'The inherited state cost-comparison fallback is used.':'The county permit valuation per authorized unit is used.'):`${fmt(scope.cost_state_fallback)} counties use an inherited state cost-comparison fallback.`;
  const chas=countyFips?(n(decision?.evidence?.chas?.lowTotal)===null?'HUD CHAS input unavailable for this geography.':'HUD CHAS housing-problem counts available, 2018–2022.'):`HUD CHAS inputs available for ${fmt(scope.chas_available)} of ${fmt(scope.counties)} counties. State/U.S. figures are approximate county sums.`;
  const transit=window.DATA_RELEASE?'Transit exposure is rebuilt from documented official stops, tract housing counts and boundaries. Withheld tract counts leave affected estimates unavailable.':'The supplied transit proxy has measured zeros, but its original processing is not fully reproduced.';
  return `<details class="forecast-method challenge-coverage"><summary>Data coverage for ${uiEscape(placeName())}</summary><dl><dt>Permits</dt><dd>${uiEscape(permit)}</dd><dt>Housing and households</dt><dd>ACS 2020–2024 evidence covers ${fmt(scope.acs_available)} of ${fmt(scope.counties)} counties in this area. These are existing conditions, not required construction.</dd><dt>Cost comparison</dt><dd>${uiEscape(cost)} Permit valuation is not a complete development budget.</dd><dt>Housing problems</dt><dd>${uiEscape(chas)}</dd><dt>Transit and eligibility</dt><dd>${uiEscape(transit)} Current binding rules, eligible sites and causal policy responses are not nationally verified.</dd></dl></details>`;
}
function challengeBaselineMethodHtml(){
  // The current build no longer exposes a 2050 outlook or projected lines in Graph.
  // Retain its historical evaluation while removing those stale UI descriptions.
  return finalMethodologyHtml()
    .replace('<p>The linked observed and modeled time series appear in the <b>Graph</b> tab.</p>','<p>The <b>Graph</b> tab shows observed permit history and 2025 building types. The annual 2026–2030 baseline values are in <b>How calculated</b>.</p>')
    .replace(' The 2026–2050 scenarios use the same selected place, reform and policy response. Its default 2030 production path repeats the 2025 pace, matching this panel; optional longer-run supply, population, bedroom and completion estimates are separately labeled conditional assumptions.','');
}
function combinedMethodologyHtml(){
  const evidence=POLICY_EVIDENCE[policyKey];
  const benchmarks=POLICY_KEYS.map(key=>`<details class="challenge-benchmark"${key===policyKey?' open':''}><summary>${uiEscape(POLICIES[key].name)}</summary><p><b>Benchmark:</b> ${uiEscape(CHALLENGE_BENCHMARKS[key])}</p><p><b>Data and purpose:</b> ${uiEscape(POLICY_EVIDENCE[key].why)}</p><p><b>Calculation:</b> ${uiEscape(POLICY_EVIDENCE[key].formula)}</p><p><b>Assumptions:</b> ${uiEscape(POLICY_EVIDENCE[key].assumption_basis)}</p></details>`).join('');
  return `<section class="final-explain challenge-methodology"><h3>Methodology</h3><p>${uiEscape(placeName())} · ${uiEscape(FINAL_NAMES[policyKey])}</p><p>Start with permitted housing under a continuation of recent conditions. Apply one stated policy-response assumption. Read the extra homes as a conditional scenario, then check local feasibility.</p>${challengePolicyComparisonHtml()}${challengeCoverageHtml()}<section class="challenge-method-step"><h4>1. Start with the same five-year baseline</h4><p>Census state permit history covers 2000–2025. Four methods were compared against known historical five-year outcomes. The selected method repeats each state's 2025 pace in 2026–2030. That is why the projected annual values are flat.</p><p>The reserved 2021–2025 test had <b>${pct(FORECAST_VALIDATION.final_test.mean_state_APE)}</b> mean state error. This tests the permit baseline, not the effects of the reforms.${countyFips?' The county baseline is allocated from its state using its 2025 permit share; it is not an independently tested county forecast.':''}</p><details class="forecast-method"><summary>See baseline selection, historical tests and limits</summary>${challengeBaselineMethodHtml()}</details></section><section class="challenge-method-step"><h4>2. Define the policy and its assumed response</h4><p><b>Selected response:</b> ${uiEscape(assumptionMeaning())}</p><p><b>Evidence status:</b> ${uiEscape(evidence.status)}</p>${benchmarks}</section><section class="challenge-method-step"><h4>3. Add and compare consistently</h4><p>ADU and Missing middle add rounded county results. Transit is calculated directly for states. Parking and Fees reconcile rounded county results to state permit coverage. U.S. results sum states and DC. Missing inputs stay unavailable; observed zeros stay zero.</p><p>${uiEscape(evidence.outcome_limit)}</p></section><section class="challenge-method-step"><h4>4. Separate uncertainty from assumptions</h4><p>Low, Default and High change the assumed policy response. They are not probabilities or confidence levels. The baseline stress range comes from historical errors. Its initial version covered 35 of 51 states in the reserved test; the refreshed displayed version has no independent coverage test. Zero extra production remains possible.</p></section><section class="challenge-method-step"><h4>5. Use housing needs to choose what to investigate</h4><p>Existing households, crowding, rents, housing types and HUD housing problems describe local pressure. Separate 2030 household scenarios continue population components with household size and group-quarters share held constant. They do not establish required new buildings or a required bedroom mix.</p><p>Check whether the selected reform addresses a binding local rule, which homes people need, and whether financing and infrastructure allow projects to proceed. Higher modeled production alone does not establish affordability or the best policy.</p></section><section class="challenge-method-step"><h4>6. Check the remaining gaps</h4><p>${uiEscape(evidence.eligibility)}</p><p>National policy-response rates are not causally calibrated. Permits do not verify completion, occupancy or affordable rents. Reforms overlap and must not be added. <b>How calculated</b> traces source → purpose → assumption → arithmetic → extra homes. <b>Sources</b> provides the datasets and downloads.</p></section></section>`;
}
document.addEventListener('click',event=>{
  const button=event.target.closest?.('[data-challenge-compare-policy]');
  if(!button||!POLICY_KEYS.includes(button.dataset.challengeComparePolicy))return;
  policyKey=button.dataset.challengeComparePolicy;
  $('policySelect').value=policyKey;
  challengeComparisonExpanded=true;
  syncHash();renderAll();
  document.querySelector(`[data-challenge-compare-policy="${policyKey}"]`)?.focus();
});


/* Concise source catalog for the current five-year simulator and four Graph panels. */
function challengeSourceLinks(row){
  const page=row.source_url||row.url;
  const links=[];
  if(page&&page!==row.download_url)links.push(`<a href="${uiEscape(page)}" target="_blank" rel="noopener noreferrer">Source page ↗</a>`);
  if(row.download_url)links.push(`<a href="${uiEscape(row.download_url)}" target="_blank" rel="noopener noreferrer">${uiEscape(row.download_label||'Original file ↓')}</a>`);
  if(row.local_download)links.push(`<a href="${uiEscape(row.local_download)}" download>Tool data CSV ↓</a>`);
  return links.join('');
}
function challengeSourceTable(rows){
  return `<div class="challenge-source-wrap"><table class="challenge-source-table"><thead><tr><th>Source / what it contains</th><th>How it is used</th><th>Open / download</th></tr></thead><tbody>${rows.map(row=>`<tr${row.id?` data-source-id="${uiEscape(row.id)}"`:''}><td><b>${uiEscape(row.title)}</b>${row.what?`<span>${uiEscape(row.what)}</span>`:''}${row.note?`<small>${uiEscape(row.note)}</small>`:''}</td><td>${uiEscape(row.used)}</td><td class="challenge-source-downloads">${challengeSourceLinks(row)}</td></tr>`).join('')}</tbody></table></div>`;
}
function combinedSourcesHtml(){
  const catalog=window.SOURCE_CATALOG;
  const acs=catalog.datasets.filter(row=>row.id.startsWith('acs_'));
  const other=catalog.datasets.filter(row=>!row.id.startsWith('acs_'));
  const calculated=[
    {title:'Annual production baseline',what:'State single-family, multifamily and total permits, 2026–2030.',used:'Traces the five-year permit reference.',local_download:'data/forecast_2026_2030.csv'},
    {title:'State baseline and stress scenarios',what:'Central baseline and historical-error stress endpoints.',used:'Separates baseline uncertainty from policy-response assumptions.',local_download:'data/state_forecast_summary.csv'},
    {title:'Five-policy scenario calculations',what:'All state policies and Low/Default/High response cases.',used:'Checks the policy comparison and coverage adjustments.',local_download:'data/policy_state_comparisons.csv'},
    {title:'Policy response parameters',what:'Original Low/Default/High parameters and units.',used:'Shows the stated take-up, redevelopment and cost-response assumptions.',local_download:'data/policy_parameter_assumptions.csv'},
    {title:'Historical baseline-method comparison',what:'Errors for the four candidate baseline methods.',used:'Documents the fixed historical selection criterion.',local_download:'data/forecast_method_test_scores.csv'},
    {title:'Reserved state test · 2021–2025',what:'Predicted and observed five-year totals by state.',used:'Checks the selected baseline against the reserved retrospective period.',local_download:'data/forecast_final_state_holdout.csv'}
  ];
  return `<section class="final-explain challenge-sources"><h3>Sources &amp; downloads</h3><p>Original data, the files used by this tool, and their purpose.</p>${challengeSourceTable(other)}<details class="challenge-source-group"><summary>ACS 2020–2024 tables · ${acs.length} datasets</summary>${challengeSourceTable(acs)}</details><details class="challenge-source-group"><summary>Calculated files · ${calculated.length} downloads</summary>${challengeSourceTable(calculated)}</details><details class="challenge-source-group"><summary>Research and method references · ${catalog.research.length} sources</summary>${challengeSourceTable(catalog.research)}</details></section>`;
}


/* Complete the existing five-tab keyboard and screen-reader interaction. */
const challengeOriginalRenderTabs=renderTabs;
renderTabs=function(){
  challengeOriginalRenderTabs();
  document.querySelectorAll('.tab').forEach(tab=>tab.setAttribute('tabindex',tab.dataset.tab===currentTab?'0':'-1'));
  document.querySelectorAll('.tab-pane').forEach(pane=>{
    const active=pane.dataset.pane===currentTab;
    pane.setAttribute('aria-hidden',String(!active));
    pane.setAttribute('tabindex',active?'0':'-1');
  });
  if(currentTab==='result')scheduleOptionAFit();
};
document.querySelectorAll('.tab').forEach((tab,index,all)=>tab.addEventListener('keydown',event=>{
  let next;
  if(event.key==='ArrowRight')next=(index+1)%all.length;
  else if(event.key==='ArrowLeft')next=(index+all.length-1)%all.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=all.length-1;
  else return;
  event.preventDefault();all[next].click();all[next].focus();
}));


/* Plain-language Result text. Original numeric methods and inputs are unchanged. */
const simplifiedOriginalResultView=finalResultView;
function simplifiedResultFact(card){
  const copy={...card};
  const labels={
    'Existing detached homes':['Stand-alone houses','Existing houses not joined to another house.'],
    'Households with one or two people':['Households with 1 or 2 people','People living alone or with one other person.'],
    'Renters spending 30%+ on housing':['Renters paying 30%+ of income for housing','Share of renters with enough cost and income data.'],
    'Detached stock adding an ADU':['Houses assumed to add an ADU','Our chosen share over five years.'],
    'Renter homes with crowding':['Renter homes with crowding','More than one person per room, on average.'],
    'Renter households with 3+ people':['Renter homes with 3+ people','Larger households renting their home.'],
    'Homes in 2–4 unit buildings':['Homes in small buildings','Existing buildings with 2–4 homes.'],
    'Housing near qualifying transit':['Housing near the model’s transit stops','Mapped share within half a mile of qualifying stops.'],
    'Homes in 5+ unit buildings':['Homes in larger buildings','Existing buildings with at least 5 homes.'],
    'Baseline permits · 2026–30':['Five-year starting point','2025 permit pace continued for five years.'],
    'Five years at the 2025 permit pace':['Five-year starting point','2025 permit pace continued for five years.'],
    'Parking cost avoided per affected home':['Assumed parking saving per affected home','Fewer spaces × the assumed cost of each space.'],
    'New development affected by reform':['Projects assumed to be affected','Our chosen share of development, not a local count.'],
    'Construction value used by the model':['Building value used for comparison','Permit value per home; a full project budget is still needed.'],
    'Fee saving per new home':['Assumed fee saving per home','The example cuts $50,000 in fees by half.'],
    'Housing increase per 1% modeled saving':['Assumed housing response','Extra housing for each 1% of building value saved.']
  };
  if(labels[card.label]){copy.label=labels[card.label][0];copy.note=labels[card.label][1];}
  if(String(copy.value).includes(' ±'))copy.note+=' ± shows the survey’s 90% margin of error.';
  copy.numberType=card.basis==='Assumed'?'Assumption':card.basis==='Observed'?'Census estimate':card.basis==='Measured proxy'?'Mapped estimate':'Comparison input';
  return copy;
}
function simplifiedResultAssumption(){
  const a=name=>n(findAssumption(name)?.[level]);
  if(policyKey==='adu')return `We test ${fmt(a('ADU 5-year take-up')*1000)} out of every 1,000 stand-alone houses adding one ADU over five years.`;
  if(policyKey==='missing_middle')return `We test ${fmt(a('Missing-middle 5-year redevelopment share')*2000)} out of every 2,000 stand-alone houses being redeveloped, with ${fmt(a('Missing-middle net additional units per redevelopment'))} more homes at each site.`;
  if(policyKey==='tod')return `We test ${pct(a('TOD production uplift in exposed areas')*100,0)} more housing in the part near the model’s transit stops.`;
  const response=a(policyKey==='parking'?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
  return policyKey==='parking'?`We test ${pct(a('Parking reform share of baseline development affected')*100,0)} of projects being affected. In those projects, each 1% cost saving could bring ${fmt(response,1)}% more housing.`:`The example saves $25,000 per home. We test ${fmt(response,1)}% more housing for each 1% cost saving.`;
}
function simplifiedResultMath(){
  const m=metric(),facts=decisionAssessment().facts,raw=policyRecord(),county=Boolean(countyFips);
  if(m.added===null)return ['A needed model input is missing.','We leave the result unavailable instead of treating missing data as zero.'];
  const result=`${fmt(m.added)} possible extra homes.`;
  const rate=assumptionNumber(policyKey==='adu'?'ADU 5-year take-up':'Missing-middle 5-year redevelopment share');
  if(policyKey==='adu')return county?[`${fmt(facts.detached)} houses × ${pct(rate*100,1)} assumed to add an ADU.`,`Round the answer: ${result}`]:[`Each county: stand-alone houses × ${pct(rate*100,1)} assumed to add an ADU.`,`Round each county, then add the results: ${result}`];
  if(policyKey==='missing_middle'){
    const net=assumptionNumber('Missing-middle net additional units per redevelopment');
    return county?[`${fmt(facts.detached)} houses × ${pct(rate*100,2)} redeveloped × ${fmt(net)} extra homes.`,`Round the answer: ${result}`]:[`Each county: houses × ${pct(rate*100,2)} redeveloped × ${fmt(net)} extra homes.`,`Round each county, then add the results: ${result}`];
  }
  if(policyKey==='tod'){
    const uplift=assumptionNumber('TOD production uplift in exposed areas');
    return stateAbbr==='US'?[`Each state: starting point × share near transit × ${pct(uplift*100,0)} assumed increase.`,`Round each state, then add states and DC: ${result}`]:[`${fmt(m.baseline)} starting point × ${fractionPct(facts.transit,3)} near transit × ${pct(uplift*100,0)} assumed increase.`,facts.transit===0?`This input records zero exposure, so the answer is ${fmt(m.added)}.`:`Round the answer: ${result}`];
  }
  const parking=policyKey==='parking';
  const saving=parking?assumptionNumber('Parking spaces avoided per affected unit')*assumptionNumber('Parking construction cost per avoided space'):assumptionNumber('Development fee savings per unit');
  const response=assumptionNumber(parking?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
  if(county){
    const cost=n(raw?.scenario_cost_base);
    if(cost===null||cost<=0||m.baseline===null)return ['A usable permit count or building-value comparison is missing.',`The saved model result is ${fmt(m.added)}; see How calculated for its inputs.`];
    const savingShare=Math.min(.30,saving/cost);
    return [`$${fmt(saving)} saved ÷ $${fmt(cost)} building value = ${pct(savingShare*100,2)}${saving/cost>.3?' after the 30% limit':''}.`,`${fmt(m.baseline)} × ${parking?pct(assumptionNumber('Parking reform share of baseline development affected')*100,0)+' affected × ':''}${pct(savingShare*100,2)} × ${fmt(response,1)} response ≈ ${fmt(m.added)} extra homes.`];
  }
  return [`Each county: compare $${fmt(saving)} saved with building value, then apply our assumed response.`,`Round results and adjust for differences between county and state totals: ${result}`];
}
finalResultView=function(){
  const v=simplifiedOriginalResultView(),m=metric(),assessment=decisionAssessment();
  const originals=[...(v.observations||[]),...(v.evidenceCards||[])];
  v.moreFacts=originals.map(simplifiedResultFact);
  v.observations=(policyKey==='fee'?[v.observations[0],v.evidenceCards[0]]:v.observations).filter(Boolean).map(simplifiedResultFact);
  v.evidenceCards=[];
  const settings={
    adu:{focusTitle:'Check space and owner interest',mechanism:'Let an owner add one small home to an existing property.',forms:'A small home beside an existing house, such as a backyard cottage.',check:'Is there space? Check water, sewers, building costs and owner interest.'},
    missing_middle:{focusTitle:'Check places for small buildings',mechanism:'Allow buildings with 2–6 homes where only one home is allowed.',forms:'Duplexes, townhouses and small apartment buildings.',check:'Check local rules, building costs, homes being replaced and people already living there.'},
    tod:{focusTitle:assessment.facts.transit===0?'No qualifying transit measured here':'Check places near useful transit',mechanism:assessment.facts.transit===0?'This input records no housing near the model’s qualifying transit stops.':'Allow more homes near major transit stops.',forms:'Apartment buildings near transit stops.',check:'Check useful transit service, room to build, local rules and affordable rents.'},
    parking:{focusTitle:'Check whether parking rules add costs',mechanism:'Let builders provide fewer parking spaces when they would choose fewer.',forms:'Many housing types.',check:'Check parking rules, the spaces builders actually need and all building costs.'},
    fee:{focusTitle:'Check fees and project costs',mechanism:'Cut the example fee of $50,000 per home in half.',forms:'Many housing types.',check:'Check actual fees, all building costs and how roads, water and sewers would be paid for.'}
  };
  const chosen=settings[policyKey];Object.assign(v,chosen);
  v.baselineLabel='Five-year starting point';
  v.totalLabel='Starting point + possible extra';
  const annual=countyFips?n(countyRec()?.baseline_annual_units):n(selectedProductionForecast()?.annual?.[0]?.total);
  v.baselineHelp=m.baseline===null?'The starting point is unavailable here. Missing data does not mean zero.':`${fmt(annual)} homes permitted in 2025 × 5 years = ${fmt(m.baseline)}. A permit is permission to build.`;
  v.percentExplanation=m.pct===null?(m.baseline===null?'The starting point is missing, so no percentage can be shown.':m.baseline===0?'The starting point is zero, so no percentage can be shown.':'The extra-home estimate is unavailable, so no percentage can be shown.'):`${pct(m.pct)} more than the five-year starting point${m.pct>100?'; a small starting point can make this percentage large':''}.`;
  v.primaryComparisonNote=['adu','missing_middle'].includes(policyKey)?'The starting point counts new-building permits; these extras use existing properties.':'';
  if(policyKey==='tod'&&m.added===null&&window.DATA_RELEASE?.transitMissingReason&&(stateAbbr==='US'||(stateAbbr==='NY'&&(!countyFips||countyFips==='36103'))))v.primaryComparisonNote=window.DATA_RELEASE.transitMissingReason;
  v.assumptionMeaning=simplifiedResultAssumption();
  v.calculationSteps=simplifiedResultMath();
  v.detailedNeed=v.localNeed.replace('2030 household scenarios:','Possible household change by 2030:').replace('New-building need: unknown.','This does not show how many homes must be built.');
  v.localNeed='';
  v.limitations=[chosen.check];
  v.sourceNote='Data: Census housing and permits. The response is our chosen assumption.';
  v.comparisonMeaning=['adu','missing_middle'].includes(policyKey)?'The starting point counts new-building permits. These possible additions use existing housing. Their sum is a comparison, not a forecast of all homes.':'The starting point and extra count possible permit authorizations. Receiving permission does not mean a home will be finished.';
  return v;
};


/* Plain-language explanations. The model, inputs and scenario results stay intact. */
const simpleDetailedPolicyMath=policyMathHtml;
const simpleDetailedSensitivity=policySensitivityHtml;
const simpleDetailedBaselineMethod=challengeBaselineMethodHtml;
const simpleDetailedPolicyComparison=challengePolicyComparisonHtml;

function simpleMoney(value){return n(value)===null?'Not available':'$'+fmt(value);}
function simpleExtra(value){return n(value)===null?'Not available':fmt(value);}
function simpleRuleText(key=policyKey){
  return {
    adu:'Let an owner add one small home to an existing property.',
    missing_middle:'Allow small buildings with 2–6 homes where only one home is allowed.',
    tod:'Allow more homes near major train or other qualifying transit stops.',
    parking:'Let builders provide fewer parking spaces when they need fewer spaces.',
    fee:'Cut the example fee from $50,000 to $25,000 per new home.'
  }[key];
}
assumptionMeaning=function(atLevel=level){
  const value=name=>n(findAssumption(name)?.[atLevel]);
  if(policyKey==='adu')return `Over five years, ${fmt(value('ADU 5-year take-up')*1000)} out of every 1,000 detached homes adds one extra home.`;
  if(policyKey==='missing_middle')return `Over five years, ${fmt(value('Missing-middle 5-year redevelopment share')*2000)} out of every 2,000 detached homes is replaced by a small building, adding ${fmt(value('Missing-middle net additional units per redevelopment'))} extra home(s) after replacing the old home.`;
  if(policyKey==='tod')return `We test ${pct(value('TOD production uplift in exposed areas')*100,0)} more housing in the part near qualifying transit.`;
  const response=value(policyKey==='parking'?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
  if(policyKey==='parking')return `${pct(value('Parking reform share of baseline development affected')*100,0)} of new development uses less parking. For each 1% of construction value saved, assume ${fmt(response,1)}% more homes in that part.`;
  return `Save $25,000 per new home. For each 1% of construction value saved, assume ${fmt(response,1)}% more homes.`;
};
assumptionTableHtml=function(){
  const labels={
    'ADU 5-year take-up':'Detached homes adding an extra home in five years',
    'Missing-middle 5-year redevelopment share':'Detached homes replaced by small buildings',
    'Missing-middle net additional units per redevelopment':'Extra homes after replacing the old home',
    'TOD production uplift in exposed areas':'Extra housing in the part near transit',
    'Parking reform share of baseline development affected':'New development using less parking',
    'Parking spaces avoided per affected unit':'Parking spaces saved per affected home',
    'Parking construction cost per avoided space':'Cost of one parking space',
    'Parking cost-to-supply elasticity':'Extra housing for each 1% of cost saved',
    'Development fee savings per unit':'Money saved per new home',
    'Development fee cost-to-supply elasticity':'Extra housing for each 1% of cost saved'
  };
  const rows=FINAL_PARAMETERS[policyKey].map(([name,label,type])=>{
    const cells=['low','default','high'].map(response=>{
      const x=n(findAssumption(name)?.[response]);
      return type==='money'?simpleMoney(x):type==='share'?pct(x===null?null:x*100,x!==null&&x<.01?2:1):type==='response'?pct(x,1):type==='decimal'?fmt(x,1):fmt(x);
    });
    return `<tr><th scope="row">${uiEscape(labels[name]||label)}</th>${cells.map(cell=>`<td>${uiEscape(cell)}</td>`).join('')}</tr>`;
  }).join('');
  return `<div class="assumption-intro"><p><b>Low, Default and High are three “what if” examples.</b> Low uses a smaller response; High uses a larger one. The Census numbers stay the same.</p><p>These examples are not odds, promises or guaranteed limits. The actual extra housing could be zero.</p></div><div class="compare-wrap"><table class="assumption-table"><thead><tr><th>What we change</th><th>Low</th><th>Default</th><th>High</th></tr></thead><tbody>${rows}</tbody></table></div><p class="assumption-selected"><b>${capital(level)} selected:</b> ${uiEscape(assumptionMeaning())}</p>`;
};
baselineExplanationHtml=function(){
  const f=selectedProductionForecast(),pf=selectedPolicyForecast(),m=metric();
  const annual=countyFips?n(countyRec()?.baseline_annual_units):n(f.history.find(row=>row.year===2025)?.total);
  let equation=annual===null?'A 2025 county permit count is missing, so the county starting point is unavailable.':`${fmt(annual)} homes given permission to build in 2025 × 5 years = ${fmt(m.baseline)} five-year starting point.`;
  if(annual!==null&&annual*5!==m.baseline)equation=`The county's share of state permits × ${fmt(f.fiveYear)} state starting point = ${fmt(m.baseline)} county starting point after rounding.`;
  const rows=f.annual.map(row=>`<tr><th scope="row">${row.year}</th><td>${fmt(row.single_family)}</td><td>${fmt(row.multifamily)}</td><td>${fmt(row.total)}</td></tr>`).join('');
  return `<section class="simple-baseline"><h3>Where the baseline comes from</h3><p><b>Baseline means starting point.</b> We ask how many homes could get permission to build in 2026–2030 if the 2025 pace continued.</p><p><b>Real data:</b> the U.S. Census Bureau counts homes given building permits. A permit is permission to build; a home may still need to be finished.</p><p class="simple-equation">${uiEscape(equation)}</p>${countyFips?'<p>The county gets a share of its state’s starting point using its 2025 permits. Its future results were not tested separately.</p>':''}<p>This is our five-year calculation, not a Census prediction or a count of existing homes.</p><details class="simple-details"><summary>Why does each future year use the same number?</summary><p>We checked 26 years of state permit data, 2000–2025, and compared four ways to predict five years ahead. Repeating the last year did best under our chosen state-by-state test. We therefore use the 2025 pace for every year from 2026 to 2030. The flat line shows that choice; real building activity can go up or down.</p><p>The <b>Methodology</b> tab keeps the test results and the limits of this choice.</p></details><details class="simple-details"><summary>See the annual starting numbers</summary>${countyFips?`<p>This table is for ${uiEscape(stateRec().state_name)}. The selected county’s five-year share is ${fmt(pf?.bases.central)}.</p>`:''}<div class="compare-wrap"><table class="assumption-table"><thead><tr><th>Year</th><th>Single-family homes</th><th>Homes in larger buildings</th><th>Total permits</th></tr></thead><tbody>${rows}</tbody></table></div></details></section>`;
};
function simplePolicyInputs(){
  const a=decisionAssessment(),r=policyRecord(),m=metric();
  if(['adu','missing_middle'].includes(policyKey))return `<p><b>${fmt(a.facts.detached)} existing detached homes</b> — houses that stand on their own. This estimate comes from the Census ACS 2020–2024 housing survey.</p>`;
  if(policyKey==='tod'){
    const exposure=a.facts.transit===null?'A required source count is missing, so the housing share near transit is unavailable.':stateAbbr==='US'?'Each state has its own measured share near qualifying transit.':`The model puts <b>${fractionPct(a.facts.transit,3)}</b> of housing near qualifying transit.`;
    return `<p><b>${fmt(m.baseline)} permits</b> in the five-year starting point, from Census permit data. ${exposure}</p><p>The transit share combines housing counts, transit locations and map boundaries. It screens the area; it does not count land ready for building.</p>`;
  }
  return `<p><b>${fmt(m.baseline)} permits</b> in the five-year starting point, from Census permit data.</p>${countyFips?`<p><b>${simpleMoney(r?.scenario_cost_base)} per home</b> is the model’s construction-value comparison. It uses permit values, with a state fallback where needed.</p>`:'<p>Each county has its own construction-value comparison from permit values, with a state fallback where needed.</p>'}<p>This is a rough comparison for savings. It leaves out parts of a real development budget.</p>`;
}
function simplePolicyPurpose(){
  return {
    adu:'An existing detached house may have room for another small home. We use the housing count as a starting pool; we have not checked each property.',
    missing_middle:'Some existing houses could be replaced by buildings with more homes. We count only the extra homes after replacing the old home.',
    tod:'We limit this example to the share near qualifying transit. That helps us avoid treating every location as a station area.',
    parking:'We compare money saved on parking with construction value, then test whether lower costs could lead to more homes.',
    fee:'We compare the $25,000 example saving with construction value, then test whether lower costs could lead to more homes.'
  }[policyKey];
}
function simplePolicyCalculation(){
  const a=decisionAssessment(),m=metric(),pf=selectedPolicyForecast(),r=policyRecord();
  if(m.added===null)return '<p>A required input is missing. We leave the answer unavailable rather than replacing missing data with zero.</p>';
  if(['adu','missing_middle'].includes(policyKey)){
    const rate=assumptionNumber(policyKey==='adu'?'ADU 5-year take-up':'Missing-middle 5-year redevelopment share');
    const net=policyKey==='adu'?1:assumptionNumber('Missing-middle net additional units per redevelopment');
    const stock=n(a.facts.detached),raw=stock===null?null:stock*rate*net;
    const formula=`${fmt(stock)} detached homes × ${pct(rate*100,policyKey==='adu'?1:2)}${net===1?'':' × '+fmt(net)+' extra homes each'} = ${fmt(raw,2)}`;
    return `<p class="simple-equation">${uiEscape(formula)}</p>${countyFips?`<p>Round this to <b>${fmt(m.added)} possible extra homes</b>.</p>`:`<p>This quick multiplication gives about ${fmt(raw)} homes. The tool rounds each county first, then adds ${stateAbbr==='US'?'states and DC':'the counties'}, giving the reported <b>${fmt(m.added)}</b>. That is why the final answer can differ slightly from the quick multiplication.</p>`}${policyKey==='missing_middle'?'<p>For example, replacing one home with three homes adds <b>two</b> homes. The old home is subtracted.</p>':''}`;
  }
  if(policyKey==='tod'){
    const uplift=assumptionNumber('TOD production uplift in exposed areas');
    return stateAbbr==='US'?`<p class="simple-equation">For each state: starting permits × share near transit × ${pct(uplift*100,0)} extra housing.</p><p>Round each state’s answer, then add states and DC: <b>${fmt(m.added)} possible extra homes</b>. Each state uses its own transit share.</p>`:`<p class="simple-equation">${fmt(m.baseline)} starting permits × ${fractionPct(a.facts.transit,3)} near transit × ${pct(uplift*100,0)} extra housing = about ${fmt(m.added)} extra homes.</p>${a.facts.transit===0?'<p>The measured transit share is zero here, so this example adds zero homes. Other transit service and housing needs may still exist.</p>':'<p>The calculation keeps all stored decimal places in the transit share, then rounds the answer to whole homes.</p>'}`;
  }
  const parking=policyKey==='parking';
  const spaces=parking?assumptionNumber('Parking spaces avoided per affected unit'):null;
  const costPer=parking?assumptionNumber('Parking construction cost per avoided space'):null;
  const saving=parking?spaces*costPer:assumptionNumber('Development fee savings per unit');
  const response=assumptionNumber(parking?'Parking cost-to-supply elasticity':'Development fee cost-to-supply elasticity');
  const affected=parking?assumptionNumber('Parking reform share of baseline development affected'):1;
  const savingStep=parking?`${fmt(spaces,1)} spaces saved × ${simpleMoney(costPer)} per space = ${simpleMoney(saving)} saved per affected home.`:`$50,000 example fee × 50% cut = ${simpleMoney(saving)} saved per home.`;
  let comparison,production;
  const cost=n(r?.scenario_cost_base);
  if(countyFips&&cost!==null&&cost>0){
    const raw=saving/cost,used=Math.min(.30,raw);
    comparison=`${simpleMoney(saving)} ÷ ${simpleMoney(cost)} = ${pct(raw*100,2)} of construction value. ${raw>.30?'The model limits this to 30%.':'This is below the model’s 30% limit.'}`;
    production=`${fmt(m.baseline)} starting permits × ${parking?pct(affected*100,0)+' affected × ':''}${pct(used*100,2)} saved × ${fmt(response,1)} response = about ${fmt(m.added)} extra homes after rounding.`;
  }else if(countyFips){
    comparison='A usable county cost comparison is missing.';production='We cannot complete this cost-based example from the available inputs.';
  }else{
    comparison=`For each county: ${simpleMoney(saving)} ÷ that county’s construction value. Keep at most 30% as the saving share.`;
    production=`For each county: starting permits × ${parking?pct(affected*100,0)+' affected × ':''}saving share × ${fmt(response,1)} response. Round the county answers, adjust for state permit coverage${stateAbbr==='US'?', then add states and DC':''}.`;
  }
  const countySum=n(pf?.countySums?.central?.[policyKey]?.[level]);
  const adjustment=!countyFips&&countySum!==null?`<p>The rounded county answers sum to <b>${fmt(countySum)}</b>. State coverage adjustments and rounding ${m.added-countySum<0?'subtract':'add'} <b>${fmt(Math.abs(m.added-countySum))}</b>, giving <b>${fmt(m.added)} extra homes</b>. We do not substitute one average cost for all counties.</p>`:'';
  return `<ol class="simple-math-steps"><li><b>Find the money saved.</b> ${uiEscape(savingStep)}</li><li><b>Compare the saving with construction value.</b> ${uiEscape(comparison)}</li><li><b>Apply the chosen response.</b> ${uiEscape(production)}</li></ol>${adjustment}<p>A response of ${fmt(response,1)} means we assume ${fmt(response,1)}% more housing for each 1% of construction value saved${parking?' in the affected part':''}.</p>`;
}
function simplePolicyAnswer(){
  const m=metric();
  if(m.added===null)return '<p>The result is unavailable because a required input is missing. It does not mean the policy would add no homes.</p>';
  const reference=m.baseline!==null?`<p class="simple-equation">${fmt(m.baseline)} starting point + ${fmt(m.added)} possible extra = ${fmt(m.total)} in the comparison.</p>`:'';
  const ratio=m.pct===null?'<p>A percentage cannot be calculated from a zero or missing starting point.</p>':`<p>${fmt(m.added)} ÷ ${fmt(m.baseline)} × 100 = <b>${pct(m.pct)}</b> relative to the starting point.${m.pct>100?' A small starting point can make this percentage very large.':''}</p>`;
  const kind=['adu','missing_middle'].includes(policyKey)?'<p>The extra number describes homes added on existing properties. The starting point counts new-building permits, so their sum is a comparison, not a forecast of total completed or existing homes.</p>':'<p>The extra number describes possible permit authorizations if the assumptions hold. It does not prove the homes will be completed or that rents will fall.</p>';
  return `<p>The model gives <b>${fmt(m.added)} possible extra homes over five years</b> under this example.</p>${reference}${ratio}${kind}`;
}
function explanationContext(){
  return {policy:policyKey,policyName:FINAL_NAMES[policyKey],level,place:placeName(),
    scope:countyFips?'county':stateAbbr==='US'?'national':'state',
    metric:metric(),assessment:decisionAssessment(),record:decisionRecord(),policyRecord:policyRecord(),
    forecast:selectedPolicyForecast(),production:selectedProductionForecast(),assumptions:ASSUMPTIONS,
    stateName:stateRec()?.state_name,stateCode:stateAbbr,stateForecasts:FORECAST_POLICY.states,
    result:finalResultView(),dataRelease:window.DATA_RELEASE};
}
resultHtml=function(){return window.TurnoutOptionA.render(explanationContext());};
finalCalculationHtml=function(){return window.TurnoutHowItWorks.render(explanationContext())+supportingMethodsHtml();};
challengePolicyComparisonHtml=function(){
  return simpleDetailedPolicyComparison()
    .replace('Compare all five policies and assumptions','Compare the five what-if examples')
    .replace('Same 2026–2030 permit baseline:','Same five-year starting point:')
    .replaceAll('Net unit potential','Extra homes on existing properties')
    .replaceAll('Permit-equivalent production','Possible extra permits')
    .replace('Default / baseline','Default / starting point')
    .replace('The order is fixed; it is not a suitability ranking. ADU and Missing middle count net unit potential. The other policies count permit-equivalent production. Percentages compare these scenarios with a common permit reference, not completed homes. A larger number does not prove that a policy best meets local needs. The reforms overlap: do not add their results.','Each row tests one policy separately. A bigger number does not prove it is the best choice. The same project may benefit from several policies, so do not add these answers. ADU and Missing middle describe additions to existing properties; the other rows describe extra permits. All percentages use the same permit starting point.');
};
combinedMethodologyHtml=function(){
  const definitions=POLICY_KEYS.map(key=>`<details class="simple-details simple-benchmark"><summary>${uiEscape(POLICIES[key].name)}</summary><p>${uiEscape(simpleRuleText(key))}</p><p><b>Full policy definition:</b> ${uiEscape(CHALLENGE_BENCHMARKS[key])}</p><p><b>What the model counts:</b> ${uiEscape(POLICY_EVIDENCE[key].formula)}</p><p><b>Where the assumptions came from:</b> ${uiEscape(POLICY_EVIDENCE[key].assumption_basis)}</p><p><b>What remains unverified:</b> ${uiEscape(POLICY_EVIDENCE[key].eligibility)}</p></details>`).join('');
  return `<section class="final-explain simple-methodology"><h3>How the tool works</h3><p>We ask: if one housing rule changes, how many extra homes might be possible over five years?</p><section class="simple-method-step"><h4>1. Start with real numbers</h4><p>Census counts building permits and estimates existing homes and households. A permit means permission to build, not a finished home.</p></section><section class="simple-method-step"><h4>2. Choose a what-if example</h4><p>${uiEscape(simpleRuleText())} Low, Default and High test smaller or larger responses. They change our assumptions, while the Census observations stay fixed.</p><p><b>Your choice:</b> ${uiEscape(assumptionMeaning())}</p></section><section class="simple-method-step"><h4>3. Do the math</h4><p>We combine the real numbers with the chosen assumptions. <b>How calculated</b> shows each step for ${uiEscape(placeName())}.</p></section><section class="simple-method-step"><h4>4. Decide what to check locally</h4><p>Check the actual rules, suitable land, willing owners, construction costs and infrastructure. More possible homes do not automatically mean affordable homes.</p><p>These are examples for comparing choices, not promises. Several policies may affect the same project; their answers must not be added.</p></section>${challengePolicyComparisonHtml()}<details class="simple-details"><summary>Understand the five policy definitions</summary>${definitions}</details><details class="simple-details"><summary>Why we use the 2025 building pace</summary><p>We compared four methods using state permit history from 2000–2025. Repeating the latest year did best under our selected state-by-state test. We use that same pace in every future year, which produces a flat line.</p><p>In the reserved 2021–2025 test, the average state error was <b>${pct(FORECAST_VALIDATION.final_test.mean_state_APE)}</b>. That test checks the starting point. It does not show that the assumed policy responses will happen.</p>${countyFips?'<p>The county gets a share of its state’s result from its 2025 permit share. That county forecast has not been tested separately.</p>':''}<details class="simple-details"><summary>See all historical tests and technical limits</summary>${simpleDetailedBaselineMethod()}</details></details>${challengeCoverageHtml().replace('Data coverage for','Available data for')}<details class="simple-details"><summary>Understand the uncertainty and housing needs</summary><p>Low, Default and High are what-if choices, not probabilities. The actual extra housing could be zero. The starting point also has a range based on past errors. The first range covered 35 of 51 states in the reserved test; the updated displayed range has not had a separate test and is not a confidence interval.</p><p>Household, rent and crowding numbers describe people’s existing housing conditions. The 2030 household examples continue past population changes while holding household size and the group-quarters share fixed. They do not count how many new buildings or bedrooms must be built.</p><p>ADU and Missing middle count possible additions to existing properties, while the starting point counts new-building permits. Their sum is a comparison, not a forecast of completed homes or future total housing stock.</p><p>State results add to the U.S. result. ADU and Missing middle add rounded county results. Transit is calculated directly for states. Parking and Fees adjust county sums for state permit coverage. Missing data stays missing; a measured zero stays zero.</p><p>${uiEscape(POLICY_EVIDENCE[policyKey].eligibility)}</p></details></section>`;
};


/* Supporting methods follow the five open steps without repeating Results. */
let supportingMethodsExpanded=false;
function supportingMethodsHtml(){
  const e=POLICY_EVIDENCE[policyKey];
  const definitions=POLICY_KEYS.map(key=>`<details class="simple-details simple-benchmark"><summary>${uiEscape(POLICIES[key].name)}</summary><p><b>Full policy definition:</b> ${uiEscape(CHALLENGE_BENCHMARKS[key])}</p><p><b>What the model counts:</b> ${uiEscape(POLICY_EVIDENCE[key].formula)}</p><p><b>Why these assumptions:</b> ${uiEscape(POLICY_EVIDENCE[key].assumption_basis)}</p><p><b>What remains unverified:</b> ${uiEscape(POLICY_EVIDENCE[key].eligibility)}</p></details>`).join('');
  return `<section class="extended-methods" aria-label="Additional methodology and validation"><details class="simple-details" id="supportingMethods"${supportingMethodsExpanded?' open':''}><summary>More methodology, assumptions and validation</summary><p>The five open steps explain the selected result. These supporting references preserve the full comparisons, tests and technical evidence.</p><h4>Compare policies and assumptions</h4>${challengePolicyComparisonHtml()}<h4>All Low, Default and High inputs</h4>${assumptionTableHtml()}<details class="simple-details"><summary>Technical equations and rounding</summary>${simpleDetailedPolicyMath()}<p><b>Input sources:</b> ${uiEscape(e.source)}</p><p><b>Evidence status:</b> ${uiEscape(e.status)}</p><p><b>Data and purpose:</b> ${uiEscape(e.why)}</p><p><b>Research and its limits:</b> ${uiEscape(e.evidence)}</p><p><b>Outcome limits:</b> ${uiEscape(e.outcome_limit)}</p></details><details class="simple-details"><summary>Historical baseline methods and validation</summary>${simpleDetailedBaselineMethod()}</details>${challengeCoverageHtml().replace('Data coverage for','Available data for')}<details class="simple-details"><summary>Baseline uncertainty and policy response</summary>${simpleDetailedSensitivity()}<p>Low, Default and High are response assumptions. They are not probabilities or confidence intervals, and actual additional production could be zero. The original baseline range covered 35 of 51 states in the reserved test; the displayed updated range has not had an independent coverage test.</p></details><details class="simple-details"><summary>Complete policy definitions and assumption rationale</summary>${definitions}</details><details class="simple-details"><summary>Housing needs, survey uncertainty and geographic limits</summary><p>ACS housing and household counts are survey estimates. Combined survey margins are approximate because the relationships between the source categories are not provided. HUD housing-problem counts have a different reference period and are approximate sums of rounded county values.</p><p>Population and household scenarios continue historical demographic changes; they do not count required new buildings or bedrooms. Changes in vacancy reserves, usable vacant homes, completions, losses, conversions and independent suppressed household formation are not fully established.</p><p>County production references are allocations of state baselines and have no separate county forecast validation. ADU and Missing middle sum rounded county additions; Transit uses direct state exposure. Fees and Parking reconcile county responses with state permit coverage. National outputs sum states and DC. Missing observations remain unavailable.</p><p>${uiEscape(e.eligibility)}</p></details><p class="detail-reference-links"><a href="docs/METHODOLOGY.html" target="_blank" rel="noopener noreferrer">Full model documentation ↗</a><a href="docs/VALIDATION_REPORT.html" target="_blank" rel="noopener noreferrer">Validation report ↗</a></p></details></section>`;
}
combinedMethodologyHtml=supportingMethodsHtml;


/* Keep every source and download; explain their jobs in everyday words. */
function challengeSourceLinks(row){
  const page=row.source_url||row.url,links=[];
  if(page&&page!==row.download_url)links.push(`<a href="${uiEscape(page)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>`);
  if(row.download_url)links.push(`<a href="${uiEscape(row.download_url)}" target="_blank" rel="noopener noreferrer">${uiEscape(row.download_label||'Original file ↓')}</a>`);
  if(row.local_download)links.push(`<a href="${uiEscape(row.local_download)}" download>Download tool data ↓</a>`);
  return links.join('');
}
function combinedSourcesHtml(){
  const catalog=window.SOURCE_CATALOG;
  const acs=catalog.datasets.filter(row=>row.id.startsWith('acs_'));
  const extraIds=['tract_geometry','display_boundaries','ca_population_benchmark','nc_population_benchmark','challenge_and_assumptions'];
  const main=catalog.datasets.filter(row=>!row.id.startsWith('acs_')&&!extraIds.includes(row.id));
  const extra=catalog.datasets.filter(row=>extraIds.includes(row.id));
  const calculated=[
    {title:'The five-year starting point',what:'Yearly permit numbers for 2026–2030.',used:'See how the starting point was added up.',local_download:'data/forecast_2026_2030.csv'},
    {title:'Other starting-point examples',what:'Lower, middle and higher permit totals.',used:'Explore how much the starting point could change.',local_download:'data/state_forecast_summary.csv'},
    {title:'All five policy results',what:'State results for Low, Default and High.',used:'Compare the extra homes from each policy.',local_download:'data/policy_state_comparisons.csv'},
    {title:'The assumptions we chose',what:'The numbers used for each policy.',used:'Check what changes when you choose Low or High.',local_download:'data/policy_parameter_assumptions.csv'},
    {title:'How we compared forecasting methods',what:'Past errors for the four methods tested.',used:'See why we kept the 2025 permit pace.',local_download:'data/forecast_method_test_scores.csv'},
    {title:'How the method did on 2021–2025',what:'Predicted and actual state permit totals.',used:'See the results of the reserved historical test.',local_download:'data/forecast_final_state_holdout.csv'}
  ];
  return `<section class="final-explain simple-sources"><h3>Where the numbers come from</h3><p>Open the original source, or download the numbers used in this tool.</p>${challengeSourceTable(main)}<details class="challenge-source-group"><summary>Existing homes and households · ${acs.length} Census tables</summary><p>ACS means American Community Survey. These are estimates collected during 2020–2024.</p>${challengeSourceTable(acs)}</details><details class="challenge-source-group"><summary>Maps, population checks and policy definitions</summary>${challengeSourceTable(extra)}</details><details class="challenge-source-group"><summary>Download our calculations · ${calculated.length} files</summary>${challengeSourceTable(calculated)}</details><details class="challenge-source-group"><summary>Research behind the methods · ${catalog.research.length} sources</summary>${challengeSourceTable(catalog.research)}</details></section>`;
}
function challengeSourceTable(rows){
  return `<div class="challenge-source-wrap"><table class="challenge-source-table"><thead><tr><th>Data source</th><th>What we use it for</th><th>Open / download</th></tr></thead><tbody>${rows.map(row=>`<tr${row.id?` data-source-id="${uiEscape(row.id)}"`:''}><td><b>${uiEscape(row.title)}</b>${row.what?`<span>${uiEscape(row.what)}</span>`:''}${row.note?`<details class="simple-source-note"><summary>About this data</summary><small>${uiEscape(row.note)}</small></details>`:''}</td><td>${uiEscape(row.used)}</td><td class="challenge-source-downloads">${challengeSourceLinks(row)}</td></tr>`).join('')}</tbody></table></div>`;
}


/* Short labels for the map and its hover explanations. */
const simpleOriginalTip=showTip;
showTip=function(event,html){
  const plain=html
    .replaceAll('Possible added:','Possible extra:')
    .replaceAll('5-year baseline:','Five-year starting point:')
    .replaceAll('Modeled impact:','Extra as % of starting point:')
    .replaceAll('Normalized impact:','Percentage:')
    .replace(/(Five-year starting point:<\/b>[^<]+) homes/g,'$1 permits')
    .replaceAll('county supporting evidence; state result remains authoritative','County example; the state is the main model result')
    .replaceAll('authoritative state result','State model result')
    .replace(/No usable county production baseline for a percentage comparison\. County evidence is supporting only; ([^<]+)'s ([^<]+) state impact is authoritative\./g,(_,place,value)=>`A percentage needs a starting point above zero. ${place}'s state comparison is ${value}.`);
  simpleOriginalTip(event,plain);
};
impactLabel=function(value){
  const category=impactClass(value);
  return category?`${category.label} extra compared with the starting point`:'A percentage needs a starting point above zero';
};
const simpleOriginalGeographyLegend=updateGeographyLegend;
updateGeographyLegend=function(tractMode){
  simpleOriginalGeographyLegend(tractMode);
  if(!tractMode){const title=document.querySelector('.legend-title');if(title)title.innerHTML='EXTRA HOMES (%) <span>compared with the five-year starting point</span>';}
};


/* Option A's bounded desktop fit affects presentation only. */
let optionAFitTicket=0;
function fitOptionAResults(){
  const pane=$('resultPane'),card=pane?.querySelector?.('.tv-compact');
  if(!pane||!card||currentTab!=='result'||pane.clientHeight<=0)return;
  card.style.zoom='1';card.style.minHeight='0';card.style.alignContent='start';pane.style.setProperty('overflow-y','auto','important');
  if(window.innerWidth<1180)return;
  const paneStyle=getComputedStyle(pane);
  const available=pane.clientHeight-parseFloat(paneStyle.paddingTop)-parseFloat(paneStyle.paddingBottom)-2;
  let best=1;
  for(let size=1.02;size>=.78;size-=.01){
    const rounded=Math.round(size*100)/100;
    card.style.zoom=String(rounded);
    if(card.getBoundingClientRect().height<=available){best=rounded;break;}
  }
  card.style.zoom=String(best);
  if(card.getBoundingClientRect().height<=available){
    card.style.minHeight=Math.max(0,available/best-2)+'px';
    card.style.alignContent='space-between';
    const excess=card.getBoundingClientRect().height-available;
    if(excess>0)card.style.minHeight=Math.max(0,parseFloat(card.style.minHeight)-(excess+2)/best)+'px';
    if(card.getBoundingClientRect().height>available){card.style.minHeight='0';card.style.alignContent='start';}
    pane.style.setProperty('overflow-y','hidden','important');
  }else{card.style.zoom='1';card.style.minHeight='0';card.style.alignContent='start';pane.style.setProperty('overflow-y','auto','important');}
}
function scheduleOptionAFit(){
  if(typeof requestAnimationFrame!=='function')return;
  if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(optionAFitTicket);
  optionAFitTicket=requestAnimationFrame(fitOptionAResults);
}
if(typeof window.addEventListener==='function')window.addEventListener('resize',scheduleOptionAFit);
document.fonts?.ready?.then(scheduleOptionAFit);


document.addEventListener('DOMContentLoaded',init);
})();
