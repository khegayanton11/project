'use strict';
const app = document.getElementById('app');
const TYPE_LABELS = {
  text: 'Короткий текст', textarea: 'Длинный текст', email: 'Email', number: 'Число', date: 'Дата',
  select: 'Выпадающий список', radio: 'Один вариант', checkbox: 'Несколько вариантов',
};
const CHOICE = ['select', 'radio', 'checkbox'];
const formUrl = (f) => `${location.origin}/f/${f.slug}`;
const fmt = (iso) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
const safe = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };

// ---------- список форм ----------
async function list() {
  const forms = await api('/api/forms');
  return h('section', {},
    h('div', { class: 'bar' }, h('h1', {}, 'Формы'), h('a', { class: 'btn primary', href: '#/new' }, 'Создать форму')),
    forms.length
      ? h('div', { class: 'rows' }, forms.map((f) => h('div', { class: 'row' },
          h('div', { class: 'grow' },
            h('a', { class: 'title', href: `#/edit/${f.id}` }, f.title),
            h('div', { class: 'muted' },
              h('span', { class: 'badge' + (f.published ? ' live' : '') }, f.published ? 'Опубликована' : 'Черновик'),
              `Вопросов: ${f.fields.length}, ответов: ${f.responses}`)),
          f.published && h('button', { class: 'btn small', onclick: () => copy(formUrl(f)) }, 'Копировать ссылку'),
          h('a', { class: 'btn small', href: `#/results/${f.id}` }, 'Ответы'),
          h('button', {
            class: 'btn small danger',
            onclick: safe(async () => {
              if (!confirm(`Удалить «${f.title}» вместе со всеми ответами?`)) return;
              await api('/api/forms/' + f.id, 'DELETE');
              route();
            }),
          }, 'Удалить'))))
      : h('p', { class: 'muted empty' }, 'Форм пока нет. Создайте первую, опубликуйте и отправьте студентам ссылку.'));
}

// ---------- конструктор ----------
function editor(form) {
  const f = structuredClone(form);
  let live = !!(f.id && f.published); // ссылка работает только для сохранённой опубликованной формы
  const box = h('div', {});
  const linkBox = h('div', {});

  const showLink = () => linkBox.replaceChildren(live
    ? h('div', { class: 'card link' },
        h('input', { class: 'grow', readonly: true, value: formUrl(f), onfocus: (e) => e.target.select() }),
        h('button', { class: 'btn', onclick: () => copy(formUrl(f)) }, 'Копировать'),
        h('a', { class: 'btn', href: formUrl(f), target: '_blank', rel: 'noopener' }, 'Открыть'))
    : h('p', { class: 'muted' }, f.id ? 'Форма не опубликована, ссылка закрыта.' : 'Сохраните форму, чтобы получить ссылку.'));

  const draw = () => box.replaceChildren(...(f.fields.length
    ? f.fields.map(fieldCard)
    : [h('p', { class: 'muted empty' }, 'Вопросов пока нет. Добавьте первый кнопками ниже.')]));

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= f.fields.length) return;
    [f.fields[i], f.fields[j]] = [f.fields[j], f.fields[i]];
    draw();
  };

  function fieldCard(q, i) {
    const sel = h('select', {
      onchange: (e) => {
        q.type = e.target.value;
        if (CHOICE.includes(q.type) && !q.options.length) q.options = ['Вариант 1', 'Вариант 2'];
        draw();
      },
    }, Object.entries(TYPE_LABELS).map(([v, l]) => h('option', { value: v }, l)));
    sel.value = q.type;
    return h('div', { class: 'card field' },
      h('div', { class: 'line' },
        h('input', { class: 'grow', placeholder: 'Текст вопроса', value: q.label, oninput: (e) => { q.label = e.target.value; } }),
        sel),
      CHOICE.includes(q.type) && h('textarea', {
        rows: 3, placeholder: 'Варианты ответа, по одному в строке', value: q.options.join('\n'),
        oninput: (e) => { q.options = e.target.value.split('\n'); },
      }),
      h('div', { class: 'line' },
        h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: q.required, onchange: (e) => { q.required = e.target.checked; } }), 'Обязательный'),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn small', disabled: i === 0, onclick: () => move(i, -1) }, 'Выше'),
        h('button', { class: 'btn small', disabled: i === f.fields.length - 1, onclick: () => move(i, 1) }, 'Ниже'),
        h('button', { class: 'btn small danger', onclick: () => { f.fields.splice(i, 1); draw(); } }, 'Удалить')));
  }

  const add = (type) => {
    f.fields.push({
      id: 'f_' + Math.random().toString(36).slice(2, 8), type, label: '', required: false,
      options: CHOICE.includes(type) ? ['Вариант 1', 'Вариант 2'] : [],
    });
    draw();
    box.lastElementChild.querySelector('input').focus();
  };

  const save = safe(async () => {
    const saved = f.id ? await api('/api/forms/' + f.id, 'PUT', f) : await api('/api/forms', 'POST', f);
    toast('Сохранено');
    if (!f.id) { location.hash = '#/edit/' + saved.id; return; }
    f.fields = saved.fields; // сервер чистит пустые варианты и т.п.
    live = saved.published;
    draw(); showLink();
  });

  draw(); showLink();
  return h('section', {},
    h('div', { class: 'bar' },
      h('h1', {}, f.id ? 'Редактирование формы' : 'Новая форма'),
      f.id && h('a', { class: 'btn', href: `#/results/${f.id}` }, 'Ответы и аналитика')),
    h('div', { class: 'card stack' },
      h('input', { class: 'big', placeholder: 'Название формы', value: f.title, oninput: (e) => { f.title = e.target.value; } }),
      h('textarea', { rows: 2, placeholder: 'Описание для студента (необязательно)', value: f.description, oninput: (e) => { f.description = e.target.value; } }),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: f.published, onchange: (e) => { f.published = e.target.checked; } }),
        'Опубликована: открыта по ссылке')),
    linkBox,
    box,
    h('div', { class: 'card' },
      h('div', { class: 'muted' }, 'Добавить вопрос'),
      h('div', { class: 'chips' }, Object.entries(TYPE_LABELS).map(([t, l]) => h('button', { class: 'btn small', onclick: () => add(t) }, l)))),
    h('div', { class: 'line' },
      h('button', { class: 'btn primary', onclick: save }, 'Сохранить'),
      h('a', { class: 'btn', href: '#/' }, 'К списку')));
}

