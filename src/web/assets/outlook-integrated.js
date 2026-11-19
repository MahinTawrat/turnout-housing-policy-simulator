(()=>{'use strict';
const STATES={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
const $=id=>document.getElementById(id);const num=x=>x==null||x===''?null:Number.isFinite(Number(x))?Number(x):null;
const fmt=(v,dec=0)=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:dec,minimumFractionDigits:dec});
const pct=v=>v===null||v===undefined||!Number.isFinite(v)?'—':v.toFixed(1)+'%';
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const caption=['1-unit','2-unit','3–4 units','5+ units'];const years=Array.from({length:25},(_,k)=>2026+k);const yearIdx={one:0,two:1,three:2,five:3,total:5};
let STATE=null;let latest=null;let loadToken=0;let simulator=null;
function option(sel,val,text){const o=document.createElement('option');o.value=val;o.textContent=text;sel.append(o)}

function current(){return STATE||null}
function settings(){return {end:+$('endYear').value,type:$('building').value,production:$('production').value,population:$('population').value,policy:simulator?.policy==='missing_middle'?'middle':(simulator?.policy||'none'),policy5Year:simulator?.fiveYearAdded,level:simulator?.level||'default',model:$('model').value}}
function popGrowth(n){const p0=num(n.p20),p5=num(n.p25);return p0>0&&p5>0?clamp(Math.pow(p5/p0,1/5)-1,-.02,.03):0}
function taper(k){return k<=10?1:Math.max(.4,1-.04*(k-10))}
function project(c,opt){const n=c.needs||{},p=c.policy||{},s=opt||settings();const h2025=c.history.find(a=>a[0]===2025);const anchorName=c.anchors[s.model]?s.model:'constant_2025_reference';const a=c.anchors[anchorName];
 const pg=popGrowth(n),sg=clamp(pg*.6,-.012,.015),pf={low:.82,central:1,high:1.18}[s.production]||1,drift={low:.996,central:1,high:1.004}[s.production]||1;
 const popDiff={slow:-.004,trend:0,fast:.004}[s.population]||0;
 const p25=num(n.p25),p2025=p25>0?p25:null,pa=num(n.pa),stock=num(n.hu),hh0=num(n.hh);
 const hh2025=hh0!==null&&p2025!==null&&pa>0?hh0*p25/pa:null;
 let pc=p2025,comp=0,pendingTypes=h2025?h2025.slice(1,5).map(Number):[0,0,0,0],pendingPolicy=0;
 const bedroomMix=getBedroomMix(c);const forecast=[];let mult=1;
 for(let i=0;i<25;i++){const year=2026+i,k=i+1;
  if(k>=2 && anchorName!=='constant_2025_reference')mult*=1+sg*taper(k);
  const base=a.map(z=>Math.max(0,Number(z)*mult*pf*Math.pow(drift,k-1)));
  const baseTotal=base.reduce((sum,x)=>sum+x,0);
  // The primary simulator owns reform calibration. Its exact five-year increment
  // is divided over 2026–2030; after 2030 the effect is extended conditionally.
  // This prevents two different policy formulas on the same page.
  const policyFive=num(s.policy5Year);
  const base2025=a.reduce((z,x)=>z+(num(x)||0),0);
  const relativePace=base2025>0?clamp(baseTotal/(base2025*pf||1),.25,4):1;
  const added=policyFive===null?0:(policyFive/5)*(k<=5?1:Math.max(.20,Math.exp(-.025*(k-5))*relativePace));
  const unallocated=num(c.meta?.unallocated2025)||0;
  const extraBaseline=unallocated*pf*Math.pow(drift,k-1);
  const total=baseTotal+extraBaseline+added;
  if(pc!==null)pc*=1+clamp(pg*taper(k)+popDiff,-.03,.035);
  const household=hh2025!==null&&pc!==null?hh2025*(pc/p25)*Math.pow(1.0005,k):null;
  const requirement=household!==null?((household-hh2025)/.95+(stock!==null?.0015*stock*k:0)):null;
  const completed=0.85*(pendingTypes.reduce((a,b)=>a+b,0)+pendingPolicy);
  const deliveredMix=[0,0,0,0,0];
  for(let j=0;j<4;j++)for(let b=0;b<5;b++)deliveredMix[b]+=.85*pendingTypes[j]*bedroomMix[j][b];
  const policyBed=policyBedroomMix(s.policy,bedroomMix);
  for(let b=0;b<5;b++)deliveredMix[b]+=.85*pendingPolicy*policyBed[b];
  comp+=completed;
  const prev=forecast.length?forecast[forecast.length-1].completedBedroom:[0,0,0,0,0];
  const cumBed=prev.map((v,b)=>v+deliveredMix[b]);
  forecast.push({year,base,added,total,population:pc,households:household,requirement,completedCumulative:comp,completedYear:completed,
    balance:requirement!==null?comp-requirement:null,completedBedroom:cumBed});
  pendingTypes=base;pendingPolicy=added;
 }
 return {forecast,hh2025,pop2025:p2025,bedroomMix};
}
function normalize(a,def){const x=(a||[]).map(z=>Math.max(0,num(z)||0));const total=x.reduce((a,b)=>a+b,0);return total>0?x.map(z=>z/total):def.slice()}
function getBedroomMix(c){const b=c.bedrooms||{};const owner=(b.ownerBeds||[]),renter=(b.renterBeds||[]);
 const o=normalize([owner[0],owner[1],owner[2],owner[3],(num(owner[4])||0)+(num(owner[5])||0)],[.01,.025,.17,.52,.275]);
 const r=normalize([renter[0],renter[1],renter[2],renter[3],(num(renter[4])||0)+(num(renter[5])||0)],[.1,.36,.37,.15,.02]);
 const mix=(a,b,t)=>a.map((x,i)=>x*t+b[i]*(1-t));
 return [o,mix(r,[.04,.30,.40,.20,.06],.5),mix(r,[.09,.40,.35,.13,.03],.7),mix(r,[.12,.44,.31,.1,.03],.4)];
}
function policyBedroomMix(p,m){return p==='adu'?[.16,.60,.20,.04,0]:p==='middle'?[.04,.31,.40,.20,.05]:p==='tod'?[.14,.46,.30,.08,.02]:m[3]}
function householdBedroomDemand(c,amount){const h=c.needs||{};const hh=[num(h.h1)||0,num(h.h2)||0,num(h.h3)||0];const total=hh.reduce((s,x)=>s+x,0);if(total<=0||amount<=0)return [0,0,0,0,0];const weights=[[.20,.65,.15,0,0],[0,.20,.65,.15,0],[0,0,.18,.53,.29]];const shares=hh.map(x=>x/total);return Array.from({length:5},(_,b)=>amount*shares.reduce((v,sh,i)=>v+sh*weights[i][b],0));}
function svgEl(tag,attr,text){let e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attr||{}))e.setAttribute(k,String(v));if(text!==undefined)e.textContent=text;return e}
// One plot, multiple coherent views.  Do not mix people and housing-unit scales
// unless explicitly indexed: the indexed view rebases every modeled series to 2026=100.
const GRAPH_MODES={
 all:{title:'All indicators · indexed trends',units:'Index (each series, 2026 = 100)',desc:'Compare relative changes in permits, policy effects, households, population and completions—not their absolute levels.',keys:['historic','with_policy','one','five','completed_annual','population','households','requirement','completed_cumulative']},
 supply:{title:'Housing permits and policy effect',units:'Annual housing-unit permits',desc:'Observed permits to 2025; projected current-rules permits, with-policy total and policy-added units afterward.',keys:['historic','base','with_policy','policy_added','completed_annual']},
 type:{title:'Permits by structure type',units:'Annual housing-unit permits',desc:'Newly permitted units in 1-unit, 2-unit, 3–4-unit and 5+-unit buildings; policy additions are unclassified.',keys:['one','two','three','five']},
 balance:{title:'Housing requirements and indicative delivery',units:'Cumulative homes / households',desc:'Estimated completion, incremental household-based requirement and indicative balance since 2025.',keys:['completed_cumulative','requirement','new_households','balance']},
 people:{title:'Population and households',units:'Population / households',desc:'Projected residents and households; overlapping units are shown on one numerical axis for context, not equivalence.',keys:['population','households']},
 bedrooms:{title:'Estimated bedrooms in new homes and household preferences',units:'Cumulative homes / households',desc:'The five bedroom sizes appear as estimated new-home supply and household-size-based preference proxies.',keys:['bed_supply_0','bed_supply_1','bed_supply_2','bed_supply_3','bed_supply_4','bed_need_0','bed_need_1','bed_need_2','bed_need_3','bed_need_4']}
};
const GRAPH_INFO={
 historic:['Observed total permits','#343f4c'],base:['Current-rules permits','#855748'],with_policy:['With-policy permits','#a3294f'],policy_added:['Policy-added permits','#d48a3d'],
 one:['1-unit permits','#1c7895'],two:['2-unit permits','#51a18f'],three:['3–4-unit permits','#749346'],five:['5+-unit permits','#6d4db1'],
 completed_annual:['Illustrative completions / year','#d07164'],population:['Population','#266a9a'],households:['Households','#ad6632'],
 completed_cumulative:['Cumulative completions','#067b71'],requirement:['Incremental housing requirement','#b66337'],new_households:['Net additional households','#8661a6'],balance:['Planning balance','#9b2948'],
 bed_supply_0:['Studio supply','#54838e'],bed_supply_1:['1-bed supply','#2b8b7c'],bed_supply_2:['2-bed supply','#285b9b'],bed_supply_3:['3-bed supply','#7a5ea4'],bed_supply_4:['4+-bed supply','#a26c64'],
 bed_need_0:['Studio demand proxy','#afc6d0'],bed_need_1:['1-bed preference proxy','#a7d2c6'],bed_need_2:['2-bed preference proxy','#a7bde0'],bed_need_3:['3-bed preference proxy','#c7bbe0'],bed_need_4:['4+-bed preference proxy','#d6b7b2']
};
let graphChosenMode='all', graphShown=new Set(['historic','with_policy','one','five','completed_annual','population','households']);
let graphRows=[],graphSeries={},graphRendered=null;
function graphData(c,opt,q,missing){
 const out={};for(const k of Object.keys(GRAPH_INFO))out[k]=new Map();
 if(!missing){for(const h of c.history||[]){const y=Number(h[0]);if(!Number.isFinite(y)||y<1990||y>2025)continue;
  out.historic.set(y,num(h[5]));for(const [j,key] of ['one','two','three','five'].entries())out[key].set(y,num(h[j+1]));}}
 if(q){for(const r of q.forecast.filter(a=>a.year<=opt.end)){
  const y=r.year;
  if(!missing){out.base.set(y,r.base.reduce((sum,x)=>sum+x,0)+(num(c.meta?.unallocated2025)||0)*({low:.82,central:1,high:1.18}[opt.production]||1)*Math.pow(({low:.996,central:1,high:1.004}[opt.production]||1),y-2026));
    out.with_policy.set(y,r.total);out.policy_added.set(y,r.added);out.completed_annual.set(y,r.completedYear);
    for(const [j,key] of ['one','two','three','five'].entries())out[key].set(y,r.base[j]);
    out.completed_cumulative.set(y,r.completedCumulative);out.requirement.set(y,r.requirement);out.balance.set(y,r.balance);
    const net=r.households!==null&&q.hh2025!==null?r.households-q.hh2025:null;out.new_households.set(y,net);
    const need=net!==null?householdBedroomDemand(c,Math.max(0,net)):[null,null,null,null,null];
    for(let j=0;j<5;j++){out['bed_supply_'+j].set(y,r.completedBedroom[j]);out['bed_need_'+j].set(y,need[j]);}
  }
  out.population.set(y,r.population);out.households.set(y,r.households);
 }}
 const p25=num(c.needs?.p25),h25=q?.hh2025;
 if(p25!==null&&p25>0)out.population.set(2025,p25);
 if(h25!==null&&h25>0)out.households.set(2025,h25);
 return out;
}
function graphModeChanged(){graphChosenMode=$('graphMode').value;
 const defaults=GRAPH_MODES[graphChosenMode].keys;
 const preset={all:['historic','with_policy','one','five','completed_annual','population','households'],supply:['historic','base','with_policy','policy_added'],type:['one','two','three','five'],balance:['completed_cumulative','requirement','new_households','balance'],people:['population','households'],bedrooms:['bed_supply_1','bed_supply_2','bed_supply_3','bed_need_1','bed_need_2','bed_need_3']};
 graphShown=new Set(preset[graphChosenMode]||defaults);refreshGraph();}
