// nook today widget for scriptable (ios)
const BASE = 'https://YOUR-DOMAIN';
const TOKEN = 'nkw_...'; // settings -> widgets -> create token

const PINK = new Color('#b8326f');
const INK = new Color('#2b1e33');
const LAV = new Color('#eee6f8');

async function load() {
  const request = new Request(`${BASE}/api/widget/today`);
  request.headers = { Authorization: `Bearer ${TOKEN}` };
  return request.loadJSON();
}

function time(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const widget = new ListWidget();
widget.backgroundColor = LAV;
widget.setPadding(12, 12, 12, 12);
widget.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

try {
  const today = await load();
  const title = widget.addText('♡ Nook · today');
  title.font = Font.boldSystemFont(13);
  title.textColor = PINK;
  widget.addSpacer(6);

  const rows = [
    ...today.events.map((e) => `${e.allDay ? 'all day' : time(e.startsAt)}  ${e.title}`),
    ...today.tasks.map(
      (t) => `${t.priority === 'HIGH' ? '❗' : '•'} ${t.title}${t.overdue ? ' (late)' : ''}`,
    ),
  ];
  if (rows.length === 0) rows.push('Nothing planned ♡');
  const limit = config.widgetFamily === 'small' ? 4 : config.widgetFamily === 'medium' ? 5 : 12;
  for (const row of rows.slice(0, limit)) {
    const line = widget.addText(row);
    line.font = Font.systemFont(12);
    line.textColor = INK;
    line.lineLimit = 1;
  }
  if (rows.length > limit) {
    const more = widget.addText(`+${rows.length - limit} more`);
    more.font = Font.systemFont(11);
    more.textColor = Color.gray();
  }
} catch (error) {
  const text = widget.addText('Nook: cannot load the plan');
  text.textColor = PINK;
  const detail = widget.addText(String(error));
  detail.font = Font.systemFont(9);
}

if (config.runsInApp) await widget.presentMedium();
Script.setWidget(widget);
Script.complete();
