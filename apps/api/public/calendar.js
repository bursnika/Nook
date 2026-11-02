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
  var DAY_MS = 86400000;

  var today = new Date();
  var month = new Date(today.getFullYear(), today.getMonth(), 1);
  var selected = key(today);
  var data = { events: [], tasks: [], google: {} };
  var loadSeq = 0;

  // dates

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
  // always six weeks, starting on monday
  function gridStart() {
    var offset = (month.getDay() + 6) % 7;
    return addDays(month, -offset);
  }
  function time(d) {
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function localStamp(d) {
    return key(d) + 'T' + time(d);
  }

  // all-day events are utc dates, timed ones use local time
  function eventDays(ev) {
    var start = new Date(ev.startsAt);
    var end = new Date(ev.endsAt);
    var keys = [];
    if (ev.allDay) {
      for (
        var t = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
        t < end.getTime() || !keys.length;
        t += DAY_MS
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

  // api

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
        window.location.reload(); // session expired
        return new Promise(function () {});
      }
      if (res.ok) return res.status === 204 ? null : res.json();
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (problem) {
          var message = Array.isArray(problem.message)
            ? problem.message.join(', ')
            : problem.message;
          throw {
            status: res.status,
            message: message || 'Something went wrong (' + res.status + ').',
            code: problem.code,
          };
        });
    });
  }

  function load() {
    var seq = ++loadSeq;
    var from = gridStart();
    var to = addDays(from, 42);
    render();
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

  // drawing

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className, text, onClick) {
    var node = el('button', className, text);
    node.type = 'button';
    if (onClick) node.addEventListener('click', onClick);
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
      var cell = el('div', 'cal-cell');
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
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
        var pill = button('cal-pill cal-pill-' + item.kind, item.title);
        pill.title = item.title;
        pill.addEventListener('click', function (event) {
          event.stopPropagation();
          openDetails(item);
        });
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
        var title = button('cal-title cal-open', ev.title, function () {
          openDetails(item);
        });
        row.appendChild(title);
        if (ev.imported) row.appendChild(el('span', 'chip chip-done', ev.calendarName || 'Google'));
      } else {
        var task = item.task;
        row.appendChild(el('span', 'chip chip-' + task.priority.toLowerCase(), 'task'));
        row.appendChild(el('span', 'cal-when', time(new Date(task.dueDate))));
        var open = button('cal-title cal-open', task.title, function () {
          openDetails(item);
        });
        if (task.status === 'DONE') open.classList.add('is-done');
        row.appendChild(open);
      }
      list.appendChild(row);
    });
    agendaEl.appendChild(list);
    agendaEl.appendChild(eventForm());
  }

  function field(label, input, id) {
    var wrap = el('div', 'mb-2');
    var l = el('label', 'form-label small fw-bold mb-1', label);
    input.id = id;
    l.htmlFor = id;
    wrap.appendChild(l);
    wrap.appendChild(input);
    return wrap;
  }

  function input(type, className) {
    var node = el('input', className || 'form-control form-control-sm');
    node.type = type;
    return node;
  }

  function eventForm() {
    var form = el('form', 'cal-form');
    var day = fromKey(selected);
    function stamp(hour) {
      return key(day) + 'T' + pad(hour) + ':00';
    }
    var title = input('text');
    title.required = true;
    title.maxLength = 200;
    title.placeholder = 'New event on this day';
    title.setAttribute('aria-label', 'Event title');
    var start = input('datetime-local');
    start.required = true;
    start.value = stamp(9);
    start.setAttribute('aria-label', 'Starts');
    var end = input('datetime-local');
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

    var extra = el('div', 'cal-form-extra');
    var toGoogle = input('checkbox', 'form-check-input');
    toGoogle.id = 'cal-quick-google';
    toGoogle.checked = true;
    if (canCreateInGoogle()) {
      var wrap = el('div', 'form-check mb-0');
      var label = el('label', 'form-check-label small', 'Also add to my Google Calendar');
      label.htmlFor = toGoogle.id;
      wrap.appendChild(toGoogle);
      wrap.appendChild(label);
      extra.appendChild(wrap);
    }
    extra.appendChild(
      button('btn btn-sm btn-link p-0', 'More options…', function () {
        var startsAt = new Date(start.value);
        var endsAt = new Date(end.value);
        openCreate({
          title: title.value.trim(),
          startsAt: isNaN(startsAt) ? new Date() : startsAt,
          endsAt: isNaN(endsAt) ? new Date(Date.now() + 3600000) : endsAt,
          google: canCreateInGoogle() && toGoogle.checked,
        });
      }),
    );
    form.appendChild(extra);
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
      var goesToGoogle = canCreateInGoogle() && toGoogle.checked;
      request('POST', goesToGoogle ? '/google-calendar/events' : '/events', {
        title: title.value.trim(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        ...(goesToGoogle ? { allDay: false, description: null } : {}),
      })
        .then(load)
        .catch(function (problem) {
          error.textContent = problem.message || 'Could not save the event.';
          submit.disabled = false;
        });
    });
    return form;
  }

  // event dialog

  var dialog = null;

  function getDialog() {
    if (dialog) return dialog;
    dialog = el('dialog', 'cal-dialog');
    dialog.setAttribute('aria-labelledby', 'cal-dialog-title');
    // click on the backdrop
    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) dialog.close();
    });
    root.appendChild(dialog);
    return dialog;
  }

  function rights(ev) {
    if (!ev.imported) return { edit: true };
    var google = data.google || {};
    if (!ev.editable) {
      return {
        reason:
          'This calendar is read-only for you in Google Calendar (a holiday or birthday calendar, or one shared with you for viewing).',
      };
    }
    if (!ev.mine) {
      return {
        reason:
          'This event came from another person’s Google Calendar, so only they can change it.',
      };
    }
    if (!google.twoWay) {
      return {
        reason:
          'Changing synced events from Nook is a Pro feature. You can still change it in Google Calendar.',
      };
    }
    if (!google.editGranted) {
      return { reason: 'Nook can only read your Google Calendar so far.', allow: true };
    }
    return { edit: true, google: true };
  }

  function canCreateInGoogle() {
    var google = data.google || {};
    return Boolean(google.twoWay && google.editGranted);
  }

  function openCreate(prefill) {
    var box = getDialog();
    box.textContent = '';
    editEvent(
      box,
      {
        title: prefill.title,
        description: '',
        startsAt: prefill.startsAt.toISOString(),
        endsAt: prefill.endsAt.toISOString(),
        allDay: false,
        imported: false,
        recurring: false,
      },
      { create: true, google: prefill.google },
    );
    if (!box.open) box.showModal();
  }

  function eventPath(ev) {
    return (ev.imported ? '/google-calendar/events/' : '/events/') + ev.id;
  }

  function describeWhen(ev) {
    var start = new Date(ev.startsAt);
    var end = new Date(ev.endsAt);
    var long = { weekday: 'long', day: 'numeric', month: 'long' };
    if (ev.allDay) {
      var last = new Date(end.getTime() - DAY_MS);
      var opts = { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' };
      var first = start.toLocaleDateString([], opts);
      return last.getTime() > start.getTime()
        ? first + ' – ' + last.toLocaleDateString([], opts)
        : first;
    }
    if (key(start) === key(end) || key(new Date(end.getTime() - 1)) === key(start)) {
      return start.toLocaleDateString([], long) + ' · ' + time(start) + ' – ' + time(end);
    }
    return (
      start.toLocaleDateString([], long) +
      ' ' +
      time(start) +
      ' – ' +
      end.toLocaleDateString([], long) +
      ' ' +
      time(end)
    );
  }

  function openDetails(item) {
    var box = getDialog();
    box.textContent = '';
    if (item.kind === 'event') showEvent(box, item.ev);
    else showTask(box, item.task);
    if (!box.open) box.showModal();
  }

  function bar(box, actions) {
    var toolbar = el('div', 'cal-dialog-bar');
    actions.forEach(function (action) {
      var b = button('btn btn-sm btn-outline-primary cal-icon', action.icon, action.run);
      b.title = action.label;
      b.setAttribute('aria-label', action.label);
      toolbar.appendChild(b);
    });
    var close = button('btn btn-sm btn-outline-primary cal-icon', '✕', function () {
      box.close();
    });
    close.title = 'Close';
    close.setAttribute('aria-label', 'Close');
    toolbar.appendChild(close);
    box.appendChild(toolbar);
  }

  function showEvent(box, ev) {
    var can = rights(ev);
    var actions = [];
    if (can.edit) {
      actions.push({
        icon: '✎',
        label: 'Edit',
        run: function () {
          editEvent(box, ev);
        },
      });
      actions.push({
        icon: '🗑',
        label: 'Delete',
        run: function () {
          removeEvent(box, ev);
        },
      });
    }
    bar(box, actions);

    var body = el('div', 'cal-dialog-body');
    var heading = el('h2', 'h4 mb-1', ev.title);
    heading.id = 'cal-dialog-title';
    body.appendChild(heading);
    body.appendChild(el('div', 'text-muted mb-1', describeWhen(ev)));
    if (ev.recurring)
      body.appendChild(
        el('div', 'small mb-1', '↻ Repeats. Changes apply to this occurrence only.'),
      );
    if (ev.imported) {
      var source = el('div', 'mb-2');
      source.appendChild(el('span', 'chip chip-done', ev.calendarName || 'Google Calendar'));
      if (ev.url) {
        var link = el('a', 'ms-2 small', 'Open in Google Calendar ↗');
        link.href = ev.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        source.appendChild(link);
      }
      body.appendChild(source);
    }
    if (ev.description) body.appendChild(el('p', 'cal-description', ev.description));
    if (can.reason) {
      var note = el('div', 'alert alert-secondary small mb-0', can.reason + ' ');
      if (can.allow) {
        var allow = el('a', undefined, 'Allow editing Google events');
        allow.href =
          '/api/google-calendar/connect?edit=1&returnTo=' +
          encodeURIComponent('/admin/workspaces/' + wsId);
        note.appendChild(allow);
        note.appendChild(document.createTextNode('.'));
      }
      body.appendChild(note);
    }
    box.appendChild(body);
  }

  function showTask(box, task) {
    bar(box, []);
    var body = el('div', 'cal-dialog-body');
    var heading = el('h2', 'h4 mb-1', task.title);
    heading.id = 'cal-dialog-title';
    body.appendChild(heading);
    body.appendChild(
      el(
        'div',
        'text-muted mb-2',
        'Due ' +
          new Date(task.dueDate).toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }),
      ),
    );
    var chips = el('div', 'mb-2');
    chips.appendChild(
      el(
        'span',
        'chip chip-' + task.status.toLowerCase(),
        task.status.replace('_', ' ').toLowerCase(),
      ),
    );
    chips.appendChild(document.createTextNode(' '));
    chips.appendChild(
      el('span', 'chip chip-' + task.priority.toLowerCase(), task.priority.toLowerCase()),
    );
    if (task.assignee)
      chips.appendChild(el('span', 'ms-2 small', 'Assigned to ' + task.assignee.name));
    body.appendChild(chips);
    var open = el('a', 'btn btn-sm btn-primary', 'Open task');
    open.href = '/admin/workspaces/' + wsId + '/tasks/' + task.id;
    body.appendChild(open);
    box.appendChild(body);
  }

  function removeEvent(box, ev) {
    var what = ev.imported
      ? 'Delete “' +
        ev.title +
        '” from Google Calendar as well?' +
        (ev.recurring ? ' Only this occurrence is deleted.' : '')
      : 'Delete the event “' + ev.title + '”?';
    if (!window.confirm(what)) return;
    request('DELETE', eventPath(ev))
      .then(function () {
        box.close();
        load();
      })
      .catch(function (problem) {
        if (problem.status === 410) {
          box.close();
          load();
        } else {
          alertIn(box, problem.message);
        }
      });
  }

  function alertIn(box, message) {
    var old = box.querySelector('.cal-error');
    if (old) old.remove();
    var line = el('div', 'alert alert-danger small m-3 mb-0 cal-error', message);
    line.setAttribute('role', 'alert');
    box.appendChild(line);
  }

  function editEvent(box, ev, options) {
    var create = Boolean(options && options.create);
    box.textContent = '';
    bar(box, []);
    var start = new Date(ev.startsAt);
    var end = new Date(ev.endsAt);
    var form = el('form', 'cal-dialog-body');

    var title = input('text');
    title.required = true;
    title.maxLength = 200;
    title.value = ev.title;
    var allDay = input('checkbox', 'form-check-input');
    allDay.checked = ev.allDay;

    var startDt = input('datetime-local');
    var endDt = input('datetime-local');
    var startDate = input('date');
    var endDate = input('date');
    if (ev.allDay) {
      startDate.value = utcKey(start);
      endDate.value = utcKey(new Date(end.getTime() - DAY_MS)); // inclusive end
      startDt.value = startDate.value + 'T09:00';
      endDt.value = startDate.value + 'T10:00';
    } else {
      startDt.value = localStamp(start);
      endDt.value = localStamp(end);
      startDate.value = key(start);
      endDate.value = key(new Date(Math.max(start.getTime(), end.getTime() - 1)));
    }
    [startDt, endDt, startDate, endDate].forEach(function (node) {
      node.required = true;
    });
    var description = el('textarea', 'form-control form-control-sm');
    description.rows = 4;
    description.maxLength = 5000;
    description.value = ev.description || '';

    var timed = el('div', 'cal-when-fields');
    timed.appendChild(field('Starts', startDt, 'cal-start-dt'));
    timed.appendChild(field('Ends', endDt, 'cal-end-dt'));
    var dated = el('div', 'cal-when-fields');
    dated.appendChild(field('First day', startDate, 'cal-start-d'));
    dated.appendChild(field('Last day', endDate, 'cal-end-d'));
    function showPair() {
      timed.hidden = allDay.checked;
      dated.hidden = !allDay.checked;
    }
    allDay.addEventListener('change', function () {
      if (allDay.checked) {
        startDate.value = startDt.value.slice(0, 10);
        endDate.value = endDt.value.slice(0, 10);
      } else {
        startDt.value = startDate.value + 'T09:00';
        endDt.value = endDate.value + 'T10:00';
      }
      showPair();
    });
    showPair();

    var heading = el(
      'h2',
      'h5 mb-2',
      create ? 'New event' : ev.imported ? 'Edit event in Google Calendar' : 'Edit event',
    );
    heading.id = 'cal-dialog-title';
    form.appendChild(heading);
    form.appendChild(field('Title', title, 'cal-title-input'));
    var check = el('div', 'form-check mb-2');
    allDay.id = 'cal-all-day';
    var checkLabel = el('label', 'form-check-label', 'All day');
    checkLabel.htmlFor = 'cal-all-day';
    check.appendChild(allDay);
    check.appendChild(checkLabel);
    form.appendChild(check);
    form.appendChild(timed);
    form.appendChild(dated);
    form.appendChild(field('Description', description, 'cal-description-input'));
    if (ev.recurring)
      form.appendChild(el('p', 'small text-muted', '↻ Repeats. Only this occurrence changes.'));

    var toGoogle = input('checkbox', 'form-check-input');
    toGoogle.id = 'cal-to-google';
    toGoogle.checked = Boolean(options && options.google);
    var save = el('button', 'btn btn-sm btn-primary');
    function saveLabel() {
      save.textContent =
        ev.imported || (create && toGoogle.checked) ? 'Save to Google Calendar' : 'Save';
    }
    if (create && canCreateInGoogle()) {
      var googleRow = el('div', 'form-check mb-3');
      var googleLabel = el('label', 'form-check-label', 'Also add to my Google Calendar');
      googleLabel.htmlFor = toGoogle.id;
      googleRow.appendChild(toGoogle);
      googleRow.appendChild(googleLabel);
      form.appendChild(googleRow);
      toGoogle.addEventListener('change', saveLabel);
    } else {
      toGoogle.checked = false;
    }
    saveLabel();

    var buttons = el('div', 'd-flex gap-2');
    save.type = 'submit';
    buttons.appendChild(save);
    buttons.appendChild(
      button('btn btn-sm btn-outline-primary', 'Cancel', function () {
        if (create) box.close();
        else openDetails({ kind: 'event', ev: ev });
      }),
    );
    form.appendChild(buttons);
    var error = el('div', 'text-danger small mt-2');
    error.setAttribute('role', 'alert');
    form.appendChild(error);

    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var startsAt;
      var endsAt;
      if (allDay.checked) {
        startsAt = new Date(startDate.value + 'T00:00:00Z');
        endsAt = new Date(new Date(endDate.value + 'T00:00:00Z').getTime() + DAY_MS); // google's end is exclusive
        if (!(endsAt > startsAt)) {
          error.textContent = 'The last day cannot be before the first day.';
          return;
        }
      } else {
        startsAt = new Date(startDt.value);
        endsAt = new Date(endDt.value);
        if (!(endsAt > startsAt)) {
          error.textContent = 'The event must end after it starts.';
          return;
        }
      }
      error.textContent = '';
      save.disabled = true;
      var path = create
        ? toGoogle.checked
          ? '/google-calendar/events'
          : '/events'
        : eventPath(ev);
      request(create ? 'POST' : 'PATCH', path, {
        title: title.value.trim(),
        description: description.value.trim() || null,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        allDay: allDay.checked,
      })
        .then(function () {
          box.close();
          load();
        })
        .catch(function (problem) {
          if (problem.status === 410) {
            box.close();
            load();
            return;
          }
          error.textContent = problem.message;
          save.disabled = false;
        });
    });
    box.appendChild(form);
    title.focus();
  }

  // controls

  function selectDay(cell) {
    selected = cell.getAttribute('data-day');
    var picked = fromKey(selected);
    if (picked.getMonth() !== month.getMonth()) {
      month = new Date(picked.getFullYear(), picked.getMonth(), 1);
      load();
    } else {
      render();
    }
  }
  gridEl.addEventListener('click', function (event) {
    var cell = event.target.closest('.cal-cell');
    if (cell) selectDay(cell);
  });
  gridEl.addEventListener('keydown', function (event) {
    if (
      event.target.classList &&
      event.target.classList.contains('cal-cell') &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault();
      selectDay(event.target);
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
