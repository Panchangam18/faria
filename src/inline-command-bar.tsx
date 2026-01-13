import React from 'react';
import ReactDOM from 'react-dom/client';
import InlineCommandBar from './components/InlineCommandBar';
import './styles/theme.css';
import './styles/inline-command-bar.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <InlineCommandBar />
  </React.StrictMode>
);

