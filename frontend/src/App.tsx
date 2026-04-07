import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { Search } from './pages/Search';
import { PRDetail } from './pages/PRDetail';
import { ReviewDetail } from './pages/ReviewDetail';
import { Settings } from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/search" element={<Search />} />
        <Route path="/pr/:repo/:prNumber" element={<PRDetail />} />
        <Route path="/review/:id" element={<ReviewDetail />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
