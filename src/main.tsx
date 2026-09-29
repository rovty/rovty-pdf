import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './fonts.css';
import './styles.css';
import { offlineEnabled, registerOffline } from './lib/offline';

if (offlineEnabled())
  void registerOffline().catch(() => {
    /* Existing tools remain usable when offline updates fail. */
  });

const root = document.getElementById('root')!;
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
// An offline navigation can receive the cached home shell for another route.
// Hydrate only matching HTML; otherwise render the requested route normally.
const path = location.pathname.replace(/\/+$/, '') || '/';
if (root.hasChildNodes() && root.dataset.route === path) ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
