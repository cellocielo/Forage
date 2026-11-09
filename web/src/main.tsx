import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/entrypoints/popup/style.css';
import './web.css';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// Makes the app installable and lets it open offline.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
