import { filterCommands, slashQuery, SLASH_COMMANDS } from './slash';

describe('slashQuery', () => {
  it('opens for a lone slash and keeps the typed query', () => {
    expect(slashQuery('/')).toBe('');
    expect(slashQuery('/head')).toBe('head');
    expect(slashQuery('hello /')).toBeNull();
    expect(slashQuery('/two words')).toBeNull();
    expect(slashQuery('')).toBeNull();
  });
});

describe('filterCommands', () => {
  const types = (q: string) => filterCommands(q).map((c) => c.type);

  it('lists everything for an empty query', () => {
    expect(filterCommands('')).toHaveLength(SLASH_COMMANDS.length);
  });

  it('matches labels, prefixes first', () => {
    expect(types('head')).toEqual(['HEADING_1', 'HEADING_2', 'HEADING_3']);
    expect(types('to')[0]).toBe('TODO');
  });

  it('matches keywords and ignores case', () => {
    expect(types('H2')).toEqual(['HEADING_2']);
    expect(types('CHECKBOX')).toEqual(['TODO']);
    expect(types('hr')).toEqual(['DIVIDER']);
  });

  it('finds words inside labels and returns nothing for gibberish', () => {
    expect(types('list')).toEqual(['BULLETED_LIST', 'NUMBERED_LIST']);
    expect(types('zzzz')).toEqual([]);
  });
});
