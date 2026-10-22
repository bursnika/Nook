// Nook "Today" widget for macOS, made for Übersicht (https://tracesof.net/uebersicht/).
// Copy this folder to ~/Library/Application Support/Übersicht/widgets/ and set BASE and TOKEN.
const BASE = 'https://YOUR-DOMAIN';
const TOKEN = 'nkw_...';

export const refreshFrequency = 5 * 60 * 1000;

export const command = `curl -s -H "Authorization: Bearer ${TOKEN}" ${BASE}/api/widget/today`;

export const className = `
  top: 24px;
  right: 24px;
  width: 280px;
  padding: 12px 14px;
  background: #eee6f8;
  color: #2b1e33;
  border: 2px solid #2b1e33;
  box-shadow: 4px 4px 0 rgba(101, 67, 144, 0.4);
  font-family: 'Pixelify Sans', 'Nunito', -apple-system, sans-serif;
  font-size: 13px;
  h1 { margin: 0 0 8px; font-size: 15px; color: #b8326f; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { margin: 3px 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .late { color: #a3262a; }
  .muted { color: #6f6979; }
`;

const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const render = ({ output }) => {
  let today;
  try {
    today = JSON.parse(output);
  } catch {
    return <div>Nook: no data</div>;
  }
  const empty = !today.events?.length && !today.tasks?.length;
  return (
    <div>
      <h1>♡ Nook · today</h1>
      {empty && <div className="muted">Nothing planned ♡</div>}
      <ul>
        {today.events?.map((e, i) => (
          <li key={`e${i}`}>
            {e.allDay ? 'all day' : time(e.startsAt)} {e.title}
          </li>
        ))}
        {today.tasks?.map((t, i) => (
          <li key={`t${i}`} className={t.overdue ? 'late' : ''}>
            {t.priority === 'HIGH' ? '❗ ' : '• '}
            {t.title}
          </li>
        ))}
      </ul>
    </div>
  );
};
