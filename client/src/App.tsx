import type { JSX } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { RequireAuth, RequireRole } from './components/layout/ProtectedRoute';
import { AuthProvider } from './context/AuthContext';
import { AdminPage } from './pages/AdminPage';
import { CompanyAdminPage } from './pages/CompanyAdminPage';
import { CreateWorkspacePage } from './pages/CreateWorkspacePage';
import { DashboardPage } from './pages/DashboardPage';
import { DocumentDetailPage } from './pages/DocumentDetailPage';
import { DocumentsPage } from './pages/DocumentsPage';
import { HistoryPage } from './pages/HistoryPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PlatformAdminLoginPage } from './pages/PlatformAdminLoginPage';
import { ProfilePage } from './pages/ProfilePage';
import { RegisterPage } from './pages/RegisterPage';
import { UploadPage } from './pages/UploadPage';
import { WorkspaceMembersPage } from './pages/WorkspaceMembersPage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';

export function App(): JSX.Element {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/platform-admin/login" element={<PlatformAdminLoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/accept-invite" element={<RegisterPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<DashboardPage />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="documents/:id" element={<DocumentDetailPage />} />
              <Route path="workspace/create" element={<CreateWorkspacePage />} />
              <Route element={<RequireRole roles={['owner', 'admin', 'editor']} />}>
                <Route path="documents/new" element={<UploadPage />} />
              </Route>
              <Route element={<RequireRole roles={['platform_admin', 'owner', 'admin']} />}>
                <Route path="history" element={<HistoryPage />} />
              </Route>
              <Route element={<RequireRole roles={['owner', 'admin']} />}>
                <Route path="company-admin" element={<CompanyAdminPage />} />
                <Route path="workspace/members" element={<WorkspaceMembersPage />} />
              </Route>
              <Route element={<RequireRole roles={['owner']} />}>
                <Route path="workspace/settings" element={<WorkspaceSettingsPage />} />
              </Route>
              <Route element={<RequireRole roles={['platform_admin']} />}>
                <Route path="admin" element={<AdminPage />} />
                <Route path="platform-admin" element={<AdminPage />} />
              </Route>
              <Route path="profile" element={<ProfilePage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
