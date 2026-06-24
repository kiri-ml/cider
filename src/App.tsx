import { Navigate, Route, Routes } from "react-router-dom";
import { Guard } from "./components/Guard";
import { ExportPage } from "./pages/ExportPage";
import { HomePage } from "./pages/HomePage";
import { IssuesPage } from "./pages/IssuesPage";
import { CleanupPage } from "./pages/CleanupPage";
import { ResultsPage } from "./pages/ResultsPage";
import { ImportPage } from "./pages/ImportPage";

export function App() {
  return <Routes>
    <Route path="/" element={<HomePage />} />
    <Route path="/import" element={<Guard stage="import"><ImportPage /></Guard>} />
    <Route path="/issues" element={<Guard stage="issues"><IssuesPage /></Guard>} />
    <Route path="/cleanup" element={<Guard stage="cleanup"><CleanupPage /></Guard>} />
    <Route path="/results" element={<Guard stage="results"><ResultsPage /></Guard>} />
    <Route path="/export" element={<Guard stage="export"><ExportPage /></Guard>} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
