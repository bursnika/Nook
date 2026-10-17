/* Workspace calendar: a month grid of events and task deadlines, drawn in the browser's own time zone. */
(function () {
  'use strict';

  var root = document.getElementById('calendar');
  if (!root) return;

  var wsId = root.getAttribute('data-workspace');
  var gridEl = root.querySelector('[data-cal="grid"]');
  var labelEl = root.querySelector('[data-cal="label"]');
  var agendaEl = root.querySelector('[data-cal="agenda"]');
  var API = '/api/workspaces/' + wsId;
  var MAX_PILLS = 3;

  var today = new Date();
  var month = new Date(today.getFullYear(), today.getMonth(), 1);
  var selected = key(today);
  var data = { events: [], tasks: [] };
  var loadSeq = 0;

  // ---- dates ---------------------------------------------------------------------------------

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }
  function key(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function utcKey(d) {
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }
  function fromKey(k) {
    var p = k.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }
  function addDays(d, n) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  }
  /** The grid starts on the Monday of the week that contains the 1st and always shows six weeks. */
  function gridStart() {
    var offset = (month.getDay() + 6) % 7;
    return addDays(month, -offset);
  }
  function time(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /** Day keys an event covers. All-day events are plain dates (UTC); timed ones follow local time. */
  function eventDays(ev) {
    var start = new Date(ev.startsAt);
    var end = new Date(ev.endsAt);
    var keys = [];
    if (ev.allDay) {
      for (
        var t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        t < end.getTime() || !keys.length;
        t += 86400000
      ) {
        keys.push(utcKey(new Date(t)));
        if (keys.length > 42) break;
      }
      return keys;
    }
    var last = key(new Date(Math.max(start.getTime(), end.getTime() - 1)));
    for (
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
      key(d) <= last && keys.length <= 42;
      d = addDays(d, 1)
    ) {
      keys.push(key(d));
    }
    return keys;
  }

  function itemsByDay() {
    var days = {};
    function put(k, item) {
      (days[k] = days[k] || []).push(item);
    }
    data.events.forEach(function (ev) {
      eventDays(ev).forEach(function (k) {
        put(k, { kind: 'event', title: ev.title, at: new Date(ev.startsAt).getTime(), ev: ev });
      });
    });
    data.tasks.forEach(function (task) {
      var due = new Date(task.dueDate);
      put(key(due), { kind: 'task', title: task.title, at: due.getTime(), task: task });
    });
    Object.keys(days).forEach(function (k) {
      days[k].sort(function (a, b) {
        return a.at - b.at;
      });
    });
    return days;
  }

  // ---- loading -------------------------------------------------------------------------------

  function request(method, path, body) {
    var options = {
      method: method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    };
    if (body) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    return fetch(API + path, options).then(function (res) {
      if (res.status === 401) {
        window.location.reload(); // the session expired: the server sends us to sign in again
        return new Promise(function () {});
      }
      if (!res.ok) throw new Error(String(res.status));
      return res.status === 204 ? null : res.json();
    });
  }

  function load() {
    var seq = ++loadSeq;
    var from = gridStart();
    var to = addDays(from, 42);
    render(); // draw the empty grid at once, items follow
    request(
      'GET',
      '/calendar?from=' +
        encodeURIComponent(from.toISOString()) +
        '&to=' +
        encodeURIComponent(to.toISOString()),
    )
      .then(function (result) {
        if (seq !== loadSeq) return;
        data = result;
        render();
      })
      .catch(function () {
        if (seq === loadSeq) agendaEl.textContent = 'Could not load the calendar. Try again later.';
      });
  }

  // ---- drawing -------------------------------------------------------------------------------

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function render() {
    labelEl.textContent = month.toLocaleDateString([], { month: 'long', year: 'numeric' });
    var days = itemsByDay();
    gridEl.textContent = '';

    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (name) {
      gridEl.appendChild(el('div', 'cal-dow', name));
    });

    var start = gridStart();
    for (var i = 0; i < 42; i++) {
      var day = addDays(start, i);
      var k = key(day);
      var cell = el('button', 'cal-cell');
      cell.type = 'button';
      if (day.getMonth() !== month.getMonth()) cell.classList.add('is-other');
      if (k === key(today)) cell.classList.add('is-today');
      if (k === selected) cell.classList.add('is-selected');
      cell.setAttribute('data-day', k);
      var items = days[k] || [];
      if (items.length) cell.classList.add('has-items');
      cell.setAttribute(
        'aria-label',
        day.toLocaleDateString([], { dateStyle: 'full' }) + ', ' + items.length + ' items',
      );
      cell.appendChild(el('span', 'cal-num', String(day.getDate())));
      items.slice(0, MAX_PILLS).forEach(function (item) {
        var pill = el('span', 'cal-pill cal-pill-' + item.kind, item.title);
        if (item.kind === 'task' && item.task.status === 'DONE') pill.classList.add('is-done');
        cell.appendChild(pill);
      });
      if (items.length > MAX_PILLS)
        cell.appendChild(el('span', 'cal-more', '+' + (items.length - MAX_PILLS) + ' more'));
      gridEl.appendChild(cell);
    }
    renderAgenda(days[selected] || []);
  }

  function renderAgenda(items) {
    agendaEl.textContent = '';
    agendaEl.appendChild(
      el('h3', 'h6', fromKey(selected).toLocaleDateString([], { dateStyle: 'full' })),
    );

    if (!items.length) {
      agendaEl.appendChild(el('p', 'text-muted mb-2', 'Nothing planned for this day.'));
    }
    var list = el('ul', 'list-unstyled mb-3');
    items.forEach(function (item) {
      var row = el('li', 'cal-agenda-row');
      if (item.kind === 'event') {
        var ev = item.ev;
        var when = ev.allDay
          ? 'All day'
          : time(new Date(ev.startsAt)) + ' – ' + time(new Date(ev.endsAt));
        row.appendChild(el('span', 'chip chip-in_progress', 'event'));
        row.appendChild(el('span', 'cal-when', when));
        row.appendChild(el('span', 'cal-title', ev.title));
        if (ev.imported) {
          row.appendChild(el('span', 'chip chip-done', ev.calendarName || 'Google'));
        } else {
          var del = el('button', 'btn btn-sm btn-outline-danger ms-auto', 'Delete');
          del.type = 'button';
          del.addEventListener('click', function () {
            if (window.confirm('Delete the event “' + ev.title + '”?')) {
              request('DELETE', '/events/' + ev.id).then(load);
            }
          });
          row.appendChild(del);
        }
      } else {
        var task = item.task;
        row.appendChild(el('span', 'chip chip-' + task.priority.toLowerCase(), 'task'));
        row.appendChild(el('span', 'cal-when', time(new Date(task.dueDate))));
        var link = el('a', 'cal-title', task.title);
        link.href = '/admin/workspaces/' + wsId + '/tasks/' + task.id;
        if (task.status === 'DONE') link.classList.add('is-done');
        row.appendChild(link);
      }
      list.appendChild(row);
    });
    agendaEl.appendChild(list);
    agendaEl.appendChild(eventForm());
  }

  function eventForm() {
    var form = el('form', 'cal-form');
    var day = fromKey(selected);
    function stamp(hour) {
      return key(day) + 'T' + pad(hour) + ':00';
    }
    var title = el('input', 'form-control form-control-sm');
    title.type = 'text';
    title.required = true;
    title.maxLength = 200;
    title.placeholder = 'New event on this day';
    title.setAttribute('aria-label', 'Event title');
    var start = el('input', 'form-control form-control-sm');
    start.type = 'datetime-local';
    start.required = true;
    start.value = stamp(9);
    start.setAttribute('aria-label', 'Starts');
    var end = el('input', 'form-control form-control-sm');
    end.type = 'datetime-local';
    end.required = true;
    end.value = stamp(10);
    end.setAttribute('aria-label', 'Ends');
    var submit = el('button', 'btn btn-sm btn-primary', 'Add event');
    submit.type = 'submit';
    var error = el('div', 'text-danger small');
    error.setAttribute('role', 'alert');
    [title, start, end, submit].forEach(function (node) {
      form.appendChild(node);
    });
    form.appendChild(error);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var startsAt = new Date(start.value);
      var endsAt = new Date(end.value);
      if (!(endsAt > startsAt)) {
        error.textContent = 'The event must end after it starts.';
        return;
      }
      error.textContent = '';
      submit.disabled = true;
      request('POST', '/events', {
        title: title.value.trim(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      })
        .then(load)
        .catch(function () {
          error.textContent = 'Could not save the event.';
          submit.disabled = false;
        });
    });
    return form;
  }

  // ---- controls ------------------------------------------------------------------------------

  gridEl.addEventListener('click', function (event) {
    var cell = event.target.closest('.cal-cell');
    if (!cell) return;
    selected = cell.getAttribute('data-day');
    var picked = fromKey(selected);
    if (picked.getMonth() !== month.getMonth()) {
      month = new Date(picked.getFullYear(), picked.getMonth(), 1);
      load();
    } else {
      render();
    }
  });
  root.querySelector('[data-cal="prev"]').addEventListener('click', function () {
    month = new Date(month.getFullYear(), month.getMonth() - 1, 1);
    load();
  });
  root.querySelector('[data-cal="next"]').addEventListener('click', function () {
    month = new Date(month.getFullYear(), month.getMonth() + 1, 1);
    load();
  });
  root.querySelector('[data-cal="today"]').addEventListener('click', function () {
    today = new Date();
    month = new Date(today.getFullYear(), today.getMonth(), 1);
    selected = key(today);
    load();
  });

  load();
})();
