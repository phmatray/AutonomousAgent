import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import './index.css';

async function bootstrap() {
  if (import.meta.env.VITE_E2E_WEBDRIVER === '1') {
    const { installWebDriverTauriMock } = await import('./test/e2e/webdriver-tauri-mock');
    installWebDriverTauriMock();
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

void bootstrap();
