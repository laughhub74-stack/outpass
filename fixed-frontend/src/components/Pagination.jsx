import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Pagination({ page, pageSize = 10, totalPages, total, onPageChange, onPageSizeChange }) {
  if (!total) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border-premium pt-4 text-xs text-muted-text sm:flex-row sm:items-center sm:justify-between">
      <span>
        Page {page} of {Math.max(totalPages, 1)} ({total} total)
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5">
          <span>Rows</span>
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="input-premium !h-8 !w-auto py-0 text-xs"
            aria-label="Rows per page"
          >
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="btn-premium btn-premium-secondary !h-8 !w-8 !p-0 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="btn-premium btn-premium-secondary !h-8 !w-8 !p-0 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
