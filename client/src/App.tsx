import { useEffect, useState } from 'react';
import Landing from './pages/Landing';
import Room from './pages/Room';
import { PlayersProvider, ToastProvider } from './store';

export default function App() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const h = () => setPath(location.pathname);
    window.addEventListener('popstate', h);
    return () => window.removeEventListener('popstate', h);
  }, []);
  const m = path.match(/^\/room\/([A-Za-z0-9]{4,8})/);
  return (
    <ToastProvider>
      <PlayersProvider>{m ? <Room key={m[1].toUpperCase()} code={m[1].toUpperCase()} /> : <Landing />}</PlayersProvider>
    </ToastProvider>
  );
}
