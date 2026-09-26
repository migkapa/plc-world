import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './app/App';

// @react-three/fiber 9 still creates a THREE.Clock per canvas, which three r186 reports as deprecated on every 3D
// mount. Drop exactly that one warning (until R3F moves to THREE.Timer) so real warnings stay visible. Done on
// console.warn rather than three's setConsoleFunction to keep three out of the entry chunk.
const CLOCK_DEPRECATION = 'THREE.Clock: This module has been deprecated';
const warn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith(CLOCK_DEPRECATION)) return;
  warn(...args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
