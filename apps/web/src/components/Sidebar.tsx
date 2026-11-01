import { useMemo, useState } from 'react';
import { NavLink, useMatch, useNavigate } from 'react-router-dom';
import { buildPageTree, useWorkspace, type PageNode } from '../lib/workspace';
import { PixelIcon, type IconName } from './PixelIcon';
import '../styles/shell.css';

export const NAV: { to: string; label: string; icon: IconName; end?: boolean }[] = [
  { to: '', label: 'Home', icon: 'home', end: true },
  { to: 'tasks', label: 'Tasks', icon: 'tasks' },
  { to: 'calendar', label: 'Calendar', icon: 'calendar' },
  { to: 'insights', label: 'Insights', icon: 'sparkle' },
  { to: 'settings', label: 'Settings', icon: 'gear' },
];

/** The ids of the pages above `pageId`, root first, so the sidebar can keep its branch open. */
function ancestorsOf(pageId: string | undefined, nodes: PageNode[]): string[] {
  if (!pageId) return [];
  const walk = (list: PageNode[]): string[] | null => {
    for (const node of list) {
      if (node.page.id === pageId) return [];
      const inner = walk(node.children);
      if (inner) return [node.page.id, ...inner];
    }
    return null;
  };
  return walk(nodes) ?? [];
}

export function Sidebar({ id, onNavigate }: { id: string; onNavigate: () => void }) {
  const { workspace, pages, pagesLoading, createPage } = useWorkspace();
  const navigate = useNavigate();
  const base = `/w/${workspace.id}`;
  const tree = useMemo(() => buildPageTree(pages), [pages]);
  const current = useMatch('/w/:workspaceId/pages/:pageId')?.params.pageId;
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const openTrail = useMemo(() => new Set(ancestorsOf(current, tree)), [current, tree]);

  const add = async (parentId?: string) => {
    setError(undefined);
    setCreating(true);
    try {
      const page = await createPage({ parentId });
      if (parentId) setCollapsed((set) => new Set([...set].filter((item) => item !== parentId)));
      navigate(`${base}/pages/${page.id}`);
      onNavigate();
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Could not create the page');
    } finally {
      setCreating(false);
    }
  };

  const toggle = (nodeId: string) =>
    setCollapsed((set) => {
      const next = new Set(set);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });

  const renderNode = (node: PageNode, depth: number) => {
    const open = !collapsed.has(node.page.id) || openTrail.has(node.page.id);
    const hasChildren = node.children.length > 0;
    return (
      <li key={node.page.id} className="tree__item">
        <div className="tree__row" style={{ paddingLeft: depth * 12 }}>
          {hasChildren ? (
            <button
              type="button"
              className="tree__toggle"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.page.title}`}
              onClick={() => toggle(node.page.id)}
            >
              {open ? '▾' : '▸'}
            </button>
          ) : (
            <span className="tree__toggle tree__toggle--empty" aria-hidden="true" />
          )}
          <NavLink to={`${base}/pages/${node.page.id}`} className="tree__link" onClick={onNavigate}>
            <span aria-hidden="true">{node.page.icon || '▫'}</span>
            <span className="tree__title">{node.page.title || 'Untitled'}</span>
          </NavLink>
          <button
            type="button"
            className="tree__add"
            aria-label={`Add a subpage to ${node.page.title}`}
            disabled={creating}
            onClick={() => void add(node.page.id)}
          >
            +
          </button>
        </div>
        {hasChildren && open && (
          <ul className="tree__list">
            {node.children.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <aside id={id} className="sidebar" aria-label="Workspace navigation">
      <div className="sidebar__scroll">
        <p className="sidebar__workspace" title={workspace.name}>
          <PixelIcon name="desktop" size={20} />
          <span>{workspace.name}</span>
        </p>
        <nav aria-label="Sections">
          <ul className="sidenav">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to ? `${base}/${item.to}` : base}
                  end={item.end}
                  className="sidenav__link"
                  onClick={onNavigate}
                >
                  <PixelIcon name={item.icon} size={18} />
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="sidebar__pages">
          <div className="sidebar__heading">
            <NavLink
              to={`${base}/pages`}
              end
              className="sidebar__heading-link"
              onClick={onNavigate}
            >
              Pages
            </NavLink>
          </div>
          <nav aria-label="Pages">
            {pagesLoading && pages.length === 0 ? (
              <p className="sidebar__note" role="status">
                Loading pages…
              </p>
            ) : tree.length === 0 ? (
              <p className="sidebar__note">No pages yet.</p>
            ) : (
              <ul className="tree__list tree__list--root">
                {tree.map((node) => renderNode(node, 0))}
              </ul>
            )}
          </nav>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="btn btn--blue sidebar__new"
            disabled={creating}
            onClick={() => void add()}
          >
            <PixelIcon name="plus" size={10} /> New page
          </button>
        </div>
      </div>
    </aside>
  );
}
