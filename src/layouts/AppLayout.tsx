import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
import TopBar from '../components/layout/TopBar';

export default function AppLayout() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#fafaf9] font-sans text-[#0a0a0a]">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 h-screen">
        <TopBar />
        <main className="flex-1 overflow-auto p-8 h-[calc(100vh-64px)]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
