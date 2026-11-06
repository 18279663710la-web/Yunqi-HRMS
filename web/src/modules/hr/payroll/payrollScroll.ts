interface ScrollTarget extends EventTarget { scrollLeft: number }

export function connectPayrollScroll(table: ScrollTarget, bar: ScrollTarget): () => void {
  const fromTable = () => { if (bar.scrollLeft !== table.scrollLeft) bar.scrollLeft = table.scrollLeft; };
  const fromBar = () => { if (table.scrollLeft !== bar.scrollLeft) table.scrollLeft = bar.scrollLeft; };
  fromTable();
  table.addEventListener('scroll', fromTable);
  bar.addEventListener('scroll', fromBar);
  return () => { table.removeEventListener('scroll', fromTable); bar.removeEventListener('scroll', fromBar); };
}
