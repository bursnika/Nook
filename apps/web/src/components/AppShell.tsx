import { Suspense, useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useIsNarrow, useNow } from '../lib/hooks';
import { useWorkspace } from '../lib/workspace';
import { PixelIcon, type IconName } from './PixelIcon';
import { Sidebar } from './Sidebar';
import { StartMenu } from './StartMenu';
import { LoadingState, Window } from './ui';
import '../styles/shell.css';
import { LOCALE } from '../lib/locale';

interface Section {
  title: string;
  icon: IconName;
}

function sectionOf(
  rest: string[],
  pageTitle: (id: string) => string | undefined,
): Section | undefined {
  switch (rest[0]) {
    case undefined:
      return { title: 'Desktop', icon: 'desktop' };
    case 'tasks':
      return { title: 'Tasks.exe', icon: 'tasks' };
    case 'calendar':
      return { title: 'Calendar', icon: 'calendar' };
    case 'insights':
      return { title: 'Insights', icon: 'sparkle' };
    case 'assistant':
      return { title: 'Assistant', icon: 'chat' };
    case 'settings':
      return { title: 'Settings', icon: 'gear' };
    case 'pages':
      return rest[1]
        ? { title: pageTitle(rest[1]) ?? 'Page', icon: 'page' }
        : { title: 'Pages', icon: 'folder' };
    default:
      return undefined;
  }
}

/** The retro desktop around a workspace: sidebar, one big window for the current screen, taskbar. */
export function AppShell() {
  const { workspace, pages } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const narrow = useIsNarrow();
  const now = useNow();
  const [drawer, setDrawer] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarId = useId();
  const firstRender = useRef(true);

  const base = `/w/${workspace.id}`;
  const rest = location.pathname.slice(base.length).split('/').filter(Boolean);
  const section = sectionOf(rest, (id) => {
    const page = pages.find((item) => item.id === id);
    return page ? page.title || 'Untitled' : undefined;
  });
  const atHome = rest.length === 0;

  // each navigation closes the drawer, restores a minimised window and moves focus to the new screen
  useEffect(() => {
    setDrawer(false);
    setMinimized(false);
    if (firstRender.current) firstRender.current = false;
    else mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  const showSidebar = narrow ? drawer : !maximized;
  const title = section?.title ?? 'Not found';
  const clock = now.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className={`shell__desk ${showSidebar ? '' : 'shell__desk--wide'}`}>
        {(showSidebar || narrow) && (
          <>
            <div
              className={`shell__sidebar ${narrow ? 'shell__sidebar--drawer' : ''} ${drawer ? 'is-open' : ''}`}
              inert={narrow && !drawer}
            >
              <Sidebar id={sidebarId} onNavigate={() => setDrawer(false)} />
            </div>
            {narrow && drawer && (
              <button
                type="button"
                className="shell__scrim"
                aria-label="Close the page list"
                onClick={() => setDrawer(false)}
              />
            )}
          </>
        )}
        <main id="main" className="shell__main" ref={mainRef} tabIndex={-1}>
          {minimized && (
            <p className="shell__minimized">
              The window is minimised. Use the button in the taskbar to bring it back.
            </p>
          )}
          <div hidden={minimized} className="shell__window-wrap">
            <Window
              title={title}
              icon={section?.icon ?? 'warning'}
              className="shell__window"
              level={1}
              controls={
                <>
                  <button
                    type="button"
                    className="btn btn--icon titlebar__wide"
                    aria-label="Minimise window"
                    onClick={() => setMinimized(true)}
                  >
                    _
                  </button>
                  <button
                    type="button"
                    className="btn btn--icon titlebar__wide"
                    aria-label={maximized ? 'Restore the sidebar' : 'Maximise window'}
                    aria-pressed={maximized}
                    onClick={() => setMaximized((value) => !value)}
                  >
                    □
                  </button>
                  {!atHome && (
                    <button
                      type="button"
                      className="btn btn--icon"
                      aria-label="Close window and return to the desktop"
                      onClick={() => navigate(base)}
                    >
                      ×
                    </button>
                  )}
                </>
              }
            >
              <div className="window__content shell__content">
                <Suspense fallback={<LoadingState />}>
                  <Outlet />
                </Suspense>
              </div>
              <div className="window__status">
                <span>{workspace.name}</span>
                <span>{workspace.plan} plan</span>
              </div>
            </Window>
          </div>
        </main>
      </div>
      <footer className="taskbar">
        <StartMenu />
        <div className="taskbar__tasks">
          <button
            type="button"
            className="btn taskbar__task"
            aria-pressed={!minimized}
            onClick={() => setMinimized((value) => !value)}
          >
            {title}
          </button>
        </div>
        <nav className="taskbar__quick" aria-label="Quick navigation">
          <QuickLink to={base} end icon="home" label="Home" />
          <QuickLink to={`${base}/tasks`} icon="tasks" label="Tasks" />
          <QuickLink to={`${base}/calendar`} icon="calendar" label="Calendar" />
          <button
            type="button"
            className="quick"
            aria-expanded={drawer}
            aria-controls={sidebarId}
            onClick={() => setDrawer((value) => !value)}
          >
            <PixelIcon name="folder" size={22} />
            <span>Pages</span>
          </button>
        </nav>
        <Link to="/?pick=1" className="taskbar__space" title="Switch workspace">
          {workspace.name}
        </Link>
        <time className="tray" dateTime={now.toISOString()}>
          {clock}
        </time>
      </footer>
    </div>
  );
}

function QuickLink({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: IconName;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className="quick">
      <PixelIcon name={icon} size={22} />
      <span>{label}</span>
    </NavLink>
  );
}
