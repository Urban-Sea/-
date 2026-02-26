'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { HelpCircle, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { glossaryTerms, pageGlossaryMap } from './glossary-data';

/* ---------- Trigger button ---------- */

export function GlossaryButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors hover:bg-accent"
        aria-label="用語解説"
      >
        <HelpCircle className="w-4 h-4 text-muted-foreground" />
      </button>
      <GlossaryPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
}

/* ---------- Slide-over panel ---------- */

function GlossaryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [search, setSearch] = useState('');

  const categories = pageGlossaryMap[pathname] || ['general'];
  const filtered = glossaryTerms
    .filter(t => categories.includes(t.category))
    .filter(t =>
      !search ||
      t.term.toLowerCase().includes(search.toLowerCase()) ||
      t.definition.includes(search) ||
      (t.reading && t.reading.toLowerCase().includes(search.toLowerCase()))
    );

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-black/40 transition-opacity duration-300',
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={cn(
          'fixed top-0 right-0 z-50 h-full w-80 transform transition-transform duration-300 ease-out',
          'plumb-glass border-l border-border',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h2 className="text-sm font-bold">用語解説</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="用語を検索..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/50 border border-border focus:outline-none focus:ring-1 focus:ring-ring"
            />
          </div>
        </div>

        {/* Terms */}
        <div className="overflow-y-auto h-[calc(100%-7rem)] p-3 space-y-2">
          {filtered.map(term => (
            <div key={term.term} className="plumb-glass rounded-lg p-3 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-foreground">{term.term}</span>
                {term.reading && (
                  <span className="text-[10px] text-muted-foreground">({term.reading})</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{term.definition}</p>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">該当する用語がありません</p>
          )}
        </div>
      </div>
    </>
  );
}
