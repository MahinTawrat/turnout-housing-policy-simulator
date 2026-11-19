/* Test the simplified simulator without changing its numeric model.
 * This is a focused DOM/logic harness; browser layout is verified separately.
 */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const root=path.resolve(__dirname,'..'),web=path.join(root,'dist'),assets=path.join(web,'assets');
const out=path.join(root,'build/frontend_validation.json');
const index=fs.readFileSync(path.join(web,'index.html'),'utf8');
const policies=['adu','missing_middle','tod','parking','fee'],levels=['low','default','high'];
const attributes=s=>Object.fromEntries(Array.from(s.matchAll(/([\w-]+)="([^"]*)"/g),m=>[m[1],m[2]]));
const strip=s=>String(s).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>n===null?'Not available':Number(n).toLocaleString('en-US',{maximumFractionDigits:0});
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const nodes=new Map(),listeners=new Map();let context;
function node(tag='div',attrs={}){
  const handlers=new Map(),classes=new Set((attrs.class||'').split(/\s+/).filter(Boolean));let content='',html='';
  const n={tagName:tag.toUpperCase(),attrs:{...attrs},children:[],style:{},value:'',hidden:false,open:false,
    dataset:Object.fromEntries(Object.entries(attrs).filter(([k])=>k.startsWith('data-')).map(([k,v])=>[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase()),v])),
    classList:{toggle(k,v){if(v)classes.add(k);else classes.delete(k);},add(...ks){ks.forEach(k=>classes.add(k));},remove(...ks){ks.forEach(k=>classes.delete(k));},contains(k){return classes.has(k);}},
    setAttribute(k,v){this.attrs[k]=String(v);},getAttribute(k){return this.attrs[k]??null;},
    append(...xs){this.children.push(...xs);},appendChild(x){this.append(x);return x;},replaceChildren(...xs){this.children=xs;content='';},
    addEventListener(type,fn){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);},
    dispatch(type,event={}){for(const fn of handlers.get(type)||[])fn({target:this,preventDefault(){},...event});},
    click(){this.dispatch('click');},focus(){document.activeElement=this;},
    closest(s){return (s==='[data-compare-policy]'&&this.dataset.comparePolicy)||(s==='[data-challenge-compare-policy]'&&this.dataset.challengeComparePolicy)||(s==='[data-open-view]'&&this.dataset.openView)?this:null;},
    showModal(){this.open=true;},close(){this.open=false;}
  };
  Object.defineProperty(n,'textContent',{get(){return content+this.children.map(x=>typeof x==='string'?x:x.textContent).join('');},set(v){content=String(v);this.children=[];}});
  Object.defineProperty(n,'innerHTML',{get(){return html;},set(v){html=String(v);this.children=[];
    if(attrs.id==='methodologyPane'){
      const d=html.match(/<details\b([^>]*\bid="(?:policyComparison|challengePolicyComparison)"[^>]*)>/);
      if(d){const a=attributes(d[1]),child=node('details',a);child.open=/(?:^|\s)open(?:\s|$)/.test(d[1]);nodes.set(a.id,child);}
    }
  }});
  return n;
}
for(const m of index.matchAll(/<([a-z][\w-]*)\b([^>]*\bid="[^"]+"[^>]*)>/g)){const a=attributes(m[2]);nodes.set(a.id,node(m[1],a));}
const buttons=Array.from(index.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g),m=>{const a=attributes(m[1]),n=node('button',a);n.textContent=strip(m[2]).replace(/&amp;/g,'&');if(a.id)nodes.set(a.id,n);return n;});
const tabs=buttons.filter(b=>b.dataset.tab),panes=Array.from(nodes.values()).filter(n=>n.dataset.pane);
const document={activeElement:null,getElementById(id){return nodes.get(id)||null;},
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
  dispatchEvent(e){for(const fn of listeners.get(e.type)||[])fn(e);},
  createElement(tag){return node(tag);},createElementNS(_ns,tag){return node(tag);},
  querySelectorAll(sel){if(sel==='.tab')return tabs;if(sel==='.tab-pane')return panes;if(sel==='[data-policy]')return buttons.filter(b=>b.dataset.policy);if(sel==='[data-level]')return buttons.filter(b=>b.dataset.level);return [];},
  querySelector(sel){const target=sel.match(/^\[data-(tab|pane)="([^"]+)"\]$/);if(target)return (target[1]==='tab'?tabs:panes).find(n=>n.dataset[target[1]]===target[2])||null;const m=sel.match(/^\[(data-(?:challenge-)?compare-policy)="([^"]+)"\]$/);if(m){const html=nodes.get('methodologyPane').innerHTML;for(const b of html.matchAll(/<button\b([^>]*)>/g)){const a=attributes(b[1]);if(a[m[1]]===m[2])return node('button',a);}}return null;}
};
document.head=node('head');document.head.append=function(script){this.children.push(script);if(script.src){const file=path.join(web,script.src.split('?')[0]);if(fs.existsSync(file)){vm.runInContext(fs.readFileSync(file,'utf8'),context,{filename:file});script.onload?.();}else script.onerror?.();}};
document.head.appendChild=x=>{document.head.append(x);return x;};
const history={replaceState(_a,_b,url){this.lastURL=url;}};
context={window:{},document,console,URLSearchParams,history,location:{pathname:'/',search:'',hash:''},CustomEvent:function(type,opts){this.type=type;this.detail=opts.detail;}};
vm.createContext(context);
const modules=['core-data','housing-needs','housing-types','structure-evidence','chas-affordability','decision-data','decision-model','evidence-guide','decision-card','production-forecast','policy-scenarios','forecast-evidence','history/AGGREGATES','how-it-works'];
for(const name of modules)vm.runInContext(fs.readFileSync(path.join(assets,name+'.js'),'utf8'),context,{filename:name+'.js'});
for(const name of fs.readdirSync(assets).filter(name=>/simplified.*card.*\.js$/i.test(name)))vm.runInContext(fs.readFileSync(path.join(assets,name),'utf8'),context,{filename:name});
for(const name of fs.readdirSync(path.join(assets,'counties/data')))if(name.endsWith('.js'))vm.runInContext(fs.readFileSync(path.join(assets,'counties/data',name),'utf8'),context,{filename:'county/'+name});
vm.runInContext(fs.readFileSync(path.join(assets,'challenge-metadata.js'),'utf8'),context,{filename:'challenge-metadata.js'});
let app=fs.readFileSync(path.join(assets,'app.js'),'utf8');
const init="document.addEventListener('DOMContentLoaded',init);";assert.strictEqual(app.split(init).length,2);
app=app.replace(init,`window.__challengeTest={
 set(s,c,p,l){stateAbbr=s;countyFips=c;tractGeoid=null;policyKey=p;level=l;},
 metric,finalResultView,resultHtml,finalCalculationHtml,combinedMethodologyHtml,combinedSourcesHtml,explanationContext,
 renderPanel,renderTabs,initEvents,initFinalEvents,policyMathHtml,
 selectedPolicyForecast,selectedTab(){return currentTab;},selectedPolicy(){return policyKey;},selectedLevel(){return level;},
 selectedPlace(){return {state:stateAbbr,county:countyFips};},
 beginClickTest(){const saved=renderAll;renderAll=()=>{renderLevels();renderPolicyRail();renderPanel();renderTabs();};return()=>{renderAll=saved;};},
 dispatchGraph(){const v=metric(),r=countyRec()||stateRec();document.dispatchEvent(new CustomEvent('turnout:simulator-changed',{detail:{state:stateAbbr,county:countyFips,policy:policyKey,level,place:placeName(),fiveYearBaseline:v.baseline,fiveYearAdded:v.added,policies:POLICY_KEYS.map(k=>({key:k,added:stateAbbr==='US'?nationalAdded(k,level):added(r,k,level)}))}}));}
};`);
vm.runInContext(app,context,{filename:'app.js'});
vm.runInContext(fs.readFileSync(path.join(assets,'challenge-graph.js'),'utf8'),context,{filename:'challenge-graph.js'});
const w=context.window,ui=w.__challengeTest,states=w.STATE_DATA,counties=Object.entries(w.COUNTY_DATA).flatMap(([state,rows])=>rows.map(c=>({state,...c}))),overlay=w.FORECAST_POLICY;
const report={buildVersion:w.APP_VERSION,status:'FAIL',metricCases:0,engineMetricComparisons:0,renderCases:0,graphCases:0,comparisonCells:0,comparisonClicks:0,tabClicks:0,tabKeys:0,coverageChecks:0,sourceLinksChecked:0,resultMeaningChecks:0,plainCalculationChains:0,issues:[],limits:'DOM/logic only; responsive layout and visual readability require separate browser review.'};
let testCase='setup';
function sane(html,label){assert.strictEqual(typeof html,'string',label);assert(strip(html).length>20,label+' empty');assert(!/\b(?:NaN|undefined|Infinity)\b/.test(html),label+' invalid value');}
function resultMeanings(html,pf,policy,level){
 const main=html.split('<details')[0],plain=strip(main),b=pf.bases.central,a=pf.scenarios.central[policy][level],t=b===null||a===null?null:b+a;
 const hasCount=(text,value)=>new RegExp('(?:^|[^\\d,])\\+?'+fmt(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?![\\d,])').test(strip(text));
 for(const [label,value] of [['starting point',b],['possible extra',a],['comparison sum',t]])if(value!==null)assert(hasCount(main,value),'Main Result retains '+label+' value');
 assert(/starting point/i.test(plain),'Starting point uses familiar wording');
 assert(/possible|could|might/i.test(plain),'Result describes possibility');
 assert(/2026|2030|five.year|five years/i.test(plain),'Result keeps its time period');
 if(b!==null)assert(/permission.*build|permit.*permission/i.test(strip(html)),'Permit meaning stays accessible');
 assert(/assum|we test|we choose|chosen/i.test(strip(html)),'Chosen assumptions stay distinct from observed data');
 assert(/data-open-view="calculation"/.test(html)&&/data-open-view="methodology"/.test(html),'Results links to its explanation and supporting facts');
 assert(!/class="dc-calculation"/.test(html),'Worked equations belong in How It Works');
 assert(!/stock potential|permit-equivalent|take-up|elasticity|HAMFI/i.test(plain),'Main Result uses everyday vocabulary');
 if(b===null||b===0)assert(!/\b(?:NaN|Infinity)\b/.test(html),'No invalid denominator output');
 report.resultMeaningChecks++;
}
function checkLocal(html){for(const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)){const p=m[1];if(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(p))continue;assert(fs.existsSync(path.join(web,decodeURIComponent(p.split(/[?#]/)[0]))),'Missing website file '+p);report.sourceLinksChecked++;}}
function coverage(){const d=w.DATA_COVERAGE;assert(d?.national&&d?.states,'Coverage metadata');const observed=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0;
 for(const [scope,rows,actual] of [['US',counties,d.national],...states.map(s=>[s.state_abbr,counties.filter(c=>c.state===s.state_abbr),d.states[s.state_abbr]])]){
  const expected={counties:rows.length,permit_available:rows.filter(c=>observed(c.baseline_annual_units)).length,permit_missing:rows.filter(c=>!observed(c.baseline_annual_units)).length,permit_zero:rows.filter(c=>c.baseline_annual_units===0).length,cost_state_fallback:rows.filter(c=>!observed(c.avg_permit_value_per_unit)).length,acs_available:rows.filter(c=>observed(w.QUIESCE_DECISION.county[c.fips]?.evidence?.stock?.total)).length,chas_available:rows.filter(c=>observed(w.QUIESCE_DECISION.county[c.fips]?.evidence?.chas?.lowTotal)).length};
  for(const [key,value] of Object.entries(expected)){assert.strictEqual(actual[key],value,scope+'/'+key);report.coverageChecks++;}
 }
 report.nationalCoverage=d.national;
}
function catalog(html){const c=w.SOURCE_CATALOG;assert(Array.isArray(c?.datasets)&&Array.isArray(c?.research));assert(html.includes('<table'),'Concise sources table');assert(!/FHFA|QCEW/.test(html),'Unused sources not included');
 for(const s of [...c.datasets,...c.research]){assert(html.includes(escape(s.title)),'Source title '+s.title);assert(html.includes(escape(s.used)),'Source use '+s.title);for(const field of ['source_url','url','download_url','local_download'])if(s[field]){assert(html.includes('href="'+escape(s[field])+'"'),'Source/download '+s[field]);report.sourceLinksChecked++;}}
 checkLocal(html);report.catalogDatasets=c.datasets.length;report.catalogResearch=c.research.length;
}
function comparison(html,pf){
 const table=html.match(/<table[^>]*class="[^"]*challenge-comparison-table[^>]*>([\s\S]*?)<\/table>/);assert(table,'Five-policy comparison table');
 const rows=Array.from(table[1].match(/<tbody>([\s\S]*?)<\/tbody>/)[1].matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g));assert.strictEqual(rows.length,5);
 rows.forEach((row,i)=>{const p=attributes(row[1])['data-challenge-comparison'];assert.strictEqual(p,policies[i],'Fixed comparison order');const cells=Array.from(row[2].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/g),m=>strip(m[1]));assert.strictEqual(cells.length,5);
  levels.forEach((l,j)=>{const e=pf.scenarios.central[p][l],a=/not available/i.test(cells[j+1])?null:Number(cells[j+1].replace(/[+,]/g,''));assert.strictEqual(a,e,'Comparison numeric count '+p+'/'+l);report.comparisonCells++;});
  const e=pf.bases.central>0&&pf.scenarios.central[p].default!==null?100*pf.scenarios.central[p].default/pf.bases.central:null;if(e===null)assert(/not available/i.test(cells[4]));else assert(Math.abs(Number(cells[4].replace(/[%+,]/g,''))-e)<=.051);report.comparisonCells++;
 });
}
function graph(state,county,policy,level,pf){ui.dispatchGraph();const host=nodes.get('challengeGraphContent'),tiles=host.children;assert.strictEqual(tiles.length,4,'Four graph panels together');
 const titles=tiles.map(t=>t.children.find(n=>n.tagName==='H4')?.textContent);assert(/policy.*result|policy.*impact/i.test(titles[0]));assert(/compare.*polic|compare.*reform/i.test(titles[1]));assert(/past.*permit|permit.*history/i.test(titles[2]));assert(/building.*type/i.test(titles[3]));
 const kpis=tiles[0].children.find(n=>n.className==='cg-kpi-strip');assert(kpis,'Graph KPI strip');const counts=kpis.children.map(n=>n.children[1].textContent),b=pf.bases.central,a=pf.scenarios.central[policy][level];
 assert.strictEqual(counts[0],b===null?'—':fmt(b),'Graph baseline');assert.strictEqual(counts[1],a===null?'—':'+'+fmt(a),'Graph added');assert.strictEqual(counts[2],b===null||a===null?'—':fmt(b+a),'Graph total');
 const rows=tiles[1].children.find(n=>n.className==='cg-compare-list').children,order=['adu','missing_middle','fee','tod','parking'];assert.strictEqual(rows.length,5);
 rows.forEach((row,i)=>{const actual=row.children[0].children[1].textContent,expected=pf.scenarios.central[order[i]][level];assert.strictEqual(actual,expected===null?'—':fmt(expected),'Graph comparison '+order[i]);});
 if(state==='US'){assert(tiles[2].textContent.includes('1,428,446'),'Graph county-assigned history');assert(tiles[2].textContent.includes('3,170'),'Graph discloses missing allocation difference');}
 assert(!/2050|bedroom|population|completions per year/i.test(host.textContent),'No unrelated long-run graphs');report.graphCases++;
}
try{
 assert.strictEqual(states.length,51);assert.strictEqual(counties.length,3144);
 coverage();checkLocal(index);
 const referenceAnswers={adu:81,missing_middle:41,tod:0,parking:7,fee:28};
 for(const [policy,extra] of Object.entries(referenceAnswers)){ui.set('GA','13195',policy,'default');const m=ui.metric();assert.strictEqual(m.baseline,650,'Reference Madison County starting point');assert.strictEqual(m.added,extra,'Reference Madison County '+policy);assert.strictEqual(m.total,650+extra,'Reference Madison County sum '+policy);}
 report.referenceCounty='Madison County, Georgia';report.referenceDefaultAnswers=referenceAnswers;
 const expectedTabs=['result','calculation','methodology','graph','data'];assert.deepStrictEqual(tabs.map(t=>t.dataset.tab),expectedTabs,'Explanation then supporting details');
 assert.deepStrictEqual(tabs.map(t=>t.textContent),['Results','How It Works','More Details','Impact Comparison','Data &amp; Sources'].map(s=>s.replace('&amp;','&')),'Plain navigation labels');
 ui.initEvents();ui.initFinalEvents();for(const t of tabs){t.click();assert.strictEqual(ui.selectedTab(),t.dataset.tab);for(const x of tabs){assert.strictEqual(x.attrs['aria-selected'],String(x===t));assert.strictEqual(x.attrs.tabindex,x===t?'0':'-1');}for(const p of panes){assert.strictEqual(p.classList.contains('active'),p.dataset.pane===t.dataset.tab);assert.strictEqual(p.attrs['aria-hidden'],String(p.dataset.pane!==t.dataset.tab));}report.tabClicks++;}
 for(const [key,expected] of [['Home','result'],['ArrowLeft','data'],['ArrowRight','result'],['End','data']]){tabs.find(t=>t.dataset.tab===ui.selectedTab()).dispatch('keydown',{key});assert.strictEqual(ui.selectedTab(),expected);assert.strictEqual(document.activeElement.dataset.tab,expected);report.tabKeys++;}
 for(const target of ['calculation','methodology']){const action=node('button',{'data-open-view':target});document.dispatchEvent({type:'click',target:action});assert.strictEqual(ui.selectedTab(),target,'Results action opens the relevant view');assert.strictEqual(document.activeElement.dataset.tab,target,'Results action places keyboard focus on the active tab');}
 const cassAnswers={adu:[46,56,460],missing_middle:[23,33,230],fee:[2,12,20],tod:[0,10,0],parking:[1,11,10]};
 for(const [policy,[extra,total,increase]] of Object.entries(cassAnswers)){
  ui.set('IL','17017',policy,'default');const m=ui.metric(),html=ui.finalCalculationHtml(),rows=w.TurnoutHowItWorks.contextRows(ui.explanationContext());
  assert.deepStrictEqual([m.baseline,m.added,m.total,m.pct],[10,extra,total,increase],'Cass County independent reference '+policy);
  assert(html.includes('Cass County')&&html.includes('2 housing units permitted in 2025 × 5 years = 10'),'Cass baseline and selected place');
  assert(rows.find(r=>r.id==='existing-homes').value==='5,676','Existing stock remains distinct');
  assert(rows.find(r=>r.id==='rent-burden').value==='28.6%','Observed renter-burden denominator');
  assert(rows.find(r=>r.id==='household-outlook').value==='133–208 fewer households','Separate demographic outlook');
  if(policy==='adu')assert(rows.find(r=>r.id==='small-households').value==='60.7%');
  if(policy==='missing_middle'){assert(rows.find(r=>r.id==='small-buildings').value==='202');assert(rows.find(r=>r.id==='large-renter-households').value==='643');assert(rows.find(r=>r.id==='crowded-renters').value==='64 ± 53','Survey margin remains visible');assert(/22.77/.test(html));}
  if(policy==='tod'){assert(rows.find(r=>r.id==='large-buildings').value==='293');assert(/measured exposure of zero/i.test(html));assert(/B25024/.test(html)&&/including water/.test(html),'Actual mapped source and geographic method');}
  if(policy==='fee')assert(/142.86%/.test(html)&&/1.5 → <strong>\+2/.test(html),'Fee cap and ties-to-even example');
  if(policy==='parking')assert(/68.57%/.test(html)&&/0.75 → <strong>\+1/.test(html),'Parking saving, cap and rounding example');
 }
 report.cassPolicyFixtures=5;
 ui.set('AL','01011','adu','default');assert.strictEqual(ui.metric().baseline,0);assert.strictEqual(ui.metric().added,20);assert(/starting point is zero/.test(ui.finalCalculationHtml()),'Zero baseline cannot create a percentage');
 ui.set('AK','02066','adu','default');assert.strictEqual(ui.metric().baseline,null);assert.strictEqual(ui.metric().added,20);assert(/stock-based extra-home result can still be shown/.test(ui.finalCalculationHtml()),'Missing permits do not erase stock additions');
 ui.set('AK','02066','tod','default');assert(!/14 New York|14 withheld/.test(ui.finalCalculationHtml()),'Missing permits do not inherit the New York exposure notice');
 ui.set('NM',null,'parking','default');assert(/1.55095095/.test(ui.finalCalculationHtml()),'State cost response displays its actual permit-coverage factor');
 const restore=ui.beginClickTest();try{for(const [s,c] of [['US',null],['CA',null],['TX','48485'],['GA','13007'],['GA','13125']]){ui.set(s,c,'adu','high');tabs.find(t=>t.dataset.tab==='methodology').click();ui.renderPanel();for(const p of policies){nodes.get('challengePolicyComparison').open=true;const button=document.querySelector(`[data-challenge-compare-policy="${p}"]`);assert(button);document.dispatchEvent({type:'click',target:button});assert.strictEqual(ui.selectedPolicy(),p);assert.strictEqual(ui.selectedLevel(),'high');assert.strictEqual(ui.selectedTab(),'methodology');assert.deepStrictEqual(JSON.parse(JSON.stringify(ui.selectedPlace())),{state:s,county:c});assert.strictEqual(nodes.get('policySelect').value,p);assert.strictEqual(document.activeElement.dataset.challengeComparePolicy,p);assert(nodes.get('challengePolicyComparison').open);report.comparisonClicks++;}}}finally{restore();}
 const all=[['US',null,overlay.national],...states.map(s=>[s.state_abbr,null,overlay.states[s.state_abbr]]),...counties.map(c=>[c.state,c.fips,overlay.counties[c.fips]])];
 for(const [s,c,pf] of all)for(const p of policies)for(const l of levels){testCase=[s,c,p,l,'metric'].join('/');ui.set(s,c,p,l);const actual=ui.metric(),b=pf.bases.central,a=pf.scenarios.central[p][l];assert.strictEqual(actual.baseline,b);assert.strictEqual(actual.added,a);assert.strictEqual(actual.total,b===null||a===null?null:b+a);assert.strictEqual(actual.pct,b>0&&a!==null?100*a/b:null);report.engineMetricComparisons++;report.metricCases++;}
 const selected=[['US',null,overlay.national],...states.map(s=>[s.state_abbr,null,overlay.states[s.state_abbr]])];
 const addCounty=fips=>{const c=counties.find(c=>c.fips===fips);assert(c,'County '+fips);if(!selected.some(x=>x[1]===fips))selected.push([c.state,c.fips,overlay.counties[fips]]);};
 for(const s of states){const c=counties.filter(c=>c.state===s.state_abbr).sort((a,b)=>(overlay.counties[b.fips].bases.central??-1)-(overlay.counties[a.fips].bases.central??-1))[0];addCounty(c.fips);}
 for(const f of ['48485','13007','13125','13195','09110','02066','36061','48377','27053','17095','48269','48257','29063'])addCounty(f);
 for(const [s,c,pf] of selected)for(const p of policies)for(const l of levels){testCase=[s,c,p,l,'render'].join('/');ui.set(s,c,p,l);ui.renderPanel();
  const result=nodes.get('resultPane').innerHTML,method=nodes.get('methodologyPane').innerHTML,calc=nodes.get('calculationPane').innerHTML,sources=nodes.get('dataPane').innerHTML;
  for(const [label,html] of [['Result',result],['Methodology',method],['How calculated',calc],['Sources',sources]])sane(html,label);
  resultMeanings(result,pf,p,l);
  assert(calc.indexOf('Where the baseline comes from')>=0,'Permit baseline explained');
  let last=-1;for(const [i,title] of ['What the policy changes','What information we start with','What assumptions we make','How we calculate the effect','What this result cannot tell us'].entries()){const pos=calc.indexOf('data-hiw-step="'+(i+1)+'"');assert(pos>last,'Five-step reading order '+title);assert(calc.indexOf(title,pos)>pos,'Step heading '+title);last=pos;}
  assert.strictEqual((calc.match(/data-hiw-step=/g)||[]).length,5,'Only one selected-policy explanation');assert(!/<details\b/.test(calc),'All five core steps and their calculations are open');assert(/Census survey estimate|Census permit record/.test(calc),'Sources classified visibly');assert(/Model assumption/.test(calc),'Chosen inputs clearly classified');report.plainCalculationChains++;
  assert(/12.0%|12\.0/.test(method),'Baseline held-out error accessible');assert(/latest.year|latest year|held.flat|flat/i.test(method),'Selected flat method');assert(/600/.test(method)&&/three stories/.test(method)&&/voluntarily/.test(method),'Complete policy benchmarks');assert(/(?:Available|coverage|available) data|Data coverage/.test(method),'Data availability stays accessible');assert(!/Policies are ranked/.test(method));assert(!/Evidence &amp; reproducibility|Evidence & reproducibility/.test(result));
  comparison(method,pf);
  if(s==='US'&&p==='adu'&&l==='default')catalog(sources);
  graph(s,c,p,l,pf);report.renderCases++;
 }
 const savedNationalTransit=overlay.national.scenarios.central.tod.default;
 const exposureState=states[0],savedExposure={share:exposureState.tod_housing_share_new,legacy:exposureState.tod_housing_share,base:exposureState.tod_housing_base_new};
 overlay.national.scenarios.central.tod.default=null;
 exposureState.tod_housing_share_new=null;exposureState.tod_housing_base_new=null;exposureState.tod_housing_share=.5;
 try{
  ui.set('US',null,'tod','default');const missing=ui.metric();
  assert.strictEqual(missing.added,null,'Missing national transit stays unavailable');assert.strictEqual(missing.total,null,'Unknown addition does not become the baseline total');assert.strictEqual(missing.pct,null,'Unknown addition does not become zero percent');
  ui.renderPanel();const view=ui.finalResultView();
  assert(/Not available/.test(nodes.get('resultPane').innerHTML),'Missing result is explained in the main card');
  assert(missing.baseline>0,'Observed baseline remains available when exposure is missing');
  assert(/extra-home estimate is unavailable/.test(view.percentExplanation),'Missing exposure does not incorrectly label the baseline missing');
  assert.strictEqual(view.observations.find(f=>f.label==='Housing near the model’s transit stops').value,'Not available','National exposure card must not display a partial sum');
  ui.set(exposureState.state_abbr,null,'tod','default');
  assert.strictEqual(ui.finalResultView().observations.find(f=>f.label==='Housing near the model’s transit stops').value,'Not available','Missing current exposure must not fall back to a legacy value');
  for(const [s,c] of [['NY',null],['NY','36103']]){
   const pf=c?overlay.counties[c]:overlay.states[s];if(pf.scenarios.central.tod.default!==null)continue;
   ui.set(s,c,'tod','default');const unavailable=ui.finalResultView();
   assert.strictEqual(unavailable.observations.find(f=>f.label==='Housing near the model’s transit stops').value,'Not available','Suppressed local exposure card stays unavailable');
   assert(!/starting point is missing/.test(unavailable.percentExplanation),'Suppressed local transit preserves the known baseline');
  }
 }finally{
  overlay.national.scenarios.central.tod.default=savedNationalTransit;
  exposureState.tod_housing_share_new=savedExposure.share;exposureState.tod_housing_share=savedExposure.legacy;exposureState.tod_housing_base_new=savedExposure.base;
 }
 report.renderGeographies=selected.length;report.status='PASS';
}catch(e){report.issues.push({case:testCase,message:e.message,stack:e.stack});process.exitCode=1;}
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
