import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PlatformProviders } from '@aicoe/aihub-platform/shell';
import { UseCasesContext } from '@aicoe/aihub-platform/usecases';
import { AppRoutes } from './routes';
import { appConfig } from './config';

/**
 * What the platform's entitlement check and access-denied page read through
 * their port: just this app. Module scope so the context value is stable
 * across renders.
 */
const USE_CASES = [appConfig];

/**
 * Provider order matches the hub's: the router outermost so the auth provider
 * and route guards can navigate, then this app's descriptor and the platform
 * providers.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <UseCasesContext.Provider value={USE_CASES}>
      <PlatformProviders>
        <AppRoutes />
      </PlatformProviders>
    </UseCasesContext.Provider>
  </BrowserRouter>
);

export default App;
