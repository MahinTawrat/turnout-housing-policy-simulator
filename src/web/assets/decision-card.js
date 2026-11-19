/* Final Decision Card. Presentation only; all values come from the audited model. */
(function () {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[character]));
  const factValue = value => {
    const text=String(value ?? 'Unknown'), cut=text.indexOf(' ±');
    return cut<0?escape(text):escape(text.slice(0,cut))+`<small class="dc-fact-moe">±${escape(text.slice(cut+2))}</small>`;
  };
  const list = value => Array.isArray(value) ? value : value ? [value] : [];
  const factCards = (facts, type) => (facts || []).slice(0, 2).map(fact => `
    <div class="dc-fact dc-fact-${type}">
      <strong>${factValue(fact.value)}</strong>
      <div class="dc-fact-copy"><span>${escape(fact.label)}</span>${fact.note ? `<small>${escape(fact.note)}</small>` : ''}</div>
    </div>`).join('');

  window.renderDecisionCard = function (v) {
    const text = key => escape(v[key]);
    const isMissing = Boolean(v.isMissing);
    const baselineLabel = v.baselineLabel || 'Five-year permit benchmark';
    const baselineHelp = v.baselineHelp || 'Five times the 2025 permits: permission to build, not the number of existing homes.';
    const ratio = v.percentExplanation || v.per100 || (v.isZeroBaseline || isMissing
      ? 'A percentage cannot be calculated from a zero or missing permit benchmark.'
      : `${v.pct} more than the five-year permit benchmark.`);
    const observations = factCards(v.observations, 'focus');
    const evidence = factCards(v.evidenceCards, 'evidence');
    const steps = list(v.calculationSteps).slice(0, 2);
    const limitation = list(v.limitations).slice(0, 1).join(' ') || v.check || 'Local rules, costs and the ability to complete these homes still need checking.';
    const source = v.sourceNote || 'Census housing data and stated model assumptions. This is a scenario, not a promise.';

    return `<div class="decision-story" aria-label="Housing policy decision card">
      <section class="dc-section dc-effect${isMissing ? ' dc-effect-missing' : ''}" aria-labelledby="dc-effect-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">1</span><h4 id="dc-effect-title">See what could change</h4><span class="dc-horizon">Over five years</span></div>
        <div class="dc-effect-main">
          <div class="dc-impact"><strong>${isMissing ? 'Not available' : text('added')}</strong><span>${isMissing ? 'Extra homes cannot be estimated here.' : 'possible extra homes'}</span></div>
          <div class="dc-comparison" aria-label="Permit benchmark and estimate with this policy">
            <div><span>${escape(baselineLabel)}</span><b>${text('baseline')}</b></div>
            <div><span>${escape(v.totalLabel || 'With assumed response')}${v.totalHelp ? `<br><small>${text('totalHelp')}</small>` : ''}</span><b>${text('total')}</b></div>
          </div>
        </div>
        <p class="dc-baseline-help">${escape(baselineHelp)}</p>
        <p class="dc-percent-explanation">${escape(ratio)}</p>
        ${v.currentHomes ? `<p class="dc-stock-context">Existing housing stock: <b>${text('currentHomes')}</b>. This counts existing homes, not new permits.</p>` : ''}
      </section>

      <section class="dc-section dc-focus" aria-labelledby="dc-focus-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">2</span><h4 id="dc-focus-title">${text('focusTitle') || 'Focus on the local need'}</h4></div>
        <p class="dc-mechanism">${escape(v.mechanism || v.focusBody || v.why)}</p>
        ${observations ? `<div class="dc-facts dc-focus-facts" aria-label="Policy-specific local evidence">${observations}</div>` : ''}
        <p class="dc-forms"><b>Homes it could allow:</b> ${text('forms')}</p>
        <p class="dc-local-need">${escape(v.localNeed || v.needText)}</p>
      </section>

      <section class="dc-section dc-explanation" aria-labelledby="dc-explanation-title">
        <div class="dc-section-heading"><span class="dc-step-number" aria-hidden="true">3</span><h4 id="dc-explanation-title">Why this estimate?</h4></div>
        ${evidence ? `<div class="dc-facts dc-evidence-facts" aria-label="Inputs behind the estimate">${evidence}</div>` : ''}
        ${v.assumptionMeaning ? `<p class="dc-assumption"><b>${text('level')} assumption:</b> ${text('assumptionMeaning')}</p>` : ''}
        ${steps.length ? `<ol class="dc-calculation" aria-label="Calculation in two steps">${steps.map(step => `<li>${escape(step)}</li>`).join('')}</ol>` : ''}
        <p class="dc-constraint"><b>Still to check:</b> ${escape(limitation)}</p>
        <p class="dc-source-note">${escape(source)}</p>
      </section>
    </div>`;
  };
  // Retain the sample renderer's integration name without changing model code.
  window.renderSampleResult = window.renderDecisionCard;
})();
