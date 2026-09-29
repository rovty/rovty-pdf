import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/archivo/400.css';
import '@fontsource/archivo/500.css';
import '@fontsource/archivo/600.css';
import '@fontsource/archivo/700.css';
import App from './App';
import './styles.css';
import { offlineEnabled, registerOffline } from './lib/offline';

if (offlineEnabled())
  void registerOffline().catch(() => {
    /* Existing tools remain usable when offline updates fail. */
  });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
