import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Self-hosted, so nothing is fetched from a font CDN — this app will sit
// behind corporate network policy. IBM Plex Mono for data, Source Serif 4 for
// the text face; the optical-size axis keeps the serif solid at 13px on dark.
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource-variable/source-serif-4/opsz.css';

import { App } from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
