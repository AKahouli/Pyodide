import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { initI18n } from './modules/localization';

// Initialize i18n before rendering the app
await initI18n().catch((error) => console.error('Failed to initialize i18n:', error));

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
