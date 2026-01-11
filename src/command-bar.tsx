import React from 'react';
import ReactDOM from 'react-dom/client';
import CommandBar from './components/CommandBar';
import './styles/theme.css';
import './styles/command-bar.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CommandBar />
  </React.StrictMode>
);

