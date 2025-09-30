"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GithubIcon } from "@/components/icons";

const navigation = [
  {
    name: "Compression",
    href: "/compression",
    description:
      "Compare compression and decompression algorithms performance and ratios for a given files.",
  },
  {
    name: "Allocation",
    href: "/allocation",
    description:
      "Compare Rust's allocator performance with global and bump allocators.",
  },
];

export const Sidebar = () => {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-80 flex-col border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
      <div className="flex h-16 items-center justify-between border-b border-gray-200 px-6 dark:border-gray-700">
        <Link href="/compression" className="text-xl font-bold">
          WASM Bench
        </Link>
        <Link
          target="_blank"
          href="https://github.com/nickbabcock/bench"
          className="text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <GithubIcon alt="Github" className="h-5 w-5" />
        </Link>
      </div>

      <nav
        className="flex-1 space-y-1 px-4 py-6"
        aria-label="Benchmark navigation"
      >
        {navigation.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className="block rounded-md px-3 py-3 text-gray-700 transition-colors hover:bg-gray-100 aria-[current=page]:bg-blue-100 aria-[current=page]:text-blue-700 dark:text-gray-300 dark:hover:bg-gray-800 dark:aria-[current=page]:bg-blue-900 dark:aria-[current=page]:text-blue-300"
            >
              <div className="mb-1 text-sm font-medium">{item.name}</div>
              <div className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                {item.description}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 px-4 py-4 dark:border-gray-700">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          All benchmarks run locally in your browser. No data is sent to any
          server.
        </p>
      </div>
    </div>
  );
};
