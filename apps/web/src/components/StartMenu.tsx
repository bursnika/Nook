import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { signOut } from '../lib/session';
import { useWorkspace } from '../lib/workspace';
import { NAV } from './Sidebar';
import { PixelIcon } from './PixelIcon';

export function StartMenu() {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const base = `/w/${workspace.id}`;

  const items = () =>
    Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);

  useEffect(() => {
    if (open) items()[0]?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const go = (to: number) => {
      event.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'ArrowDown') go(index + 1);
    else if (event.key === 'ArrowUp') go(index < 0 ? -1 : index - 1);
    else if (event.key === 'Home') go(0);
    else if (event.key === 'End') go(-1);
    else if (event.key === 'Tab') setOpen(false);
  };

  return (
    <div className="start" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        className="btn start__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <PixelIcon name="heart" size={16} />
        Start
      </button>
      {open && (
        <div className="start__menu" id={menuId} role="menu" aria-label="Start menu">
          <div className="start__rail" aria-hidden="true">
            <span>Nook</span>
          </div>
          <ul role="none">
            {NAV.map((item) => (
              <li role="none" key={item.to}>
                <Link
                  role="menuitem"
                  to={item.to ? `${base}/${item.to}` : base}
                  tabIndex={-1}
                  onClick={() => close(false)}
                >
                  <PixelIcon name={item.icon} size={16} />
                  {item.label}
                </Link>
              </li>
            ))}
            <li role="none">
              <Link role="menuitem" to={`${base}/pages`} tabIndex={-1} onClick={() => close(false)}>
                <PixelIcon name="folder" size={16} />
                Pages
              </Link>
            </li>
            <li role="separator" className="start__sep" />
            <li role="none">
              <Link role="menuitem" to="/?pick=1" tabIndex={-1} onClick={() => close(false)}>
                <PixelIcon name="desktop" size={16} />
                Switch workspace
              </Link>
            </li>
            <li role="none">
              <a role="menuitem" href="/admin" tabIndex={-1}>
                <PixelIcon name="page" size={16} />
                Classic admin
              </a>
            </li>
            <li role="none">
              <button role="menuitem" type="button" tabIndex={-1} onClick={() => void signOut()}>
                <PixelIcon name="logout" size={16} />
                Sign out
              </button>
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
