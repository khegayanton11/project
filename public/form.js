'use strict';
(async () => {
  const slug = location.pathname.split('/').pop();
  const root = document.getElementById('root');
  const sidKey = 'sid:' + slug, draftKey = 'draft:' + slug;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* приватный режим */ } },
    del: (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
  };

  let form;
  try { form = await api('/api/public/' + slug); }
  catch (e) {
    root.replaceChildren(h('div', { class: 'card center' }, h('h1', {}, 'Форма недоступна'), h('p', { class: 'muted' }, e.message)));
    return;
  }
  document.title = form.title;

  // Аналитика: анонимная сессия + какие поля студент открыл. По ней админка показывает, где бросают форму.
  const sid = store.get(sidKey) || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  store.set(sidKey, sid);
  const track = (type, fieldId) => fetch(`/api/public/${slug}/event`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sid, type, fieldId }), keepalive: true,
  }).catch(() => {});
  track('view');

  // Черновик в localStorage: студент не теряет ответы при перезагрузке или закрытии вкладки.
  let values = {};
  try { values = JSON.parse(store.get(draftKey) || '{}') || {}; } catch { values = {}; }

  const answered = () => form.fields.filter((q) => {
    const v = values[q.id];
    return Array.isArray(v) ? v.length : v != null && String(v).trim() !== '';
  }).length;
  const fill = h('div', { class: 'progress-fill' });
  const progressText = h('div', { class: 'muted' });
  const progress = () => {
    const n = answered(), total = form.fields.length;
    fill.style.width = total ? Math.round((n / total) * 100) + '%' : '0';
    progressText.textContent = `Заполнено ${n} из ${total}`;
  };
  const set = (q, v) => { values[q.id] = v; store.set(draftKey, JSON.stringify(values)); progress(); };

  function inputFor(q) {
    const id = 'q_' + q.id, cur = values[q.id];
    switch (q.type) {
      case 'textarea':
        return h('textarea', { id, rows: 4, value: cur ?? '', oninput: (e) => set(q, e.target.value) });
      case 'select': {
        const s = h('select', { id, onchange: (e) => set(q, e.target.value) },
          h('option', { value: '' }, 'Выберите вариант'), q.options.map((o) => h('option', { value: o }, o)));
        s.value = q.options.includes(cur) ? cur : '';
        return s;
      }
      case 'radio':
        return h('div', { class: 'choices' }, q.options.map((o) => h('label', { class: 'check' },
          h('input', { type: 'radio', name: id, value: o, checked: cur === o, onchange: () => set(q, o) }), o)));
      case 'checkbox': {
        const chosen = Array.isArray(cur) ? cur : [];
        return h('div', { class: 'choices' }, q.options.map((o) => h('label', { class: 'check' },
          h('input', {
            type: 'checkbox', checked: chosen.includes(o),
            onchange: (e) => {
              const a = new Set(Array.isArray(values[q.id]) ? values[q.id] : []);
              if (e.target.checked) a.add(o); else a.delete(o);
              set(q, [...a]);
            },
          }), o)));
      }
      default:
        return h('input', { id, type: q.type, step: q.type === 'number' ? 'any' : null, value: cur ?? '', oninput: (e) => set(q, e.target.value) });
    }
  }

  let lastTracked = null;
  const errEls = {}, qEls = {};
  const questions = form.fields.map((q) => {
    errEls[q.id] = h('div', { class: 'err', role: 'alert' });
    qEls[q.id] = h('div', {
      class: 'q',
      onfocusin: () => { if (lastTracked !== q.id) { lastTracked = q.id; track('field', q.id); } },
    },
    h(q.type === 'radio' || q.type === 'checkbox' ? 'div' : 'label', { class: 'lbl', for: 'q_' + q.id },
      q.label, q.required && h('span', { class: 'req' }, ' *')),
    inputFor(q), errEls[q.id]);
    return qEls[q.id];
  });

  const showErrors = (errors) => {
    for (const q of form.fields) {
      errEls[q.id].textContent = errors[q.id] || '';
      qEls[q.id].classList.toggle('invalid', !!errors[q.id]);
    }
    const first = form.fields.find((q) => errors[q.id]);
    if (first) qEls[first.id].scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const btn = h('button', { class: 'btn primary', type: 'submit' }, 'Отправить отклик');
  const onSubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      await api(`/api/public/${slug}/submit`, 'POST', { sid, answers: values });
      store.del(draftKey); store.del(sidKey);
      root.replaceChildren(h('div', { class: 'card center' },
        h('h1', {}, 'Спасибо, отклик отправлен'), h('p', { class: 'muted' }, 'Мы получили ваши ответы и свяжемся с вами.')));
    } catch (err) {
      if (err.errors) showErrors(err.errors); else toast(err.message);
      btn.disabled = false;
    }
  };

  progress();
  root.replaceChildren(h('form', { novalidate: true, onsubmit: onSubmit },
    h('h1', {}, form.title),
    form.description && h('p', { class: 'muted' }, form.description),
    h('div', { class: 'progress' }, fill), progressText,
    h('div', { class: 'card', style: 'margin-top:1rem' }, questions.length ? questions : h('p', { class: 'muted' }, 'В этой форме пока нет вопросов.')),
    btn));
})();