function graphLegend(){const legend=$('graphLegend');if(!legend)return;legend.replaceChildren();for(const key of GRAPH_MODES[graphChosenMode].keys){
 const b=document.createElement('label');b.className='graph-chip';const inp=document.createElement('input');inp.type='checkbox';inp.checked=graphShown.has(key);inp.dataset.series=key;inp.addEventListener('change',()=>{if(inp.checked)graphShown.add(key);else graphShown.delete(key);refreshGraph(false)});
 const sw=document.createElement('i');sw.style.background=GRAPH_INFO[key][1];const txt=document.createElement('span');txt.textContent=GRAPH_INFO[key][0];b.append(inp,sw,txt);legend.append(b);}}
function plotSeries(key,mode){const d=graphSeries[key];if(!d)return[];
 if(mode!=='all')return [...d.entries()].filter(([y,v])=>Number.isFinite(v)&&y<=graphRendered.end).sort((a,b)=>a[0]-b[0]);
 // Relative trends are explicitly rebased to their own 2026 value; no shared
 // denominator is implied across people, homes, permit flows or stock.
 const base=key==='historic'?d.get(2025):d.get(2026);if(!(base>0))return [];
 return [...d.entries()].filter(([y,v])=>Number.isFinite(v)&&y<=graphRendered.end).map(([y,v])=>[y,v/base*100]).sort((a,b)=>a[0]-b[0]);
}
function graphDisplayNumber(v){if(v===null||!Number.isFinite(v))return '—';if(Math.abs(v)>=1e6)return (v/1e6).toFixed(1)+'m';if(Math.abs(v)>=1000)return (v/1000).toFixed(1)+'k';return fmt(v,Math.abs(v)<100?1:0);}
function refreshGraph(rebuildLegend=true){const svg=$('unifiedGraphSvg');if(!svg)return;
 const mode=graphChosenMode,config=GRAPH_MODES[mode];$('graphMode').value=mode;
 $('graphTitle').textContent=(simulator?.place||STATE?.name||'United States')+' · '+config.title;
 $('graphDescription').textContent=config.desc;
 $('graphCaveat').textContent=(mode==='all'?'Each displayed series is indexed to its own 2026 estimate (each series, 2026 = 100); levels and units are NOT directly comparable. ':'')+'Observed Census permits end in 2025; future values are conditional scenarios. Permit authorizations are not completions. Policy-added units are not classified by building type.';
 if(rebuildLegend)graphLegend();svg.replaceChildren();
 if(!graphRendered){svg.append(svgEl('text',{x:480,y:160,'text-anchor':'middle','font-size':'17',fill:'#79695d'},'Select a place to load graph data'));return;}
 const left=68,right=931,top=22,bottom=292,yearStart=(mode==='balance'||mode==='bedrooms')?2025:1990,end=graphRendered.end;
 const selected=GRAPH_MODES[mode].keys.filter(key=>graphShown.has(key));const series=selected.map(key=>({key,points:plotSeries(key,mode)})).filter(s=>s.points.length);
 const vals=series.flatMap(s=>s.points.map(d=>d[1]));if(!vals.length){svg.append(svgEl('text',{x:480,y:165,'text-anchor':'middle','font-size':15,fill:'#79695d'},'No comparable observations for this selection'));setText('graphReadout','No series available for the selected place and graph mode.');return;}
 let low=Math.min(0,...vals),high=Math.max(1,...vals);if(mode==='all'){low=Math.min(0,low);high=Math.max(125,high);}const pad=(high-low)*.09||1;high+=pad;if(low<0)low-=pad;
 const sx=y=>left+(y-yearStart)/(end-yearStart)*(right-left),sy=v=>bottom-(v-low)/(high-low)*(bottom-top);
 for(let i=0;i<5;i++){const value=low+(high-low)*i/4,yy=sy(value);svg.append(svgEl('line',{x1:left,x2:right,y1:yy,y2:yy,stroke:'#e7e1db','stroke-width':1}),svgEl('text',{x:left-8,y:yy+4,'text-anchor':'end',class:'graph-axis'},mode==='all'?value.toFixed(0):graphDisplayNumber(value)));}
 const ticks=mode==='all'?[1990,2000,2010,2020,2026,2030,2035,2040,2045,2050]:[1990,2000,2010,2020,2025,2030,2035,2040,2045,2050];
 for(const y of ticks)if(y>=yearStart&&y<=end)svg.append(svgEl('text',{x:sx(y),y:318,'text-anchor':'middle',class:'graph-axis'},String(y)));
 if(yearStart<2025&&end>2025){svg.append(svgEl('line',{x1:sx(2025),x2:sx(2025),y1:top,y2:bottom,stroke:'#958e87','stroke-dasharray':'4,5','stroke-width':1.3}));svg.append(svgEl('text',{x:sx(2025)-6,y:16,'text-anchor':'end',class:'graph-axis'},'Actual → Scenario'));}
 for(const item of series){const color=GRAPH_INFO[item.key][1];let segments=[[]];let prev=null;
 for(const v of item.points){if(prev!==null&&v[0]-prev>1){segments.push([])}segments[segments.length-1].push(v);prev=v[0];}
 for(const segment of segments){if(segment.length<2)continue;
 svg.append(svgEl('polyline',{points:segment.map(([y,v])=>sx(y).toFixed(1)+','+sy(v).toFixed(1)).join(' '),fill:'none',stroke:color,'stroke-width':item.key==='with_policy'?3.2:2.1,'stroke-dasharray':item.key.startsWith('bed_need')?'5,5':'none','stroke-linejoin':'round','stroke-linecap':'round'}));}}
 const yearInput=$('graphYear');yearInput.min=String(yearStart);yearInput.max=String(end);if(+yearInput.value>end||+yearInput.value<yearStart)yearInput.value=String(end);
 const marker=svgEl('line',{id:'graphCursor',x1:sx(+yearInput.value),x2:sx(+yearInput.value),y1:top,y2:bottom,stroke:'#7b5b55','stroke-width':1.2,'stroke-dasharray':'3,3'});svg.append(marker);
 const overlay=svgEl('rect',{x:left,y:top,width:right-left,height:bottom-top,fill:'transparent',style:'cursor:crosshair'});svg.append(overlay);
 overlay.addEventListener('pointermove',e=>{const r=svg.getBoundingClientRect();const pixel=(e.clientX-r.left)/r.width*960;const year=Math.max(yearStart,Math.min(end,Math.round(yearStart+(pixel-left)/(right-left)*(end-yearStart))));yearInput.value=String(year);readGraphYear(year,sx)});
 yearInput.oninput=()=>readGraphYear(+yearInput.value,sx);
 readGraphYear(+yearInput.value,sx);
}
function readGraphYear(year,sx){setText('graphYearValue',String(year));const cursor=$('graphCursor');if(cursor&&sx){cursor.setAttribute('x1',sx(year));cursor.setAttribute('x2',sx(year));}
 const read=$('graphReadout');if(!read||!graphRendered)return;const mode=graphChosenMode;read.replaceChildren();const label=document.createElement('strong');label.textContent=year+(year<=2025?' · observed where available':' · modeled scenario');read.append(label);
 for(const key of GRAPH_MODES[mode].keys){if(!graphShown.has(key))continue;const val=graphSeries[key]?.get(year);if(val===null||val===undefined||!Number.isFinite(val))continue;
 const item=document.createElement('div');item.className='graph-value';const sw=document.createElement('i');sw.style.background=GRAPH_INFO[key][1];const name=document.createElement('span');name.textContent=GRAPH_INFO[key][0];const value=document.createElement('b');value.textContent=fmt(val,0)+(mode==='all'&&year>=2026?' · index '+(graphSeries[key].get(2026)>0?(val/graphSeries[key].get(2026)*100).toFixed(1):'—'):'');item.append(sw,name,value);read.append(item);}}
