import { createContext, useContext, useMemo } from 'react';
import { api } from '../../lib/api';
import { useResource } from '../../lib/hooks';
import type { Member } from '../../lib/types';

export type Person = Member['user'];

export const PeopleContext = createContext<ReadonlyMap<string, Person>>(new Map());

export const usePerson = (id: string | null | undefined) => {
  const people = useContext(PeopleContext);
  return id ? people.get(id) : undefined;
};

export function useMembers(workspaceId: string) {
  const { data } = useResource<Member[]>(
    () => api<Member[]>(`/workspaces/${workspaceId}/members`),
    workspaceId,
  );
  const members = useMemo(() => data ?? [], [data]);
  const people = useMemo(
    () => new Map(members.map((member) => [member.user.id, member.user])),
    [members],
  );
  return { members, people };
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

const TONES = ['pink', 'lavender', 'blue'] as const;

export function Avatar({
  person,
  size = 24,
}: {
  person: { name: string; avatarUrl: string | null } | undefined;
  size?: number;
}) {
  if (!person) {
    return (
      <span
        className="avatar avatar--empty"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        ?
      </span>
    );
  }
  if (person.avatarUrl) {
    return (
      <img
        className="avatar"
        src={person.avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
      />
    );
  }
  const tone = TONES[[...person.name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3];
  return (
    <span
      className={`avatar avatar--${tone}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}
