import { NavLink, Route, Routes } from "react-router-dom";
import { ClassDetailPage } from "./pages/ClassDetailPage";
import { ClassesPage } from "./pages/ClassesPage";
import { EditorPage } from "./pages/EditorPage";
import { LogsPage } from "./pages/LogsPage";
import { OverviewPage } from "./pages/OverviewPage";
import { QueuePage } from "./pages/QueuePage";
import { SettingsPage } from "./pages/SettingsPage";
import { TasksPage } from "./pages/TasksPage";

function Shell(props: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-title">SyllabusOps</div>
          <div className="brand-subtitle">school control plane</div>
        </div>
        <nav className="nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Overview
          </NavLink>
          <NavLink
            to="/classes"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Classes
          </NavLink>
          <NavLink
            to="/tasks"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Tasks
          </NavLink>
          <NavLink
            to="/queue"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Queue
          </NavLink>
          <NavLink
            to="/editor"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Editor
          </NavLink>
          <NavLink
            to="/logs"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Logs
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              isActive ? "nav-link active" : "nav-link"
            }
          >
            Settings
          </NavLink>
        </nav>
        <div className="sidebar-footer">
          <div className="muted">Mocha • Lavender</div>
        </div>
      </aside>
      <main className="content">{props.children}</main>
    </div>
  );
}

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<OverviewPage />} />
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/classes/:courseSlug" element={<ClassDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="/logs" element={<LogsPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </Shell>
  );
}
