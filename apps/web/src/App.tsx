import { lazy, Suspense } from 'react';
import { Route, Routes, useParams } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { CenteredWindow, NotFound, WorkspaceGate } from './components/Gate';
import { LoadingState } from './components/ui';
import { WorkspaceProvider } from './lib/workspace';
import HomePage from './screens/HomePage';
import WorkspacePicker from './screens/WorkspacePicker';

const TasksPage = lazy(() => import('./screens/TasksPage'));
const CalendarPage = lazy(() => import('./screens/CalendarPage'));
const InsightsPage = lazy(() => import('./screens/InsightsPage'));
const SettingsPage = lazy(() => import('./screens/SettingsPage'));
const PagesIndex = lazy(() => import('./screens/PagesIndex'));
const EditorPage = lazy(() => import('./editor/EditorPage'));

function WorkspaceLayout() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  return (
    <WorkspaceProvider
      key={workspaceId}
      workspaceId={workspaceId}
      fallback={(state) => <WorkspaceGate {...state} />}
    >
      <AppShell />
    </WorkspaceProvider>
  );
}

function WorkspaceNotFound() {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  return <NotFound home={`/w/${workspaceId}`} />;
}

export function App() {
  return (
    <Suspense
      fallback={
        <CenteredWindow title="Nook">
          <LoadingState />
        </CenteredWindow>
      }
    >
      <Routes>
        <Route path="/" element={<WorkspacePicker />} />
        <Route path="/w/:workspaceId" element={<WorkspaceLayout />}>
          <Route index element={<HomePage />} />
          <Route path="tasks" element={<TasksPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="pages" element={<PagesIndex />} />
          <Route path="pages/:pageId" element={<EditorPage />} />
          <Route path="insights" element={<InsightsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<WorkspaceNotFound />} />
        </Route>
        <Route
          path="*"
          element={
            <CenteredWindow title="Page not found">
              <NotFound />
            </CenteredWindow>
          }
        />
      </Routes>
    </Suspense>
  );
}
