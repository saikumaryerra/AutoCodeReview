import { useState, useCallback } from 'react';
import { Search } from 'lucide-react';

export type SearchType = 'pr' | 'commit' | 'title';

interface SearchBarProps {
  onSearch: (type: SearchType, value: string) => void;
  placeholder?: string;
}

function detectSearchType(value: string): SearchType {
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return 'pr';
  }
  if (/^[0-9a-fA-F]{7,}$/.test(trimmed)) {
    return 'commit';
  }
  return 'title';
}

function getHintText(type: SearchType): string {
  switch (type) {
    case 'pr':
      return 'Searching by PR number...';
    case 'commit':
      return 'Searching by commit SHA...';
    case 'title':
      return 'Searching by PR title...';
  }
}

export function SearchBar({ onSearch, placeholder = 'Search by PR number, commit SHA, or title...' }: SearchBarProps) {
  const [value, setValue] = useState('');
  const searchType = detectSearchType(value);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
        onSearch(searchType, trimmed);
      }
    },
    [value, searchType, onSearch]
  );

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border border-gray-300 bg-white py-3 pl-10 pr-4 text-sm shadow-sm placeholder:text-gray-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>
      {value.trim() && (
        <p className="mt-1.5 text-xs text-gray-500">{getHintText(searchType)}</p>
      )}
    </form>
  );
}
