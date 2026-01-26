import ReactDOM from 'react-dom/client';
import CommandBar from './components/CommandBar';
import './styles/theme.css';
import './styles/command-bar.css';

// Skip StrictMode for command bar - performance is critical for instant open/close
ReactDOM.createRoot(document.getElementById('root')!).render(<CommandBar />);

