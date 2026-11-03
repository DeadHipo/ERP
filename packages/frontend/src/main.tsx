import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Toast } from '@heroui/react';
import { App } from './App';
import { createQueryClient } from './api/queries/core';
import './index.css';

ModuleRegistry.registerModules([AllCommunityModule]);

const queryClient = createQueryClient();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
      <Toast.Provider />
    </QueryClientProvider>
  </StrictMode>,
);
