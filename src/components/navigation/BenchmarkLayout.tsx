"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";

interface BenchmarkLayoutProps {
  children: React.ReactNode;
  title: string;
}

export const BenchmarkLayout = ({ children, title }: BenchmarkLayoutProps) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <main className="flex-1 overflow-auto">
        {/* Mobile header with hamburger */}
        <div className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-gray-50 px-4 md:hidden dark:border-gray-700 dark:bg-gray-900">
          <button
            onClick={() => setIsSidebarOpen(true)}
            className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            aria-label="Open menu"
          >
            <svg
              className="h-6 w-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">
            {title}
          </h1>
          <div className="w-6" /> {/* Spacer for centering */}
        </div>

        <div className="p-4 md:p-8">
          <div className="mb-8 hidden md:block">
            <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
              {title}
            </h1>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
};
