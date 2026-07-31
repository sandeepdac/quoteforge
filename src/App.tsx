import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import { ThemeProvider } from './context/ThemeContext';
import { SettingsProvider } from './context/SettingsContext';
import { QuoteProvider } from './context/QuoteContext';

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
import FixtureEstimatorPage from './pages/FixtureEstimatorPage';

export default function App() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <QuoteProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/quotes" element={<QuotesListPage />} />
                <Route path="/quotes/new" element={<NewQuotePage />} />
                <Route path="/quotes/:id" element={<QuoteDetailPage />} />
                <Route path="/parts" element={<PartsPage />} />
                <Route path="/parts/:id" element={<PartDetailPage />} />
                <Route path="/materials" element={<MaterialsPage />} />
                <Route path="/customers" element={<CustomersPage />} />
                <Route path="/customers/:id" element={<CustomerDetailPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/fixtures" element={<FixtureEstimatorPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                
                {/* Fallback */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QuoteProvider>
      </SettingsProvider>
    </ThemeProvider>
  );
}
