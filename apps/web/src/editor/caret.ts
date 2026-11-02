const MIRRORED = [
  'boxSizing',
  'width',
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'textTransform',
  'textIndent',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'tabSize',
] as const;

export interface CaretBox {
  top: number;
  left: number;
  height: number;
}

// textareas don't expose caret coords, so measure a hidden copy
export function measureCaret(el: HTMLTextAreaElement, offset: number): CaretBox {
  const mirror = document.createElement('div');
  const computed = getComputedStyle(el);
  for (const prop of MIRRORED) mirror.style[prop] = computed[prop];
  Object.assign(mirror.style, {
    position: 'absolute',
    visibility: 'hidden',
    top: '0',
    left: '-9999px',
    overflow: 'hidden',
    whiteSpace: el.wrap === 'off' ? 'pre' : 'pre-wrap',
    overflowWrap: 'break-word',
  });
  mirror.textContent = el.value.slice(0, offset);
  const marker = document.createElement('span');
  marker.textContent = el.value.slice(offset) || '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const box: CaretBox = {
    top: marker.offsetTop - el.scrollTop,
    left: marker.offsetLeft - el.scrollLeft,
    height: parseFloat(computed.lineHeight) || marker.offsetHeight,
  };
  mirror.remove();
  return box;
}

export function onFirstLine(el: HTMLTextAreaElement): boolean {
  if (el.selectionStart === 0) return true;
  if (el.value.lastIndexOf('\n', el.selectionStart - 1) >= 0) return false;
  return measureCaret(el, el.selectionStart).top === measureCaret(el, 0).top;
}

export function onLastLine(el: HTMLTextAreaElement): boolean {
  const end = el.value.length;
  if (el.selectionStart === end) return true;
  if (el.value.indexOf('\n', el.selectionStart) >= 0) return false;
  return measureCaret(el, el.selectionStart).top === measureCaret(el, end).top;
}
