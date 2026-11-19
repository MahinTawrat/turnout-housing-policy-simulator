/* Three short answers, using the existing fonts and decision-card colors. */
(function(){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const factValue=value=>{
    const text=String(value??'Not available'),cut=text.indexOf(' ±');
    return cut<0?esc(text):esc(text.slice(0,cut))+`<small class="dc-fact-moe">±${esc(text.slice(cut+2))}</small>`;
  };
  const factCards=(facts,type)=>(facts||[]).map(f=>`<div class="dc-fact dc-fact-${type}"><strong>${factValue(f.value)}</strong><div class="dc-fact-copy"><span>${esc(f.label)}</span><small><b class="simple-number-kind">${esc(f.numberType||'Census estimate')}</b> · ${esc(f.note)}</small></div></div>`).join('');
  window.renderDecisionCard=function(v){
    const missing=Boolean(v.isMissing);
    return `<div class="decision-story simple-decision-story" aria-label="Housing policy decision card">
      <section class="dc-section dc-effect${missing?' dc-effect-missing':''}" aria-labelledby="dc-effect-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">1</span><h4 id="dc-effect-title">What could change?</h4><span class="dc-horizon">2026–2030 · five years</span></div>
        <div class="dc-effect-main"><div class="dc-impact"><strong>${missing?'Not available':esc(v.added)}</strong><span>${missing?'A needed input is missing.':'possible extra homes'}</span></div><div class="dc-comparison" aria-label="Five-year starting point and starting point plus possible extra homes"><div><span>${esc(v.baselineLabel)}</span><b>${esc(v.baseline)}</b></div><div><span>${esc(v.totalLabel)}</span><b>${esc(v.total)}</b></div></div></div>
        <p class="dc-baseline-help">${esc(v.baselineHelp)}</p><p class="dc-percent-explanation">${esc(v.percentExplanation)}</p>${v.primaryComparisonNote?`<p class="dc-primary-note">${esc(v.primaryComparisonNote)}</p>`:''}
      </section>
      <section class="dc-section dc-focus" aria-labelledby="dc-focus-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">2</span><h4 id="dc-focus-title">${esc(v.focusTitle)}</h4></div>
        <p class="dc-mechanism">${esc(v.mechanism)}</p><div class="dc-facts dc-focus-facts" aria-label="Policy inputs and local housing context">${factCards(v.observations,'focus')}</div>
        <p class="dc-forms"><b>Housing it could add:</b> ${esc(v.forms)}</p><p class="dc-local-need"><b>Check first:</b> ${esc(v.check)}</p>
      </section>
      <section class="dc-section dc-explanation" aria-labelledby="dc-explanation-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">3</span><h4 id="dc-explanation-title">Read this as a what-if example</h4></div>
        <p class="dc-assumption"><b>${esc(v.level)} assumption:</b> ${esc(v.assumptionMeaning)}</p>
        <p class="dc-constraint">Actual extra homes could be zero. A larger estimate does not prove this is the best local policy.</p>
        <div class="result-next-links" aria-label="Understand this result"><button type="button" data-open-view="calculation">How did we get this number? →</button><button type="button" data-open-view="methodology">More local facts →</button></div>
      </section>
    </div>`;
  };
  window.renderSampleResult=window.renderDecisionCard;
})();
