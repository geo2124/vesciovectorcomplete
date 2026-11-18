import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Row,
  RowActions,
  Search,
  Select,
  Stat,
  Table,
  Td,
  Th,
  money,
  Pagination,
} from "@/components/kit";
import {
  useDB,
  useTenantUser,
  useModulePermissions,
  defaultRoleDefinitions,
  DEFAULT_PRINTING_OPTIONS,
  type PrintingOption,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import type { MerchPrintingItem, MerchVariant, Order, StockItem, Supplier } from "@/lib/mock-data";
import { toast } from "sonner";
import { dispatchLowStockAlert } from "@/lib/notifications";
import {
  FileSpreadsheet,
  FileText,
  Search as SearchIcon,
  Printer,
  Plus,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/merchandise")({
  head: () => ({
    meta: [
      { title: "Merchandise — Vescio Vector" },
      {
        name: "description",
        content:
          "Inventory, suppliers, reorder alerts and player merchandise orders with payment and delivery status.",
      },
      { property: "og:title", content: "Merchandise — Vescio Vector" },
      {
        property: "og:description",
        content: "Track stock, suppliers and player orders end to end.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MerchandisePage,
});

const PRESET_SIZES = [
  "Youth S",
  "Youth M",
  "Youth L",
  "Small",
  "Medium",
  "Large",
  "XL",
  "XXL",
  "One Size",
];

const PRESET_COLORS = ["Blue", "White", "Black", "Gold", "Navy", "Red", "Green", "Grey"];

function formatVariantsSummary(variants?: MerchVariant[], fallbackVariant?: string): string {
  if (Array.isArray(variants) && variants.length > 0) {
    return variants
      .map((v) => `${v.color || "Standard"} · ${v.size || "One Size"} (${Number(v.quantity) || 0})`)
      .join(", ");
  }
  return fallbackVariant || "";
}

function adjustStockItemVariants(
  item: StockItem,
  deltaSoldQty: number, // > 0 means more sold (decrement stock); < 0 means restored to stock (increment stock)
  targetVariantId?: string,
  targetColor?: string,
  targetSize?: string,
  fallbackVariantText?: string,
): StockItem {
  if (!Array.isArray(item.variants) || item.variants.length === 0) {
    return {
      ...item,
      stock: Math.max(0, (Number(item.stock) || 0) - deltaSoldQty),
    };
  }

  let matched = false;
  const normColor = (targetColor || "").trim().toLowerCase();
  const normSize = (targetSize || "").trim().toLowerCase();
  const normFallback = (fallbackVariantText || "").trim().toLowerCase();

  const updatedVariants = item.variants.map((v) => {
    if (matched) return v;
    const isMatchById = Boolean(targetVariantId && v.id === targetVariantId);
    const isMatchByColorSize = Boolean(
      normColor &&
      normSize &&
      v.color.trim().toLowerCase() === normColor &&
      v.size.trim().toLowerCase() === normSize,
    );
    const isMatchByFallback = Boolean(
      !isMatchById &&
      !isMatchByColorSize &&
      normFallback &&
      (`${v.color} · ${v.size}`.toLowerCase() === normFallback ||
        `${v.color} - ${v.size}`.toLowerCase() === normFallback ||
        `${v.size} ${v.color}`.toLowerCase() === normFallback),
    );

    if (isMatchById || isMatchByColorSize || isMatchByFallback) {
      matched = true;
      return {
        ...v,
        quantity: Math.max(0, (Number(v.quantity) || 0) - deltaSoldQty),
      };
    }
    return v;
  });

  const finalVariants = matched
    ? updatedVariants
    : updatedVariants.map((v, idx) =>
        idx === 0 ? { ...v, quantity: Math.max(0, (Number(v.quantity) || 0) - deltaSoldQty) } : v,
      );

  const newTotalStock = finalVariants.reduce(
    (sum, v) => sum + Math.max(0, Number(v.quantity) || 0),
    0,
  );

  return {
    ...item,
    variants: finalVariants,
    variant: formatVariantsSummary(finalVariants, item.variant),
    stock: newTotalStock,
  };
}

function downloadCatalogueCSV(stockList: StockItem[], academyName: string) {
  const headers = [
    "Item,Variant Breakdown,Supplier,Stock Quantity,Reorder Level,Cost Price (USD),Selling Price (USD),Unit Margin (USD),Margin (%),Total Cost Value (USD),Total Retail Value (USD)",
  ];
  const rows = stockList.map((s) => {
    const cost = s.costPrice ?? 0;
    const sell = s.sellingPrice ?? s.price;
    const margin = sell - cost;
    const marginPct = sell > 0 ? Math.round((margin / sell) * 100) : 0;
    const totalCost = s.stock * cost;
    const totalRetail = s.stock * sell;
    const variantStr = formatVariantsSummary(s.variants, s.variant);
    return `"${(s.item || "").replace(/"/g, '""')}","${variantStr.replace(/"/g, '""')}","${(s.supplier || "").replace(/"/g, '""')}",${s.stock},${s.reorder},${cost.toFixed(2)},${sell.toFixed(2)},${margin.toFixed(2)},${marginPct}%,${totalCost.toFixed(2)},${totalRetail.toFixed(2)}`;
  });
  const csv = headers.concat(rows).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${academyName.replace(/\s+/g, "_")}_Merchandise_Catalogue_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success("Merchandise catalogue (CSV) downloaded successfully.");
}

async function downloadCataloguePDF(stockList: StockItem[], academyName: string) {
  try {
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

    const totalItems = stockList.length;
    const totalUnits = stockList.reduce((a, s) => a + s.stock, 0);
    const totalCost = stockList.reduce((a, s) => a + s.stock * (s.costPrice ?? 0), 0);
    const totalRetail = stockList.reduce((a, s) => a + s.stock * (s.sellingPrice ?? s.price), 0);
    const projectedProfit = totalRetail - totalCost;

    // Header
    doc.setFillColor(15, 23, 42); // slate-900
    doc.rect(0, 0, 297, 24, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text(`${academyName.toUpperCase()} · FULL MERCHANDISE CATALOGUE`, 14, 11);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(45, 212, 191);
    doc.text(
      `Generated: ${new Date().toLocaleDateString()} | Total Catalog Items: ${totalItems} | Total In-Stock Units: ${totalUnits}`,
      14,
      18,
    );

    // KPI Metrics bar
    doc.setFontSize(8.5);
    doc.setTextColor(40, 40, 40);
    doc.text(
      `Total Inventory Cost: ${money(totalCost)}  |  Retail Sales Value: ${money(totalRetail)}  |  Projected Gross Profit: ${money(projectedProfit)}`,
      14,
      31,
    );

    const tableRows = stockList.map((s) => {
      const cost = s.costPrice ?? 0;
      const sell = s.sellingPrice ?? s.price;
      const margin = sell - cost;
      const marginPct = sell > 0 ? `${Math.round((margin / sell) * 100)}%` : "0%";
      return [
        s.item,
        formatVariantsSummary(s.variants, s.variant) || "—",
        s.supplier || "—",
        String(s.stock),
        String(s.reorder),
        money(cost),
        money(sell),
        money(margin),
        marginPct,
        money(s.stock * sell),
      ];
    });

    autoTable(doc, {
      startY: 36,
      head: [
        [
          "Item Name",
          "Variants (Color · Size · Qty)",
          "Supplier",
          "Stock",
          "Reorder",
          "Cost Price",
          "Selling Price",
          "Unit Margin",
          "Margin %",
          "Total Value",
        ],
      ],
      body: tableRows,
      theme: "grid",
      headStyles: {
        fillColor: [15, 23, 42],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 8,
      },
      styles: {
        fontSize: 7.5,
        cellPadding: 2,
        textColor: [30, 41, 59],
      },
      columnStyles: {
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
        9: { halign: "right" },
      },
    });

    doc.save(
      `${academyName.replace(/\s+/g, "_")}_Merchandise_Catalogue_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
    toast.success("Merchandise catalogue (PDF) downloaded successfully.");
  } catch (err) {
    console.error("PDF export error:", err);
    toast.error("Failed to generate catalogue PDF.");
  }
}

const blankItem: Omit<StockItem, "id"> = {
  item: "",
  supplier: "",
  variant: "",
  variants: [],
  stock: 0,
  reorder: 10,
  costPrice: 0,
  sellingPrice: 0,
  price: 0,
};

const blankOrder: Omit<Order, "id"> = {
  team: "",
  player: "",
  items: "",
  quantity: 1,
  unitPrice: 0,
  variant: "",
  variantId: "",
  selectedSize: "",
  selectedColor: "",
  number: "",
  printings: [],
  printingTotalFee: 0,
  subtotal: 0,
  discountPercent: 0,
  discountAmount: 0,
  total: 0,
  paid: 0,
  delivered: false,
};

const blankSupplier: Omit<Supplier, "id"> = {
  name: "",
  contact: "",
  email: "",
  phone: "",
};

function MerchandisePage() {
  const {
    db,
    update,
    updateAcademy,
    processMerchandiseTransaction,
    settleMerchandiseOrder,
    tenantId,
  } = useDB();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const userRoleDef = useMemo(() => {
    const roleName = currentUser?.role;
    if (!roleName) return undefined;
    const defaultDef = defaultRoleDefinitions.find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    const customDef = (db.customRoles || []).find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    if (!customDef && !defaultDef) return undefined;
    return {
      ...defaultDef,
      ...customDef,
      permissions: { ...defaultDef?.permissions, ...customDef?.permissions },
    };
  }, [currentUser?.role, db.customRoles]);
  const hasAccess =
    currentUser?.role === "Super Admin" ||
    currentUser?.role === "Academy Manager" ||
    currentUser?.role === "Accountant" ||
    currentUser?.role === "Branch Manager" ||
    Boolean(userRoleDef?.permissions?.["merchandise"]?.read) ||
    user?.email === "geogo3@gmail.com" ||
    passwordUser?.email === "geogo3@gmail.com";
  const hasFeature = db.academy?.features?.includes("merchandise") !== false;

  const { stock, orders, suppliers } = db;
  const [q, setQ] = useState("");
  const [orderSearchInput, setOrderSearchInput] = useState("");
  const [orderQ, setOrderQ] = useState("");
  const [itemOpen, setItemOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [editOrder, setEditOrder] = useState<Order | null>(null);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [itemForm, setItemForm] = useState<Omit<StockItem, "id">>(blankItem);
  const [orderForm, setOrderForm] = useState<Omit<Order, "id">>(blankOrder);
  const [supplierForm, setSupplierForm] = useState<Omit<Supplier, "id">>(blankSupplier);
  const [stockPage, setStockPage] = useState(1);
  const [orderPage, setOrderPage] = useState(1);
  const [restockItem, setRestockItem] = useState<StockItem | null>(null);
  const [restockQty, setRestockQty] = useState<number>(10);
  const [restockVariants, setRestockVariants] = useState<MerchVariant[]>([]);
  const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);
  const [managePrintingOpen, setManagePrintingOpen] = useState(false);
  const pageSize = 20;

  const activePrintingOptions: PrintingOption[] = useMemo(() => {
    if (Array.isArray(db.academy?.printingOptions) && db.academy.printingOptions.length > 0) {
      return db.academy.printingOptions;
    }
    return DEFAULT_PRINTING_OPTIONS;
  }, [db.academy?.printingOptions]);

  const [printingDraft, setPrintingDraft] = useState<PrintingOption[]>([]);

  const openManagePrinting = () => {
    setPrintingDraft(activePrintingOptions.map((o) => ({ ...o })));
    setManagePrintingOpen(true);
  };

  const savePrintingOptions = async () => {
    const sanitized = printingDraft
      .map((o) => ({
        id: o.id || `pr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        label: o.label.trim() || "Custom Printing",
        defaultFee: Math.max(0, Number(o.defaultFee) || 0),
      }))
      .filter((o) => Boolean(o.label));

    await updateAcademy({
      ...db.academy,
      printingOptions: sanitized,
    });
    toast.success("Printing fee catalog updated successfully.");
    setManagePrintingOpen(false);
  };

  const { canWrite: canWriteMerchandise, canDelete: canDeleteMerchandise } =
    useModulePermissions("merchandise");
  const isBranchManager =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const branchPlayerNames = useMemo(
    () =>
      isBranchManager
        ? new Set(
            db.players
              .filter((p) => p.branch?.toLowerCase() === userBranch.toLowerCase())
              .map((p) => p.name.toLowerCase()),
          )
        : null,
    [isBranchManager, userBranch, db.players],
  );
  const branchTeamNames = useMemo(
    () =>
      isBranchManager
        ? new Set(
            db.teams
              .filter((t) => t.branch?.toLowerCase() === userBranch.toLowerCase())
              .map((t) => t.name.toLowerCase()),
          )
        : null,
    [isBranchManager, userBranch, db.teams],
  );

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    kind: "stock" | "order" | "supplier";
    id: string;
    label: string;
  } | null>(null);

  useEffect(() => {
    setStockPage(1);
  }, [q]);

  // Helper to recompute order totals whenever unitPrice, quantity, discount, or printings change
  const recomputeOrderPricing = (
    nextPartial: Partial<Omit<Order, "id">>,
    baseState: Omit<Order, "id"> = orderForm,
  ): Omit<Order, "id"> => {
    const merged = { ...baseState, ...nextPartial };
    const qty = Math.max(1, Number(merged.quantity) || 1);
    const unitPrice = Math.max(0, Number(merged.unitPrice ?? merged.subtotal ?? 0) || 0);
    const itemsSubtotal = Math.round(unitPrice * qty * 100) / 100;
    const discountPct = Math.min(100, Math.max(0, Number(merged.discountPercent) || 0));
    const discAmt = Math.round(((itemsSubtotal * discountPct) / 100) * 100) / 100;
    const netItemsTotal = Math.max(0, itemsSubtotal - discAmt);
    const printingsList = Array.isArray(merged.printings) ? merged.printings : [];
    const printingFee = printingsList.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
    const finalTotal = Math.round((netItemsTotal + printingFee) * 100) / 100;

    // Preserve credit/partial payment ratio if user already chose On Credit (paid === 0), otherwise default paid to finalTotal
    const wasOnCredit = baseState.total > 0 && baseState.paid === 0 && !("paid" in nextPartial);
    const nextPaid =
      "paid" in nextPartial
        ? Math.max(0, Number(nextPartial.paid) || 0)
        : wasOnCredit
          ? 0
          : finalTotal;

    return {
      ...merged,
      quantity: qty,
      unitPrice,
      subtotal: itemsSubtotal,
      discountPercent: discountPct,
      discountAmount: discAmt,
      printingTotalFee: printingFee,
      total: finalTotal,
      paid: nextPaid,
    };
  };

  if (authLoading && !currentUser && !user) {
    return (
      <AppShell crumb="OPS / MERCHANDISE" title="Merchandise">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">
            Loading merchandise inventory...
          </span>
        </div>
      </AppShell>
    );
  }

  if (!hasFeature) {
    return (
      <AppShell crumb="OPS / MERCHANDISE" title="Merchandise">
        <div className="py-10 text-center font-mono text-[11px] text-ink-400">
          This feature is not included in your current plan.
        </div>
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell crumb="OPS / MERCHANDISE" title="Merchandise">
        <div className="mx-auto max-w-xl py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/10 text-warn border border-warn/20">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink-100">
            Access Restricted
          </h2>
          <p className="mt-2 text-sm text-ink-300">
            You do not have permission to manage merchandise.
          </p>
        </div>
      </AppShell>
    );
  }

  const filtered = stock.filter(
    (s) =>
      !q.trim() ||
      [s.item, s.supplier, s.variant, formatVariantsSummary(s.variants, s.variant)]
        .join(" ")
        .toLowerCase()
        .includes(q.toLowerCase()),
  );

  const pagedStock = filtered.slice((stockPage - 1) * pageSize, stockPage * pageSize);

  const filteredOrders = orders.filter((o, idx) => {
    if (branchPlayerNames && branchTeamNames) {
      const matchPlayer = o.player && branchPlayerNames.has(o.player.toLowerCase());
      const matchTeam = o.team && branchTeamNames.has(o.team.toLowerCase());
      if (!matchPlayer && !matchTeam) return false;
    }
    if (!orderQ.trim()) return true;
    const term = orderQ.trim().toLowerCase();
    const orderIndexStr = String(idx + 1);
    const orderHashStr = `#${idx + 1}`;
    return (
      o.id.toLowerCase().includes(term) ||
      o.player.toLowerCase().includes(term) ||
      (o.number && String(o.number).toLowerCase().includes(term)) ||
      (o.items && o.items.toLowerCase().includes(term)) ||
      (o.variant && o.variant.toLowerCase().includes(term)) ||
      orderIndexStr === term ||
      orderHashStr === term
    );
  });
  const pagedOrders = filteredOrders.slice((orderPage - 1) * pageSize, orderPage * pageSize);

  const lowStock = stock.filter((s) => s.stock <= s.reorder);
  const inventoryCostValue = stock.reduce(
    (a, s) => a + s.stock * (s.costPrice !== undefined ? s.costPrice : s.price * 0.5),
    0,
  );
  const salesValue = stock.reduce(
    (a, s) => a + s.stock * (s.sellingPrice !== undefined ? s.sellingPrice : s.price),
    0,
  );
  const owed = orders.reduce((a, o) => a + (o.total - o.paid), 0);

  // Variant matrix calculations for New / Edit Item modal
  const itemVariantsList = itemForm.variants || [];
  const itemVariantsSum = itemVariantsList.reduce(
    (acc, v) => acc + Math.max(0, Number(v.quantity) || 0),
    0,
  );
  const itemTotalPurchased = Math.max(0, Number(itemForm.stock) || 0);
  const hasItemVariantMismatch =
    itemVariantsList.length > 0 && itemVariantsSum !== itemTotalPurchased;

  // Variant matrix calculations for Restock modal
  const restockVariantsSum = restockVariants.reduce(
    (acc, v) => acc + Math.max(0, Number(v.quantity) || 0),
    0,
  );
  const hasRestockVariantMismatch =
    restockVariants.length > 0 && restockVariantsSum !== Math.max(0, Number(restockQty) || 0);

  // Selected stock item & variant validation for Order / POS Modal
  const stripQtySuffix = (itemsText: string) =>
    (itemsText || "").replace(/\s*\(x\d+\)\s*$/i, "").trim();

  const selectedOrderStockItem = (() => {
    const cleanName = stripQtySuffix(orderForm.items).toLowerCase();
    if (!cleanName) return undefined;
    return (
      (orderForm.stockItemId ? db.stock.find((s) => s.id === orderForm.stockItemId) : undefined) ||
      db.stock.find((s) => s.item.toLowerCase() === cleanName) ||
      db.stock.find((s) => cleanName.includes(s.item.toLowerCase()))
    );
  })();

  const itemHasStructuredVariants = Boolean(
    selectedOrderStockItem?.variants && selectedOrderStockItem.variants.length > 0,
  );

  const selectedOrderVariant = (() => {
    if (!selectedOrderStockItem?.variants || selectedOrderStockItem.variants.length === 0) {
      return undefined;
    }
    if (orderForm.variantId) {
      const byId = selectedOrderStockItem.variants.find((v) => v.id === orderForm.variantId);
      if (byId) return byId;
    }
    if (orderForm.selectedColor && orderForm.selectedSize) {
      return selectedOrderStockItem.variants.find(
        (v) =>
          v.color.trim().toLowerCase() === orderForm.selectedColor?.trim().toLowerCase() &&
          v.size.trim().toLowerCase() === orderForm.selectedSize?.trim().toLowerCase(),
      );
    }
    return undefined;
  })();

  function submitItem() {
    if (!itemForm.item.trim()) {
      toast.error("Please enter an item name.");
      return;
    }

    const cleanedVariants: MerchVariant[] = (itemForm.variants || []).map((v, idx) => ({
      id: v.id || `var-${Date.now().toString(36)}-${idx}`,
      size: (v.size || "").trim(),
      color: (v.color || "").trim(),
      quantity: Math.max(0, Math.floor(Number(v.quantity) || 0)),
      ...(v.sku?.trim() ? { sku: v.sku.trim() } : {}),
    }));

    if (cleanedVariants.length > 0) {
      const missingMeta = cleanedVariants.some((v) => !v.size || !v.color);
      if (missingMeta) {
        toast.error("Please specify both Size and Color for every variant row.");
        return;
      }
      const sum = cleanedVariants.reduce((acc, v) => acc + v.quantity, 0);
      const totalPurchased = Math.max(0, Math.floor(Number(itemForm.stock) || 0));
      if (sum !== totalPurchased) {
        toast.error(
          `Mismatch: Variant quantities sum to ${sum}, which does not equal Total Purchased (${totalPurchased}). Adjust by ${Math.abs(totalPurchased - sum)} pcs.`,
        );
        return;
      }
    }

    const finalSellingPrice = itemForm.sellingPrice || itemForm.price || 0;
    const finalCostPrice = itemForm.costPrice ?? 0;
    const finalStock =
      cleanedVariants.length > 0
        ? cleanedVariants.reduce((acc, v) => acc + v.quantity, 0)
        : Math.max(0, Math.floor(Number(itemForm.stock) || 0));
    const finalVariantSummary =
      cleanedVariants.length > 0
        ? formatVariantsSummary(cleanedVariants, itemForm.variant)
        : itemForm.variant;

    const itemData: Omit<StockItem, "id"> = {
      ...itemForm,
      stock: finalStock,
      variant: finalVariantSummary,
      variants: cleanedVariants,
      sellingPrice: finalSellingPrice,
      price: finalSellingPrice,
      costPrice: finalCostPrice,
    };
    update((d) =>
      editItem
        ? { ...d, stock: d.stock.map((s) => (s.id === editItem.id ? { ...s, ...itemData } : s)) }
        : { ...d, stock: [{ ...itemData, id: `m-${Date.now().toString(36)}` }, ...d.stock] },
    );
    if (itemData.stock <= (itemData.reorder ?? 10)) {
      void dispatchLowStockAlert(tenantId, {
        itemName: itemData.item,
        variant: itemData.variant || undefined,
        stock: itemData.stock,
        reorderLevel: itemData.reorder ?? 10,
        branch: itemData.branch || userBranch || undefined,
      }).catch(() => {});
    }
    toast.success(
      editItem ? `Item "${itemForm.item}" updated.` : `Item "${itemForm.item}" added to stock.`,
    );
    setItemOpen(false);
  }

  async function submitOrder() {
    const cleanItemName = stripQtySuffix(orderForm.items);
    if (!orderForm.player.trim() || !cleanItemName) {
      toast.error("Please specify both Player and Merchandise Item.");
      return;
    }

    const orderQty = Math.max(1, Math.floor(Number(orderForm.quantity) || 1));
    const playerObj = db.players.find(
      (p) => p.name.toLowerCase() === orderForm.player.trim().toLowerCase(),
    );
    const stockItem = selectedOrderStockItem;

    // Point 4: Mandatory Variant Selection & Stock Availability Check
    if (stockItem && Array.isArray(stockItem.variants) && stockItem.variants.length > 0) {
      if (
        !orderForm.selectedColor?.trim() ||
        !orderForm.selectedSize?.trim() ||
        !selectedOrderVariant
      ) {
        toast.error(
          `Please select both Color and Size variant for "${stockItem.item}" before completing the sale.`,
        );
        return;
      }

      // If editing an existing order of the exact same variant, allow the previously reserved quantity
      const oldReservedOnSameVariant =
        editOrder &&
        (editOrder.variantId === selectedOrderVariant.id ||
          (editOrder.selectedColor?.toLowerCase() === selectedOrderVariant.color.toLowerCase() &&
            editOrder.selectedSize?.toLowerCase() === selectedOrderVariant.size.toLowerCase()))
          ? Math.max(1, Number(editOrder.quantity) || 1)
          : 0;

      const maxAvailableForOrder =
        (Number(selectedOrderVariant.quantity) || 0) + oldReservedOnSameVariant;

      if (orderQty > maxAvailableForOrder) {
        toast.error(
          `Insufficient stock for ${selectedOrderVariant.color} — ${selectedOrderVariant.size}: requested ${orderQty} pcs, but only ${maxAvailableForOrder} in stock.`,
        );
        return;
      }
    } else if (stockItem && !editOrder && orderQty > stockItem.stock) {
      toast.error(
        `Insufficient stock for "${stockItem.item}": requested ${orderQty} pcs, but only ${stockItem.stock} in stock.`,
      );
      return;
    }

    const printingsList = (orderForm.printings || []).filter((p) => p && p.label?.trim());
    const printingTotalFee = printingsList.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
    const resolvedVariantLabel = selectedOrderVariant
      ? `${selectedOrderVariant.color} · ${selectedOrderVariant.size}`
      : orderForm.selectedColor && orderForm.selectedSize
        ? `${orderForm.selectedColor} · ${orderForm.selectedSize}`
        : orderForm.variant || "";

    if (editOrder) {
      const parseQty = (itemsStr: string, explicitQty?: number) => {
        if (typeof explicitQty === "number" && explicitQty > 0) return explicitQty;
        const match = (itemsStr || "").match(/\(x(\d+)\)|\bx(\d+)\b/i);
        if (match) {
          const parsed = parseInt(match[1] || match[2] || "1", 10);
          if (!Number.isNaN(parsed) && parsed > 0) return parsed;
        }
        return 1;
      };

      const oldQty = parseQty(editOrder.items, editOrder.quantity);
      const newQty = orderQty;

      const oldStockItem =
        (editOrder.stockItemId
          ? db.stock.find((s) => s.id === editOrder.stockItemId)
          : undefined) ||
        db.stock.find(
          (s) =>
            s.item.toLowerCase() === stripQtySuffix(editOrder.items).toLowerCase() ||
            editOrder.items.toLowerCase().includes(s.item.toLowerCase()),
        );
      const oldPlayerObj = db.players.find(
        (p) => p.name.toLowerCase() === editOrder.player.trim().toLowerCase(),
      );

      const oldUnpaid = Math.max(0, (editOrder.total || 0) - (editOrder.paid || 0));
      const newUnpaid = Math.max(0, (orderForm.total || 0) - (orderForm.paid || 0));
      const deltaUnpaid = newUnpaid - oldUnpaid;
      const newPaid = Math.max(0, orderForm.paid || 0);
      const dateStr = editOrder.date || new Date().toISOString().slice(0, 10);
      const branchName = playerObj?.branch || oldPlayerObj?.branch || "";
      const effectiveCost = stockItem?.costPrice ?? editOrder.costPrice ?? 0;
      const formattedItemsLabel = newQty > 1 ? `${cleanItemName} (x${newQty})` : cleanItemName;

      update((d) => {
        // 1. Restore oldStockItem (including old variant) and deduct newStockItem (including new variant)
        const updatedStock = d.stock.map((s) => {
          let nextItem = s;
          if (oldStockItem && s.id === oldStockItem.id) {
            nextItem = adjustStockItemVariants(
              nextItem,
              -oldQty,
              editOrder.variantId,
              editOrder.selectedColor,
              editOrder.selectedSize,
              editOrder.variant,
            );
          }
          if (stockItem && s.id === stockItem.id) {
            nextItem = adjustStockItemVariants(
              nextItem,
              newQty,
              selectedOrderVariant?.id || orderForm.variantId,
              selectedOrderVariant?.color || orderForm.selectedColor,
              selectedOrderVariant?.size || orderForm.selectedSize,
              resolvedVariantLabel,
            );
          }
          return nextItem;
        });

        // 2. Adjust player's balance by deltaUnpaid (or move unpaid balance if player changed)
        const updatedPlayers = d.players.map((p) => {
          if (oldPlayerObj && playerObj && oldPlayerObj.id === playerObj.id) {
            if (p.id === playerObj.id) {
              return { ...p, balance: Math.max(0, (p.balance || 0) + deltaUnpaid) };
            }
            return p;
          }
          if (oldPlayerObj && p.id === oldPlayerObj.id) {
            return { ...p, balance: Math.max(0, (p.balance || 0) - oldUnpaid) };
          }
          if (playerObj && p.id === playerObj.id) {
            return { ...p, balance: Math.max(0, (p.balance || 0) + newUnpaid) };
          }
          return p;
        });

        // 3. Reconcile corresponding ledger entries for editOrder.id
        const isOrderEntry = (l: (typeof d.ledger)[number]) =>
          l.referenceId === editOrder.id ||
          l.orderId === editOrder.id ||
          Boolean(l.note?.includes(`Order #${editOrder.id}`));

        const printingSummaryText =
          printingsList.length > 0
            ? printingsList
                .map((p) => `${p.label}${p.details ? ` ('${p.details}')` : ""}: +${money(p.fee)}`)
                .join(", ")
            : "";
        const printingSuffix =
          printingTotalFee > 0 ? ` + Custom Printing (${money(printingTotalFee)})` : "";
        const variantSuffix = resolvedVariantLabel ? ` [${resolvedVariantLabel}]` : "";
        const breakdownNote = [
          `Order #${editOrder.id} (${orderForm.player.trim()})`,
          `Base Item: ${money((orderForm.subtotal || 0) - (orderForm.discountAmount || 0))}`,
          printingTotalFee > 0 ? `Printing Fees: ${printingSummaryText}` : "",
          `Total: ${money(orderForm.total)}`,
        ]
          .filter(Boolean)
          .join(" · ");

        let hasRevEntry = false;
        let hasArEntry = false;

        const reconciledLedger = d.ledger
          .map((l) => {
            if (!isOrderEntry(l)) return l;
            if (l.account === "Merchandise Revenue") {
              hasRevEntry = true;
              if (newPaid <= 0) return null;
              return {
                ...l,
                entry: `Merchandise Sale · ${orderForm.player.trim()} · ${formattedItemsLabel}${variantSuffix}${printingSuffix}`,
                amount: Math.abs(newPaid),
                branch: branchName || l.branch || "",
                note: breakdownNote,
              };
            }
            if (l.account === "Accounts Receivable - Merchandise") {
              hasArEntry = true;
              if (newUnpaid <= 0) {
                return {
                  ...l,
                  amount: 0,
                  status: "Collected" as const,
                };
              }
              return {
                ...l,
                entry: `Accounts Receivable - Merchandise · ${orderForm.player.trim()} · ${formattedItemsLabel}${variantSuffix}${printingSuffix}`,
                amount: Math.abs(newUnpaid),
                status: "Pending" as const,
                branch: branchName || l.branch || "",
                note: `Assigned on credit to ${orderForm.player.trim()}. ${breakdownNote}`,
              };
            }
            if (l.account === "Merchandise" && l.type === "Expense") {
              return {
                ...l,
                entry: `Merchandise Cost (COGS) · ${formattedItemsLabel}${variantSuffix}`,
                amount: Math.abs(newQty * effectiveCost),
              };
            }
            return l;
          })
          .filter((l): l is NonNullable<typeof l> => l !== null && l.amount > 0);

        if (!hasRevEntry && newPaid > 0) {
          reconciledLedger.unshift({
            id: `l-merch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            date: dateStr,
            account: "Merchandise Revenue",
            category: "Merchandise Revenue",
            entry: `Merchandise Sale · ${orderForm.player.trim()} · ${formattedItemsLabel}${variantSuffix}${printingSuffix}`,
            type: "Revenue",
            amount: Math.abs(newPaid),
            status: "Collected",
            referenceId: editOrder.id,
            orderId: editOrder.id,
            branch: branchName,
            note: breakdownNote,
          });
        }

        if (!hasArEntry && newUnpaid > 0) {
          reconciledLedger.unshift({
            id: `l-ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            date: dateStr,
            account: "Accounts Receivable - Merchandise",
            category: "Accounts Receivable - Merchandise",
            entry: `Accounts Receivable - Merchandise · ${orderForm.player.trim()} · ${formattedItemsLabel}${variantSuffix}${printingSuffix}`,
            type: "Revenue",
            amount: Math.abs(newUnpaid),
            status: "Pending",
            referenceId: editOrder.id,
            orderId: editOrder.id,
            branch: branchName,
            note: `Assigned on credit to ${orderForm.player.trim()}. ${breakdownNote}`,
          });
        }

        return {
          ...d,
          stock: updatedStock,
          players: updatedPlayers,
          ledger: reconciledLedger,
          orders: d.orders.map((o) =>
            o.id === editOrder.id
              ? {
                  ...o,
                  ...orderForm,
                  items: formattedItemsLabel,
                  quantity: newQty,
                  stockItemId: stockItem?.id || o.stockItemId,
                  playerId: playerObj?.id || o.playerId,
                  variant: resolvedVariantLabel,
                  variantId: selectedOrderVariant?.id || orderForm.variantId,
                  selectedColor: selectedOrderVariant?.color || orderForm.selectedColor,
                  selectedSize: selectedOrderVariant?.size || orderForm.selectedSize,
                  printings: printingsList,
                  printingTotalFee,
                  costPrice: effectiveCost || o.costPrice,
                  costTotal: effectiveCost > 0 ? newQty * effectiveCost : o.costTotal,
                }
              : o,
          ),
        };
      });
      toast.success(
        `Updated order for ${orderForm.player} and reconciled variant stock, player balance, and ledger.`,
      );
    } else {
      const unitSell =
        orderForm.unitPrice || stockItem?.sellingPrice || stockItem?.price || orderForm.total;
      await processMerchandiseTransaction({
        playerName: orderForm.player.trim(),
        playerId: playerObj?.id,
        team: orderForm.team || playerObj?.teams?.[0] || "",
        stockItemId: stockItem?.id,
        itemName: cleanItemName,
        variant: resolvedVariantLabel,
        variantId: selectedOrderVariant?.id || orderForm.variantId || undefined,
        selectedColor: selectedOrderVariant?.color || orderForm.selectedColor || undefined,
        selectedSize: selectedOrderVariant?.size || orderForm.selectedSize || undefined,
        number: orderForm.number || "",
        printings: printingsList,
        printingTotalFee,
        quantity: orderQty,
        unitPrice: unitSell,
        costPrice: stockItem?.costPrice,
        subtotal: orderForm.subtotal || unitSell * orderQty,
        discountPercent: orderForm.discountPercent || 0,
        discountAmount: orderForm.discountAmount || 0,
        totalAmount: orderForm.total,
        paidAmount: orderForm.paid,
        delivered: orderForm.delivered,
        branch: playerObj?.branch || "",
      });

      if (orderForm.paid >= orderForm.total) {
        toast.success(
          `Order completed: Variant stock deducted and ${money(orderForm.paid)} recorded as Merchandise Revenue in Accounting.`,
        );
      } else if (orderForm.paid === 0) {
        toast.success(
          `Assigned on credit: Variant stock deducted, ${money(orderForm.total)} added to ${orderForm.player}'s balance and logged as Accounts Receivable - Merchandise.`,
        );
      } else {
        toast.success(
          `Order logged: Variant stock deducted, ${money(orderForm.paid)} Merchandise Revenue recorded, and ${money(orderForm.total - orderForm.paid)} added to player balance.`,
        );
      }
    }
    setOrderOpen(false);
  }

  function submitSupplier() {
    if (!supplierForm.name.trim()) {
      toast.error("Please enter a supplier name.");
      return;
    }
    update((d) =>
      editSupplier
        ? {
            ...d,
            suppliers: d.suppliers.map((s) =>
              s.id === editSupplier.id ? { ...s, ...supplierForm } : s,
            ),
          }
        : {
            ...d,
            suppliers: [{ ...supplierForm, id: `sup-${Date.now().toString(36)}` }, ...d.suppliers],
          },
    );
    toast.success(
      editSupplier
        ? `Supplier "${supplierForm.name}" updated.`
        : `Supplier "${supplierForm.name}" added.`,
    );
    setSupplierOpen(false);
  }

  function submitRestock() {
    if (!restockItem) return;
    const qty = Math.max(1, Math.floor(restockQty || 0));
    if (!qty || Number.isNaN(qty)) {
      toast.error("Please enter a valid stock quantity to add.");
      return;
    }

    if (restockVariants.length > 0) {
      const missingMeta = restockVariants.some((v) => !v.size.trim() || !v.color.trim());
      if (missingMeta) {
        toast.error("Please enter both Size and Color for every restock variant row.");
        return;
      }
      const sum = restockVariants.reduce((acc, v) => acc + Math.max(0, Number(v.quantity) || 0), 0);
      if (sum !== qty) {
        toast.error(
          `Mismatch: Restock variant quantities sum to ${sum}, which does not equal Total Purchased (${qty}). Adjust by ${Math.abs(qty - sum)} pcs.`,
        );
        return;
      }
    }

    const effectiveCost = restockItem.costPrice ?? restockItem.price * 0.5;
    update((d) => ({
      ...d,
      stock: d.stock.map((x) => {
        if (x.id !== restockItem.id) return x;
        if (restockVariants.length > 0) {
          const existingVariants = Array.isArray(x.variants) ? [...x.variants] : [];
          for (const rv of restockVariants) {
            const addQty = Math.max(0, Math.floor(Number(rv.quantity) || 0));
            if (addQty <= 0 && existingVariants.some((ev) => ev.id === rv.id)) continue;
            const matchIdx = existingVariants.findIndex(
              (ev) =>
                ev.id === rv.id ||
                (ev.size.trim().toLowerCase() === rv.size.trim().toLowerCase() &&
                  ev.color.trim().toLowerCase() === rv.color.trim().toLowerCase()),
            );
            if (matchIdx >= 0) {
              existingVariants[matchIdx] = {
                ...existingVariants[matchIdx],
                size: rv.size.trim(),
                color: rv.color.trim(),
                quantity: (Number(existingVariants[matchIdx].quantity) || 0) + addQty,
              };
            } else if (addQty > 0) {
              existingVariants.push({
                id:
                  rv.id ||
                  `var-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
                size: rv.size.trim(),
                color: rv.color.trim(),
                quantity: addQty,
              });
            }
          }
          const nextTotal = existingVariants.reduce(
            (sum, v) => sum + Math.max(0, Number(v.quantity) || 0),
            0,
          );
          return {
            ...x,
            variants: existingVariants,
            variant: formatVariantsSummary(existingVariants, x.variant),
            stock: nextTotal,
          };
        }
        return { ...x, stock: x.stock + qty };
      }),
      ledger: [
        {
          id: `l-${Date.now().toString(36)}`,
          date: new Date().toISOString().slice(0, 10),
          account: "Merchandise",
          category: "Merchandise",
          entry: `${restockItem.item} restock · ${qty} pcs`,
          type: "Expense" as const,
          amount: qty * effectiveCost,
          status: "Paid" as const,
          branch: restockItem.branch || userBranch || db.branches[0]?.name || "",
          note: `Purchased ${qty} units @ ${money(effectiveCost)}${
            restockVariants.length > 0
              ? ` (${restockVariants
                  .filter((v) => Number(v.quantity) > 0)
                  .map((v) => `${v.color} · ${v.size}: +${v.quantity}`)
                  .join(", ")})`
              : ""
          }`,
        },
        ...d.ledger,
      ],
    }));
    toast.success(`Added ${qty} units to ${restockItem.item} inventory.`);
    setRestockItem(null);
    setRestockQty(10);
    setRestockVariants([]);
  }

  function confirmDeleteMerchandise() {
    if (!deleteConfirmTarget) return;
    const { kind, id } = deleteConfirmTarget;
    setDeleteConfirmTarget(null);
    if (kind === "stock") {
      update((d) => ({ ...d, stock: d.stock.filter((x) => x.id !== id) }));
    } else if (kind === "order") {
      update((d) => {
        const order = d.orders.find((o) => o.id === id);
        if (!order) return { ...d, orders: d.orders.filter((x) => x.id !== id) };

        // 1. Restore the order's item quantity back to db.stock AND exact variant (unless already restocked)
        const orderAny = order as Order & {
          status?: string;
          restocked?: boolean;
        };
        const isCancelledOrReturned =
          orderAny.status === "Cancelled" ||
          orderAny.status === "Returned" ||
          orderAny.status === "cancelled" ||
          orderAny.status === "returned";
        const alreadyRestocked = Boolean(orderAny.restocked);
        const shouldRestoreStock = !(isCancelledOrReturned && alreadyRestocked);

        let updatedStock = d.stock;
        if (shouldRestoreStock) {
          const parseQty = (itemsStr: string, explicitQty?: number) => {
            if (typeof explicitQty === "number" && explicitQty > 0) return explicitQty;
            const match = (itemsStr || "").match(/\(x(\d+)\)|\bx(\d+)\b/i);
            if (match) {
              const parsed = parseInt(match[1] || match[2] || "1", 10);
              if (!Number.isNaN(parsed) && parsed > 0) return parsed;
            }
            return 1;
          };
          const orderQty = parseQty(order.items, order.quantity);

          const stockItem = d.stock.find(
            (s) =>
              (order.stockItemId && s.id === order.stockItemId) ||
              s.item.toLowerCase() === stripQtySuffix(order.items).toLowerCase() ||
              order.items.toLowerCase().includes(s.item.toLowerCase()),
          );

          if (stockItem) {
            updatedStock = d.stock.map((s) =>
              s.id === stockItem.id
                ? adjustStockItemVariants(
                    s,
                    -orderQty,
                    order.variantId,
                    order.selectedColor,
                    order.selectedSize,
                    order.variant,
                  )
                : s,
            );
          }
        }

        // 2. Deduct any unpaid balance (Math.max(0, order.total - order.paid)) from the linked player's balance in db.players
        const unpaidBalance = Math.max(0, (order.total || 0) - (order.paid || 0));
        let updatedPlayers = d.players;
        if (unpaidBalance > 0) {
          const linkedPlayer = d.players.find(
            (p) =>
              (order.playerId && p.id === order.playerId) ||
              (order.player && p.name.toLowerCase() === order.player.trim().toLowerCase()),
          );
          if (linkedPlayer) {
            updatedPlayers = d.players.map((p) =>
              p.id === linkedPlayer.id
                ? { ...p, balance: Math.max(0, (p.balance || 0) - unpaidBalance) }
                : p,
            );
          }
        }

        // 3. Remove all corresponding ledger entries in db.ledger where referenceId === order.id
        const updatedLedger = d.ledger.filter(
          (l) =>
            l.referenceId !== order.id &&
            l.orderId !== order.id &&
            !l.note?.includes(`Order #${order.id}`),
        );

        return {
          ...d,
          stock: updatedStock,
          players: updatedPlayers,
          ledger: updatedLedger,
          orders: d.orders.filter((x) => x.id !== id),
        };
      });
      toast.success("Order deleted and variant stock, player balance, and ledger reconciled.");
    } else if (kind === "supplier") {
      update((d) => ({ ...d, suppliers: d.suppliers.filter((x) => x.id !== id) }));
    }
  }

  return (
    <AppShell crumb="OPS / MERCHANDISE" title="Merchandise">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Items tracked" value={String(stock.length)} accent />
        <Stat label="Low stock" value={String(lowStock.length)} note="at or below reorder point" />
        <Stat
          label="Inventory cost"
          value={money(inventoryCostValue)}
          note={`retail value: ${money(salesValue)}`}
        />
        <Stat label="Unpaid orders" value={money(owed)} accent note="due from players" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel
          title="Inventory"
          meta="Cost price, selling price, margins and structured Size × Color stock matrix"
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCatalogueCSV(stock, db.academy?.name || "Vescio Vector")}
                title="Download complete catalogue with quantities, cost price and selling price as CSV"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-good" />
                <span>Catalogue CSV</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => downloadCataloguePDF(stock, db.academy?.name || "Vescio Vector")}
                title="Download complete catalogue with quantities, cost price and selling price as PDF"
              >
                <FileText className="w-3.5 h-3.5 text-court-400" />
                <span>Catalogue PDF</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={openManagePrinting}
                title="Manage custom printing labels and default fees"
              >
                <Printer className="w-3.5 h-3.5 text-court-300" />
                <span>Printing Fees</span>
              </Button>
              {canWriteMerchandise ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditItem(null);
                    setItemForm({ ...blankItem, variants: [] });
                    setItemOpen(true);
                  }}
                >
                  + New item
                </Button>
              ) : undefined}
            </div>
          }
        >
          <div className="border-b border-ink-800 px-4 py-3 w-full">
            <Search
              value={q}
              onChange={setQ}
              placeholder="Search items, colors, sizes, suppliers…"
            />
          </div>
          <Table
            head={
              <>
                <Th>ITEM &amp; VARIANTS</Th>
                <Th hide>SUPPLIER</Th>
                <Th>STOCK</Th>
                <Th hide>COST</Th>
                <Th>SELLING</Th>
                <Th hide>MARGIN</Th>
                <Th>
                  <span className="block text-right">ACTIONS</span>
                </Th>
              </>
            }
            footer={
              <Pagination
                page={stockPage}
                pageSize={pageSize}
                total={filtered.length}
                setPage={setStockPage}
              />
            }
          >
            {pagedStock.length === 0 ? (
              <EmptyState>No inventory matches this search.</EmptyState>
            ) : (
              pagedStock.map((s) => {
                const cost = s.costPrice ?? 0;
                const sell = s.sellingPrice ?? s.price;
                const margin = sell - cost;
                const marginPct = sell > 0 ? Math.round((margin / sell) * 100) : 0;
                const hasVariants = Array.isArray(s.variants) && s.variants.length > 0;
                return (
                  <Row key={s.id}>
                    <Td strong>
                      <div className="leading-tight space-y-1">
                        <div>{s.item}</div>
                        {hasVariants ? (
                          <div className="flex flex-wrap gap-1 pt-0.5">
                            {s.variants?.map((v) => (
                              <span
                                key={v.id}
                                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] ring-1 ${
                                  (Number(v.quantity) || 0) <= 0
                                    ? "bg-bad/10 text-bad ring-bad/30"
                                    : "bg-ink-850 text-ink-200 ring-ink-700"
                                }`}
                              >
                                <span className="text-court-300">{v.color}</span>
                                <span>·</span>
                                <span>{v.size}:</span>
                                <strong>{v.quantity}</strong>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <div className="font-mono text-[10px] text-ink-400">{s.variant}</div>
                        )}
                      </div>
                    </Td>
                    <Td hide>{s.supplier}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold">{s.stock}</span>
                        {s.stock <= s.reorder ? <Chip tone="warn">REORDER</Chip> : null}
                      </div>
                    </Td>
                    <Td hide>
                      <span className="font-mono text-xs text-ink-400">{money(cost)}</span>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs font-semibold text-ink-100">
                        {money(sell)}
                      </span>
                    </Td>
                    <Td hide>
                      <div className="font-mono text-[11px] leading-tight">
                        <span className={margin > 0 ? "text-good font-medium" : "text-ink-400"}>
                          {margin >= 0 ? `+${money(margin)}` : money(margin)}
                        </span>
                        <span className="text-[10px] text-ink-400 ml-1">({marginPct}%)</span>
                      </div>
                    </Td>
                    <Td right>
                      <RowActions
                        extra={
                          canWriteMerchandise ? (
                            <button
                              type="button"
                              onClick={() => {
                                setRestockItem(s);
                                const defaultAdd = 10;
                                setRestockQty(defaultAdd);
                                if (Array.isArray(s.variants) && s.variants.length > 0) {
                                  setRestockVariants(
                                    s.variants.map((v, idx) => ({
                                      ...v,
                                      quantity: idx === 0 ? defaultAdd : 0,
                                    })),
                                  );
                                } else {
                                  setRestockVariants([]);
                                }
                              }}
                              className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-court-500/10"
                            >
                              RESTOCK
                            </button>
                          ) : undefined
                        }
                        onEdit={
                          canWriteMerchandise
                            ? () => {
                                setEditItem(s);
                                const { id: _id, ...rest } = s;
                                const existingVariants = Array.isArray(rest.variants)
                                  ? rest.variants.map((v) => ({ ...v }))
                                  : [];
                                const computedStock =
                                  existingVariants.length > 0
                                    ? existingVariants.reduce(
                                        (sum, v) => sum + Math.max(0, Number(v.quantity) || 0),
                                        0,
                                      )
                                    : rest.stock;
                                setItemForm({
                                  ...rest,
                                  stock: computedStock,
                                  variants: existingVariants,
                                  costPrice: rest.costPrice ?? 0,
                                  sellingPrice: rest.sellingPrice || rest.price,
                                  price: rest.sellingPrice || rest.price,
                                });
                                setItemOpen(true);
                              }
                            : undefined
                        }
                        onDelete={
                          canDeleteMerchandise
                            ? () => {
                                setDeleteConfirmTarget({ kind: "stock", id: s.id, label: s.item });
                              }
                            : undefined
                        }
                      />
                    </Td>
                  </Row>
                );
              })
            )}
          </Table>
        </Panel>

        <Panel
          title="Player orders"
          meta="Variant POS, custom printing & delivery"
          action={
            canWriteMerchandise ? (
              <Button
                onClick={() => {
                  setEditOrder(null);
                  setOrderForm({
                    ...blankOrder,
                    player: db.players[0]?.name ?? "",
                    team: db.players[0]?.teams?.[0] ?? "",
                    printings: [],
                  });
                  setOrderOpen(true);
                }}
              >
                + New order
              </Button>
            ) : undefined
          }
        >
          {/* Search order by order number or player name */}
          <div className="border-b border-ink-800 px-3 py-2.5 flex items-center gap-2 bg-ink-900/40">
            <div className="relative flex-1">
              <input
                type="text"
                value={orderSearchInput}
                onChange={(e) => {
                  setOrderSearchInput(e.target.value);
                  if (!e.target.value) {
                    setOrderQ("");
                    setOrderPage(1);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setOrderQ(orderSearchInput.trim());
                    setOrderPage(1);
                  }
                }}
                placeholder="Search order # or player name…"
                className="w-full rounded bg-ink-900 px-3 py-1.5 font-ui text-xs text-ink-100 placeholder:text-ink-500 ring-1 ring-ink-700 focus:outline-none focus:ring-court-500"
              />
            </div>
            <Button
              variant="primary"
              className="h-8 px-3 text-xs bg-court-500 hover:bg-court-400 text-ink-950 font-bold shrink-0 flex items-center gap-1.5"
              onClick={() => {
                setOrderQ(orderSearchInput.trim());
                setOrderPage(1);
              }}
            >
              <SearchIcon className="w-3.5 h-3.5" />
              <span>Search</span>
            </Button>
            {orderQ && (
              <button
                type="button"
                onClick={() => {
                  setOrderSearchInput("");
                  setOrderQ("");
                  setOrderPage(1);
                }}
                className="text-xs font-mono text-ink-400 hover:text-ink-100 px-1 py-1"
                title="Clear search"
              >
                Clear
              </button>
            )}
          </div>

          <div className="divide-y divide-ink-800">
            {pagedOrders.length === 0 ? (
              <div className="px-4 py-10 text-center font-mono text-[11px] text-ink-400">
                {orderQ ? `No orders found matching "${orderQ}".` : "No orders yet."}
              </div>
            ) : (
              pagedOrders.map((o) => {
                const orderIdx = orders.indexOf(o) + 1;
                const orderPrintings = Array.isArray(o.printings) ? o.printings : [];
                const orderPrintFee =
                  o.printingTotalFee ??
                  orderPrintings.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
                const baseNet = Math.max(0, (o.total || 0) - orderPrintFee);
                return (
                  <div key={o.id} className="px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="text-sm font-medium text-ink-100 flex items-center gap-1.5">
                          <span className="font-mono text-xs font-bold text-court-400">
                            #{orderIdx}
                          </span>
                          <span className="truncate">{o.player}</span>
                          {o.team && (
                            <span className="font-normal text-ink-400 text-xs">({o.team})</span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-ink-300 flex flex-wrap items-center gap-1.5">
                          <span>{o.items}</span>
                          {(o.variant || (o.selectedColor && o.selectedSize)) && (
                            <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300 ring-1 ring-court-500/30">
                              {o.selectedColor && o.selectedSize
                                ? `${o.selectedColor} · ${o.selectedSize}`
                                : o.variant}
                            </span>
                          )}
                          {o.number ? <span>· #{o.number}</span> : null}
                          {o.discountPercent ? (
                            <span className="text-court-400">· {o.discountPercent}% off</span>
                          ) : null}
                        </div>
                        {orderPrintings.length > 0 && (
                          <div className="rounded bg-ink-900/70 px-2 py-1 border border-ink-800 text-[10px] font-mono text-ink-300 space-y-0.5">
                            <div className="text-ink-400">
                              Base: <strong className="text-ink-200">{money(baseNet)}</strong> +
                              Printing:{" "}
                              <strong className="text-court-300">{money(orderPrintFee)}</strong> ={" "}
                              <strong className="text-good">{money(o.total)}</strong>
                            </div>
                            <div className="flex flex-wrap gap-1 pt-0.5">
                              {orderPrintings.map((pr) => {
                                const txt = pr.customText || pr.details;
                                return (
                                  <span
                                    key={pr.id}
                                    className="rounded bg-ink-850 px-1.5 py-0.5 text-[9px] text-ink-200 ring-1 ring-ink-700 font-mono"
                                  >
                                    🖨️ {pr.label}
                                    {txt ? ` ("${txt}" ${money(pr.fee)})` : `: +${money(pr.fee)}`}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-xs font-bold text-ink-100">
                          {money(o.total)}
                        </div>
                        {o.discountPercent && o.discountPercent > 0 ? (
                          <div className="font-mono text-[9px] text-court-400">
                            saved{" "}
                            {money(o.discountAmount || (o.subtotal ? o.subtotal - baseNet : 0))}
                          </div>
                        ) : null}
                        <div
                          className={`font-mono text-[10px] ${
                            o.paid >= o.total ? "text-good" : "text-warn"
                          }`}
                        >
                          paid {money(o.paid)}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Chip tone={o.delivered ? "good" : "neutral"}>
                        {o.delivered ? "DELIVERED" : "PENDING DELIVERY"}
                      </Chip>
                      <button
                        type="button"
                        onClick={() => setReceiptOrder(o)}
                        className="rounded px-2 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-ink-850"
                      >
                        RECEIPT
                      </button>
                      {o.paid < o.total ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await settleMerchandiseOrder(o.id);
                            toast.success(
                              `Order for ${o.player} marked as paid. ${money(o.total - o.paid)} recorded as Merchandise Revenue in Accounting and deducted from player balance.`,
                            );
                          }}
                          className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-court-500/10"
                        >
                          MARK PAID
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() =>
                          update((d) => ({
                            ...d,
                            orders: d.orders.map((x) =>
                              x.id === o.id ? { ...x, delivered: !x.delivered } : x,
                            ),
                          }))
                        }
                        className="rounded px-2 py-1 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-850"
                      >
                        {o.delivered ? "UNDO DELIVERY" : "MARK DELIVERED"}
                      </button>
                      <RowActions
                        onEdit={
                          canWriteMerchandise
                            ? () => {
                                setEditOrder(o);
                                const { id: _id, ...rest } = o;
                                const parsedQty =
                                  rest.quantity ||
                                  (() => {
                                    const m = (rest.items || "").match(/\(x(\d+)\)/i);
                                    return m ? Math.max(1, parseInt(m[1], 10) || 1) : 1;
                                  })();
                                const printList = Array.isArray(rest.printings)
                                  ? rest.printings.map((p) => ({ ...p }))
                                  : [];
                                const printFee =
                                  rest.printingTotalFee ??
                                  printList.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
                                const baseSub =
                                  rest.subtotal ?? Math.max(0, (rest.total || 0) - printFee);
                                setOrderForm({
                                  ...rest,
                                  items: stripQtySuffix(rest.items),
                                  quantity: parsedQty,
                                  unitPrice:
                                    rest.unitPrice ??
                                    (parsedQty > 0 ? baseSub / parsedQty : baseSub),
                                  subtotal: baseSub,
                                  number: rest.number ?? "",
                                  team: rest.team ?? "",
                                  variant: rest.variant ?? "",
                                  variantId: rest.variantId ?? "",
                                  selectedColor: rest.selectedColor ?? "",
                                  selectedSize: rest.selectedSize ?? "",
                                  printings: printList,
                                  printingTotalFee: printFee,
                                });
                                setOrderOpen(true);
                              }
                            : undefined
                        }
                        onDelete={
                          canDeleteMerchandise
                            ? () => {
                                setDeleteConfirmTarget({
                                  kind: "order",
                                  id: o.id,
                                  label: `order for ${o.player}`,
                                });
                              }
                            : undefined
                        }
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          {filteredOrders.length > 0 ? (
            <div className="border-t border-ink-800 px-4 py-3">
              <Pagination
                page={orderPage}
                pageSize={pageSize}
                total={filteredOrders.length}
                setPage={setOrderPage}
              />
            </div>
          ) : null}
        </Panel>
      </div>

      <div className="mt-4">
        <Panel
          title="Suppliers"
          meta="Manage merchandise suppliers and contact info"
          action={
            canWriteMerchandise ? (
              <Button
                onClick={() => {
                  setEditSupplier(null);
                  setSupplierForm(blankSupplier);
                  setSupplierOpen(true);
                }}
              >
                + New supplier
              </Button>
            ) : undefined
          }
        >
          <Table
            head={
              <>
                <Th>NAME</Th>
                <Th>CONTACT</Th>
                <Th>EMAIL / PHONE</Th>
                <Th>
                  <span className="block text-right">ACTIONS</span>
                </Th>
              </>
            }
          >
            {suppliers.length === 0 ? (
              <EmptyState>No suppliers found.</EmptyState>
            ) : (
              suppliers.map((s) => (
                <Row key={s.id}>
                  <Td strong>{s.name}</Td>
                  <Td>{s.contact || "—"}</Td>
                  <Td>
                    {s.email && <div className="text-xs text-ink-300">{s.email}</div>}
                    {s.phone && <div className="text-xs text-ink-300">{s.phone}</div>}
                    {!s.email && !s.phone && "—"}
                  </Td>
                  <Td right>
                    <RowActions
                      onEdit={
                        canWriteMerchandise
                          ? () => {
                              setEditSupplier(s);
                              const { id: _id, ...rest } = s;
                              setSupplierForm(rest);
                              setSupplierOpen(true);
                            }
                          : undefined
                      }
                      onDelete={
                        canDeleteMerchandise
                          ? () => {
                              setDeleteConfirmTarget({
                                kind: "supplier",
                                id: s.id,
                                label: `supplier ${s.name}`,
                              });
                            }
                          : undefined
                      }
                    />
                  </Td>
                </Row>
              ))
            )}
          </Table>
        </Panel>
      </div>

      {/* NEW / EDIT MERCHANDISE ITEM MODAL (Point 3: Structured Variant Matrix & Strict Sum Validation) */}
      <Modal
        open={itemOpen}
        title={editItem ? `Edit ${editItem.item}` : "New inventory item"}
        onClose={() => setItemOpen(false)}
        onSubmit={submitItem}
        submitLabel={
          hasItemVariantMismatch
            ? `Blocked: Fix ${Math.abs(itemTotalPurchased - itemVariantsSum)} pcs Mismatch`
            : editItem
              ? "Save changes"
              : "Add item"
        }
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Item">
            <Input
              value={itemForm.item}
              onChange={(v) => setItemForm({ ...itemForm, item: v })}
              list="items-list"
              placeholder="e.g. Game jersey · home"
            />
          </Field>
          <Field label="Supplier">
            <Select
              value={itemForm.supplier}
              onChange={(v) => setItemForm({ ...itemForm, supplier: v })}
              options={["", ...suppliers.map((s) => s.name)]}
            />
          </Field>
          <Field
            label="Total Purchased / Total Stock Quantity (pcs)"
            hint="Must equal exact sum of all Color × Size variants below"
          >
            <Input
              type="number"
              value={String(itemForm.stock)}
              onChange={(v) =>
                setItemForm({ ...itemForm, stock: Math.max(0, Math.floor(Number(v) || 0)) })
              }
            />
          </Field>
          <Field label="Reorder point">
            <Input
              type="number"
              value={String(itemForm.reorder)}
              onChange={(v) => setItemForm({ ...itemForm, reorder: Number(v) || 0 })}
            />
          </Field>

          {/* Point 3: Structured Variant Matrix (Size + Color + Quantity) */}
          <div className="sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-ink-100">
                  Structured Variant Matrix (Size + Color + Quantity)
                </div>
                <div className="text-[11px] font-mono text-ink-400">
                  Break down your total purchased stock ({itemTotalPurchased} pcs) by Size and Color
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  const remaining = Math.max(0, itemTotalPurchased - itemVariantsSum);
                  const nextVar: MerchVariant = {
                    id: `var-${Date.now().toString(36)}-${(itemForm.variants || []).length}`,
                    size: "Large",
                    color: "Blue",
                    quantity: remaining > 0 ? remaining : 10,
                  };
                  setItemForm({
                    ...itemForm,
                    variants: [...(itemForm.variants || []), nextVar],
                  });
                }}
              >
                + Add Variant Row
              </Button>
            </div>

            {/* Quick Add Size & Color Chips */}
            <div className="space-y-1.5 pt-1 border-t border-ink-850">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-mono text-ink-400 mr-1">Quick Add Size:</span>
                {PRESET_SIZES.map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => {
                      const remaining = Math.max(0, itemTotalPurchased - itemVariantsSum);
                      const lastColor =
                        itemVariantsList[itemVariantsList.length - 1]?.color || "Blue";
                      const nextVar: MerchVariant = {
                        id: `var-${Date.now().toString(36)}-${itemVariantsList.length}`,
                        size: sz,
                        color: lastColor,
                        quantity: remaining > 0 ? remaining : 10,
                      };
                      setItemForm({
                        ...itemForm,
                        variants: [...itemVariantsList, nextVar],
                      });
                    }}
                    className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-court-500/15 hover:text-court-300"
                  >
                    + {sz}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-[10px] font-mono text-ink-400 mr-1">Quick Colors:</span>
                {PRESET_COLORS.map((clr) => (
                  <span
                    key={clr}
                    className="rounded bg-ink-950 px-1.5 py-0.5 font-mono text-[9px] text-ink-400 border border-ink-850"
                  >
                    {clr}
                  </span>
                ))}
              </div>
            </div>

            {itemVariantsList.length === 0 ? (
              <div className="rounded bg-ink-950/60 p-3 border border-ink-850 text-xs text-ink-400 font-mono">
                No structured variants added yet. Click <strong>+ Add Variant Row</strong> or a
                quick size chip above to define <code>[Size | Color | Quantity]</code> breakdown.
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] font-mono uppercase text-ink-400 px-1">
                  <div className="sm:col-span-4">Size</div>
                  <div className="sm:col-span-4">Color</div>
                  <div className="sm:col-span-3">Quantity (pcs)</div>
                  <div className="sm:col-span-1 text-right">Del</div>
                </div>
                {itemVariantsList.map((v, idx) => (
                  <div
                    key={v.id || idx}
                    className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-lg bg-ink-950/80 p-2.5 sm:p-2 border border-ink-850"
                  >
                    <div className="col-span-1 sm:col-span-4">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Size
                      </span>
                      <Input
                        value={v.size}
                        onChange={(val) => {
                          const updated = itemVariantsList.map((row, i) =>
                            i === idx ? { ...row, size: val } : row,
                          );
                          setItemForm({ ...itemForm, variants: updated });
                        }}
                        list="preset-sizes-list"
                        placeholder="Size (e.g. Large)"
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-4">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Color
                      </span>
                      <Input
                        value={v.color}
                        onChange={(val) => {
                          const updated = itemVariantsList.map((row, i) =>
                            i === idx ? { ...row, color: val } : row,
                          );
                          setItemForm({ ...itemForm, variants: updated });
                        }}
                        list="preset-colors-list"
                        placeholder="Color (e.g. Blue)"
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-3">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Qty (pcs)
                      </span>
                      <Input
                        type="number"
                        value={String(v.quantity)}
                        onChange={(val) => {
                          const qty = Math.max(0, Math.floor(Number(val) || 0));
                          const updated = itemVariantsList.map((row, i) =>
                            i === idx ? { ...row, quantity: qty } : row,
                          );
                          setItemForm({ ...itemForm, variants: updated });
                        }}
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-1 flex items-end justify-end sm:block text-right pt-3 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = itemVariantsList.filter((_, i) => i !== idx);
                          setItemForm({ ...itemForm, variants: updated });
                        }}
                        className="rounded px-2.5 py-1.5 font-mono text-xs text-bad hover:bg-bad/15"
                        title="Remove variant row"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Live Reconciliation Bar */}
            <div
              className={`rounded-lg p-2.5 border font-mono text-xs flex flex-wrap items-center justify-between gap-2 ${
                itemVariantsList.length === 0
                  ? "bg-ink-950 border-ink-800 text-ink-300"
                  : hasItemVariantMismatch
                    ? "bg-bad/15 border-bad/40 text-bad"
                    : "bg-good/15 border-good/40 text-good"
              }`}
            >
              <div>
                <strong>
                  Variants Breakdown Sum: {itemVariantsSum} / {itemTotalPurchased} pcs
                </strong>
                {itemVariantsList.length > 0 && !hasItemVariantMismatch && (
                  <span className="ml-2 text-[11px]">✓ 100% Reconciled</span>
                )}
              </div>
              {hasItemVariantMismatch && (
                <button
                  type="button"
                  onClick={() => setItemForm({ ...itemForm, stock: itemVariantsSum })}
                  className="rounded bg-ink-900 px-2 py-1 text-[10px] font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-800"
                >
                  Set Total Purchased = {itemVariantsSum} pcs
                </button>
              )}
            </div>

            {hasItemVariantMismatch && (
              <div className="rounded-lg bg-bad/20 border border-bad/50 p-3 text-xs font-mono text-bad leading-relaxed">
                ⚠️ Mismatch: Variant quantities sum to {itemVariantsSum}, which does not equal the
                Total Purchased ({itemTotalPurchased}). Adjust variant quantities or total by{" "}
                {Math.abs(itemTotalPurchased - itemVariantsSum)} pcs to continue.
              </div>
            )}
          </div>

          <Field
            label="Variant Summary Note (Optional)"
            hint="Auto-generated from variants matrix when variants are present"
          >
            <Input
              value={
                itemVariantsList.length > 0
                  ? formatVariantsSummary(itemVariantsList, itemForm.variant)
                  : itemForm.variant
              }
              onChange={(v) => setItemForm({ ...itemForm, variant: v })}
              placeholder="e.g. Navy · S–XL, Size 7"
            />
          </Field>

          <div className="sm:col-span-2 grid grid-cols-2 gap-3 p-3 rounded-lg bg-ink-900/60 ring-1 ring-ink-800">
            <Field label="Cost Price" hint={`Academy cost (${db.academy?.currency || "USD"})`}>
              <Input
                type="number"
                value={String(itemForm.costPrice ?? 0)}
                onChange={(v) => {
                  const cost = Number(v) || 0;
                  setItemForm({ ...itemForm, costPrice: cost });
                }}
              />
            </Field>
            <Field
              label="Selling Price"
              hint={`Retail price to player (${db.academy?.currency || "USD"})`}
            >
              <Input
                type="number"
                value={String(itemForm.sellingPrice || itemForm.price || 0)}
                onChange={(v) => {
                  const sell = Number(v) || 0;
                  setItemForm({ ...itemForm, sellingPrice: sell, price: sell });
                }}
              />
            </Field>
            <div className="col-span-2 flex items-center justify-between text-[11px] font-mono border-t border-ink-800/80 pt-2 text-ink-300">
              <span>Unit Profit Margin:</span>
              {(() => {
                const cost = itemForm.costPrice ?? 0;
                const sell = itemForm.sellingPrice || itemForm.price || 0;
                const margin = sell - cost;
                const pct = sell > 0 ? Math.round((margin / sell) * 100) : 0;
                return (
                  <span className={`font-semibold ${margin > 0 ? "text-good" : "text-warn"}`}>
                    {margin >= 0 ? `+${money(margin)}` : money(margin)} ({pct}%)
                  </span>
                );
              })()}
            </div>
          </div>
        </div>
      </Modal>

      {/* SELL / NEW ORDER MODAL (Point 4: Mandatory Variant Selection & Multi-Printing Fee Engine) */}
      <Modal
        open={orderOpen}
        title={editOrder ? `Edit order · ${editOrder.player}` : "New Merchandise Sale / Order"}
        onClose={() => setOrderOpen(false)}
        onSubmit={submitOrder}
        submitLabel={editOrder ? "Save changes" : `Complete Order (${money(orderForm.total)})`}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Player">
            <Input
              value={orderForm.player}
              onChange={(v) => {
                const matched = db.players.find(
                  (p) => p.name.toLowerCase() === v.trim().toLowerCase(),
                );
                setOrderForm({
                  ...orderForm,
                  player: v,
                  playerId: matched?.id,
                  team: matched?.teams?.[0] || orderForm.team || "",
                });
              }}
              list="players-list"
              placeholder="Select or enter player"
            />
          </Field>
          <Field label="Team">
            <Input
              value={orderForm.team ?? ""}
              onChange={(v) => setOrderForm({ ...orderForm, team: v })}
              list="teams-list"
              placeholder="Team name"
            />
          </Field>
          <Field label="Merchandise Item" hint="Select from catalog to deduct stock">
            <Input
              value={orderForm.items}
              onChange={(v) => {
                const cleanName = stripQtySuffix(v).toLowerCase();
                const matchedStock = db.stock.find(
                  (s) =>
                    s.item.toLowerCase() === cleanName || cleanName.includes(s.item.toLowerCase()),
                );
                const unitPrice = matchedStock?.sellingPrice ?? matchedStock?.price ?? 0;
                const firstAvailVariant = matchedStock?.variants?.find(
                  (vr) => (Number(vr.quantity) || 0) > 0,
                );
                setOrderForm(
                  recomputeOrderPricing({
                    items: v,
                    stockItemId: matchedStock?.id,
                    unitPrice,
                    variantId: firstAvailVariant?.id || "",
                    selectedColor: firstAvailVariant?.color || "",
                    selectedSize: firstAvailVariant?.size || "",
                    variant: firstAvailVariant
                      ? `${firstAvailVariant.color} · ${firstAvailVariant.size}`
                      : matchedStock?.variant || "",
                  }),
                );
              }}
              placeholder="Jersey home, Training Ball, Shorts..."
              list="items-list"
            />
          </Field>
          <Field label="Quantity (pcs)" hint="Units to purchase">
            <Input
              type="number"
              value={String(orderForm.quantity ?? 1)}
              onChange={(v) => {
                const qty = Math.max(1, Math.floor(Number(v) || 1));
                setOrderForm(recomputeOrderPricing({ quantity: qty }));
              }}
            />
          </Field>

          {/* Point 4: Mandatory Variant Selection When Selling an Item with Variants */}
          {itemHasStructuredVariants && selectedOrderStockItem ? (
            <div className="sm:col-span-2 rounded-lg border border-court-500/30 bg-court-950/20 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-xs font-semibold text-court-300">
                    Mandatory Variant Selection (Color &amp; Size) *
                  </span>
                  <span className="block text-[11px] font-mono text-ink-400">
                    Select exact Color and Size to verify stock and deduct from variant inventory
                  </span>
                </div>
                {selectedOrderVariant ? (
                  <span
                    className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${
                      (orderForm.quantity || 1) <= selectedOrderVariant.quantity
                        ? "bg-good/15 text-good ring-1 ring-good/30"
                        : "bg-bad/15 text-bad ring-1 ring-bad/30"
                    }`}
                  >
                    {selectedOrderVariant.color} — {selectedOrderVariant.size} (
                    {selectedOrderVariant.quantity} in stock)
                  </span>
                ) : (
                  <span className="rounded bg-bad/15 px-2 py-0.5 font-mono text-xs text-bad ring-1 ring-bad/30">
                    Select Color &amp; Size Required
                  </span>
                )}
              </div>

              {/* Interactive Variant Pills */}
              <div className="flex flex-wrap gap-1.5">
                {selectedOrderStockItem.variants?.map((v) => {
                  const isSelected =
                    selectedOrderVariant?.id === v.id ||
                    (orderForm.selectedColor === v.color && orderForm.selectedSize === v.size);
                  const outOfStock = (Number(v.quantity) || 0) <= 0;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        setOrderForm({
                          ...orderForm,
                          variantId: v.id,
                          selectedColor: v.color,
                          selectedSize: v.size,
                          variant: `${v.color} · ${v.size}`,
                        });
                      }}
                      className={`rounded-md px-2.5 py-1.5 font-mono text-xs transition flex items-center gap-1.5 ${
                        isSelected
                          ? "bg-court-500 text-ink-950 font-bold ring-2 ring-court-300"
                          : outOfStock
                            ? "bg-ink-900/50 text-ink-500 ring-1 ring-ink-800 opacity-60"
                            : "bg-ink-900 text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                      }`}
                    >
                      <span>
                        {v.color} — {v.size}
                      </span>
                      <span
                        className={`text-[10px] px-1 rounded ${
                          isSelected
                            ? "bg-ink-950/20 text-ink-950"
                            : outOfStock
                              ? "text-bad"
                              : "text-court-300"
                        }`}
                      >
                        ({v.quantity} in stock)
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Explicit Color & Size Selectors */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <Field label="Select Color *">
                  <Select
                    value={orderForm.selectedColor || ""}
                    onChange={(colorVal) => {
                      const matchingSizeVariant =
                        selectedOrderStockItem.variants?.find(
                          (v) =>
                            v.color === colorVal &&
                            v.size === (orderForm.selectedSize || "") &&
                            v.quantity > 0,
                        ) || selectedOrderStockItem.variants?.find((v) => v.color === colorVal);
                      setOrderForm({
                        ...orderForm,
                        selectedColor: colorVal,
                        selectedSize: matchingSizeVariant?.size || orderForm.selectedSize || "",
                        variantId: matchingSizeVariant?.id || "",
                        variant: matchingSizeVariant
                          ? `${matchingSizeVariant.color} · ${matchingSizeVariant.size}`
                          : `${colorVal} · ${orderForm.selectedSize || ""}`,
                      });
                    }}
                    options={[
                      "",
                      ...Array.from(
                        new Set((selectedOrderStockItem.variants || []).map((v) => v.color)),
                      ),
                    ]}
                  />
                </Field>
                <Field label="Select Size *">
                  <Select
                    value={orderForm.selectedSize || ""}
                    onChange={(sizeVal) => {
                      const matchingVariant =
                        selectedOrderStockItem.variants?.find(
                          (v) => v.size === sizeVal && v.color === (orderForm.selectedColor || ""),
                        ) || selectedOrderStockItem.variants?.find((v) => v.size === sizeVal);
                      setOrderForm({
                        ...orderForm,
                        selectedSize: sizeVal,
                        selectedColor: matchingVariant?.color || orderForm.selectedColor || "",
                        variantId: matchingVariant?.id || "",
                        variant: matchingVariant
                          ? `${matchingVariant.color} · ${matchingVariant.size}`
                          : `${orderForm.selectedColor || ""} · ${sizeVal}`,
                      });
                    }}
                    options={[
                      "",
                      ...Array.from(
                        new Set(
                          (selectedOrderStockItem.variants || [])
                            .filter(
                              (v) =>
                                !orderForm.selectedColor || v.color === orderForm.selectedColor,
                            )
                            .map((v) => v.size),
                        ),
                      ),
                    ]}
                  />
                </Field>
              </div>

              {selectedOrderVariant &&
                (orderForm.quantity || 1) > (Number(selectedOrderVariant.quantity) || 0) && (
                  <div className="rounded bg-bad/20 border border-bad/40 p-2.5 text-xs font-mono text-bad">
                    ⚠️ Requested quantity ({orderForm.quantity || 1} pcs) exceeds available stock
                    for {selectedOrderVariant.color} — {selectedOrderVariant.size} (
                    {selectedOrderVariant.quantity} in stock).
                  </div>
                )}
            </div>
          ) : (
            <Field label="Variant" hint="Size, color, etc.">
              <Input
                value={orderForm.variant ?? ""}
                onChange={(v) => setOrderForm({ ...orderForm, variant: v })}
                placeholder="e.g. Size M, Size 5"
              />
            </Field>
          )}

          <Field label="Shirt number (Optional)">
            <Input
              value={orderForm.number ?? ""}
              onChange={(v) => setOrderForm({ ...orderForm, number: v })}
              placeholder="Optional # (e.g. 10)"
            />
          </Field>

          {/* Point 4: Multiple Custom Printings with Per-Printing Fees */}
          <div className="sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-ink-100">
                  Add Custom Printing / Customization
                </div>
                <div className="text-[11px] font-mono text-ink-400">
                  Add one or multiple custom printings (Name, Number, Sponsor Patch) with
                  per-printing fees
                </div>
              </div>
              <span className="font-mono text-xs font-semibold text-court-300">
                Printing Fees: +{money(orderForm.printingTotalFee || 0)}
              </span>
            </div>

            {/* 1-by-1 Printing Preset Buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {activePrintingOptions.map((preset) => (
                <button
                  key={preset.id || preset.label}
                  type="button"
                  onClick={() => {
                    const isNumber = preset.label.toLowerCase().includes("number");
                    const initialText = isNumber ? orderForm.number || "" : "";
                    const newPrint: MerchPrintingItem = {
                      id: `prt-${Date.now().toString(36)}-${(orderForm.printings || []).length}`,
                      label: preset.label,
                      details: initialText,
                      customText: initialText,
                      fee: preset.defaultFee,
                    };
                    setOrderForm(
                      recomputeOrderPricing({
                        printings: [...(orderForm.printings || []), newPrint],
                      }),
                    );
                  }}
                  className="rounded bg-ink-850 px-2.5 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-700 hover:bg-court-500/15"
                >
                  + Add {preset.label} ({money(preset.defaultFee)})
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const newPrint: MerchPrintingItem = {
                    id: `prt-${Date.now().toString(36)}-${(orderForm.printings || []).length}`,
                    label: "Custom Printing",
                    details: "",
                    customText: "",
                    fee: 5,
                  };
                  setOrderForm(
                    recomputeOrderPricing({
                      printings: [...(orderForm.printings || []), newPrint],
                    }),
                  );
                }}
                className="rounded bg-court-500/10 px-2.5 py-1 font-mono text-[10px] text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20"
              >
                + Add Custom Printing Row
              </button>
            </div>

            {(orderForm.printings || []).length > 0 && (
              <div className="space-y-2 pt-1">
                <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] font-mono uppercase text-ink-400 px-1">
                  <div className="sm:col-span-5">Printing Type / Label</div>
                  <div className="sm:col-span-4">Text / Number Details</div>
                  <div className="sm:col-span-2">Fee ($)</div>
                  <div className="sm:col-span-1 text-right">Del</div>
                </div>
                {(orderForm.printings || []).map((pr, idx) => (
                  <div
                    key={pr.id || idx}
                    className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-lg bg-ink-950/80 p-2.5 sm:p-2 border border-ink-850"
                  >
                    <div className="col-span-2 sm:col-span-5">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Printing Type / Label
                      </span>
                      <Input
                        value={pr.label}
                        onChange={(val) => {
                          const updated = (orderForm.printings || []).map((row, i) =>
                            i === idx ? { ...row, label: val } : row,
                          );
                          setOrderForm(recomputeOrderPricing({ printings: updated }));
                        }}
                        placeholder="e.g. Player Name"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-4">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Text / Number Details
                      </span>
                      <Input
                        value={pr.customText ?? pr.details ?? ""}
                        onChange={(val) => {
                          const updated = (orderForm.printings || []).map((row, i) =>
                            i === idx ? { ...row, details: val, customText: val } : row,
                          );
                          setOrderForm(recomputeOrderPricing({ printings: updated }));
                        }}
                        placeholder="e.g. THEO or 10"
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-2">
                      <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                        Fee ($)
                      </span>
                      <Input
                        type="number"
                        value={String(pr.fee)}
                        onChange={(val) => {
                          const fee = Math.max(0, Number(val) || 0);
                          const updated = (orderForm.printings || []).map((row, i) =>
                            i === idx ? { ...row, fee } : row,
                          );
                          setOrderForm(recomputeOrderPricing({ printings: updated }));
                        }}
                      />
                    </div>
                    <div className="col-span-1 sm:col-span-1 flex items-end justify-end sm:block text-right pt-3 sm:pt-0">
                      <button
                        type="button"
                        onClick={() => {
                          const updated = (orderForm.printings || []).filter((_, i) => i !== idx);
                          setOrderForm(recomputeOrderPricing({ printings: updated }));
                        }}
                        className="rounded px-2.5 py-1.5 font-mono text-xs text-bad hover:bg-bad/15"
                        title="Remove printing line"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sm:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-ink-900/60 ring-1 ring-ink-800">
            <Field label="Unit Selling Price" hint={`Subtotal: ${money(orderForm.subtotal || 0)}`}>
              <Input
                type="number"
                value={String(orderForm.unitPrice ?? orderForm.subtotal ?? orderForm.total)}
                onChange={(v) => {
                  const unit = Math.max(0, Number(v) || 0);
                  setOrderForm(recomputeOrderPricing({ unitPrice: unit }));
                }}
              />
            </Field>
            <Field label="Discount (%)" hint="Percent off base item">
              <div className="space-y-1.5">
                <Input
                  type="number"
                  value={String(orderForm.discountPercent ?? 0)}
                  onChange={(v) => {
                    const discount = Math.min(100, Math.max(0, Number(v) || 0));
                    setOrderForm(recomputeOrderPricing({ discountPercent: discount }));
                  }}
                />
                <div className="flex gap-1">
                  {[0, 5, 10, 15, 20].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setOrderForm(recomputeOrderPricing({ discountPercent: d }))}
                      className={`text-[9px] px-1.5 py-0.5 rounded font-mono ${
                        (orderForm.discountPercent ?? 0) === d
                          ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                          : "bg-ink-800 text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      {d}%
                    </button>
                  ))}
                </div>
              </div>
            </Field>
            <Field label="Total Transaction" hint="Base Item(s) + Printing Fees">
              <div className="h-9 flex items-center px-3 rounded-md bg-ink-850 ring-1 ring-ink-700 font-mono text-sm font-semibold text-good">
                {money(orderForm.total)}
              </div>
            </Field>

            {/* Itemized Breakdown Strip */}
            <div className="sm:col-span-3 border-t border-ink-800 pt-2.5 flex flex-wrap items-center justify-between gap-2 font-mono text-xs text-ink-300">
              <span>
                Base Item(s):{" "}
                <strong>
                  {money(Math.max(0, (orderForm.subtotal || 0) - (orderForm.discountAmount || 0)))}
                </strong>
                {(orderForm.discountPercent || 0) > 0 && (
                  <span className="text-court-400 ml-1">
                    (-{money(orderForm.discountAmount || 0)} discount)
                  </span>
                )}
              </span>
              <span>+</span>
              <span>
                Printing Fees ({(orderForm.printings || []).length}):{" "}
                <strong className="text-court-300">{money(orderForm.printingTotalFee || 0)}</strong>
              </span>
              <span>=</span>
              <span className="text-good font-bold">
                Total Transaction: {money(orderForm.total)}
              </span>
            </div>
          </div>

          <div className="sm:col-span-2 space-y-2 rounded-lg bg-ink-900/60 p-3 ring-1 ring-ink-800">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink-200">Payment settlement</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOrderForm({ ...orderForm, paid: orderForm.total })}
                  className={`px-2 py-0.5 font-mono text-[10px] rounded transition ${
                    orderForm.paid >= orderForm.total && orderForm.total > 0
                      ? "bg-good/20 text-good ring-1 ring-good/40"
                      : "bg-ink-800 text-ink-300 hover:text-ink-100"
                  }`}
                >
                  PAID IN FULL
                </button>
                <button
                  type="button"
                  onClick={() => setOrderForm({ ...orderForm, paid: 0 })}
                  className={`px-2 py-0.5 font-mono text-[10px] rounded transition ${
                    orderForm.paid === 0
                      ? "bg-warn/20 text-warn ring-1 ring-warn/40"
                      : "bg-ink-800 text-ink-300 hover:text-ink-100"
                  }`}
                >
                  ON CREDIT (UNPAID)
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <Field label="Amount Paid" hint="Immediate Revenue">
                <Input
                  type="number"
                  value={String(orderForm.paid)}
                  onChange={(v) => setOrderForm({ ...orderForm, paid: Number(v) || 0 })}
                />
              </Field>
              <Field label="Unpaid Balance" hint="Accounts Receivable">
                <Input
                  type="number"
                  value={String(Math.max(0, orderForm.total - orderForm.paid))}
                  onChange={(v) => {
                    const unpaid = Number(v) || 0;
                    setOrderForm({ ...orderForm, paid: Math.max(0, orderForm.total - unpaid) });
                  }}
                />
              </Field>
            </div>
            <div className="text-[11px] text-ink-400 font-mono">
              {orderForm.paid >= orderForm.total ? (
                <span className="text-good">
                  ✓ Full amount ({money(orderForm.total)}) will be booked into Accounting under{" "}
                  <strong>Merchandise Revenue</strong>.
                </span>
              ) : orderForm.paid === 0 ? (
                <span className="text-warn">
                  ⚠ Full amount ({money(orderForm.total)}) will increase{" "}
                  <strong>{orderForm.player || "Player"}</strong>&apos;s balance and be tracked as{" "}
                  <strong>Accounts Receivable - Merchandise</strong>.
                </span>
              ) : (
                <span className="text-court-300">
                  ℹ {money(orderForm.paid)} booked as Merchandise Revenue,{" "}
                  {money(orderForm.total - orderForm.paid)} added to player&apos;s balance.
                </span>
              )}
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={supplierOpen}
        title={editSupplier ? `Edit ${editSupplier.name}` : "New supplier"}
        onClose={() => setSupplierOpen(false)}
        onSubmit={submitSupplier}
        submitLabel={editSupplier ? "Save changes" : "Add supplier"}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={supplierForm.name}
              onChange={(v) => setSupplierForm({ ...supplierForm, name: v })}
            />
          </Field>
          <Field label="Contact person">
            <Input
              value={supplierForm.contact}
              onChange={(v) => setSupplierForm({ ...supplierForm, contact: v })}
            />
          </Field>
          <Field label="Email">
            <Input
              value={supplierForm.email}
              onChange={(v) => setSupplierForm({ ...supplierForm, email: v })}
            />
          </Field>
          <Field label="Phone">
            <Input
              value={supplierForm.phone}
              onChange={(v) => setSupplierForm({ ...supplierForm, phone: v })}
            />
          </Field>
        </div>
      </Modal>

      <datalist id="items-list">
        {Array.from(new Set(stock.map((s) => s.item))).map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <datalist id="preset-sizes-list">
        {PRESET_SIZES.map((sz) => (
          <option key={sz} value={sz} />
        ))}
      </datalist>
      <datalist id="preset-colors-list">
        {PRESET_COLORS.map((clr) => (
          <option key={clr} value={clr} />
        ))}
      </datalist>
      <datalist id="teams-list">
        {db.teams.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
      <datalist id="players-list">
        {db.players.map((p) => (
          <option key={p.id} value={p.name} />
        ))}
      </datalist>

      <Modal
        open={Boolean(deleteConfirmTarget)}
        title="Confirm deletion"
        meta={deleteConfirmTarget ? `Delete ${deleteConfirmTarget.label}` : undefined}
        onClose={() => setDeleteConfirmTarget(null)}
        onSubmit={confirmDeleteMerchandise}
        submitLabel="Delete"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-ink-100">{deleteConfirmTarget?.label}</span>? This
          action cannot be undone.
        </div>
      </Modal>

      {/* Restock Quantity & Variant Matrix Modal */}
      <Modal
        title={restockItem ? `Restock: ${restockItem.item}` : "Restock Inventory"}
        open={Boolean(restockItem)}
        onClose={() => {
          setRestockItem(null);
          setRestockVariants([]);
        }}
        wide
      >
        {restockItem && (
          <div className="space-y-4 p-4">
            <div className="text-xs text-ink-300">
              Current stock level:{" "}
              <strong className="text-court-400 font-mono">{restockItem.stock}</strong> units. Enter
              total purchased quantity to add to inventory:
            </div>
            <Field label="Total Purchased / Restock Quantity (Units)">
              <Input
                type="number"
                value={String(restockQty)}
                onChange={(v) => setRestockQty(Math.max(1, parseInt(v, 10) || 0))}
                placeholder="10"
                autoFocus
              />
            </Field>

            {/* Restock Variant Breakdown */}
            <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-3.5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-ink-100">
                    Restock Variant Breakdown (Size + Color + Add Quantity)
                  </div>
                  <div className="text-[11px] font-mono text-ink-400">
                    Specify how many units of each Size &amp; Color are being added
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const rem = Math.max(0, (restockQty || 0) - restockVariantsSum);
                    setRestockVariants([
                      ...restockVariants,
                      {
                        id: `rvar-${Date.now().toString(36)}-${restockVariants.length}`,
                        size: "Large",
                        color: "Blue",
                        quantity: rem > 0 ? rem : 5,
                      },
                    ]);
                  }}
                >
                  + Add Variant Row
                </Button>
              </div>

              {restockVariants.length > 0 && (
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] font-mono uppercase text-ink-400 px-1">
                    <div className="sm:col-span-4">Size</div>
                    <div className="sm:col-span-4">Color</div>
                    <div className="sm:col-span-3">Add Qty (pcs)</div>
                    <div className="sm:col-span-1 text-right">Del</div>
                  </div>
                  {restockVariants.map((rv, idx) => (
                    <div
                      key={rv.id || idx}
                      className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-lg bg-ink-950/80 p-2.5 sm:p-2 border border-ink-850"
                    >
                      <div className="col-span-1 sm:col-span-4">
                        <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                          Size
                        </span>
                        <Input
                          value={rv.size}
                          onChange={(val) => {
                            setRestockVariants(
                              restockVariants.map((r, i) => (i === idx ? { ...r, size: val } : r)),
                            );
                          }}
                          list="preset-sizes-list"
                        />
                      </div>
                      <div className="col-span-1 sm:col-span-4">
                        <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                          Color
                        </span>
                        <Input
                          value={rv.color}
                          onChange={(val) => {
                            setRestockVariants(
                              restockVariants.map((r, i) => (i === idx ? { ...r, color: val } : r)),
                            );
                          }}
                          list="preset-colors-list"
                        />
                      </div>
                      <div className="col-span-1 sm:col-span-3">
                        <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                          Add Qty (pcs)
                        </span>
                        <Input
                          type="number"
                          value={String(rv.quantity)}
                          onChange={(val) => {
                            const qVal = Math.max(0, Math.floor(Number(val) || 0));
                            setRestockVariants(
                              restockVariants.map((r, i) =>
                                i === idx ? { ...r, quantity: qVal } : r,
                              ),
                            );
                          }}
                        />
                      </div>
                      <div className="col-span-1 sm:col-span-1 flex items-end justify-end sm:block text-right pt-3 sm:pt-0">
                        <button
                          type="button"
                          onClick={() =>
                            setRestockVariants(restockVariants.filter((_, i) => i !== idx))
                          }
                          className="rounded px-2.5 py-1.5 font-mono text-xs text-bad hover:bg-bad/15"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {restockVariants.length > 0 && (
                <div
                  className={`rounded-lg p-2.5 border font-mono text-xs flex flex-wrap items-center justify-between gap-2 ${
                    hasRestockVariantMismatch
                      ? "bg-bad/15 border-bad/40 text-bad"
                      : "bg-good/15 border-good/40 text-good"
                  }`}
                >
                  <span>
                    <strong>
                      Variants Breakdown Sum: {restockVariantsSum} / {restockQty} pcs
                    </strong>
                    {!hasRestockVariantMismatch && <span className="ml-2">✓ Reconciled</span>}
                  </span>
                  {hasRestockVariantMismatch && (
                    <button
                      type="button"
                      onClick={() => setRestockQty(restockVariantsSum)}
                      className="rounded bg-ink-900 px-2 py-0.5 text-[10px] text-ink-100 ring-1 ring-ink-700"
                    >
                      Set Total = {restockVariantsSum} pcs
                    </button>
                  )}
                </div>
              )}

              {hasRestockVariantMismatch && (
                <div className="rounded bg-bad/20 border border-bad/50 p-2.5 text-xs font-mono text-bad">
                  ⚠️ Mismatch: Variant quantities sum to {restockVariantsSum}, which does not equal
                  the Total Purchased ({restockQty}). Adjust variant quantities or total by{" "}
                  {Math.abs(restockQty - restockVariantsSum)} pcs to continue.
                </div>
              )}
            </div>

            <div className="rounded bg-ink-850 p-2.5 text-xs font-mono text-ink-300 flex justify-between border border-ink-800">
              <span>
                Estimated Cost ({money(restockItem.costPrice ?? restockItem.price * 0.5)}/unit):
              </span>
              <span className="text-bad font-semibold">
                {money((restockQty || 0) * (restockItem.costPrice ?? restockItem.price * 0.5))}
              </span>
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setRestockItem(null);
                  setRestockVariants([]);
                }}
              >
                Cancel
              </Button>
              <Button size="sm" onClick={submitRestock} disabled={hasRestockVariantMismatch}>
                Confirm Restock
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Itemized Order & Custom Printing Receipt Modal */}
      <Modal
        open={Boolean(receiptOrder)}
        title={receiptOrder ? `Merchandise Receipt · ${receiptOrder.player}` : "Order Receipt"}
        meta={
          receiptOrder ? `Order #${receiptOrder.id} · ${receiptOrder.date || "Today"}` : undefined
        }
        onClose={() => setReceiptOrder(null)}
      >
        {receiptOrder && (
          <div className="p-4 space-y-4 font-mono text-xs">
            <div className="rounded-lg bg-ink-950 p-3.5 border border-ink-800 space-y-2">
              <div className="flex justify-between">
                <span className="text-ink-400">Player:</span>
                <strong className="text-ink-100">{receiptOrder.player}</strong>
              </div>
              {receiptOrder.team && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Team:</span>
                  <span className="text-ink-200">{receiptOrder.team}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-400">Item:</span>
                <span className="text-ink-100 font-semibold">{receiptOrder.items}</span>
              </div>
              {(receiptOrder.variant ||
                (receiptOrder.selectedColor && receiptOrder.selectedSize)) && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Selected Variant:</span>
                  <span className="text-court-300">
                    {receiptOrder.selectedColor && receiptOrder.selectedSize
                      ? `${receiptOrder.selectedColor} · ${receiptOrder.selectedSize}`
                      : receiptOrder.variant}
                  </span>
                </div>
              )}
              {receiptOrder.number && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Shirt Number:</span>
                  <span className="text-ink-200">#{receiptOrder.number}</span>
                </div>
              )}
            </div>

            {/* Itemized Pricing Breakdown */}
            {(() => {
              const prList = Array.isArray(receiptOrder.printings) ? receiptOrder.printings : [];
              const prTotal =
                receiptOrder.printingTotalFee ??
                prList.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
              const baseNet = Math.max(0, (receiptOrder.total || 0) - prTotal);
              return (
                <div className="rounded-lg bg-ink-900/70 p-3.5 border border-ink-800 space-y-2">
                  <div className="text-[10px] uppercase text-ink-400 font-bold">
                    Itemized Breakdown (Base Item + Printing Fees = Total)
                  </div>
                  <div className="flex justify-between text-ink-200">
                    <span>Base Item(s) Subtotal:</span>
                    <span>{money(receiptOrder.subtotal ?? baseNet)}</span>
                  </div>
                  {(receiptOrder.discountAmount || 0) > 0 && (
                    <div className="flex justify-between text-court-400">
                      <span>Discount ({receiptOrder.discountPercent}%):</span>
                      <span>-{money(receiptOrder.discountAmount || 0)}</span>
                    </div>
                  )}
                  {prList.map((p) => {
                    const txt = p.customText || p.details;
                    return (
                      <div key={p.id} className="flex justify-between text-ink-300">
                        <span>
                          + {p.label}
                          {txt ? ` ("${txt}")` : ""}:
                        </span>
                        <span>{money(p.fee)}</span>
                      </div>
                    );
                  })}
                  {prList.length > 0 && (
                    <div className="flex justify-between text-court-300 border-t border-ink-850 pt-1">
                      <span>Total Printing Fees:</span>
                      <span>{money(prTotal)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold text-good border-t border-ink-800 pt-2">
                    <span>Total Transaction:</span>
                    <span>{money(receiptOrder.total)}</span>
                  </div>
                  <div className="flex justify-between text-ink-200">
                    <span>Amount Paid:</span>
                    <span className="text-good">{money(receiptOrder.paid)}</span>
                  </div>
                  <div className="flex justify-between text-ink-200">
                    <span>Balance Due:</span>
                    <span
                      className={
                        receiptOrder.total - receiptOrder.paid > 0 ? "text-warn font-bold" : ""
                      }
                    >
                      {money(Math.max(0, receiptOrder.total - receiptOrder.paid))}
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                🖨️ Print Receipt
              </Button>
              <Button variant="primary" size="sm" onClick={() => setReceiptOrder(null)}>
                Done
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Manage Printing Fees & Presets Modal */}
      <Modal
        open={managePrintingOpen}
        title="Manage Printing Fees & Presets"
        meta="Configure reusable printing options and default fee rates across the academy"
        onClose={() => setManagePrintingOpen(false)}
      >
        <div className="p-4 space-y-4 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="text-ink-400 text-[11px]">
              Preset Printing Options ({printingDraft.length})
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setPrintingDraft([
                  ...printingDraft,
                  {
                    id: `pr-${Date.now().toString(36)}-${printingDraft.length}`,
                    label: "",
                    defaultFee: 5,
                  },
                ]);
              }}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              <span>+ Add Option</span>
            </Button>
          </div>

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            <div className="hidden sm:grid sm:grid-cols-12 gap-2 text-[10px] uppercase text-ink-400 px-1 font-bold">
              <div className="sm:col-span-7">Printing Label</div>
              <div className="sm:col-span-4">Default Fee ($)</div>
              <div className="sm:col-span-1 text-right">Del</div>
            </div>
            {printingDraft.map((opt, idx) => (
              <div
                key={opt.id || idx}
                className="grid grid-cols-2 sm:grid-cols-12 gap-2 items-center rounded-lg bg-ink-950/80 p-2.5 sm:p-2 border border-ink-850"
              >
                <div className="col-span-2 sm:col-span-7">
                  <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                    Printing Label
                  </span>
                  <Input
                    value={opt.label}
                    onChange={(val) => {
                      setPrintingDraft(
                        printingDraft.map((row, i) => (i === idx ? { ...row, label: val } : row)),
                      );
                    }}
                    placeholder="e.g. Player Name, Sponsor Logo"
                  />
                </div>
                <div className="col-span-1 sm:col-span-4">
                  <span className="block sm:hidden font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                    Default Fee ($)
                  </span>
                  <Input
                    type="number"
                    value={String(opt.defaultFee)}
                    onChange={(val) => {
                      const fee = Math.max(0, Number(val) || 0);
                      setPrintingDraft(
                        printingDraft.map((row, i) =>
                          i === idx ? { ...row, defaultFee: fee } : row,
                        ),
                      );
                    }}
                  />
                </div>
                <div className="col-span-1 sm:col-span-1 flex items-end justify-end sm:block text-right pt-3 sm:pt-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPrintingDraft(printingDraft.filter((_, i) => i !== idx));
                    }}
                    className="rounded p-1.5 text-bad hover:bg-bad/15 transition"
                    title="Delete printing option"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {printingDraft.length === 0 && (
              <div className="py-6 text-center text-ink-500 text-xs">
                No printing options configured. Click &ldquo;Reset to Defaults&rdquo; or &ldquo;+
                Add Option&rdquo;.
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-2 border-t border-ink-800">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPrintingDraft(DEFAULT_PRINTING_OPTIONS.map((o) => ({ ...o })));
              }}
            >
              Reset to Defaults
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setManagePrintingOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={savePrintingOptions}>
                Save Presets
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </AppShell>
  );
}
