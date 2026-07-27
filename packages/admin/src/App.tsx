import type { ReactElement } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthProvider.js'
import { RequireAuth } from './auth/RequireAuth.js'
import { AdminLayout } from './layout/AdminLayout.js'
import { ConversationsPage } from './pages/ConversationsPage.js'
import { DashboardPage } from './pages/DashboardPage.js'
import { FeedsPage } from './pages/FeedsPage.js'
import { KnowledgePage } from './pages/KnowledgePage.js'
import { LeadsPage } from './pages/LeadsPage.js'
import { LoginPage } from './pages/LoginPage.js'
import { NotFoundPage } from './pages/NotFoundPage.js'
import { ProjectPage } from './pages/ProjectPage.js'
import { ProjectsPage } from './pages/ProjectsPage.js'
import { SettingsPage } from './pages/SettingsPage.js'

/**
 * Маршруты админки.
 *
 * `basename="/admin"` — SPA живёт на этом префиксе, сервер отдаёт index.html
 * на любой адрес внутри него (см. plugins/static-assets.ts на сервере).
 *
 * Всё, кроме `/login`, закрыто `RequireAuth`. Новый раздел добавляется
 * одной строкой `<Route>` внутри layout плюс строкой в `navigation.ts`.
 */

export function App(): ReactElement {
  return (
    <BrowserRouter basename="/admin">
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AdminLayout />}>
              <Route index element={<DashboardPage />} />
              <Route path="projects" element={<ProjectsPage />} />
              <Route path="projects/:id" element={<ProjectPage />} />
              <Route path="feeds" element={<FeedsPage />} />
              <Route path="knowledge" element={<KnowledgePage />} />
              <Route path="conversations" element={<ConversationsPage />} />
              <Route path="leads" element={<LeadsPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
