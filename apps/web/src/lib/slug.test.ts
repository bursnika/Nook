import { slugify, withSuffix } from './slug';

describe('slugify', () => {
  it('lower-cases and dashes', () => {
    expect(slugify('Demo Space')).toBe('demo-space');
    expect(slugify('  My  notes!! ')).toBe('my-notes');
  });

  it('strips accents and falls back for names with nothing usable', () => {
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('Привіт')).toBe('workspace');
  });

  it('always matches what the API accepts', () => {
    expect(slugify('A'.repeat(90))).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    expect(withSuffix('demo', 'ab12')).toBe('demo-ab12');
  });
});
