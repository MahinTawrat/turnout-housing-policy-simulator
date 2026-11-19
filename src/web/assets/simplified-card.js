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
        <div class="dc-effect-main"><div class="dc-impact"><strong>${missing?'Not available':esc(v.added)}</strong><span>${missing?'A needed input is missing.':'possible extra homes'}</span></div><div class="dc-comparison" aria-label="Five-year starting point and starting point plus extra"><div><span>${esc(v.baselineLabel)}</span><b>${esc(v.baseline)}</b></div><div><span>${esc(v.totalLabel)}${v.totalHelp?`<br><small>${esc(v.totalHelp)}</small>`:''}</span><b>${esc(v.total)}</b></div></div></div>
        <p class="dc-baseline-help">${esc(v.baselineHelp)}</p><p class="dc-percent-explanation">${esc(v.percentExplanation)}</p>${v.primaryComparisonNote?`<p class="dc-primary-note">${esc(v.primaryComparisonNote)}</p>`:''}
      </section>
      <section class="dc-section dc-focus" aria-labelledby="dc-focus-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">2</span><h4 id="dc-focus-title">${esc(v.focusTitle)}</h4></div>
        <p class="dc-mechanism">${esc(v.mechanism)}</p><div class="dc-facts dc-focus-facts" aria-label="Numbers to understand this policy">${factCards(v.observations,'focus')}</div>
        <p class="dc-forms"><b>Housing it could add:</b> ${esc(v.forms)}</p><p class="dc-local-need"><b>Check first:</b> ${esc(v.check)}</p>
      </section>
      <section class="dc-section dc-explanation" aria-labelledby="dc-explanation-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">3</span><h4 id="dc-explanation-title">How we got this number</h4></div>
        <p class="dc-assumption"><b>${esc(v.level)} assumption:</b> ${esc(v.assumptionMeaning)}</p><ol class="dc-calculation" aria-label="Calculation in two steps">${(v.calculationSteps||[]).map(step=>`<li>${esc(step)}</li>`).join('')}</ol>
        <p class="dc-constraint">The extra homes depend on these assumptions and on projects being able to happen.</p>
        <details class="simple-more-facts"><summary>More local housing facts</summary><div class="simple-more-facts-body">${v.currentHomes?`<p><b>Existing homes:</b> ${esc(v.currentHomes)}. This is separate from new permits.</p>`:''}<div class="dc-facts dc-evidence-facts" aria-label="Additional local housing facts">${factCards(v.moreFacts,'evidence')}</div>${v.detailedNeed?`<p>${esc(v.detailedNeed)}</p>`:''}<p>${esc(v.comparisonMeaning)}</p><p>${esc(v.sourceNote)}</p></div></details>
      </section>
    </div>`;
  };
  window.renderSampleResult=window.renderDecisionCard;
})();