// ---------- ответы и аналитика ----------
async function results(id) {
  const [form, rs, st] = await Promise.all([
    api(`/api/forms/${id}`), api(`/api/forms/${id}/responses`), api(`/api/forms/${id}/stats`),
  ]);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const max = Math.max(1, ...st.perField.map((x) => x.abandonedHere));
  const top = [...st.perField].sort((a, b) => b.abandonedHere - a.abandonedHere)[0];
  const stat = (n, label, sub) => h('div', { class: 'stat' }, h('div', { class: 'num' }, n), h('div', {}, label), h('div', { class: 'muted' }, sub));
  const show = (v) => (v == null ? '—' : Array.isArray(v) ? v.join(', ') : v);

  return h('section', {},
    h('div', { class: 'bar' },
      h('div', {}, h('a', { href: '#/', class: 'muted' }, 'Все формы'), h('h1', {}, form.title)),
      h('a', { class: 'btn', href: `#/edit/${id}` }, 'Редактировать')),
    h('h2', {}, 'Путь студента'),
    h('div', { class: 'stats' },
      stat(st.views, 'Открыли форму', 'уникальных посетителей'),
      stat(st.started, 'Начали заполнять', pct(st.started, st.views) + ' от открывших'),
      stat(st.submitted, 'Отправили', pct(st.submitted, st.started) + ' от начавших')),
    top && top.abandonedHere > 0 && h('p', {}, `Начали, но не отправили: ${st.started - st.submitted}. Чаще всего останавливаются на вопросе «${top.label}».`),
    st.perField.length > 0 && h('div', { class: 'card' },
      h('h3', {}, 'Где бросают заполнение'),
      h('p', { class: 'muted' }, 'Число показывает, сколько студентов остановились на этом вопросе из тех, кто до него дошёл.'),
      st.perField.map((x) => h('div', { class: 'drop' },
        h('div', { class: 'grow' }, x.label),
        h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${Math.round((x.abandonedHere / max) * 100)}%` })),
        h('div', { class: 'cnt' }, `${x.abandonedHere} из ${x.reached}`)))),
    h('div', { class: 'bar' },
      h('h2', {}, `Ответы (${rs.length})`),
      rs.length > 0 && h('a', { class: 'btn', href: `/api/forms/${id}/export.csv`, download: 'responses.csv' }, 'Скачать CSV')),
    rs.length
      ? rs.map((r) => h('div', { class: 'card' },
          h('div', { class: 'muted' }, fmt(r.submittedAt)),
          h('dl', {}, r.fields.map((q) => [h('dt', {}, q.label), h('dd', {}, show(r.answers[q.id]))]))))
      : h('p', { class: 'muted empty' }, 'Ответов пока нет.'));
}

// ---------- роутер ----------
const routes = [
  [/^#\/new$/, () => editor({ title: '', description: '', published: false, fields: [] })],
  [/^#\/edit\/([\w-]+)$/, async (id) => editor(await api('/api/forms/' + id))],
  [/^#\/results\/([\w-]+)$/, (id) => results(id)],
];
async function route() {
  const hash = location.hash || '#/';
  try {
    for (const [re, fn] of routes) {
      const m = hash.match(re);
      if (m) { app.replaceChildren(await fn(m[1])); return; }
    }
    app.replaceChildren(await list());
  } catch (e) {
    app.replaceChildren(h('p', { class: 'error' }, e.message));
  }
}
addEventListener('hashchange', route);
route();
