/* The Turnout — four at-once challenge graphs, 2026–2030.
 * All scenario figures reuse the selected map/Result calculation.
 * This module does not fit or modify a forecasting model.
 */
(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const format=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:0});
  const percent=(v,base)=>Number.isFinite(v)&&Number.isFinite(base)&&base>0?(100*v/base).toFixed(1)+'%':'n/a';
  const labels=[['adu','ADU'],['missing_middle','Missing middle'],['fee','Fees'],['tod','Transit'],['parking','Parking']];
  const inks=['#854442','#b78277','#9f7164','#c5a391','#6c514d'];
  const host=$('challengeGraphContent');
  if(!host)return;
  const historyCache=new Map();let selected=null,historical=null,loadToken=0;
  function el(tag,cl,text){const x=document.createElement(tag);if(cl)x.className=cl;if(text!==undefined)x.textContent=String(text);return x;}
  function tile(title){const card=el('section','cg-dashboard-tile');card.append(el('h4','cg-tile-title',title));return card;}
  function note(str){return el('p','cg-tile-note',str);}
  function bar(label,value,maximum,color,selectedBar=false){
    const line=el('div','cg-mini-row'+(selectedBar?' cg-mini-selected':''));
    const head=el('div','cg-mini-head');head.append(el('span','',label),el('strong','',value===null?'—':format(value)));line.append(head);
    const track=el('div','cg-mini-track'),fill=el('i');fill.style.width=(value===null?0:Math.max(0,Math.min(100,100*value/Math.max(1,maximum)))).toFixed(2)+'%';fill.style.background=color;track.append(fill);line.append(track);
    return line;
  }
  function impactTile(){
    const d=tile('Policy result'),b=selected?.fiveYearBaseline??null,a=selected?.fiveYearAdded??null,t=b===null||a===null?null:b+a;
    const metrics=el('div','cg-kpi-strip');
    for(const [label,num] of [['Starting point',b],['Possible extra',a],['Added together',t]]){
      const one=el('div','cg-kpi');one.append(el('span','',label),el('strong','',num===null?'—':(label==='Possible extra'?'+':'')+format(num)));metrics.append(one);
    }
    d.append(metrics);
    if(t!==null){const box=el('div','cg-compact-bars');box.append(bar('Starting point',b,t,'#b78277'),bar('Added together',t,t,'#854442'));d.append(box);}
    else d.append(note('The permit numbers needed for this comparison are missing.'));
    const meaning=['adu','missing_middle'].includes(selected?.policy)?'Homes on existing properties are compared with new-building permits.':'These what-if results are not homes already built.';
    d.append(note((a!==null&&b>0?`${percent(a,b)} extra vs. starting point · 2026–2030. `:'A percentage needs a starting point above zero. ')+meaning));
    return d;
  }
  function compareTile(){
    const d=tile('Compare policies');const options=labels.map(([key,name])=>({key,name,value:selected?.policies?.find(x=>x.key===key)?.added??null}));
    const max=Math.max(1,...options.map(x=>Math.max(0,x.value||0)));const rows=el('div','cg-compare-list');
    options.forEach((v,i)=>rows.append(bar(v.name,v.value,max,inks[i],v.key===selected?.policy)));
    d.append(rows,note('Same place and assumption. Compare one policy at a time; do not add the results.'));
    return d;
  }
  function parseHistory(){return (historical?.history||[]).filter(r=>Array.isArray(r)&&r.length>=6&&Number.isFinite(Number(r[5]))&&Number(r[0])<=2025).map(r=>[Number(r[0]),Number(r[5])]).sort((a,b)=>a[0]-b[0]);}
  function historyTile(){
    const d=tile('Past building permits');
    if(!historical){d.append(note('Loading past Census permit counts…'));return d;}
    const points=parseHistory();if(points.length<2){d.append(note('Past permit counts are not available for this place.'));return d;}
    const yr=points[points.length-1],peak=points.reduce((a,b)=>b[1]>a[1]?b:a,points[0]);
    const caption=el('div','cg-chart-caption');caption.append(el('span','',`${points[0][0]}–${yr[0]}`),el('strong','',`${yr[0]}: ${format(yr[1])} units`));d.append(caption);
    const ns='http://www.w3.org/2000/svg',W=320,H=92,L=5,R=5,T=4,B=18;
    const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${W} ${H}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`Observed permitted housing units, ${points[0][0]} to ${yr[0]}`);
    const tag=(k,attrs,text)=>{const x=document.createElementNS(ns,k);Object.entries(attrs).forEach(([a,v])=>x.setAttribute(a,String(v)));if(text!==undefined)x.textContent=text;return x;};
    const max=Math.max(1,...points.map(v=>v[1])),x=y=>L+(y-points[0][0])/Math.max(1,yr[0]-points[0][0])*(W-L-R),y=v=>T+(max-v)/max*(H-T-B);
    [0,.5,1].forEach(i=>svg.append(tag('line',{x1:L,y1:y(max*i),x2:W-R,y2:y(max*i),stroke:'#eaddd4','stroke-width':.7})));
    const line=points.map((p,i)=>`${i?'L':'M'}${x(p[0]).toFixed(2)} ${y(p[1]).toFixed(2)}`).join(' ');
    svg.append(tag('path',{d:line,fill:'none',stroke:'#854442','stroke-width':2.2,'stroke-linecap':'round','stroke-linejoin':'round'}));
    const last=tag('circle',{cx:x(yr[0]),cy:y(yr[1]),r:3.2,fill:'#854442'});last.append(tag('title',{},`${yr[0]}: ${format(yr[1])} authorized units`));svg.append(last);
    svg.append(tag('text',{x:L,y:H-2,fill:'#79685f','font-size':10},points[0][0]));svg.append(tag('text',{x:W-R,y:H-2,'text-anchor':'end',fill:'#79685f','font-size':10},yr[0]));
    const spark=el('div','cg-sparkline');spark.append(svg);d.append(spark,note(`Peak: ${format(peak[1])} units (${peak[0]}). Permits mean permission to build, not finished homes.`));
    if(selected?.state==='US'&&!selected?.county)d.append(note('The graph leaves out 3,170 permits with no county listed. The national starting point includes them.'));
    return d;
  }
  function buildingTile(){
    const d=tile('2025 permits by building type');if(!historical){d.append(note('Loading 2025 permits by building size…'));return d;}
    const raw=(historical.history||[]).find(r=>Number(r[0])===2025);
    if(!raw){d.append(note('2025 permits by building size are missing for this place.'));return d;}
    const kinds=[['Homes in 1-home buildings',raw[1]],['Homes in 2-home buildings',raw[2]],['Homes in 3–4-home buildings',raw[3]],['Homes in 5+-home buildings',raw[4]]].map(([name,v])=>({name,value:Number.isFinite(Number(v))?Number(v):null}));
    const max=Math.max(1,...kinds.map(x=>x.value||0));const rows=el('div','cg-building-list');kinds.forEach((v,i)=>rows.append(bar(v.name,v.value,max,inks[i])));d.append(rows,note(selected?.state==='US'&&!selected?.county?'Homes permitted in buildings of each size. Excludes 3,170 permits with no county. Extra homes have no assigned building type.':'Homes permitted in buildings of each size. Extra homes have no assigned building type.'));
    return d;
  }
  function render(){if(!selected)return;
    $('challengeGraphTitle').textContent=selected.place||'United States';
    const pol=labels.find(x=>x[0]===selected.policy)?.[1]||'Selected policy';
    $('challengeGraphContext').textContent=`${pol} · ${selected.level==='low'?'Low':selected.level==='high'?'High':'Default'} assumption · 2026–2030`;
    host.replaceChildren(impactTile(),compareTile(),historyTile(),buildingTile());
  }
  function loadHistory(){
    if(!selected)return;
    const current=++loadToken,geography=selected.state,county=selected.county;
    const key=county?`${geography}/${county}`:geography;
    if(historyCache.has(key)){historical=historyCache.get(key);render();return;}
    if(!county){
      historical=window.TURNOUT_HISTORY_AGGREGATES?.[geography]||{history:[]};historyCache.set(key,historical);render();return;
    }
    const script=document.createElement('script');script.src=`assets/history/${encodeURIComponent(geography)}.js?v=challenge-dashboard-20261117`;
    script.onload=()=>{
      const value=window.TURNOUT_HISTORY_STATE?.state===geography?window.TURNOUT_HISTORY_STATE?.counties?.[county]:null;
      historyCache.set(key,value||{history:[]});if(current===loadToken){historical=value||{history:[]};render();}
    };
    script.onerror=()=>{if(current===loadToken){historical={history:[]};render();}};
    document.head.append(script);
  }
  document.addEventListener('turnout:simulator-changed',e=>{
    const value=e.detail;if(!value)return;
    const previous=selected&&`${selected.state}/${selected.county}`;
    const current=`${value.state}/${value.county}`;
    selected=value;
    if(previous!==current){historical=null;render();loadHistory();}else render();
  });
})();
