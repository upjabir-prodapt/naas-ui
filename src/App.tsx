import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PlatformProviders } from '@aicoe/aihub-platform/shell';
import { UseCasesContext } from '@aicoe/aihub-platform/usecases';
import { AppRoutes } from './AppRoutes';
import { useCase } from './useCase';

/**
 * The registry the platform's entitlement check and access-denied page read
 * through their port: in a use-case app, just this one vertical. Module scope
 * so the context value is stable across renders.
 */
const USE_CASES = [useCase];

/**
 * The vertical's own long-lived provider, declared on its manifest.
 *
 * **This is load-bearing**, as in the hub's providers.tsx: it mounts *above*
 * the router outlet, so a running job keeps polling when the user moves
 * between the app's pages (e.g. `/translation` and `/translation/tracker`).
 * Moved inside a route element, navigating away would unmount it and silently
 * kill in-flight jobs.
 */
const UseCaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const Provider = useCase.Provider;
  return Provider ? <Provider>{children}</Provider> : <>{children}</>;
};

/**
 * Provider order matches the hub's: the router outermost so the auth provider
 * and route guards can navigate, the registry and platform providers next, and
 * the vertical's provider inside them because it reads the session.
 */
const App: React.FC = () => (
  <BrowserRouter>
    <UseCasesContext.Provider value={USE_CASES}>
      <PlatformProviders>
        <UseCaseProvider>
          <AppRoutes useCase={useCase} />
        </UseCaseProvider>
      </PlatformProviders>
    </UseCasesContext.Provider>
  </BrowserRouter>
);

export default App;
