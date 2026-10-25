import { render } from '@testing-library/react';
import { RichText } from './RichText';

const html = (text: string) => render(<RichText text={text} />).container.innerHTML;

describe('RichText', () => {
  it('renders paragraphs, bold and code', () => {
    expect(html('Hello **there** and `code`.\n\nSecond')).toBe(
      '<div class="rt"><p>Hello <strong>there</strong> and <code>code</code>.</p><p>Second</p></div>',
    );
  });

  it('renders bullet and numbered lists', () => {
    expect(html('- one\n- **two**\n\n3. three\n4. four')).toBe(
      '<div class="rt"><ul><li>one</li><li><strong>two</strong></li></ul><ol start="3"><li>three</li><li>four</li></ol></div>',
    );
  });

  it('keeps single line breaks and shows headings as bold lines', () => {
    expect(html('## Plan\nline 1\nline 2')).toBe(
      '<div class="rt"><p class="rt__heading"><strong>Plan</strong></p><p>line 1<br>line 2</p></div>',
    );
  });

  it('renders fenced code, also when the fence is still open', () => {
    expect(html('```\na < b\n```\nafter')).toContain('<pre><code>a &lt; b</code></pre>');
    expect(html('```\nunfinished')).toContain('<pre><code>unfinished</code></pre>');
  });

  it('leaves unfinished markers as plain text while streaming', () => {
    expect(html('half **bold')).toBe('<div class="rt"><p>half **bold</p></div>');
  });

  it('never turns text into HTML or links', () => {
    const out = html(
      '<img src=x onerror=alert(1)> <script>alert(1)</script> [a](javascript:alert(1)) **<b>x</b>**',
    );
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).not.toContain('<a ');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });
});
