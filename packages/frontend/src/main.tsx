import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Toast } from '@heroui/react';
import { App } from './App';
import { createQueryClient } from './api/queries/core';
import { TOAST_PLACEMENT, TOAST_WIDTH } from './components/toast';
import './index.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const queryClient = createQueryClient();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toast.Provider placement={TOAST_PLACEMENT} width={TOAST_WIDTH} />
    </QueryClientProvider>
  </StrictMode>,
);
