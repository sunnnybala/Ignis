# Ignis Frontend

React SPA for the Ignis AI-powered research platform.

## Tech Stack

- **Framework**: React 19 + TypeScript
- **Build**: Vite 7
- **Routing**: React Router DOM 7
- **UI Components**: Shadcn/ui + Radix UI
- **Styling**: Tailwind CSS 4
- **State**: Zustand + TanStack React Query
- **Editor**: Monaco Editor
- **PDF**: react-pdf + pdfjs-dist
- **Auth**: Supabase

## Getting Started

### Prerequisites

- Node.js 18+
- Backend server running (localhost:4000)

### Installation

```bash
npm install
```

### Environment Variables

Create a `.env` file:

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbG...
```

### Development

```bash
npm run dev      # Start Vite dev server (localhost:5173)
```

### Production

```bash
npm run build    # TypeScript check + Vite build
npm run preview  # Preview production build locally
```

## Project Structure

```
src/
├── main.tsx              # Vite entry point
├── App.tsx               # Router setup
├── pages/
│   ├── Landing.tsx       # Public homepage
│   ├── Login_page.tsx    # Login
│   ├── Register_page.tsx # Registration
│   ├── Home.tsx          # Dashboard layout
│   ├── HomeProjects.tsx  # Project list
│   ├── Forge.tsx         # Experiment workspace
│   └── Athena.tsx        # Paper writing UI
├── components/
│   ├── ChatPanel.tsx     # AI agent chat (SSE)
│   ├── ForgeMain.tsx     # Experiment editor + results
│   ├── ForgeSidebar.tsx  # File tree navigation
│   ├── landing/          # Landing page components
│   └── ui/               # Shadcn/Radix components
├── lib/
│   ├── api.ts            # API client with auth
│   ├── chat.ts           # Chat state management
│   └── supabaseClient.ts # Supabase client
├── auth/
│   ├── AuthProvider.tsx  # Auth context
│   └── RequireAuth.tsx   # Protected route wrapper
├── hooks/                # Custom React hooks
└── assets/               # Static assets
```

## Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/` | Landing | Public homepage |
| `/login` | Login_page | Login form |
| `/register` | Register_page | Registration form |
| `/auth/callback` | AuthCallback | OAuth callback |
| `/home` | Home | Dashboard (protected) |
| `/home/projects` | HomeProjects | Project list |
| `/forge/:projectId` | Forge | Experiment workspace |
| `/athena/:projectId` | Athena | Paper writing |

## Key Features

### Agent Chat (SSE Streaming)
Real-time chat with AI agents via Server-Sent Events. See `components/ChatPanel.tsx`.

### Monaco Editor
Code editing for Python experiments and LaTeX papers with syntax highlighting.

### File Tree Navigation
Hierarchical file browser with lazy loading. See `components/ForgeSidebar.tsx`.

### PDF Viewer
Embedded PDF preview for compiled papers. See `pages/Athena.tsx`.

### Resizable Panels
Split-view layouts using `react-resizable-panels`.

## Scripts

```bash
npm run dev      # Development server with HMR
npm run build    # Production build (tsc + vite)
npm run lint     # Run ESLint
npm run preview  # Preview production build
```

## UI Components

Uses Shadcn/ui components built on Radix UI primitives:
- Button, Input, Badge, Card
- Dialog, Dropdown Menu, Tooltip
- Avatar, Separator, Scroll Area
- Sheet (mobile sidebar)

## Styling

Tailwind CSS 4 with:
- `clsx` + `tailwind-merge` for conditional classes
- `class-variance-authority` for component variants
- `tailwindcss-animate` for animations
