"use client";

import { Sidebar } from "./Sidebar";

interface BenchmarkLayoutProps {
  children: React.ReactNode;
  title: string;
}

export const BenchmarkLayout = ({ children, title }: BenchmarkLayoutProps) => {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-8">
          <div className="mb-8">
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
