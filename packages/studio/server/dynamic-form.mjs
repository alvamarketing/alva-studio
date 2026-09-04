const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

function field(step) {
  const required = step.required ? ' required' : '';
  if (step.type === 'single_choice') {
    return `<div class="choices">${step.options
      .map(
        (option, index) =>
          `<label class="choice"><input type="radio" name="${escape(step.id)}" value="${escape(option)}"${required}><span class="choice-key">${index + 1}</span><span>${escape(option)}</span></label>`,
      )
      .join('')}</div>`;
  }
  const type = step.type === 'email' ? 'email' : step.type === 'phone' ? 'tel' : 'text';
  const autocomplete = step.type === 'email' ? 'email' : step.type === 'phone' ? 'tel' : 'off';
  return `<input class="answer" type="${type}" name="${escape(step.id)}" placeholder="${escape(step.placeholder)}" autocomplete="${autocomplete}"${required}>`;
}

export function renderDynamicForm(form, actionUrl) {
  const total = form.steps.length;
  const steps = form.steps
    .map(
      (step, index) =>
        `<section class="step" data-step="${index}"${index ? ' hidden' : ''}><p class="step-count">PERGUNTA ${index + 1} DE ${total}</p><h1>${escape(step.title)}</h1>${step.description ? `<p class="description">${escape(step.description)}</p>` : ''}${field(step)}<div class="actions">${index ? '<button type="button" class="back">Voltar</button>' : '<span></span>'}<button type="button" class="next">${index === total - 1 ? 'Enviar respostas' : 'Continuar'} <span aria-hidden="true">→</span></button></div></section>`,
    )
    .join('');
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(form.name)}</title><style>
:root{--accent:#286eea;--ink:#101828;--muted:#667085;--line:#dfe7f3;--cloud:#f7f9fc;--white:#fff;font-family:Instrument Sans,Inter,system-ui,sans-serif;color:#101828;background:#f7f9fc}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px;background:radial-gradient(circle at 85% 15%,#eaf2ff,transparent 34%),var(--cloud)}.shell{width:min(720px,100%)}.brand{display:flex;align-items:center;gap:9px;margin-bottom:28px;font-weight:750;letter-spacing:.14em}.brand-mark{color:var(--accent);font-size:24px}.card{background:var(--white);border:1px solid var(--line);border-radius:24px;padding:clamp(28px,6vw,58px);box-shadow:0 24px 70px rgba(16,24,40,.08)}.progress{height:6px;background:#edf1f7;border-radius:999px;overflow:hidden;margin-bottom:46px}.progress span{display:block;width:0;height:100%;background:var(--accent);border-radius:inherit;transition:width .25s ease}.step-count{font-size:11px;letter-spacing:.14em;color:var(--accent);font-weight:700;margin:0 0 16px}.step h1{font-size:clamp(30px,5vw,48px);line-height:1.08;letter-spacing:-.04em;margin:0 0 13px}.description{font-size:16px;line-height:1.6;color:var(--muted);margin:0 0 28px}.answer{width:100%;border:0;border-bottom:2px solid var(--line);padding:16px 2px;background:transparent;color:var(--ink);font:inherit;font-size:21px;outline:none}.answer:focus{border-color:var(--accent)}.choices{display:grid;gap:10px;margin-top:25px}.choice{display:flex;align-items:center;gap:12px;border:1px solid var(--line);border-radius:14px;padding:14px 16px;cursor:pointer;transition:.16s}.choice:hover,.choice:has(input:checked){border-color:var(--accent);background:#eef4ff}.choice input{accent-color:var(--accent)}.choice-key{display:grid;place-items:center;width:27px;height:27px;border:1px solid var(--line);border-radius:8px;font-size:12px}.actions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:38px}.actions button{border:0;border-radius:12px;padding:13px 18px;font:inherit;font-weight:700;cursor:pointer}.back{background:transparent;color:var(--muted)}.next{background:var(--accent);color:#fff;box-shadow:0 8px 22px rgba(40,110,234,.2)}.hint{text-align:center;color:var(--muted);font-size:11px;margin-top:18px}@media(max-width:560px){body{padding:14px}.card{padding:30px 22px;border-radius:19px}.progress{margin-bottom:34px}.step h1{font-size:31px}}
</style></head><body><main class="shell" data-dynamic-form><div class="brand"><span class="brand-mark">⌁</span> ALVA</div><form class="card" method="post" action="${escape(actionUrl)}"><div class="progress" role="progressbar" aria-label="Progresso do formulário" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="1"><span></span></div>${steps}<input type="hidden" name="_completion_title" value="${escape(form.completion.title)}"><input type="hidden" name="_completion_message" value="${escape(form.completion.message)}"></form><p class="hint">Seus dados serão usados para responder ao seu contato.</p></main><script>
(()=>{const form=document.querySelector('form');const steps=[...form.querySelectorAll('.step')];const progress=form.querySelector('.progress');const bar=progress.querySelector('span');let current=0;function showStep(index){current=Math.max(0,Math.min(index,steps.length-1));steps.forEach((step,i)=>step.hidden=i!==current);progress.setAttribute('aria-valuenow',String(current+1));bar.style.width=((current+1)/steps.length*100)+'%';const focus=steps[current].querySelector('input');if(focus)setTimeout(()=>focus.focus(),40)}function valid(){const fields=[...steps[current].querySelectorAll('input')];const required=fields.find(field=>field.required);if(!required)return true;if(required.type==='radio'){if(fields.some(field=>field.checked))return true;required.setCustomValidity('Escolha uma opção para continuar.');required.reportValidity();required.setCustomValidity('');return false}return required.reportValidity()}form.addEventListener('click',event=>{const next=event.target.closest('.next');const back=event.target.closest('.back');if(back)showStep(current-1);if(!next||!valid())return;if(current===steps.length-1)form.requestSubmit();else showStep(current+1)});form.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.type!=='radio'){event.preventDefault();const next=steps[current].querySelector('.next');next.click()}});showStep(0)})();
</script></body></html>`;
}

export function renderCompletion(title, message) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#f7f9fc;color:#101828;font-family:Instrument Sans,Inter,system-ui,sans-serif}.card{width:min(620px,100%);padding:55px;background:#fff;border:1px solid #e7ecf3;border-radius:24px;box-shadow:0 24px 70px rgba(16,24,40,.08)}.mark{display:grid;place-items:center;width:54px;height:54px;border-radius:50%;background:#eaf2ff;color:#286eea;font-size:26px}h1{font-size:clamp(34px,6vw,54px);letter-spacing:-.04em;margin:28px 0 12px}p{color:#667085;font-size:17px;line-height:1.65}</style></head><body><main class="card"><div class="mark">✓</div><h1>${escape(title)}</h1><p>${escape(message)}</p></main></body></html>`;
}
