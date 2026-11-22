/**
 * Report exports. CSV for spreadsheets, PDF via jsPDF direct download
 * and HTML print window fallback.
 */
export function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const all = [columns, ...rows];
  const csv = all
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const esc = (v: string) =>
  String(v ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);

export type ExportPdfOptions = {
  title: string;
  subtitle?: string;
  academy?: string;
  logo?: string | null;
  columns?: string[];
  headers?: string[];
  rows: string[][];
  summary?: { label: string; value: string }[];
  filename?: string;
};

export async function exportPdf(
  titleOrOptions: string | ExportPdfOptions,
  columns?: string[],
  rows?: string[][],
  summary?: { label: string; value: string }[],
) {
  let opts: ExportPdfOptions;
  if (typeof titleOrOptions === "object" && titleOrOptions !== null) {
    opts = titleOrOptions;
  } else {
    opts = {
      title: titleOrOptions,
      columns: columns || [],
      rows: rows || [],
      summary: summary || [],
    };
  }

  const {
    title,
    subtitle,
    academy = "Vescio Vector Academy",
    columns: rawCols,
    headers,
    rows: rws,
    summary: sum = [],
    filename,
  } = opts;
  const cols = rawCols || headers || [];
  const fileName =
    filename ||
    `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // 1. Direct PDF Generation using dynamically imported jsPDF & autoTable
  try {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);

    const doc = new jsPDF({
      orientation: cols.length > 5 ? "landscape" : "portrait",
      unit: "mm",
      format: "a4",
    });

    // Brand header
    doc.setFillColor(18, 125, 117); // Teal / Court primary color #127d75
    doc.rect(14, 12, doc.internal.pageSize.width - 28, 2, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(20, 35, 42);
    doc.text(title, 14, 22);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(91, 112, 120);
    const metaLine = `${academy}${subtitle ? ` · ${subtitle}` : ""} · Generated ${new Date().toLocaleString()}`;
    doc.text(metaLine, 14, 28);

    let startY = 34;

    // Summary KPI boxes if provided
    if (sum.length > 0) {
      doc.setFontSize(8);
      const cardWidth = Math.min(42, (doc.internal.pageSize.width - 28) / sum.length);
      sum.forEach((s, idx) => {
        const x = 14 + idx * (cardWidth + 4);
        doc.setFillColor(241, 246, 246);
        doc.roundedRect(x, startY, cardWidth, 12, 1.5, 1.5, "F");
        doc.setTextColor(91, 112, 120);
        doc.setFont("helvetica", "bold");
        doc.text(s.label.toUpperCase(), x + 3, startY + 4.5);
        doc.setTextColor(20, 35, 42);
        doc.setFont("helvetica", "bold");
        doc.text(s.value, x + 3, startY + 9.5);
      });
      startY += 16;
    }

    // Data table
    autoTable(doc, {
      head: [cols],
      body: rws,
      startY,
      theme: "grid",
      headStyles: {
        fillColor: [241, 246, 246],
        textColor: [64, 87, 95],
        fontStyle: "bold",
        fontSize: 8,
      },
      bodyStyles: {
        textColor: [20, 35, 42],
        fontSize: 8,
        cellPadding: 2.5,
      },
      alternateRowStyles: {
        fillColor: [250, 252, 252],
      },
      margin: { left: 14, right: 14 },
    });

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(123, 139, 145);
      doc.text(
        `${rws.length} entries · Page ${i} of ${pageCount} · Vescio Vector Academy Management System`,
        14,
        doc.internal.pageSize.height - 8,
      );
    }

    doc.save(fileName);
    return;
  } catch (err) {
    console.warn("jsPDF direct generation fallback to print window:", err);
  }

  // 2. Fallback to print window
  const printed = new Date().toLocaleString();
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #14232a; margin: 32px; }
  header { display: flex; align-items: center; gap: 14px; border-bottom: 2px solid #127d75; padding-bottom: 12px; }
  header img { height: 40px; }
  h1 { font-size: 18px; margin: 0; }
  .meta { font-size: 11px; color: #5b7078; margin-top: 2px; }
  .summary { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .card { border: 1px solid #dde5e6; border-radius: 6px; padding: 8px 12px; min-width: 130px; }
  .card span { display: block; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #5b7078; }
  .card strong { font-size: 15px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { text-align: left; background: #f1f6f6; border-bottom: 1px solid #cfdcdd; padding: 7px 8px; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #40575f; }
  td { padding: 7px 8px; border-bottom: 1px solid #eef3f3; }
  tr:nth-child(even) td { background: #fafcfc; }
  footer { margin-top: 18px; font-size: 10px; color: #7b8b91; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<header>
  ${opts.logo ? `<img src="${opts.logo}" alt="" />` : ""}
  <div><h1>${esc(title)}</h1>
  <div class="meta">${esc(academy)}${subtitle ? ` · ${esc(subtitle)}` : ""} · generated ${esc(printed)}</div></div>
</header>
${sum.length ? `<div class="summary">${sum.map((s) => `<div class="card"><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong></div>`).join("")}</div>` : ""}
<table><thead><tr>${cols.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead>
<tbody>${rws.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>
<footer>${esc(rws.length.toString())} rows · Vescio Vector</footer>
<script>window.onload = () => { window.focus(); window.print(); };</script>
</body></html>`;

  const win = window.open("", "_blank", "width=980,height=760");
  if (!win) {
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
}
