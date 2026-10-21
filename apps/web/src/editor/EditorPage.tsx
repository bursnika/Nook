import { useParams } from 'react-router-dom';

/** The block editor of one page. Replaced by the real editor (see src/editor and src/sync). */
export default function EditorPage() {
  const { pageId } = useParams<{ workspaceId: string; pageId: string }>();
  return <p className="boot">Editor for page {pageId} is coming.</p>;
}