function renderUnifiedGraph(c,opt,q,missing=false){graphRendered={end:opt.end,missing};graphSeries=graphData(c,opt,q,missing);if(['one','two','three','five'].includes(opt.type)&&['all','type'].includes(graphChosenMode))graphShown.add(opt.type);refreshGraph();}
function downloadGraphData(){if(!graphRendered)return;
 const keys=GRAPH_MODES[graphChosenMode].keys.filter(k=>graphShown.has(k));
 const isIndexed=graphChosenMode==='all';
 const columns=['year','period',...keys.flatMap(k=>isIndexed?[k+'_raw',k+'_index']: [k])];
 const time=Array.from({length:graphRendered.end-1990+1},(_,i)=>1990+i);
 const rows=time.map(y=>[y,y<=2025?'observed_where_available':'modeled',...keys.flatMap(k=>{
  const val=graphSeries[k]?.get(y),v=val!==null&&val!==undefined&&Number.isFinite(val)?val.toFixed(3):'';
  if(!isIndexed)return [v];
  const denominator=k==='historic'?graphSeries[k]?.get(2025):graphSeries[k]?.get(2026);
  return [v,v!==''&&Number.isFinite(denominator)&&denominator>0?(Number(val)/denominator*100).toFixed(3):''];
 })]);
 emitCSV('Turnout2_'+(simulator?.county||simulator?.state||'US')+'_'+graphChosenMode+'_'+graphRendered.end+'.csv',columns,rows);
}

