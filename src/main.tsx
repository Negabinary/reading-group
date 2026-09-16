import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './alt.css';

const alternative = /^\/alt\/?$/.test(window.location.pathname);
if (alternative) document.documentElement.classList.add('text-view');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App alternative={alternative} />
  </React.StrictMode>,
);
