import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Landing from './pages/Landing'
import LoginPage from './pages/Login_page'
import RegisterPage from './pages/Register_page'
import Home from './pages/Home'
import Forge from './pages/Forge'
import Athena from './pages/Athena'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/home/*" element={<Home />} />
        <Route path="/forge/:projectId" element={<Forge />} />
        <Route path="/athena/:projectId" element={<Athena />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
