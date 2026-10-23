import { colorFor, initials } from '../sync/colors';
import type { RemotePresence } from '../sync/syncClient';

/** Avatars of everybody else on this page (one per person, even with several tabs open). */
export function Participants({ presence }: { presence: readonly RemotePresence[] }) {
  const people = new Map<string, RemotePresence>();
  for (const p of presence) if (!people.has(p.userId)) people.set(p.userId, p);
  const list = [...people.values()];
  return (
    <div className="people" aria-label="People on this page">
      {list.length === 0 ? (
        <span className="people__alone">Only you</span>
      ) : (
        <ul className="people__list">
          {list.map((p) => (
            <li
              key={p.userId}
              className="avatar pixel-border"
              style={{ background: colorFor(p.userId) }}
              title={p.name}
              aria-label={`${p.name} is here`}
            >
              {initials(p.name)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
