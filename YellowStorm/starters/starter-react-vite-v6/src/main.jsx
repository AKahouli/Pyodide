import { StrictMode, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './AppRouter';
import './index.css';

const container = document.getElementById('root');

createRoot(container).render(createElement(StrictMode, null, createElement(AppRouter)));
