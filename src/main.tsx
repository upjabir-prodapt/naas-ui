import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// The platform stylesheet first: every app on the host imports it once, at its
// root, before any CSS of its own.
import '@aicoe/aihub-platform/styles.css';
// Importing the module initialises the shared i18n instance (platform strings,
// language detection) before anything renders.
import { addUseCaseResources } from '@aicoe/aihub-platform/i18n';
import { setQuotaServices } from '@aicoe/aihub-platform/api';
import { ErrorBoundary } from '@aicoe/aihub-platform/ui';
import App from './app/App';
import { appConfig } from './app/config';

// This app's own translations, merged into the shared bundle.
addUseCaseResources(appConfig.i18n);

// Platform knows no slugs: tell the API client which `/api/<slug>/` responses
// carry quota headers. Before the first render, so it is in place before the
// first request goes out.
setQuotaServices([appConfig.slug]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
