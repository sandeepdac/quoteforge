import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import ErrorBoundary from './components/common/ErrorBoundary';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';
import { QuoteProvider } from './context/QuoteContext';
import { JobProvider } from './context/JobContext';

// Pages (to be created)
import DashboardPage from './pages/DashboardPage';
import QuotesListPage from './pages/QuotesListPage';
import NewQuotePage from './pages/NewQuotePage';
import QuoteDetailPage from './pages/QuoteDetailPage';
import PartsPage from './pages/PartsPage';
import PartDetailPage from './pages/PartDetailPage';
import MaterialsPage from './pages/MaterialsPage';
import CustomersPage from './pages/CustomersPage';
import CustomerDetailPage from './pages/CustomerDetailPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SettingsPage from './pages/SettingsPage';
import JobsListPage from './pages/JobsListPage';
import JobDetailPage from './pages/JobDetailPage';
import InvoicesListPage from './pages/InvoicesListPage';
import InvoiceDetailPage from './pages/InvoiceDetailPage';

export default function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <QuoteProvider>
         <JobProvider>
          <ErrorBoundary>
            <BrowserRouter>
              <Routes>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/quotes" element={<QuotesListPage />} />
                  <Route path="/quotes/new" element={<NewQuotePage />} />
                  <Route path="/quotes/:id" element={<QuoteDetailPage />} />
                  <Route path="/jobs" element={<JobsListPage />} />
                  <Route path="/jobs/:id" element={<JobDetailPage />} />
                  <Route path="/invoices" element={<InvoicesListPage />} />
                  <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
                  <Route path="/parts" element={<PartsPage />} />
                  <Route path="/parts/:id" element={<PartDetailPage />} />
                  <Route path="/materials" element={<MaterialsPage />} />
                  <Route path="/customers" element={<CustomersPage />} />
                  <Route path="/customers/:id" element={<CustomerDetailPage />} />
                  <Route path="/analytics" element={<AnalyticsPage />} />
                  <Route path="/settings" element={<SettingsPage />} />

                  {/* Fallback */}
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </ErrorBoundary>
         </JobProvider>
        </QuoteProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
