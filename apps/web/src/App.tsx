import { Route, Routes } from 'react-router-dom';

/** Routes are filled in as screens are built. */
export function App() {
  return (
    <Routes>
      <Route path="*" element={<p className="boot">Nook is starting…</p>} />
    </Routes>
  );
}
