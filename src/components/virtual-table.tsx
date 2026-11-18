import { ReactNode, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { TableContext } from "@/components/kit";

export interface VirtualTableProps<T> {
  head: ReactNode;
  footer?: ReactNode;
  data: T[];
  estimateRowHeight?: number;
  maxHeight?: string;
  colSpan?: number;
  renderRow: (item: T, index: number) => ReactNode;
  emptyState?: ReactNode;
}

export function VirtualTable<T extends { id?: string | number }>({
  head,
  footer,
  data,
  estimateRowHeight = 54,
  maxHeight = "640px",
  colSpan = 8,
  renderRow,
  emptyState,
}: VirtualTableProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: data.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateRowHeight,
    overscan: 6,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
      <div
        ref={parentRef}
        style={{ maxHeight }}
        className="overflow-auto rounded-t-lg border-b border-ink-800"
      >
        <table className="w-full text-left font-ui text-xs">
          <thead className="sticky top-0 z-10 border-b border-ink-800 bg-ink-900 text-ink-300 font-mono text-[10px] tracking-wider uppercase shadow-sm">
            <tr>{head}</tr>
          </thead>
          <tbody className="divide-y divide-ink-800/60 font-ui text-xs">
            {data.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="p-8 text-center">
                  <TableContext.Provider value={false}>{emptyState}</TableContext.Provider>
                </td>
              </tr>
            ) : (
              <>
                {paddingTop > 0 && (
                  <tr>
                    <td style={{ height: `${paddingTop}px` }} colSpan={colSpan} />
                  </tr>
                )}
                {virtualRows.map((virtualRow) => {
                  const item = data[virtualRow.index];
                  return (
                    <tr
                      key={item.id ?? virtualRow.key}
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      className="cursor-pointer transition-colors hover:bg-ink-850/60"
                    >
                      {renderRow(item, virtualRow.index)}
                    </tr>
                  );
                })}
                {paddingBottom > 0 && (
                  <tr>
                    <td style={{ height: `${paddingBottom}px` }} colSpan={colSpan} />
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
      </div>
      {footer ? (
        <div className="label-mono flex items-center justify-between border-t border-ink-800 px-4 py-2.5 bg-ink-900/50">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
