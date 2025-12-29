import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import LoginPage from './pages/Login_page'
import RegisterPage from './pages/Register_page'
import AuthCallback from './pages/AuthCallback'
import Home from './pages/Home'
import Forge from './pages/Forge'
import Athena from './pages/Athena'
import { RequireAuth } from '@/auth/RequireAuth'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/auth/callback" element={<AuthCallback />} />
        <Route
          path="/home/*"
          element={
            <RequireAuth>
              <Home />
            </RequireAuth>
          }
        />
        <Route
          path="/forge/:projectId"
          element={
            <RequireAuth>
              <Forge />
            </RequireAuth>
          }
        />
        <Route
          path="/athena/:projectId"
          element={
            <RequireAuth>
              <Athena />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