function setText(id,v){$(id).textContent=v}
function newRow(dl,label,val){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=val;dl.append(dt,dd)}
function drawBars(el,items){el.replaceChildren();const max=Math.max(1,...items.map(x=>x[1]));items.forEach(([label,val])=>{const row=document.createElement('div');row.className='bar-row';const lbl=document.createElement('span');lbl.textContent=label;const wrap=document.createElement('div');wrap.className='bar-track';const fill=document.createElement('span');fill.className='bar-fill';fill.style.width=(val/max*100)+'%';wrap.append(fill);const t=document.createElement('strong');t.textContent=fmt(val);row.append(lbl,wrap,t);el.append(row)})}
function drawBedrooms(c,forecast,amount){const newSupply=forecast.completedBedroom;const newDemand=householdBedroomDemand(c,amount);const max=Math.max(1,...newSupply,...newDemand);let parent=$('bedBars');parent.replaceChildren();for(const heading of ['Bedroom size','Modeled new homes','New household preferences']){const d=document.createElement('div');d.className='th';d.textContent=heading;parent.append(d)}
 ['Studio','1 bedroom','2 bedrooms','3 bedrooms','4+ bedrooms'].forEach((label,i)=>{const n=document.createElement('span');n.className='bed-label';n.textContent=label;parent.append(n);for(const [cls,value] of [['supply',newSupply[i]],['need',newDemand[i]]]){const b=document.createElement('div');b.className='bed-group '+cls;const bar=document.createElement('i');bar.style.width=Math.max(1,value/max*80)+'%';const s=document.createElement('small');s.textContent=fmt(value);b.append(bar,s);parent.append(b)}});
 return {newSupply,newDemand};
}
function safeCSV(v){const s=String(v??'');return /[",\n\r]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}
function emitCSV(filename,columns,rows){const csv=[columns,...rows].map(a=>a.map(safeCSV).join(',')).join('\r\n')+'\r\n';const blob=new Blob(['\ufeff',csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000)}
function renderMissing(c){updateBridge();const s=settings(),q=project(c,s),e=q.forecast.find(r=>r.year===s.end);latest=null;
 for(const id of ['metricHistory','metricPermits','metricComplete','metricBalance','requirement','completedCompare','policyAdded'])setText(id,'—');
 $('metricBalance').className='';
 setText('metricHH',e.households!==null&&q.hh2025!==null?fmt(e.households-q.hh2025):'—');
 setText('metricHistoryDetail','County BPS record unavailable for 2025');setText('metricPermitsDetail','Permit forecast withheld: no BPS history');
 setText('selectionNote',`${simulator?.place||c.name} · county-level permit record unavailable in supplied 2025 Census BPS. Existing housing and demographic conditions are shown; no zero-production assumption is made.`);

 renderUnifiedGraph(c,s,q,true);
 $('typeBars').replaceChildren();$('bedBars').replaceChildren();$('trackSupply').style.width='0%';$('trackDemand').style.width='0%';
 setText('balanceExplanation','Household trends can be explored, but the supply balance is not calculated without a county permit baseline. Missing does not mean zero construction.');
 const dl=$('householdStats');dl.replaceChildren();newRow(dl,'2025 anchored households',fmt(q.hh2025));newRow(dl,`${s.end} projected households`,fmt(e.households));newRow(dl,'Production evidence','Insufficient for this county code');
 setText('pop2025',fmt(q.pop2025));setText('popFuture',fmt(e.population));setText('stock',fmt(c.needs?.hu));setText('hhNow',fmt(q.hh2025));
 const nf=$('needFacts');nf.replaceChildren();newRow(nf,'ACS households',fmt(c.needs?.hh));newRow(nf,'Existing vacant units',fmt(c.needs?.vacant));newRow(nf,'ACS median household income',num(c.needs?.income)!==null?'$'+fmt(c.needs.income):'—');newRow(nf,'CHAS low-income renter problems',fmt(c.chas?.lowProblem));
 setText('affordNote','County population, housing and HUD CHAS context is available; permit-based production and bedroom forecasts are not generated when the observed permit baseline is absent.');
 const qa=$('qualityFacts');qa.replaceChildren();newRow(qa,'Permit history','Missing for current 2025 BPS county code');newRow(qa,'2021–2025 comparable backtest','Unavailable');newRow(qa,'Modeled supply confidence','No production forecast published');
 setText('qualityNote','A missing historical permit record does not imply zero new housing. Add verified county permit records or a documented geographic crosswalk to make this county forecastable.');
 $('downloadSelected').disabled=true;$('downloadBedrooms').disabled=true;
}
function render(){const c=current();if(!c)return;updateBridge();const s=settings();if(!c.history?.length){renderMissing(c);return}$('downloadSelected').disabled=false;$('downloadBedrooms').disabled=false;const q=project(c,s);const end=q.forecast.find(r=>r.year===s.end);const lo=project(c,{...s,production:'low'});const hi=project(c,{...s,production:'high'});
 const hist=c.history.find(a=>a[0]===2025);const idx=yearIdx[s.type];const obs=idx===5?hist[5]+(num(c.meta?.unallocated2025)||0):hist[idx+1];const forecastArr=q.forecast.filter(r=>r.year<=s.end);
 const permits=forecastArr.reduce((sum,r)=>sum+(idx===5?r.total:r.base[idx]),0);const added=forecastArr.reduce((sum,r)=>sum+r.added,0);
 setText('metricHistory',fmt(obs));setText('metricPermits',fmt(permits));setText('metricComplete',fmt(end.completedCumulative));setText('metricHH',end.households===null||q.hh2025===null?'—':fmt(end.households-q.hh2025));setText('metricBalance',fmt(end.balance));
 $('metricBalance').className=end.balance!==null?(end.balance>=0?'good':'bad'):'';
 setText('metricHistoryDetail',s.type==='total'?(c.meta?'County-assigned plus unallocated 2025 permits':'All four observed structure categories'):$('building').selectedOptions[0].textContent+' observed units');
 setText('metricPermitsDetail',(s.type==='total'?'All housing types':'Selected building type')+' · 2026–'+s.end);


 setText('selectionNote',`${simulator?.place||c.name} · ${simulator?.policy||'selected reform'} · ${simulator?.level||'default'} response · Graph horizon ${s.end}. The five-year policy increment comes from the simulator; other years are conditional scenarios. Unclassified policy additions are excluded from building-type totals.`);
 renderUnifiedGraph(c,s,q,false);
 const cumulative=Array.from({length:4},(_,i)=>forecastArr.reduce((sum,r)=>sum+r.base[i],0));drawBars($('typeBars'),caption.map((v,i)=>[v,cumulative[i]]));setText('policyAdded',fmt(added));
 setText('requirement',fmt(end.requirement));setText('completedCompare',fmt(end.completedCumulative));
 const width=Math.max(1,Math.max(0,end.requirement||0),end.completedCumulative);$('trackDemand').style.width=(Math.max(0,end.requirement||0)/width*100)+'%';$('trackSupply').style.width=(end.completedCumulative/width*100)+'%';
 setText('balanceExplanation',`Indicative balance: ${fmt(end.completedCumulative)} assumed completions − ${fmt(end.requirement)} incremental stock requirement = ${fmt(end.balance)} homes. Positive balances are NOT verified market surpluses; negative balances are NOT measured existing shortages.`);
 const dl=$('householdStats');dl.replaceChildren();newRow(dl,'2025 anchored households',fmt(q.hh2025));newRow(dl,`${s.end} projected households`,fmt(end.households));newRow(dl,'Assumed housing reserve','5% vacancy target');newRow(dl,'Replacement assumption','0.15% of 2024 stock/year');newRow(dl,'Completions from authorized permits','85%, lagged one year');
 const hhNet=end.households!==null&&q.hh2025!==null?Math.max(0,end.households-q.hh2025):0;
 latest={county:c,settings:s,series:q,bedrooms:drawBedrooms(c,end,hhNet)};
 setText('pop2025',fmt(q.pop2025));setText('popFuture',fmt(end.population));setText('stock',fmt(c.needs?.hu));setText('hhNow',fmt(q.hh2025));
 const nf=$('needFacts');nf.replaceChildren();newRow(nf,'2024 ACS occupied households',fmt(c.needs?.hh));newRow(nf,'ACS average household size',num(c.needs?.avgHH)!==null?fmt(c.needs.avgHH,2):'—');newRow(nf,'ACS vacant units (all types)',fmt(c.needs?.vacant));newRow(nf,'Median household income (ACS)',num(c.needs?.income)!==null?'$'+fmt(c.needs.income):'Not aggregated');
 newRow(nf,'Median gross rent, 2 bedrooms (ACS)',num(c.bedrooms?.rents?.[2])!==null?'$'+fmt(c.bedrooms.rents[2]):'Not aggregated');newRow(nf,'Low-income renter households with housing problems (CHAS)',fmt(c.chas?.lowProblem));
 const futureProblem=c.chas?.lowProblem!=null&&q.hh2025>0&&end.households!==null?Number(c.chas.lowProblem)*end.households/q.hh2025:null;
 setText('affordNote',`HUD CHAS 2018–2022: ${fmt(c.chas?.lowProblem)} lower-income renter households with problems, from ${fmt(c.chas?.lowTotal)} in the applicable group. If the baseline rate persisted and households changed proportionately, the illustrative count in ${s.end} would be ${fmt(futureProblem)}. This is a constant-incidence thought experiment—not an affordability forecast or verified policy benefit.`);
 const qa=$('qualityFacts');qa.replaceChildren();newRow(qa,'Historical annual observations',c.meta?('Aggregate of '+fmt(c.meta.counties_permit)+' county permit series'):fmt(c.quality?.history_years)+' of 36 possible');newRow(qa,'2021–2025 comparison',c.meta?'See state/county retrospective comparisons':(c.quality?.has_holdout?'Available':'Not comparable under current county code'));newRow(qa,'Candidate retrospective 5-year county error',c.quality?.has_holdout?pct(num(c.quality?.development_error_pct)):'—');newRow(qa,'Previous-year retrospective 5-year error',c.quality?.has_holdout?pct(num(c.quality?.previous_year_error_pct)):'—');newRow(qa,'National candidate county WAPE','20.17% (2021–2025)');newRow(qa,'Source of future growth','Capped 2020–2025 population trend + sensitivities');newRow(qa,'Geography coverage',c.meta?`${fmt(c.meta.counties_permit)} of ${fmt(c.meta.counties_total)} county equivalents with permit histories; ${fmt(c.meta.unallocated2025)} annual units unassigned to counties`:'2025 county code; historical predecessor changes not harmonized');
 setText('qualityNote',c.meta?'State and national histories are sums of county-assigned records; their long-run county coverage varies and 2025 unallocated records are tracked separately. Retrospective model tests do not validate long-run forecasts.':c.quality?.has_holdout?'The 2021–2025 comparison is retrospective and was examined while choosing alternative methods; do not treat it as a fresh external test. Large errors remain possible, particularly for 2–4-unit and 5+-unit construction.':(c.quality?.not_comparable||'Historical comparability is limited under this county code. The website falls back to the observed 2025 permit benchmark.'));
}

// A compact bridge in the original Result tab keeps the map and outlook one workflow.
function updateBridge(){ /* No promotional banner in Result. */ }

function refreshCounty(){if(simulator)render();}
function selectGeo(detail){
  const seq=++loadToken; simulator=detail;latest=null;
  const code=detail.state||'US';
  if(detail.county){
    setText('selectionNote','Loading '+detail.place+' graph evidence…');
    const apply=()=>{if(seq!==loadToken)return;const d=window.TURNOUT_2050_STATE;if(!d||d.state!==code){setText('selectionNote','County data missing for '+detail.place);return;}
      STATE=d.counties[detail.county]||null;if(!STATE){setText('selectionNote','This county is not in the forecast evidence file.');return;}render();};
    if(window.TURNOUT_2050_STATE?.state===code){apply();return;}
    const sc=document.createElement('script');sc.src='assets/outlook2050/'+code+'.js?v=20261112-integrated4';sc.onload=apply;sc.onerror=()=>{if(seq===loadToken)setText('selectionNote','Could not load '+code+' map-linked graph evidence');};document.head.append(sc);
  }else{
    STATE=window.TURNOUT_OUTLOOK_AGGREGATES?.[code]||null;
    if(!STATE){setText('selectionNote','Aggregate evidence unavailable for '+code);return;}
    render();
  }
}
for(const id of ['endYear','building','production','population','model'])$(id).addEventListener('change',()=>{render();});
$('graphMode').addEventListener('change',graphModeChanged);$('graphShowAll').addEventListener('click',()=>{graphShown=new Set(GRAPH_MODES[graphChosenMode].keys);refreshGraph();});$('graphReset').addEventListener('click',graphModeChanged);
document.addEventListener('turnout:simulator-changed',e=>{const d=e.detail;if(!d)return;const changed=!simulator||simulator.state!==d.state||simulator.county!==d.county; if(changed)selectGeo(d);else{simulator=d;render();}});
$('resetBtn').addEventListener('click',()=>{for(const [id,value] of [['endYear','2030'],['building','total'],['production','central'],['population','trend'],['model','constant_2025_reference']])$(id).value=value;render();});
// Restore outlook parameters without replacing the policy/state URL semantics.
const initial=new URLSearchParams(location.hash.replace(/^#/,''));
for(const [id,key] of [['endYear','y'],['building','t'],['production','o'],['population','g'],['model','f']]){const control=$(id),value=initial.get(key);if(value&&[...control.options].some(o=>o.value===value))control.value=value;}
// Allow jumping to the integrated outlook without changing the app's state hash.

$('downloadSelected').addEventListener('click',()=>{if(!latest)return;const {county:c,settings:s,series:q}=latest;const cols=['year','permits_1_unit','permits_2_unit','permits_3_4_unit','permits_5plus_unit','policy_additional_permits','total_permitted','projected_population','projected_households','incremental_stock_requirement','illustrative_completed_units_cumulative','illustrative_planning_balance'];const rows=q.forecast.filter(r=>r.year<=s.end).map(r=>[r.year,...r.base,r.added,r.total,r.population,r.households,r.requirement,r.completedCumulative,r.balance].map(x=>x===null?'':typeof x==='number'?x.toFixed(3):x));emitCSV(`Turnout2_${simulator?.county||simulator?.state||'US'}_${s.end}_${s.policy}_forecast.csv`,cols,rows)});
$('downloadBedrooms').addEventListener('click',()=>{if(!latest)return;const {county:c,settings:s,series:q}=latest;const result=q.forecast.find(x=>x.year===s.end);const hh=Math.max(0,(result.households||0)-(q.hh2025||0));const need=householdBedroomDemand(c,hh);const rows=['Studio','1 bedroom','2 bedrooms','3 bedrooms','4+ bedrooms'].map((label,i)=>[label,result.completedBedroom[i].toFixed(2),need[i].toFixed(2)]);emitCSV(`Turnout2_${simulator?.county||simulator?.state||'US'}_${s.end}_bedrooms.csv`,['category','illustrative_new_homes','new_household_preference_proxy'],rows)});

})();
