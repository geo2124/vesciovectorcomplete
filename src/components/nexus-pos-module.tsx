import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  useDB,
  DEFAULT_POS_CATALOG,
  MAX_BRANCH_LOG_ENTRIES,
  atomicCompletePosSaleTransaction,
  type PosCatalogItem,
  type PosCartLineItem,
  type PosTransaction,
  type PosInventoryLog,
  type PosRegisterShift,
  type PosHeldOrder,
  type LedgerEntry,
} from "@/lib/data-store";
import { normalizeDoubleEntryLedger } from "@/lib/accounting-coa";
import { useAuth } from "@/lib/auth";
import {
  Button as Btn,
  Chip,
  Field,
  Input,
  Select,
  Modal,
  money as kitMoney,
} from "@/components/kit";
import {
  ShoppingCart,
  Barcode,
  Package,
  Layers,
  DollarSign,
  Printer,
  Plus,
  Minus,
  Trash2,
  Edit2,
  Search,
  PauseCircle,
  PlayCircle,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  FileText,
  TrendingUp,
  Lock,
  Unlock,
  Globe,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = "",
  children,
}) => (
  <div className={`rounded-xl border border-ink-800 bg-ink-900/90 ${className}`}>{children}</div>
);

const Badge: React.FC<{
  tone?: "amber" | "green" | "red" | "blue" | "gray";
  children: React.ReactNode;
}> = ({ tone = "gray", children }) => {
  const toneMap: Record<
    string,
    "neutral" | "accent" | "court" | "info" | "good" | "ok" | "warn" | "bad" | "danger"
  > = {
    amber: "warn",
    green: "ok",
    red: "danger",
    blue: "info",
    gray: "neutral",
  };
  return <Chip tone={toneMap[tone] || "neutral"}>{children}</Chip>;
};

const money = (amount: number) => kitMoney(amount);

export const DEFAULT_LBP_PER_USD_RATE = 89500;

export interface PosCartCalculationResult {
  subtotal: number;
  taxTotal: number;
  discount: number;
  total: number;
  totalLbp: number;
  changeDue: number;
  changeDueLbp: number;
}

/**
 * Pure helper for Kiosk POS cart totals, item-level & cart-level discounts,
 * tax calculation, change due, and LBP/USD conversion math.
 */
export function calculatePosCartTotals(params: {
  cart: PosCartLineItem[];
  cartDiscount?: number;
  amountTendered?: number;
  amountTenderedLbp?: number;
  paymentMethod?: "Cash" | "Card" | "Charge to Account" | "Split Payment";
  lbpRate?: number;
}): PosCartCalculationResult {
  const rate = params.lbpRate && params.lbpRate > 0 ? params.lbpRate : DEFAULT_LBP_PER_USD_RATE;
  const rawSubtotal = params.cart.reduce((sum, item) => {
    const lineGross = Math.max(0, item.quantity * item.unitPrice);
    const lineDisc = Math.min(lineGross, Math.max(0, item.itemDiscount || 0));
    const lineSub =
      typeof item.subtotal === "number" ? item.subtotal : Number((lineGross - lineDisc).toFixed(2));
    return sum + lineSub;
  }, 0);
  const taxTotal = Number(
    params.cart
      .reduce((sum, item) => {
        if (typeof item.taxAmount === "number") return sum + item.taxAmount;
        const lineGross = Math.max(0, item.quantity * item.unitPrice);
        const lineDisc = Math.min(lineGross, Math.max(0, item.itemDiscount || 0));
        const lineSub = Math.max(0, lineGross - lineDisc);
        return sum + Number((lineSub * ((item.taxRatePct || 0) / 100)).toFixed(2));
      }, 0)
      .toFixed(2),
  );
  const discountClamped = Math.min(rawSubtotal, Math.max(0, Number(params.cartDiscount) || 0));
  const total = Number(Math.max(0, rawSubtotal - discountClamped + taxTotal).toFixed(2));
  const totalLbp = Math.round(total * rate);

  const tenderedUsd =
    (Number(params.amountTendered) || 0) +
    ((Number(params.amountTenderedLbp) || 0) > 0
      ? (Number(params.amountTenderedLbp) || 0) / rate
      : 0);
  const method = params.paymentMethod || "Cash";
  const changeDue =
    method === "Cash" && tenderedUsd > total ? Number((tenderedUsd - total).toFixed(2)) : 0;
  const changeDueLbp = Math.round(changeDue * rate);

  return {
    subtotal: Number(rawSubtotal.toFixed(2)),
    taxTotal,
    discount: Number(discountClamped.toFixed(2)),
    total,
    totalLbp,
    changeDue,
    changeDueLbp,
  };
}

/**
 * Pure helper to convert between USD and LBP at a specified exchange rate.
 */
export function convertPosCurrency(params: {
  amountUsd?: number;
  amountLbp?: number;
  lbpRate?: number;
}): { usd: number; lbp: number; rate: number } {
  const rate = params.lbpRate && params.lbpRate > 0 ? params.lbpRate : DEFAULT_LBP_PER_USD_RATE;
  if (typeof params.amountUsd === "number") {
    const usd = Number(Math.max(0, params.amountUsd).toFixed(2));
    return { usd, lbp: Math.round(usd * rate), rate };
  }
  const lbp = Math.max(0, Math.round(params.amountLbp || 0));
  return { usd: Number((lbp / rate).toFixed(2)), lbp, rate };
}

/**
 * Pure helper for POS stock deduction & low-stock status evaluation.
 * Unlimited pass items (stock >= 999) are not deducted.
 */
export function calculatePosStockDeduction(params: {
  catalogItems: PosCatalogItem[];
  cart: PosCartLineItem[];
}): {
  updatedCatalog: PosCatalogItem[];
  deductions: Array<{ itemId: string; previousStock: number; newStock: number; deducted: number }>;
} {
  const deductions: Array<{
    itemId: string;
    previousStock: number;
    newStock: number;
    deducted: number;
  }> = [];

  const updatedCatalog = params.catalogItems.map((cat) => {
    const matchingLines = params.cart.filter((l) => l.itemId === cat.id);
    if (matchingLines.length === 0) return cat;
    const totalQty = matchingLines.reduce((s, l) => s + l.quantity, 0);
    if (cat.stock >= 999) {
      deductions.push({
        itemId: cat.id,
        previousStock: cat.stock,
        newStock: cat.stock,
        deducted: 0,
      });
      return cat;
    }
    if (cat.stock < totalQty) {
      throw new Error(`Insufficient stock for "${cat.name}" (available: ${cat.stock}).`);
    }
    const newStock = Math.max(0, cat.stock - totalQty);
    deductions.push({
      itemId: cat.id,
      previousStock: cat.stock,
      newStock,
      deducted: totalQty,
    });
    return {
      ...cat,
      stock: newStock,
    };
  });

  return { updatedCatalog, deductions };
}

type PosLang = "en" | "ar";
type PosSubTab = "terminal" | "catalog" | "inventory" | "shifts_reports";

const POS_CATEGORIES = [
  { id: "All", en: "All Items", ar: "جميع الأصناف" },
  { id: "Hydration & Drinks", en: "Drinks", ar: "المشروبات" },
  { id: "Cafeteria & Coffee", en: "Cafeteria / Coffee", ar: "الكافيتيريا والقهوة" },
  { id: "Snacks & Nutrition", en: "Snacks", ar: "الوجبات الخفيفة" },
  { id: "Supplements", en: "Supplements", ar: "المكملات الغذائية" },
  { id: "Uniforms & Merch", en: "Apparel / Gear", ar: "الملابس والمعدات" },
  { id: "Court Walk-In & Passes", en: "Walk-In Passes", ar: "تذاكر الدخول" },
  { id: "Recovery & Tape", en: "Recovery & Tape", ar: "الاستشفاء والأشرطة" },
];

const DICT = {
  en: {
    moduleTitle: "Kiosk & Cafeteria POS System",
    moduleSub:
      "Touch POS Terminal · Hardware Barcode Scanner · Hold/Park Orders · Split Payments · Inventory & Z-Report Shifts",
    allBranches: "All Branches",
    tabTerminal: "POS Terminal",
    tabCatalog: "Product & Category Manager",
    tabInventory: "Inventory & Stock Logs",
    tabShifts: "Shift & Register (Z-Report)",
    registerOpen: "Register Open",
    registerClosed: "Register Closed",
    openShiftBtn: "Open Register Shift",
    closeShiftBtn: "Close Shift (Z-Report)",
    barcodePlaceholder: "Scan or type Barcode / SKU and press Enter...",
    searchPlaceholder: "Search product name (EN / AR) or SKU...",
    scanBtn: "Scan / Add",
    lastScanned: "Last Scanned",
    inStock: "in stock",
    lowStock: "Low Stock",
    outOfStock: "Out of Stock",
    currentOrder: "Current Cart & Checkout",
    clearCart: "Clear",
    holdOrder: "Hold / Park Order",
    heldOrders: "Parked Orders",
    recallOrder: "Recall",
    customerType: "Customer Type",
    walkIn: "Walk-In Customer",
    academyPlayer: "Academy Player",
    gymMember: "Gym Client",
    customerName: "Customer Name",
    emptyCart: "Cart is empty. Tap any product card or scan a barcode to add items.",
    qty: "Qty",
    itemDisc: "Item Disc",
    subtotal: "Subtotal",
    cartDiscount: "Cart Discount",
    taxVat: "Tax / VAT",
    grandTotal: "Grand Total",
    paymentMethod: "Payment Method",
    cash: "Cash",
    card: "Card",
    accountCharge: "Charge to Client Account",
    splitPayment: "Split Payment",
    amountTendered: "Cash Tendered",
    changeDue: "Change Due",
    splitCash: "Cash Portion",
    splitCard: "Card Portion",
    splitAccount: "Account Charge Portion",
    completeSale: "Complete Sale & Print Receipt",
    addProduct: "+ Add Product",
    costPrice: "Cost Price",
    sellingPrice: "Selling Price",
    taxRate: "Tax / VAT %",
    barcodeLabel: "Barcode (EAN / UPC)",
    skuLabel: "SKU Code",
    stockCount: "Current Stock",
    lowStockAlertAt: "Low-Stock Alert Threshold",
    inventoryValuationCost: "Inventory Valuation (Cost)",
    inventoryValuationRetail: "Retail Stock Value",
    lowStockAlerts: "Low-Stock Items",
    todayRevenue: "Today's POS Sales",
    stockInBtn: "+ Stock-In / Restock",
    wasteBtn: "Record Waste / Spoilage",
    receiptTitle: "Official POS Thermal Receipt",
    printReceipt: "Print Receipt",
    refundSale: "Refund",
    zReportTitle: "Shift Z-Report / X-Report & Cash Drawer Audit",
    openingFloat: "Opening Float",
    expectedCash: "Expected Drawer Cash",
    actualCash: "Actual Cash Counted",
    variance: "Cash Variance (Over/Short)",
    topSelling: "Top-Selling Items",
    paymentBreakdown: "Sales Breakdown by Payment Method",
  },
  ar: {
    moduleTitle: "نظام نقاط البيع والكافيتيريا (POS)",
    moduleSub:
      "شاشة بيع سريعة · قارئ الباركود · تعليق الفواتير · الدفع المقسّم · إدارة المخزون وتقرير إغلاق الصندوق (Z-Report)",
    allBranches: "جميع الفروع",
    tabTerminal: "شاشة البيع (POS)",
    tabCatalog: "إدارة المنتجات والأصناف",
    tabInventory: "المخزون وحركة المستودع",
    tabShifts: "الورديات وإغلاق الصندوق (Z-Report)",
    registerOpen: "الصندوق مفتوح",
    registerClosed: "الصندوق مغلق",
    openShiftBtn: "فتح وردية الصندوق",
    closeShiftBtn: "إغلاق الوردية (تقرير Z)",
    barcodePlaceholder: "امسح الباركود أو اكتب رمز الصنف (SKU) واضغط Enter...",
    searchPlaceholder: "ابحث باسم المنتج (عربي / إنجليزي) أو الرمز...",
    scanBtn: "مسح / إضافة",
    lastScanned: "آخر باركود ممسوح",
    inStock: "متوفر",
    lowStock: "مخزون منخفض",
    outOfStock: "نفد المخزون",
    currentOrder: "سلة المشتريات والدفع",
    clearCart: "إفراغ",
    holdOrder: "تعليق الطلب (Park)",
    heldOrders: "الطلبات المعلّقة",
    recallOrder: "استرجاع",
    customerType: "نوع العميل",
    walkIn: "عميل مباشر (Walk-In)",
    academyPlayer: "لاعب الأكاديمية",
    gymMember: "مشترك الجيم",
    customerName: "اسم العميل",
    emptyCart: "السلة فارغة. اضغط على أي منتج أو امسح الباركود لإضافة الأصناف.",
    qty: "الكمية",
    itemDisc: "خصم الصنف",
    subtotal: "المجموع الفرعي",
    cartDiscount: "خصم الفاتورة",
    taxVat: "الضريبة (VAT)",
    grandTotal: "الإجمالي النهائي",
    paymentMethod: "طريقة الدفع",
    cash: "نقداً (Cash)",
    card: "بطاقة (Card)",
    accountCharge: "تقييد على حساب العميل",
    splitPayment: "دفع مقسّم (Split)",
    amountTendered: "المبلغ النقدي المستلم",
    changeDue: "الباقي للعميل (Change)",
    splitCash: "الجزء النقدي",
    splitCard: "جزء البطاقة",
    splitAccount: "جزء حساب العميل",
    completeSale: "إتمام البيع وطباعة الإيصال",
    addProduct: "+ إضافة منتج جديد",
    costPrice: "سعر التكلفة",
    sellingPrice: "سعر البيع",
    taxRate: "نسبة الضريبة %",
    barcodeLabel: "رقم الباركود",
    skuLabel: "رمز الصنف (SKU)",
    stockCount: "الكمية المتوفرة",
    lowStockAlertAt: "حد تنبيه انخفاض المخزون",
    inventoryValuationCost: "قيمة المخزون (بالتكلفة)",
    inventoryValuationRetail: "قيمة المخزون (بسعر البيع)",
    lowStockAlerts: "أصناف منخفضة المخزون",
    todayRevenue: "مبيعات اليوم",
    stockInBtn: "+ توريد مخزون (Stock-In)",
    wasteBtn: "تسجيل تالف / هدر",
    receiptTitle: "إيصال مبيعات نقطة البيع",
    printReceipt: "طباعة الإيصال",
    refundSale: "استرجاع",
    zReportTitle: "تقرير الوردية وجرد الصندوق (Z-Report / X-Report)",
    openingFloat: "رصيد افتتاح الصندوق",
    expectedCash: "النقد المتوقع في الدرج",
    actualCash: "النقد الفعلي المعدود",
    variance: "الفرق (فائض / عجز)",
    topSelling: "الأصناف الأكثر مبيعاً",
    paymentBreakdown: "تفصيل المبيعات حسب طريقة الدفع",
  },
};

export interface NexusPosModuleProps {
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
}

export const NexusPosModule: React.FC<NexusPosModuleProps> = ({
  selectedBranch,
  onSelectBranch,
}) => {
  const { db, tenantId, setEntity, patchEntity, deleteEntity, runBranchArrayTransaction } = useDB();
  const { role } = useAuth();
  const isSuperAdmin = role === "Super Admin";

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Bilingual EN / AR State with RTL support
  const [lang, setLang] = useState<PosLang>(() => {
    if (typeof window !== "undefined") {
      const saved = window.localStorage.getItem("vv_pos_lang");
      if (saved === "ar" || saved === "en") return saved;
    }
    return "en";
  });

  const toggleLang = (next: PosLang) => {
    setLang(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("vv_pos_lang", next);
    }
  };

  const t = DICT[lang];
  const isRtl = lang === "ar";

  const [activeSubTab, setActiveSubTab] = useState<PosSubTab>("terminal");

  const activeBranchName = useMemo(() => {
    if (selectedBranch !== "All") return selectedBranch;
    return db.branches[0]?.name || "Main Branch";
  }, [selectedBranch, db.branches]);

  const activeBranchObj = useMemo(() => {
    return db.branches.find((b) => b.name === activeBranchName) || db.branches[0];
  }, [db.branches, activeBranchName]);

  // Catalog Items
  const catalogItems = useMemo<PosCatalogItem[]>(() => {
    const raw = db.posCatalog && db.posCatalog.length > 0 ? db.posCatalog : DEFAULT_POS_CATALOG;
    return raw.map((item) => {
      const defaultMatch = DEFAULT_POS_CATALOG.find((d) => d.id === item.id);
      return {
        ...defaultMatch,
        ...item,
        nameAr: item.nameAr || defaultMatch?.nameAr || item.name,
        barcode: item.barcode || defaultMatch?.barcode || item.sku || item.id,
        costPrice:
          item.costPrice ?? defaultMatch?.costPrice ?? Number((item.price * 0.45).toFixed(2)),
        lowStockThreshold: item.lowStockThreshold ?? defaultMatch?.lowStockThreshold ?? 10,
        imageIcon: item.imageIcon || defaultMatch?.imageIcon || "📦",
      };
    });
  }, [db.posCatalog]);

  const branchTransactions = useMemo<PosTransaction[]>(() => {
    const all = db.posTransactions || [];
    if (selectedBranch === "All") return all;
    return all.filter((tx) => tx.branch === selectedBranch);
  }, [db.posTransactions, selectedBranch]);

  const branchInventoryLogs = useMemo<PosInventoryLog[]>(() => {
    return (activeBranchObj?.posInventoryLogs || []).slice();
  }, [activeBranchObj]);

  const branchShifts = useMemo<PosRegisterShift[]>(() => {
    return (activeBranchObj?.posShifts || []).slice();
  }, [activeBranchObj]);

  const activeOpenShift = useMemo<PosRegisterShift | undefined>(() => {
    return branchShifts.find((s) => s.status === "Open");
  }, [branchShifts]);

  const heldOrders = useMemo<PosHeldOrder[]>(() => {
    return (activeBranchObj?.posHeldOrders || []).slice();
  }, [activeBranchObj]);

  // Helper to get localized product name
  const getItemDisplayName = (item: { name: string; nameAr?: string | undefined }) => {
    return lang === "ar" && item.nameAr ? item.nameAr : item.name;
  };

  const getCategoryDisplayName = (catId: string) => {
    const found = POS_CATEGORIES.find((c) => c.id === catId);
    if (!found) return catId;
    return lang === "ar" ? found.ar : found.en;
  };

  // ---------------------------------------------------------------------------
  // 1. FRONTEND POS TERMINAL, CART & BARCODE SCANNER INTEGRATION
  // ---------------------------------------------------------------------------
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [barcodeInput, setBarcodeInput] = useState<string>("");
  const [lastScannedBanner, setLastScannedBanner] = useState<string>("");

  const [cart, setCart] = useState<PosCartLineItem[]>([]);
  const [cartDiscount, setCartDiscount] = useState<number>(0);
  const [customerType, setCustomerType] = useState<"Walk-In" | "Academy Player" | "Gym Member">(
    "Walk-In",
  );
  const [customerName, setCustomerName] = useState<string>("Walk-In Guest");
  const [linkedPlayerId, setLinkedPlayerId] = useState<string>("");
  const [linkedGymMemberId, setLinkedGymMemberId] = useState<string>("");

  // Payment & Split Payment State
  const [paymentMethod, setPaymentMethod] = useState<
    "Cash" | "Card" | "Charge to Account" | "Split Payment"
  >("Cash");
  const [tenderCurrency, setTenderCurrency] = useState<"USD" | "LBP">("USD");
  const [lbpExchangeRate, setLbpExchangeRate] = useState<number>(89500);
  const [amountTendered, setAmountTendered] = useState<string>("");
  const [splitCash, setSplitCash] = useState<number>(0);
  const [splitCard, setSplitCard] = useState<number>(0);
  const [splitAccount, setSplitAccount] = useState<number>(0);

  // Active Receipt Modal
  const [activeReceipt, setActiveReceipt] = useState<PosTransaction | null>(null);

  // Add item to cart helper
  const addItemToCart = (item: PosCatalogItem) => {
    if (item.stock <= 0) {
      toast.error(
        lang === "ar"
          ? `نفد المخزون: ${getItemDisplayName(item)}`
          : `${item.name} is out of stock!`,
      );
      return;
    }

    setCart((prev) => {
      const existing = prev.find((line) => line.itemId === item.id);
      if (existing) {
        if (existing.quantity + 1 > item.stock) {
          toast.error(
            lang === "ar"
              ? `الكمية المطلوبة تتجاوز المخزون (${item.stock})`
              : `Cannot exceed available stock (${item.stock})`,
          );
          return prev;
        }
        return prev.map((line) => {
          if (line.itemId !== item.id) return line;
          const nextQty = line.quantity + 1;
          const disc = line.itemDiscount || 0;
          const baseSub = Math.max(0, nextQty * line.unitPrice - disc);
          const taxAmt = Number((baseSub * ((line.taxRatePct || 0) / 100)).toFixed(2));
          return {
            ...line,
            quantity: nextQty,
            taxAmount: taxAmt,
            subtotal: baseSub,
          };
        });
      }

      const taxPct = item.taxRatePct || 0;
      const taxAmt = Number((item.price * (taxPct / 100)).toFixed(2));
      const newLine: PosCartLineItem = {
        itemId: item.id,
        name: item.name,
        nameAr: item.nameAr,
        category: item.category,
        quantity: 1,
        unitPrice: item.price,
        costPrice: item.costPrice,
        itemDiscount: 0,
        taxRatePct: taxPct,
        taxAmount: taxAmt,
        subtotal: item.price,
        linkedStockId: item.linkedStockId,
      };
      return [...prev, newLine];
    });
  };

  // Barcode Lookup & Add
  const handleBarcodeScanCode = (rawCode: string) => {
    const code = rawCode.trim();
    if (!code) return;
    const lower = code.toLowerCase();
    const matched = catalogItems.find(
      (item) =>
        item.active &&
        ((item.barcode || "").toLowerCase() === lower ||
          (item.sku || "").toLowerCase() === lower ||
          item.id.toLowerCase() === lower),
    );

    if (!matched) {
      toast.error(
        lang === "ar"
          ? `لم يتم العثور على منتج بالباركود: ${code}`
          : `No product found for Barcode / SKU: "${code}"`,
      );
      return;
    }

    addItemToCart(matched);
    const displayName = getItemDisplayName(matched);
    setLastScannedBanner(`${displayName} (${matched.barcode || matched.sku})`);
    setBarcodeInput("");
    toast.success(
      lang === "ar" ? `تم مسح الباركود وإضافة: ${displayName}` : `Scanned & added: ${matched.name}`,
    );
  };

  // Global Keyboard-Wedge Hardware Barcode Scanner Listener
  const scanBufferRef = useRef<string>("");
  const lastKeyTimeRef = useRef<number>(0);

  useEffect(() => {
    if (activeSubTab !== "terminal") return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      // Ignore if typing inside an input/textarea/select
      if (tagName === "input" || tagName === "textarea" || tagName === "select") {
        return;
      }

      const now = Date.now();
      if (now - lastKeyTimeRef.current > 80) {
        scanBufferRef.current = "";
      }
      lastKeyTimeRef.current = now;

      if (e.key === "Enter") {
        if (scanBufferRef.current.length >= 3) {
          e.preventDefault();
          const scanned = scanBufferRef.current;
          scanBufferRef.current = "";
          handleBarcodeScanCode(scanned);
        }
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        scanBufferRef.current += e.key;
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [activeSubTab, catalogItems, lang]);

  // Cart Calculations
  const cartTotals = useMemo(() => {
    const rawSubtotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
    const taxTotal = Number(cart.reduce((sum, item) => sum + (item.taxAmount || 0), 0).toFixed(2));
    const discountClamped = Math.min(rawSubtotal, Math.max(0, Number(cartDiscount) || 0));
    const total = Number(Math.max(0, rawSubtotal - discountClamped + taxTotal).toFixed(2));
    const tenderedNum = Number(amountTendered) || 0;
    const changeDue =
      paymentMethod === "Cash" && tenderedNum > total
        ? Number((tenderedNum - total).toFixed(2))
        : 0;
    return {
      subtotal: Number(rawSubtotal.toFixed(2)),
      taxTotal,
      discount: discountClamped,
      total,
      changeDue,
    };
  }, [cart, cartDiscount, amountTendered, paymentMethod]);

  const updateCartQuantity = (itemId: string, delta: number) => {
    const catalogItem = catalogItems.find((i) => i.id === itemId);
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.itemId !== itemId) return line;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return null;
          if (catalogItem && nextQty > catalogItem.stock) {
            toast.error(`Max available stock is ${catalogItem.stock}`);
            return line;
          }
          const disc = line.itemDiscount || 0;
          const sub = Math.max(0, nextQty * line.unitPrice - disc);
          const taxAmt = Number((sub * ((line.taxRatePct || 0) / 100)).toFixed(2));
          return { ...line, quantity: nextQty, subtotal: sub, taxAmount: taxAmt };
        })
        .filter((x): x is PosCartLineItem => x !== null),
    );
  };

  const updateLineItemDiscount = (itemId: string, discAmount: number) => {
    setCart((prev) =>
      prev.map((line) => {
        if (line.itemId !== itemId) return line;
        const maxDisc = line.quantity * line.unitPrice;
        const clamped = Math.min(maxDisc, Math.max(0, discAmount || 0));
        const sub = Number((maxDisc - clamped).toFixed(2));
        const taxAmt = Number((sub * ((line.taxRatePct || 0) / 100)).toFixed(2));
        return {
          ...line,
          itemDiscount: clamped,
          subtotal: sub,
          taxAmount: taxAmt,
        };
      }),
    );
  };

  // Hold / Park Current Order
  const handleHoldCurrentOrder = async () => {
    if (cart.length === 0 || !activeBranchObj) {
      toast.error(lang === "ar" ? "السلة فارغة" : "Cart is empty.");
      return;
    }
    const newHeld: PosHeldOrder = {
      id: `held-${Date.now()}`,
      branch: activeBranchName,
      label: `${customerName} (${cart.length} items)`,
      customerType,
      customerName,
      linkedPlayerId: linkedPlayerId || undefined,
      linkedGymMemberId: linkedGymMemberId || undefined,
      items: cart,
      cartDiscount,
      heldAt: new Date().toTimeString().slice(0, 5),
    };
    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          posHeldOrders: [newHeld, ...(curr.posHeldOrders || [])],
        }),
        activeBranchObj,
      );
      setCart([]);
      setCartDiscount(0);
      toast.success(
        lang === "ar" ? `تم تعليق الطلب لـ ${customerName}` : `Parked order for ${customerName}`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to park order.");
    }
  };

  const handleRecallHeldOrder = async (held: PosHeldOrder) => {
    if (!activeBranchObj) return;
    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          posHeldOrders: (curr.posHeldOrders || []).filter((h) => h.id !== held.id),
        }),
        activeBranchObj,
      );
      setCart(held.items);
      setCartDiscount(held.cartDiscount);
      setCustomerType(held.customerType);
      setCustomerName(held.customerName);
      setLinkedPlayerId(held.linkedPlayerId || "");
      setLinkedGymMemberId(held.linkedGymMemberId || "");
      toast.success(
        lang === "ar" ? `تم استرجاع الطلب: ${held.label}` : `Recalled order: ${held.label}`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to recall order.");
    }
  };

  // Complete Checkout & Deduct Inventory Atomically via Firestore Transaction
  const handleCompleteSale = async () => {
    if (cart.length === 0) {
      toast.error(lang === "ar" ? "السلة فارغة" : "Add items to the cart before checkout.");
      return;
    }

    if (paymentMethod === "Split Payment") {
      const splitSum = Number((splitCash + splitCard + splitAccount).toFixed(2));
      if (Math.abs(splitSum - cartTotals.total) > 0.05) {
        toast.error(
          lang === "ar"
            ? `مجموع الدفع المقسّم (${money(splitSum)}) يجب أن يساوي الإجمالي (${money(cartTotals.total)})`
            : `Split payment total (${money(splitSum)}) must equal Grand Total (${money(cartTotals.total)})`,
        );
        return;
      }
    }

    const nowTime = new Date().toTimeString().slice(0, 5);
    const receiptNo = `POS-${Date.now().toString().slice(-6)}`;
    const activeRate = tenderCurrency === "LBP" ? Math.max(1, Number(lbpExchangeRate) || 89500) : 1;
    const txOriginalTotal =
      tenderCurrency === "LBP" ? Math.round(cartTotals.total * activeRate) : cartTotals.total;

    const tx: PosTransaction = {
      id: `pos-tx-${Date.now()}`,
      receiptNumber: receiptNo,
      date: todayStr,
      time: nowTime,
      branch: activeBranchName,
      shiftId: activeOpenShift?.id,
      cashierName: role || "Cashier",
      customerType,
      customerName: customerName.trim() || "Walk-In Guest",
      linkedPlayerId: customerType === "Academy Player" ? linkedPlayerId : undefined,
      linkedGymMemberId: customerType === "Gym Member" ? linkedGymMemberId : undefined,
      items: cart,
      subtotal: cartTotals.subtotal,
      discount: cartTotals.discount,
      taxTotal: cartTotals.taxTotal,
      total: cartTotals.total,
      currency: tenderCurrency,
      originalAmount: txOriginalTotal,
      exchangeRate: activeRate,
      paymentMethod,
      splitCashAmount: paymentMethod === "Split Payment" ? splitCash : undefined,
      splitCardAmount: paymentMethod === "Split Payment" ? splitCard : undefined,
      splitAccountAmount: paymentMethod === "Split Payment" ? splitAccount : undefined,
      amountTendered:
        paymentMethod === "Cash" ? Number(amountTendered) || cartTotals.total : undefined,
      changeDue: paymentMethod === "Cash" ? cartTotals.changeDue : undefined,
      status: "Completed",
      createdAt: new Date().toISOString(),
    };

    const cashAdded =
      paymentMethod === "Cash"
        ? cartTotals.total
        : paymentMethod === "Split Payment"
          ? splitCash
          : 0;
    const cardAdded =
      paymentMethod === "Card"
        ? cartTotals.total
        : paymentMethod === "Split Payment"
          ? splitCard
          : 0;
    const accountChargePortion =
      paymentMethod === "Charge to Account"
        ? cartTotals.total
        : paymentMethod === "Split Payment"
          ? splitAccount
          : 0;

    let accountChargeTarget:
      | {
          type: "player" | "gymMember";
          id: string;
          amount: number;
          fallbackRecord: (typeof db.players)[number] | (typeof db.gymMembers)[number];
        }
      | undefined;

    if (accountChargePortion > 0) {
      if (customerType === "Academy Player" && linkedPlayerId) {
        const pl = db.players.find((p) => p.id === linkedPlayerId);
        if (pl) {
          accountChargeTarget = {
            type: "player",
            id: pl.id,
            amount: accountChargePortion,
            fallbackRecord: pl,
          };
        }
      } else if (customerType === "Gym Member" && linkedGymMemberId) {
        const gm = (db.gymMembers || []).find((m) => m.id === linkedGymMemberId);
        if (gm) {
          accountChargeTarget = {
            type: "gymMember",
            id: gm.id,
            amount: accountChargePortion,
            fallbackRecord: gm,
          };
        }
      }
    }

    const collectedNow = Number((cartTotals.total - accountChargePortion).toFixed(2));
    const collectedOriginal =
      tenderCurrency === "LBP" ? Math.round(collectedNow * activeRate) : collectedNow;
    const ledgerEntry: LedgerEntry | undefined =
      collectedNow > 0
        ? normalizeDoubleEntryLedger({
            id: `led-pos-${Date.now()}`,
            date: todayStr,
            account: "Kiosk POS & Merch Sales",
            category: "Kiosk POS",
            module: "pos",
            entry: `[Vescio Nexus POS ${receiptNo}] ${tx.customerName} (${paymentMethod}${tenderCurrency === "LBP" ? ` · ${collectedOriginal.toLocaleString()} LBP @ ${activeRate}` : ""} - ${activeBranchName})`,
            memo: `[Vescio Nexus POS ${receiptNo}] ${tx.customerName}`,
            type: "Revenue",
            amount: collectedNow,
            currency: tenderCurrency,
            originalAmount: collectedOriginal,
            exchangeRate: activeRate,
            paymentMethod,
            status: "Collected",
            branch: activeBranchName,
            referenceId: tx.id,
          })
        : undefined;

    if (!activeBranchObj) {
      toast.error("Active branch not found.");
      return;
    }

    try {
      const catalogMap = new Map(catalogItems.map((i) => [i.id, i]));
      const stockMap = new Map((db.stock || []).map((s) => [s.id, s]));

      const result = await atomicCompletePosSaleTransaction({
        tenantId,
        branchId: activeBranchObj.id,
        fallbackBranch: activeBranchObj,
        transaction: tx,
        catalogItemsMap: catalogMap,
        stockItemsMap: stockMap,
        ...(accountChargeTarget ? { accountChargeTarget } : {}),
        ...(activeOpenShift?.id ? { openShiftId: activeOpenShift.id } : {}),
        cashCollected: cashAdded,
        cardCollected: cardAdded,
        accountChargeCollected: accountChargePortion,
        ...(ledgerEntry ? { ledgerEntry } : {}),
        staffName: role || "Cashier",
      });

      await setEntity("posTransactions", tx);
      for (const updatedCat of result.updatedCatalogItems) {
        await setEntity("posCatalog", updatedCat);
      }
      for (const updatedStock of result.updatedStockItems) {
        await patchEntity("stock", updatedStock.id, {
          qty: updatedStock.qty,
          status: updatedStock.status,
        });
      }
      if (result.updatedPlayer) {
        await patchEntity("players", result.updatedPlayer.id, {
          balance: result.updatedPlayer.balance,
        });
      }
      if (result.updatedGymMember) {
        await setEntity("gymMembers", result.updatedGymMember);
      }
      await setEntity("branches", result.updatedBranch);
      if (ledgerEntry) {
        await setEntity("ledger", ledgerEntry);
      }

      setCart([]);
      setCartDiscount(0);
      setAmountTendered("");
      setActiveReceipt(tx);
      toast.success(
        lang === "ar"
          ? `تم إتمام البيع بنجاح (${receiptNo})`
          : `Sale completed (${receiptNo}) · ${money(tx.total)}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "POS checkout failed.";
      toast.error(msg);
    }
  };

  // Refund Transaction & Restore Stock, Shift Totals, Account Balance & Ledger
  const handleRefundTransaction = async (tx: PosTransaction) => {
    if (tx.status === "Refunded") return;
    try {
      await setEntity("posTransactions", {
        ...tx,
        status: "Refunded",
      });

      const nowTime = new Date().toTimeString().slice(0, 5);
      const refundLogs: PosInventoryLog[] = [];

      // 1. Restore posCatalog stock AND linked Academy merchandise stock (db.stock)
      for (const line of tx.items) {
        const catItem = catalogItems.find((i) => i.id === line.itemId);
        if (catItem && catItem.stock < 999) {
          const nextStock = catItem.stock + line.quantity;
          await setEntity("posCatalog", {
            ...catItem,
            stock: nextStock,
          });

          if (catItem.linkedStockId) {
            const st = db.stock.find((s) => s.id === catItem.linkedStockId);
            if (st) {
              await patchEntity("stock", st.id, {
                qty: (Number(st.qty) || 0) + line.quantity,
              });
            }
          }

          refundLogs.push({
            id: `inv-refund-${Date.now()}-${line.itemId}`,
            date: todayStr,
            time: nowTime,
            branch: tx.branch || activeBranchName,
            itemId: catItem.id,
            itemName: catItem.name,
            itemNameAr: catItem.nameAr,
            adjustmentType: "Manual Correction",
            quantityDelta: line.quantity,
            previousStock: catItem.stock,
            newStock: nextStock,
            unitCost: catItem.costPrice,
            totalCostImpact: Number(((catItem.costPrice || 0) * line.quantity).toFixed(2)),
            reasonOrSupplier: `Refund Receipt ${tx.receiptNumber}`,
            recordedBy: role || "Cashier",
          });
        }
      }

      // 2. Adjust open register shift totals & append refund inventory logs on Branch
      const cashRefunded =
        tx.paymentMethod === "Cash"
          ? tx.total
          : tx.paymentMethod === "Split Payment"
            ? Number(tx.splitCashAmount) || 0
            : 0;
      const cardRefunded =
        tx.paymentMethod === "Card"
          ? tx.total
          : tx.paymentMethod === "Split Payment"
            ? Number(tx.splitCardAmount) || 0
            : 0;
      const acctRefunded =
        tx.paymentMethod === "Charge to Account"
          ? tx.total
          : tx.paymentMethod === "Split Payment"
            ? Number(tx.splitAccountAmount) || 0
            : 0;

      const targetBranchObj =
        db.branches.find(
          (b) => (b.name || "").toLowerCase() === (tx.branch || activeBranchName).toLowerCase(),
        ) || activeBranchObj;

      if (targetBranchObj) {
        await runBranchArrayTransaction(
          targetBranchObj.id,
          (curr) => {
            const targetShifts = curr.posShifts || [];
            const nextShifts = targetShifts.map((s) => {
              const isMatchingShift = tx.shiftId ? s.id === tx.shiftId : s.status === "Open";
              if (!isMatchingShift && s.status !== "Open") return s;
              if (tx.shiftId && s.id !== tx.shiftId) return s;
              const nextCashSales = Math.max(
                0,
                Number((s.cashSalesTotal - cashRefunded).toFixed(2)),
              );
              return {
                ...s,
                cashSalesTotal: nextCashSales,
                cardSalesTotal: Math.max(0, Number((s.cardSalesTotal - cardRefunded).toFixed(2))),
                accountChargeTotal: Math.max(
                  0,
                  Number((s.accountChargeTotal - acctRefunded).toFixed(2)),
                ),
                expectedDrawerCash: Number((s.openingFloat + nextCashSales).toFixed(2)),
                transactionsCount: Math.max(0, s.transactionsCount - 1),
              };
            });
            return {
              ...curr,
              posInventoryLogs: [...refundLogs, ...(curr.posInventoryLogs || [])].slice(
                0,
                MAX_BRANCH_LOG_ENTRIES,
              ),
              posShifts: nextShifts,
            };
          },
          targetBranchObj,
        );
      }

      // 3. Credit back client account balance if the original sale charged an account
      if (acctRefunded > 0) {
        if (tx.customerType === "Academy Player" && tx.linkedPlayerId) {
          const pl = db.players.find((p) => p.id === tx.linkedPlayerId);
          if (pl) {
            await patchEntity("players", pl.id, {
              balance: Math.max(0, Number(((pl.balance || 0) - acctRefunded).toFixed(2))),
            });
          }
        } else if (tx.customerType === "Gym Member" && tx.linkedGymMemberId) {
          const gm = (db.gymMembers || []).find((m) => m.id === tx.linkedGymMemberId);
          if (gm) {
            await setEntity("gymMembers", {
              ...gm,
              balance: Math.max(0, Number(((gm.balance || 0) - acctRefunded).toFixed(2))),
            });
          }
        }
      }

      // 4. Record reversing refund entry in Financial Ledger
      const collectedRefund = Number((tx.total - acctRefunded).toFixed(2));
      if (collectedRefund > 0) {
        const refCurrency = tx.currency || "USD";
        const refRate = tx.exchangeRate || (refCurrency === "LBP" ? 89500 : 1);
        const refOriginal =
          refCurrency === "LBP" ? Math.round(collectedRefund * refRate) : collectedRefund;
        const refundLedgerEntry: LedgerEntry = normalizeDoubleEntryLedger({
          id: `led-pos-ref-${Date.now()}`,
          date: todayStr,
          account: "Kiosk POS & Merch Sales",
          category: "Kiosk POS",
          module: "pos",
          entry: `[Vescio Nexus POS Refund ${tx.receiptNumber}] ${tx.customerName} (${tx.paymentMethod} - ${tx.branch || activeBranchName})`,
          memo: `[Vescio Nexus POS Refund ${tx.receiptNumber}] ${tx.customerName}`,
          type: "Expense",
          amount: collectedRefund,
          currency: refCurrency,
          originalAmount: refOriginal,
          exchangeRate: refRate,
          paymentMethod: tx.paymentMethod,
          status: "Paid",
          branch: tx.branch || activeBranchName,
          referenceId: tx.id,
        });
        await setEntity("ledger", refundLedgerEntry);
      }

      toast.success(
        lang === "ar"
          ? `تم استرجاع الفاتورة ${tx.receiptNumber} وإعادة المخزون وتحديث الصندوق`
          : `Refunded ${tx.receiptNumber}, restored stock, and reconciled register & ledger`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to process refund.");
    }
  };

  // Filtered Products for POS Grid
  const filteredGridProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalogItems.filter((item) => {
      if (!item.active) return false;
      const catOk = selectedCategory === "All" || item.category === selectedCategory;
      if (!catOk) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        (item.nameAr || "").toLowerCase().includes(q) ||
        (item.sku || "").toLowerCase().includes(q) ||
        (item.barcode || "").toLowerCase().includes(q)
      );
    });
  }, [catalogItems, selectedCategory, searchQuery]);

  // ---------------------------------------------------------------------------
  // 2. PRODUCT & CATEGORY MANAGER STATE (BACKEND)
  // ---------------------------------------------------------------------------
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [productForm, setProductForm] = useState<{
    name: string;
    nameAr: string;
    category: string;
    sku: string;
    barcode: string;
    costPrice: number;
    price: number;
    taxRatePct: number;
    stock: number;
    lowStockThreshold: number;
    imageIcon: string;
    active: boolean;
  }>({
    name: "",
    nameAr: "",
    category: "Hydration & Drinks",
    sku: "",
    barcode: "",
    costPrice: 1.5,
    price: 4.0,
    taxRatePct: 0,
    stock: 40,
    lowStockThreshold: 10,
    imageIcon: "🥤",
    active: true,
  });

  const openNewProductModal = () => {
    setEditingProductId(null);
    setProductForm({
      name: "",
      nameAr: "",
      category: "Cafeteria & Coffee",
      sku: `SKU-${Date.now().toString().slice(-4)}`,
      barcode: `628100${Date.now().toString().slice(-6)}`,
      costPrice: 1.5,
      price: 4.0,
      taxRatePct: 11,
      stock: 50,
      lowStockThreshold: 10,
      imageIcon: "☕",
      active: true,
    });
    setProductModalOpen(true);
  };

  const openEditProductModal = (item: PosCatalogItem) => {
    setEditingProductId(item.id);
    setProductForm({
      name: item.name,
      nameAr: item.nameAr || "",
      category: item.category,
      sku: item.sku || "",
      barcode: item.barcode || "",
      costPrice: item.costPrice ?? 1.0,
      price: item.price,
      taxRatePct: item.taxRatePct ?? 0,
      stock: item.stock,
      lowStockThreshold: item.lowStockThreshold ?? 10,
      imageIcon: item.imageIcon || "📦",
      active: item.active,
    });
    setProductModalOpen(true);
  };

  const handleSaveProduct = async () => {
    if (!productForm.name.trim()) {
      toast.error("Please enter the product English name.");
      return;
    }

    try {
      // Ensure all default catalog items are persisted if posCatalog is still empty
      if (!db.posCatalog || db.posCatalog.length === 0) {
        for (const def of DEFAULT_POS_CATALOG) {
          await setEntity("posCatalog", def);
        }
      }

      const record: PosCatalogItem = {
        id: editingProductId || `pos-item-${Date.now()}`,
        name: productForm.name.trim(),
        nameAr: productForm.nameAr.trim() || productForm.name.trim(),
        category: productForm.category,
        sku: productForm.sku.trim() || undefined,
        barcode: productForm.barcode.trim() || undefined,
        costPrice: Number(productForm.costPrice) || 0,
        price: Number(productForm.price) || 0,
        taxRatePct: Number(productForm.taxRatePct) || 0,
        stock: Number(productForm.stock) || 0,
        lowStockThreshold: Number(productForm.lowStockThreshold) || 5,
        imageIcon: productForm.imageIcon.trim() || "📦",
        branch: activeBranchName,
        active: productForm.active,
      };

      await setEntity("posCatalog", record);
      setProductModalOpen(false);
      toast.success(
        editingProductId ? `Updated ${record.name}` : `Added ${record.name} to POS Catalog`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save product.");
    }
  };

  // ---------------------------------------------------------------------------
  // 3. INVENTORY TRACKING, RESTOCK & WASTE ADJUSTMENT MODAL STATE
  // ---------------------------------------------------------------------------
  const [invModalOpen, setInvModalOpen] = useState(false);
  const [invForm, setInvForm] = useState<{
    itemId: string;
    adjustmentType: "Stock-In / Restock" | "Waste / Spoilage" | "Manual Correction";
    quantity: number;
    unitCost: number;
    reasonOrSupplier: string;
  }>({
    itemId: catalogItems[0]?.id || "",
    adjustmentType: "Stock-In / Restock",
    quantity: 24,
    unitCost: 1.5,
    reasonOrSupplier: "Weekly Beverage & Nutrition Supplier Delivery",
  });

  const handleSaveInventoryAdjustment = async () => {
    const item = catalogItems.find((i) => i.id === invForm.itemId);
    if (!item || !activeBranchObj) return;

    const qty = Math.max(1, Number(invForm.quantity) || 1);
    const delta = invForm.adjustmentType === "Waste / Spoilage" ? -qty : qty;
    const nextStock = Math.max(0, item.stock + delta);

    const log: PosInventoryLog = {
      id: `inv-log-${Date.now()}`,
      date: todayStr,
      time: new Date().toTimeString().slice(0, 5),
      branch: activeBranchName,
      itemId: item.id,
      itemName: item.name,
      itemNameAr: item.nameAr,
      adjustmentType: invForm.adjustmentType,
      quantityDelta: delta,
      previousStock: item.stock,
      newStock: nextStock,
      unitCost: Number(invForm.unitCost) || item.costPrice,
      totalCostImpact: Number((qty * (Number(invForm.unitCost) || item.costPrice || 0)).toFixed(2)),
      reasonOrSupplier: invForm.reasonOrSupplier.trim() || undefined,
      recordedBy: role || "Manager",
    };

    try {
      await setEntity("posCatalog", {
        ...item,
        stock: nextStock,
        costPrice: Number(invForm.unitCost) || item.costPrice,
      });

      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          posInventoryLogs: [log, ...(curr.posInventoryLogs || [])].slice(
            0,
            MAX_BRANCH_LOG_ENTRIES,
          ),
        }),
        activeBranchObj,
      );

      if ((log.totalCostImpact || 0) > 0 && invForm.adjustmentType !== "Manual Correction") {
        const cogsEntry = normalizeDoubleEntryLedger({
          id: `led-pos-cogs-${Date.now()}`,
          date: todayStr,
          account: "Kiosk POS Cost of Goods Sold (COGS)",
          category: "Kiosk POS",
          module: "pos",
          entry: `[Vescio Nexus POS ${invForm.adjustmentType}] ${item.name} (${qty} units @ ${money(log.unitCost || 0)})`,
          memo: log.reasonOrSupplier || `${invForm.adjustmentType}: ${item.name}`,
          type: "Expense",
          amount: log.totalCostImpact || 0,
          status: "Paid",
          paymentMethod: "Cash",
          branch: activeBranchName,
          referenceId: log.id,
        });
        await setEntity("ledger", cogsEntry);
      }

      setInvModalOpen(false);
      toast.success(`${invForm.adjustmentType}: ${item.name} (${item.stock} → ${nextStock} units)`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save inventory adjustment.");
    }
  };

  // ---------------------------------------------------------------------------
  // 4. SHIFT & REGISTER MANAGEMENT (Z-REPORT / X-REPORT)
  // ---------------------------------------------------------------------------
  const [openShiftModalOpen, setOpenShiftModalOpen] = useState(false);
  const [openingFloatInput, setOpeningFloatInput] = useState<number>(
    activeBranchObj?.posStartingFloat ?? 200,
  );
  const [registerNameInput, setRegisterNameInput] = useState<string>(
    activeBranchObj?.posRegisterName || "Main Kiosk & Cafeteria Register #1",
  );

  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [actualCashCountedInput, setActualCashCountedInput] = useState<string>("");
  const [closeShiftNotes, setCloseShiftNotes] = useState<string>("");

  const handleOpenRegisterShift = async () => {
    if (!activeBranchObj) return;
    if (activeOpenShift) {
      toast.info("A register shift is already open for this branch.");
      return;
    }
    const newShift: PosRegisterShift = {
      id: `shift-${Date.now()}`,
      branch: activeBranchName,
      registerName: registerNameInput.trim() || "Register #1",
      cashierName: role || "Cashier",
      openedAt: `${todayStr} ${new Date().toTimeString().slice(0, 5)}`,
      status: "Open",
      openingFloat: Number(openingFloatInput) || 0,
      cashSalesTotal: 0,
      cardSalesTotal: 0,
      accountChargeTotal: 0,
      expectedDrawerCash: Number(openingFloatInput) || 0,
      transactionsCount: 0,
    };

    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          posStatus: "Open",
          posRegisterName: newShift.registerName,
          posStartingFloat: newShift.openingFloat,
          posShifts: [newShift, ...(curr.posShifts || [])].slice(0, MAX_BRANCH_LOG_ENTRIES),
        }),
        activeBranchObj,
      );
      setOpenShiftModalOpen(false);
      toast.success(
        `Opened register shift on ${newShift.registerName} with ${money(newShift.openingFloat)} float`,
      );
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to open register shift.");
    }
  };

  const handleCloseRegisterShift = async () => {
    if (!activeBranchObj || !activeOpenShift) return;
    const actual = Number(actualCashCountedInput) || 0;
    const variance = Number((actual - activeOpenShift.expectedDrawerCash).toFixed(2));

    const closedShift: PosRegisterShift = {
      ...activeOpenShift,
      status: "Closed",
      closedAt: `${todayStr} ${new Date().toTimeString().slice(0, 5)}`,
      actualCashCounted: actual,
      variance,
      notes: closeShiftNotes.trim() || undefined,
    };

    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          posStatus: "Closed",
          posShifts: (curr.posShifts || []).map((s) => (s.id === closedShift.id ? closedShift : s)),
        }),
        activeBranchObj,
      );
      setCloseShiftModalOpen(false);
      toast.success(`Shift closed (Z-Report generated) · Cash Variance: ${money(variance)}`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to close register shift.");
    }
  };

  // Inventory & Sales Analytics
  const posAnalytics = useMemo(() => {
    const physicalItems = catalogItems.filter((i) => i.stock < 900);
    const valuationCost = physicalItems.reduce((sum, i) => sum + i.stock * (i.costPrice || 0), 0);
    const valuationRetail = physicalItems.reduce((sum, i) => sum + i.stock * i.price, 0);
    const lowStockItems = physicalItems.filter((i) => i.stock <= (i.lowStockThreshold ?? 10));

    const completedTxs = branchTransactions.filter((tx) => tx.status === "Completed");
    const todayTxs = completedTxs.filter((tx) => tx.date === todayStr);
    const todayRevenue = todayTxs.reduce((s, tx) => s + tx.total, 0);

    // Breakdown by payment method
    let cashTotal = 0;
    let cardTotal = 0;
    let accountTotal = 0;

    const itemSalesMap = new Map<
      string,
      { name: string; nameAr?: string; qty: number; revenue: number }
    >();

    for (const tx of completedTxs) {
      if (tx.paymentMethod === "Cash") cashTotal += tx.total;
      else if (tx.paymentMethod === "Card") cardTotal += tx.total;
      else if (tx.paymentMethod === "Charge to Account") accountTotal += tx.total;
      else if (tx.paymentMethod === "Split Payment") {
        cashTotal += tx.splitCashAmount || 0;
        cardTotal += tx.splitCardAmount || 0;
        accountTotal += tx.splitAccountAmount || 0;
      }

      for (const line of tx.items) {
        const cur = itemSalesMap.get(line.itemId) || {
          name: line.name,
          nameAr: line.nameAr,
          qty: 0,
          revenue: 0,
        };
        cur.qty += line.quantity;
        cur.revenue += line.subtotal;
        itemSalesMap.set(line.itemId, cur);
      }
    }

    const topSellingItems = Array.from(itemSalesMap.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    return {
      valuationCost: Number(valuationCost.toFixed(2)),
      valuationRetail: Number(valuationRetail.toFixed(2)),
      lowStockItems,
      todayRevenue: Number(todayRevenue.toFixed(2)),
      todayTxCount: todayTxs.length,
      cashTotal: Number(cashTotal.toFixed(2)),
      cardTotal: Number(cardTotal.toFixed(2)),
      accountTotal: Number(accountTotal.toFixed(2)),
      topSellingItems,
    };
  }, [catalogItems, branchTransactions, todayStr]);

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="space-y-6">
      {/* TOP POS HEADER WITH PROMINENT BILINGUAL EN / AR + RTL SWITCHER */}
      <Card className="p-5 bg-gradient-to-br from-amber-500/10 via-ink-900 to-ink-900 border-amber-500/30">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
              <ShoppingCart className="w-5 h-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-white tracking-tight">{t.moduleTitle}</h2>
                <Badge tone="amber">{activeBranchName}</Badge>
                <Badge tone={activeOpenShift ? "green" : "red"}>
                  {activeOpenShift ? t.registerOpen : t.registerClosed}
                </Badge>
              </div>
              <p className="text-xs text-ink-300 mt-0.5">{t.moduleSub}</p>
            </div>
          </div>

          {/* RIGHT CONTROLS: BILINGUAL EN / AR TOGGLE + BRANCH SWITCHER + SHIFT BUTTON */}
          <div className="flex flex-wrap items-center gap-2">
            {/* PROMINENT EN / AR LANGUAGE & RTL SWITCHER */}
            <div
              className="flex items-center bg-black/40 border border-amber-500/40 rounded-xl p-1"
              title="Switch POS Language & LTR/RTL Direction"
            >
              <Globe className="w-3.5 h-3.5 text-amber-400 mx-1.5" />
              <button
                type="button"
                onClick={() => toggleLang("en")}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  lang === "en" ? "bg-amber-500 text-black shadow" : "text-ink-300 hover:text-white"
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => toggleLang("ar")}
                className={`px-2.5 py-1 rounded-lg text-xs font-black transition-all cursor-pointer ${
                  lang === "ar" ? "bg-amber-500 text-black shadow" : "text-ink-300 hover:text-white"
                }`}
              >
                العربية (AR)
              </button>
            </div>

            {/* Branch Pills */}
            <div className="flex items-center bg-black/30 border border-ink-800 rounded-xl p-1">
              <button
                type="button"
                onClick={() => onSelectBranch("All")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedBranch === "All"
                    ? "bg-amber-500 text-black"
                    : "text-ink-400 hover:text-white"
                }`}
              >
                {t.allBranches}
              </button>
              {db.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBranch(b.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedBranch === b.name
                      ? "bg-amber-500 text-black"
                      : "text-ink-400 hover:text-white"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>

            {activeOpenShift ? (
              <Btn
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActualCashCountedInput(String(activeOpenShift.expectedDrawerCash));
                  setCloseShiftModalOpen(true);
                }}
              >
                <Lock className="w-3.5 h-3.5 text-rose-400" /> {t.closeShiftBtn}
              </Btn>
            ) : (
              <Btn variant="primary" size="sm" onClick={() => setOpenShiftModalOpen(true)}>
                <Unlock className="w-3.5 h-3.5" /> {t.openShiftBtn}
              </Btn>
            )}
          </div>
        </div>

        {/* 4 Summary KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-ink-800">
          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              {t.todayRevenue}
            </div>
            <div className="text-xl font-black text-emerald-400 mt-0.5">
              {money(posAnalytics.todayRevenue)}{" "}
              <span className="text-xs font-normal text-ink-400">
                ({posAnalytics.todayTxCount} receipts)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              {t.inventoryValuationCost}
            </div>
            <div className="text-xl font-black text-white mt-0.5">
              {money(posAnalytics.valuationCost)}{" "}
              <span className="text-xs font-normal text-amber-400">
                · Retail: {money(posAnalytics.valuationRetail)}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              {t.lowStockAlerts}
            </div>
            <div className="text-xl font-black text-rose-400 mt-0.5">
              {posAnalytics.lowStockItems.length}{" "}
              <span className="text-xs font-normal text-ink-400">/ {catalogItems.length} SKUs</span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-ink-800">
            <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400">
              {t.expectedCash}
            </div>
            <div className="text-xl font-black text-sky-400 mt-0.5">
              {money(
                activeOpenShift
                  ? activeOpenShift.expectedDrawerCash
                  : (activeBranchObj?.posStartingFloat ?? 200) + posAnalytics.cashTotal,
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* POS SUB-NAVIGATION TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-800 pb-3">
        {[
          {
            id: "terminal" as PosSubTab,
            label: t.tabTerminal,
            icon: ShoppingCart,
            badge: cart.reduce((s, i) => s + i.quantity, 0),
          },
          {
            id: "catalog" as PosSubTab,
            label: t.tabCatalog,
            icon: Package,
            badge: catalogItems.length,
          },
          {
            id: "inventory" as PosSubTab,
            label: t.tabInventory,
            icon: Layers,
            badge: posAnalytics.lowStockItems.length,
          },
          {
            id: "shifts_reports" as PosSubTab,
            label: t.tabShifts,
            icon: TrendingUp,
            badge: branchTransactions.length,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                active
                  ? "bg-amber-500 text-black border-amber-400 shadow-md"
                  : "bg-ink-900 text-ink-300 border-ink-800 hover:text-white hover:border-amber-500/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                  active ? "bg-black/20 text-black" : "bg-white/5 text-ink-400"
                }`}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          TAB 1: FRONTEND POS TERMINAL & BARCODE SCANNER
      ===================================================================== */}
      {activeSubTab === "terminal" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 7 COLS: BARCODE SCANNER BAR, CATEGORY TABS & TOUCH PRODUCT GRID */}
          <div className="xl:col-span-7 space-y-4">
            {/* Hardware Keyboard-Wedge & Manual Barcode Scanner Input Bar */}
            <Card className="p-4 space-y-3 border-amber-500/30">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <div className="relative flex-1">
                  <Barcode className="w-4 h-4 text-amber-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={barcodeInput}
                    onChange={(e) => setBarcodeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleBarcodeScanCode(barcodeInput);
                      }
                    }}
                    placeholder={t.barcodePlaceholder}
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/40 border border-amber-500/40 text-xs text-white font-mono focus:outline-none focus:border-amber-400"
                  />
                </div>
                <Btn
                  variant="primary"
                  size="sm"
                  onClick={() => handleBarcodeScanCode(barcodeInput)}
                >
                  <Barcode className="w-3.5 h-3.5" /> {t.scanBtn}
                </Btn>

                {/* Search by Name */}
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-ink-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="w-full pl-8 pr-3 py-2 rounded-xl bg-black/30 border border-ink-800 text-xs text-white focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              {lastScannedBanner && (
                <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-xs text-emerald-300">
                  <span>
                    ✓ <strong>{t.lastScanned}:</strong> {lastScannedBanner}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLastScannedBanner("")}
                    className="text-[10px] underline cursor-pointer"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Category Filter Buttons */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {POS_CATEGORIES.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      selectedCategory === cat.id
                        ? "bg-amber-500 text-black shadow"
                        : "bg-black/30 text-ink-300 border border-ink-800 hover:text-white"
                    }`}
                  >
                    {lang === "ar" ? cat.ar : cat.en}
                  </button>
                ))}
              </div>
            </Card>

            {/* Touch-Friendly Product Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filteredGridProducts.map((item) => {
                const isLow = item.stock < 900 && item.stock <= (item.lowStockThreshold ?? 10);
                const isOut = item.stock <= 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={isOut}
                    onClick={() => addItemToCart(item)}
                    className={`p-3.5 rounded-xl border text-left transition-all flex flex-col justify-between gap-2.5 cursor-pointer ${
                      isOut
                        ? "bg-ink-950/50 border-ink-800 opacity-50 cursor-not-allowed"
                        : "bg-ink-900/90 border-ink-800 hover:border-amber-500/60 hover:bg-ink-850 active:scale-[0.98]"
                    }`}
                  >
                    <div className="w-full">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-2xl">{item.imageIcon || "📦"}</span>
                        <span className="font-mono text-[10px] text-ink-400">
                          {item.sku || item.barcode}
                        </span>
                      </div>
                      <div className="text-xs font-black text-white mt-2 line-clamp-2">
                        {getItemDisplayName(item)}
                      </div>
                      <div className="text-[10px] text-ink-400 mt-0.5">
                        {getCategoryDisplayName(item.category)}
                      </div>
                    </div>

                    <div className="w-full pt-2 border-t border-ink-800/80 flex items-center justify-between">
                      <span className="text-sm font-black text-amber-400">{money(item.price)}</span>
                      <Badge tone={isOut ? "red" : isLow ? "amber" : "green"}>
                        {item.stock >= 900
                          ? "∞"
                          : isOut
                            ? t.outOfStock
                            : `${item.stock} ${t.inStock}`}
                      </Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* RIGHT 5 COLS: CART, HOLD/PARK ORDERS & SPLIT-PAYMENT CHECKOUT */}
          <Card className="xl:col-span-5 p-5 space-y-4 border-amber-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingCart className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  {t.currentOrder}
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                {cart.length > 0 && (
                  <>
                    <Btn variant="secondary" size="xs" onClick={handleHoldCurrentOrder}>
                      <PauseCircle className="w-3.5 h-3.5 text-sky-400" /> {t.holdOrder}
                    </Btn>
                    <Btn
                      variant="ghost"
                      size="xs"
                      onClick={() => {
                        setCart([]);
                        setCartDiscount(0);
                      }}
                    >
                      {t.clearCart}
                    </Btn>
                  </>
                )}
              </div>
            </div>

            {/* Parked / Held Orders Bar */}
            {heldOrders.length > 0 && (
              <div className="p-2.5 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-1.5">
                <div className="text-[10px] font-black uppercase tracking-wider text-sky-300">
                  {t.heldOrders} ({heldOrders.length})
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {heldOrders.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => handleRecallHeldOrder(h)}
                      className="px-2.5 py-1 rounded-lg bg-black/40 border border-sky-500/40 text-[11px] text-white hover:bg-sky-500/20 flex items-center gap-1 cursor-pointer"
                    >
                      <PlayCircle className="w-3 h-3 text-sky-400" />
                      <span>
                        {h.label} ({h.heldAt})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Customer Selection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-2.5">
              <Field label={t.customerType}>
                <Select
                  value={customerType}
                  onChange={(e) => {
                    const ct = e.target.value as typeof customerType;
                    setCustomerType(ct);
                    if (ct === "Walk-In") setCustomerName("Walk-In Guest");
                  }}
                >
                  <option value="Walk-In">{t.walkIn}</option>
                  <option value="Academy Player">{t.academyPlayer}</option>
                  <option value="Gym Member">{t.gymMember}</option>
                </Select>
              </Field>

              {customerType === "Academy Player" ? (
                <Field label={t.academyPlayer}>
                  <Select
                    value={linkedPlayerId}
                    onChange={(e) => {
                      const pl = db.players.find((p) => p.id === e.target.value);
                      setLinkedPlayerId(e.target.value);
                      if (pl) setCustomerName(pl.name);
                    }}
                  >
                    <option value="">Select Player...</option>
                    {db.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.team})
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : customerType === "Gym Member" ? (
                <Field label={t.gymMember}>
                  <Select
                    value={linkedGymMemberId}
                    onChange={(e) => {
                      const gm = (db.gymMembers || []).find((m) => m.id === e.target.value);
                      setLinkedGymMemberId(e.target.value);
                      if (gm) setCustomerName(gm.memberName);
                    }}
                  >
                    <option value="">Select Gym Client...</option>
                    {(db.gymMembers || []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.memberName}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label={t.customerName}>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </Field>
              )}
            </div>

            {/* Cart Items List */}
            {cart.length === 0 ? (
              <div className="py-10 text-center text-xs text-ink-400 border border-dashed border-ink-800 rounded-xl px-4">
                {t.emptyCart}
              </div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {cart.map((line) => (
                  <div
                    key={line.itemId}
                    className="p-3 rounded-xl bg-black/35 border border-ink-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-bold text-white">
                        {lang === "ar" && line.nameAr ? line.nameAr : line.name}
                        <span className="text-ink-400 font-normal mx-1">
                          ({money(line.unitPrice)})
                        </span>
                      </div>
                      <span className="font-mono font-black text-amber-400">
                        {money(line.subtotal)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      {/* Quantity +/- */}
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(line.itemId, -1)}
                          className="w-6 h-6 rounded bg-ink-800 text-white flex items-center justify-center hover:bg-ink-700 cursor-pointer"
                        >
                          <Minus className="w-3 h-3" />
                        </button>
                        <span className="font-mono font-bold text-white px-2">{line.quantity}</span>
                        <button
                          type="button"
                          onClick={() => updateCartQuantity(line.itemId, 1)}
                          className="w-6 h-6 rounded bg-ink-800 text-white flex items-center justify-center hover:bg-ink-700 cursor-pointer"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>

                      {/* Item-Level Discount */}
                      <div className="flex items-center gap-1 text-[11px] text-ink-400">
                        <span>{t.itemDisc}:</span>
                        <input
                          type="number"
                          min={0}
                          value={line.itemDiscount || 0}
                          onChange={(e) =>
                            updateLineItemDiscount(line.itemId, Number(e.target.value))
                          }
                          className="w-14 px-1.5 py-0.5 rounded bg-black/40 border border-ink-700 text-white text-center font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Totals Breakdown */}
            <div className="p-3.5 rounded-xl bg-black/40 border border-ink-800 space-y-2 text-xs">
              <div className="flex items-center justify-between text-ink-300">
                <span>{t.subtotal}</span>
                <span className="font-mono">{money(cartTotals.subtotal)}</span>
              </div>
              <div className="flex items-center justify-between text-ink-300">
                <span>{t.cartDiscount}</span>
                <input
                  type="number"
                  min={0}
                  value={cartDiscount}
                  onChange={(e) => setCartDiscount(Number(e.target.value) || 0)}
                  className="w-20 px-2 py-0.5 rounded bg-black/40 border border-ink-700 text-white text-right font-mono"
                />
              </div>
              <div className="flex items-center justify-between text-ink-300">
                <span>{t.taxVat}</span>
                <span className="font-mono">{money(cartTotals.taxTotal)}</span>
              </div>
              <div className="flex items-center justify-between text-base font-black text-white pt-2 border-t border-ink-800">
                <span>{t.grandTotal}</span>
                <span className="font-mono text-amber-400">{money(cartTotals.total)}</span>
              </div>
            </div>

            {/* Payment Method & Split Payment Controls */}
            <div className="space-y-3">
              <Field label={t.paymentMethod}>
                <div className="grid grid-cols-2 gap-1.5">
                  {(
                    [
                      { id: "Cash", label: t.cash },
                      { id: "Card", label: t.card },
                      { id: "Charge to Account", label: t.accountCharge },
                      { id: "Split Payment", label: t.splitPayment },
                    ] as const
                  ).map((pm) => (
                    <button
                      key={pm.id}
                      type="button"
                      onClick={() => {
                        setPaymentMethod(pm.id);
                        if (pm.id === "Split Payment") {
                          const half = Number((cartTotals.total / 2).toFixed(2));
                          setSplitCash(half);
                          setSplitCard(Number((cartTotals.total - half).toFixed(2)));
                          setSplitAccount(0);
                        }
                      }}
                      className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                        paymentMethod === pm.id
                          ? "bg-amber-500 text-black border-amber-400"
                          : "bg-black/30 text-ink-300 border-ink-800 hover:text-white"
                      }`}
                    >
                      {pm.label}
                    </button>
                  ))}
                </div>
              </Field>

              {/* Multi-Currency USD / LBP Tender Switcher */}
              <div className="grid grid-cols-2 items-end gap-2.5 p-2.5 rounded-xl bg-black/30 border border-ink-800">
                <Field label="Tender Currency">
                  <div className="grid grid-cols-2 gap-1.5">
                    {(["USD", "LBP"] as const).map((curr) => (
                      <button
                        key={curr}
                        type="button"
                        onClick={() => setTenderCurrency(curr)}
                        className={`h-9 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                          tenderCurrency === curr
                            ? "bg-emerald-500 text-black border-emerald-400"
                            : "bg-black/40 text-ink-300 border-ink-700 hover:text-white"
                        }`}
                      >
                        {curr}
                      </button>
                    ))}
                  </div>
                </Field>
                {tenderCurrency === "LBP" ? (
                  <Field label="LBP Rate (1 USD =)">
                    <Input
                      type="number"
                      value={lbpExchangeRate}
                      onChange={(e) =>
                        setLbpExchangeRate(Math.max(1, Number(e.target.value) || 89500))
                      }
                    />
                  </Field>
                ) : (
                  <div className="h-9 flex items-center justify-end font-mono text-[11px] text-ink-400 px-2">
                    1 USD = {lbpExchangeRate.toLocaleString()} LBP
                  </div>
                )}
              </div>

              {tenderCurrency === "LBP" && (
                <div className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between text-xs font-mono text-emerald-300">
                  <span>LBP Equivalent Due:</span>
                  <strong>
                    {Math.round(
                      cartTotals.total * (Number(lbpExchangeRate) || 89500),
                    ).toLocaleString()}{" "}
                    LBP ({money(cartTotals.total)})
                  </strong>
                </div>
              )}

              {paymentMethod === "Cash" && (
                <div className="grid grid-cols-2 items-end gap-2.5 p-3 rounded-xl bg-black/30 border border-ink-800">
                  <Field label={t.amountTendered}>
                    <Input
                      type="number"
                      value={amountTendered}
                      onChange={(e) => setAmountTendered(e.target.value)}
                      placeholder={String(cartTotals.total)}
                    />
                  </Field>
                  <Field label={t.changeDue}>
                    <div className="h-10 px-3 rounded-md bg-emerald-500/15 border border-emerald-500/30 flex items-center font-mono text-sm font-black text-emerald-400">
                      {money(cartTotals.changeDue)}
                    </div>
                  </Field>
                </div>
              )}

              {paymentMethod === "Split Payment" && (
                <div className="grid grid-cols-3 items-end gap-2 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30">
                  <Field label={t.splitCash}>
                    <Input
                      type="number"
                      value={splitCash}
                      onChange={(e) => setSplitCash(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label={t.splitCard}>
                    <Input
                      type="number"
                      value={splitCard}
                      onChange={(e) => setSplitCard(Number(e.target.value) || 0)}
                    />
                  </Field>
                  <Field label={t.splitAccount}>
                    <Input
                      type="number"
                      value={splitAccount}
                      onChange={(e) => setSplitAccount(Number(e.target.value) || 0)}
                    />
                  </Field>
                </div>
              )}

              <Btn
                variant="primary"
                className="w-full justify-center py-2.5"
                onClick={handleCompleteSale}
                disabled={cart.length === 0}
              >
                <CheckCircle2 className="w-4 h-4" /> {t.completeSale} ({money(cartTotals.total)})
              </Btn>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 2: PRODUCT & CATEGORY MANAGER (EN & AR, BARCODE, COST, VAT)
      ===================================================================== */}
      {activeSubTab === "catalog" && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                {t.tabCatalog} ({catalogItems.length})
              </h3>
              <p className="text-xs text-ink-400">
                Manage Bilingual Name (EN &amp; AR), Barcode/SKU, Category, Cost Price, Selling
                Price, Tax/VAT &amp; Icon
              </p>
            </div>
            <Btn variant="primary" size="sm" onClick={openNewProductModal}>
              {t.addProduct}
            </Btn>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-ink-800 text-[10px] font-black uppercase tracking-wider text-ink-400">
                  <th className="py-2.5 px-3">Product (EN / AR)</th>
                  <th className="py-2.5 px-3">Barcode &amp; SKU</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">{t.costPrice}</th>
                  <th className="py-2.5 px-3">{t.sellingPrice}</th>
                  <th className="py-2.5 px-3">{t.taxRate}</th>
                  <th className="py-2.5 px-3">{t.stockCount}</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-800/60">
                {catalogItems.map((item) => (
                  <tr key={item.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{item.imageIcon || "📦"}</span>
                        <div>
                          <div className="font-bold text-white">{item.name}</div>
                          <div className="text-[11px] text-amber-300/90">{item.nameAr || "—"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-[11px] text-ink-300">
                      <div>{item.barcode || "—"}</div>
                      <div className="text-ink-400">{item.sku || "—"}</div>
                    </td>
                    <td className="py-3 px-3">
                      <Badge tone="blue">{getCategoryDisplayName(item.category)}</Badge>
                    </td>
                    <td className="py-3 px-3 font-mono text-ink-300">
                      {money(item.costPrice || 0)}
                    </td>
                    <td className="py-3 px-3 font-mono font-bold text-amber-400">
                      {money(item.price)}
                    </td>
                    <td className="py-3 px-3 font-mono text-ink-300">{item.taxRatePct || 0}%</td>
                    <td className="py-3 px-3">
                      <Badge
                        tone={
                          item.stock <= 0
                            ? "red"
                            : item.stock < 900 && item.stock <= (item.lowStockThreshold ?? 10)
                              ? "amber"
                              : "green"
                        }
                      >
                        {item.stock >= 900 ? "∞ Pass" : `${item.stock} units`}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditProductModal(item)}
                          className="p-1.5 rounded-lg text-ink-400 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        {isSuperAdmin && (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await deleteEntity("posCatalog", item.id);
                                toast.success(`Removed ${item.name}`);
                              } catch (err: unknown) {
                                toast.error(
                                  err instanceof Error ? err.message : "Failed to remove product.",
                                );
                              }
                            }}
                            className="p-1.5 rounded-lg text-ink-400 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* =====================================================================
          TAB 3: INVENTORY TRACKING, LOW-STOCK ALERTS, RESTOCK & WASTE LOGS
      ===================================================================== */}
      {activeSubTab === "inventory" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 5 COLS: LOW-STOCK ALERTS & QUICK RESTOCK / WASTE ACTIONS */}
          <Card className="xl:col-span-5 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider">
                  {t.lowStockAlerts} ({posAnalytics.lowStockItems.length})
                </h3>
                <p className="text-xs text-ink-400">
                  Real-time stock alerts &amp; inventory valuation
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                <Btn
                  variant="primary"
                  size="xs"
                  onClick={() => {
                    setInvForm((f) => ({
                      ...f,
                      adjustmentType: "Stock-In / Restock",
                    }));
                    setInvModalOpen(true);
                  }}
                >
                  {t.stockInBtn}
                </Btn>
                <Btn
                  variant="secondary"
                  size="xs"
                  onClick={() => {
                    setInvForm((f) => ({
                      ...f,
                      adjustmentType: "Waste / Spoilage",
                    }));
                    setInvModalOpen(true);
                  }}
                >
                  {t.wasteBtn}
                </Btn>
              </div>
            </div>

            {posAnalytics.lowStockItems.length === 0 ? (
              <div className="py-8 text-center text-xs text-emerald-400 border border-dashed border-emerald-500/30 rounded-xl">
                ✓ All products are stocked above their minimum threshold.
              </div>
            ) : (
              <div className="space-y-2">
                {posAnalytics.lowStockItems.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="font-bold text-white">{getItemDisplayName(item)}</div>
                      <div className="text-[11px] text-rose-300">
                        Remaining: <strong>{item.stock}</strong> (Alert threshold:{" "}
                        {item.lowStockThreshold ?? 10})
                      </div>
                    </div>
                    <Btn
                      variant="primary"
                      size="xs"
                      onClick={() => {
                        setInvForm({
                          itemId: item.id,
                          adjustmentType: "Stock-In / Restock",
                          quantity: 24,
                          unitCost: item.costPrice || 1.5,
                          reasonOrSupplier: "Low-Stock Replenishment",
                        });
                        setInvModalOpen(true);
                      }}
                    >
                      Restock
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* RIGHT 7 COLS: STOCK-IN, WASTE & SALE DEDUCTION AUDIT LOG */}
          <Card className="xl:col-span-7 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Stock-In, Waste / Spoilage &amp; Sale Deduction Audit Log (
                {branchInventoryLogs.length})
              </h3>
            </div>

            {branchInventoryLogs.length === 0 ? (
              <div className="py-10 text-center text-xs text-ink-400 border border-dashed border-ink-800 rounded-xl">
                No inventory movements logged yet. Complete a sale or click &ldquo;+ Stock-In /
                Restock&rdquo; to record stock adjustments.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {branchInventoryLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3 rounded-xl bg-black/30 border border-ink-800 flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-ink-400">
                          {log.date} {log.time}
                        </span>
                        <Badge
                          tone={
                            log.adjustmentType === "Stock-In / Restock"
                              ? "green"
                              : log.adjustmentType === "Waste / Spoilage"
                                ? "red"
                                : "amber"
                          }
                        >
                          {log.adjustmentType}
                        </Badge>
                        <strong className="text-white">
                          {lang === "ar" && log.itemNameAr ? log.itemNameAr : log.itemName}
                        </strong>
                      </div>
                      {log.reasonOrSupplier && (
                        <div className="text-[11px] text-ink-400 mt-0.5">
                          {log.reasonOrSupplier} · By {log.recordedBy}
                        </div>
                      )}
                    </div>

                    <div className="font-mono text-right">
                      <div
                        className={`font-black ${
                          log.quantityDelta > 0 ? "text-emerald-400" : "text-rose-400"
                        }`}
                      >
                        {log.quantityDelta > 0 ? `+${log.quantityDelta}` : log.quantityDelta} (
                        {log.previousStock} → {log.newStock})
                      </div>
                      {log.totalCostImpact !== undefined && (
                        <div className="text-[10px] text-ink-400">
                          Cost Impact: {money(log.totalCostImpact)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          TAB 4: SHIFT & REGISTER MANAGEMENT (Z-REPORT / X-REPORT) & RECEIPTS
      ===================================================================== */}
      {activeSubTab === "shifts_reports" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* 1. Payment Method Breakdown */}
            <Card className="p-5 space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-amber-400">
                {t.paymentBreakdown}
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800">
                  <span className="text-ink-300">{t.cash}</span>
                  <strong className="font-mono text-emerald-400">
                    {money(posAnalytics.cashTotal)}
                  </strong>
                </div>
                <div className="flex items-center justify-between py-1.5 border-b border-ink-800">
                  <span className="text-ink-300">{t.card}</span>
                  <strong className="font-mono text-sky-400">
                    {money(posAnalytics.cardTotal)}
                  </strong>
                </div>
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-ink-300">{t.accountCharge}</span>
                  <strong className="font-mono text-amber-400">
                    {money(posAnalytics.accountTotal)}
                  </strong>
                </div>
              </div>
            </Card>

            {/* 2. Top-Selling Items */}
            <Card className="p-5 space-y-3">
              <div className="text-xs font-black uppercase tracking-wider text-emerald-400">
                {t.topSelling}
              </div>
              {posAnalytics.topSellingItems.length === 0 ? (
                <div className="text-xs text-ink-400 py-4">No sales recorded yet.</div>
              ) : (
                <div className="space-y-2 text-xs">
                  {posAnalytics.topSellingItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between border-b border-ink-800/60 pb-1.5"
                    >
                      <span className="text-white font-semibold">
                        {lang === "ar" && item.nameAr ? item.nameAr : item.name}
                      </span>
                      <span className="font-mono text-amber-400">
                        {item.qty} sold · {money(item.revenue)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 3. Register Shifts (Z-Report / X-Report Audit) */}
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-sky-400">
                  {t.zReportTitle}
                </span>
                {activeOpenShift ? (
                  <Btn
                    variant="secondary"
                    size="xs"
                    onClick={() => {
                      setActualCashCountedInput(String(activeOpenShift.expectedDrawerCash));
                      setCloseShiftModalOpen(true);
                    }}
                  >
                    {t.closeShiftBtn}
                  </Btn>
                ) : (
                  <Btn variant="primary" size="xs" onClick={() => setOpenShiftModalOpen(true)}>
                    {t.openShiftBtn}
                  </Btn>
                )}
              </div>

              {branchShifts.length === 0 ? (
                <div className="text-xs text-ink-400 py-4">
                  Click &ldquo;{t.openShiftBtn}&rdquo; to start a cashier shift with opening float.
                </div>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto text-xs">
                  {branchShifts.map((sh) => (
                    <div
                      key={sh.id}
                      className="p-2.5 rounded-xl bg-black/30 border border-ink-800 space-y-1"
                    >
                      <div className="flex items-center justify-between">
                        <strong className="text-white">{sh.registerName}</strong>
                        <Badge tone={sh.status === "Open" ? "green" : "gray"}>{sh.status}</Badge>
                      </div>
                      <div className="text-[11px] text-ink-400">
                        Float: {money(sh.openingFloat)} · Expected Cash:{" "}
                        <strong className="text-white">{money(sh.expectedDrawerCash)}</strong>
                      </div>
                      {sh.status === "Closed" && (
                        <div className="text-[11px] text-amber-300">
                          Actual Counted: {money(sh.actualCashCounted || 0)} · Variance:{" "}
                          <strong>{money(sh.variance || 0)}</strong>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Recent POS Receipts Table */}
          <Card className="p-5 space-y-3">
            <h3 className="text-sm font-black text-white uppercase tracking-wider">
              POS Receipt Ledger ({branchTransactions.length})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink-800 text-[10px] font-black uppercase text-ink-400">
                    <th className="py-2.5 px-3">Receipt #</th>
                    <th className="py-2.5 px-3">Date &amp; Time</th>
                    <th className="py-2.5 px-3">Customer</th>
                    <th className="py-2.5 px-3">Items</th>
                    <th className="py-2.5 px-3">Payment</th>
                    <th className="py-2.5 px-3">Total</th>
                    <th className="py-2.5 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800/60">
                  {branchTransactions.map((tx) => (
                    <tr key={tx.id}>
                      <td className="py-2.5 px-3 font-mono font-bold text-amber-400">
                        {tx.receiptNumber}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-ink-300">
                        {tx.date} {tx.time}
                      </td>
                      <td className="py-2.5 px-3 text-white font-semibold">{tx.customerName}</td>
                      <td className="py-2.5 px-3 text-ink-300">
                        {tx.items.map((i) => `${i.quantity}x ${getItemDisplayName(i)}`).join(", ")}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone={tx.status === "Refunded" ? "red" : "green"}>
                          {tx.paymentMethod} ({tx.status})
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 font-mono font-bold text-white">
                        {money(tx.total)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Btn variant="secondary" size="xs" onClick={() => setActiveReceipt(tx)}>
                            <Printer className="w-3 h-3" /> Receipt
                          </Btn>
                          {tx.status === "Completed" && (
                            <Btn
                              variant="ghost"
                              size="xs"
                              onClick={() => handleRefundTransaction(tx)}
                            >
                              <RotateCcw className="w-3 h-3 text-rose-400" /> {t.refundSale}
                            </Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: ADD / EDIT PRODUCT (BILINGUAL EN & AR + BARCODE + VAT)
      ===================================================================== */}
      <Modal
        open={productModalOpen}
        onClose={() => setProductModalOpen(false)}
        title={editingProductId ? "Edit POS Product" : t.addProduct}
      >
        <div dir={isRtl ? "rtl" : "ltr"} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
            <Field label="Product Name (English)">
              <Input
                value={productForm.name}
                onChange={(e) => setProductForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Double Espresso Shot"
              />
            </Field>
            <Field label="اسم المنتج (Arabic)">
              <Input
                value={productForm.nameAr}
                onChange={(e) => setProductForm((f) => ({ ...f, nameAr: e.target.value }))}
                placeholder="قهوة إسبريسو دبل"
              />
            </Field>
            <Field label="Category">
              <Select
                value={productForm.category}
                onChange={(e) => setProductForm((f) => ({ ...f, category: e.target.value }))}
              >
                {POS_CATEGORIES.filter((c) => c.id !== "All").map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.en} / {cat.ar}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Icon / Emoji">
              <Input
                value={productForm.imageIcon}
                onChange={(e) => setProductForm((f) => ({ ...f, imageIcon: e.target.value }))}
              />
            </Field>
            <Field label={t.barcodeLabel}>
              <Input
                value={productForm.barcode}
                onChange={(e) => setProductForm((f) => ({ ...f, barcode: e.target.value }))}
              />
            </Field>
            <Field label={t.skuLabel}>
              <Input
                value={productForm.sku}
                onChange={(e) => setProductForm((f) => ({ ...f, sku: e.target.value }))}
              />
            </Field>
            <Field label={t.costPrice}>
              <Input
                type="number"
                value={productForm.costPrice}
                onChange={(e) =>
                  setProductForm((f) => ({ ...f, costPrice: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label={t.sellingPrice}>
              <Input
                type="number"
                value={productForm.price}
                onChange={(e) => setProductForm((f) => ({ ...f, price: Number(e.target.value) }))}
              />
            </Field>
            <Field label={t.taxRate}>
              <Input
                type="number"
                value={productForm.taxRatePct}
                onChange={(e) =>
                  setProductForm((f) => ({ ...f, taxRatePct: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label={t.stockCount}>
              <Input
                type="number"
                value={productForm.stock}
                onChange={(e) => setProductForm((f) => ({ ...f, stock: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setProductModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveProduct}>
              Save Product
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 2: STOCK-IN / RESTOCK & WASTE ADJUSTMENT
      ===================================================================== */}
      <Modal
        open={invModalOpen}
        onClose={() => setInvModalOpen(false)}
        title="Inventory Stock-In / Waste Adjustment"
      >
        <div dir={isRtl ? "rtl" : "ltr"} className="space-y-4">
          <Field label="Select Product">
            <Select
              value={invForm.itemId}
              onChange={(e) => setInvForm((f) => ({ ...f, itemId: e.target.value }))}
            >
              {catalogItems.map((i) => (
                <option key={i.id} value={i.id}>
                  {getItemDisplayName(i)} (Current: {i.stock})
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 items-end gap-3">
            <Field label="Adjustment Type">
              <Select
                value={invForm.adjustmentType}
                onChange={(e) =>
                  setInvForm((f) => ({
                    ...f,
                    adjustmentType: e.target.value as typeof invForm.adjustmentType,
                  }))
                }
              >
                <option value="Stock-In / Restock">Stock-In / Restock (+)</option>
                <option value="Waste / Spoilage">Waste / Spoilage (-)</option>
                <option value="Manual Correction">Manual Correction (+)</option>
              </Select>
            </Field>
            <Field label="Quantity">
              <Input
                type="number"
                value={invForm.quantity}
                onChange={(e) => setInvForm((f) => ({ ...f, quantity: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Unit Cost">
              <Input
                type="number"
                value={invForm.unitCost}
                onChange={(e) => setInvForm((f) => ({ ...f, unitCost: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <Field label="Supplier / Reason Note">
            <Input
              value={invForm.reasonOrSupplier}
              onChange={(e) => setInvForm((f) => ({ ...f, reasonOrSupplier: e.target.value }))}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setInvModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveInventoryAdjustment}>
              Confirm Stock Adjustment
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 3: OPEN REGISTER SHIFT
      ===================================================================== */}
      <Modal
        open={openShiftModalOpen}
        onClose={() => setOpenShiftModalOpen(false)}
        title={t.openShiftBtn}
      >
        <div dir={isRtl ? "rtl" : "ltr"} className="space-y-4">
          <Field label="Register / Terminal Name">
            <Input
              value={registerNameInput}
              onChange={(e) => setRegisterNameInput(e.target.value)}
            />
          </Field>
          <Field label={t.openingFloat}>
            <Input
              type="number"
              value={openingFloatInput}
              onChange={(e) => setOpeningFloatInput(Number(e.target.value) || 0)}
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
            <Btn variant="secondary" onClick={() => setOpenShiftModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleOpenRegisterShift}>
              {t.openShiftBtn}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 4: CLOSE REGISTER SHIFT (Z-REPORT CASH RECONCILIATION)
      ===================================================================== */}
      <Modal
        open={closeShiftModalOpen}
        onClose={() => setCloseShiftModalOpen(false)}
        title={t.zReportTitle}
      >
        {activeOpenShift && (
          <div dir={isRtl ? "rtl" : "ltr"} className="space-y-4">
            <div className="p-3.5 rounded-xl bg-black/35 border border-ink-800 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-400">{t.openingFloat}</span>
                <strong className="font-mono text-white">
                  {money(activeOpenShift.openingFloat)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">{t.cash} Sales</span>
                <strong className="font-mono text-emerald-400">
                  {money(activeOpenShift.cashSalesTotal)}
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">{t.card} Sales</span>
                <strong className="font-mono text-sky-400">
                  {money(activeOpenShift.cardSalesTotal)}
                </strong>
              </div>
              <div className="flex justify-between pt-2 border-t border-ink-800 text-sm">
                <span className="font-bold text-white">{t.expectedCash}</span>
                <strong className="font-mono text-amber-400">
                  {money(activeOpenShift.expectedDrawerCash)}
                </strong>
              </div>
            </div>

            <Field label={t.actualCash}>
              <Input
                type="number"
                value={actualCashCountedInput}
                onChange={(e) => setActualCashCountedInput(e.target.value)}
              />
            </Field>

            <div className="p-3 rounded-xl bg-black/25 border border-ink-800 flex items-center justify-between text-xs">
              <span>{t.variance}</span>
              <strong className="font-mono text-sm text-white">
                {money((Number(actualCashCountedInput) || 0) - activeOpenShift.expectedDrawerCash)}
              </strong>
            </div>

            <Field label="Shift Closing Notes">
              <Input value={closeShiftNotes} onChange={(e) => setCloseShiftNotes(e.target.value)} />
            </Field>

            <div className="flex justify-end gap-2 pt-3 border-t border-ink-800">
              <Btn variant="secondary" onClick={() => setCloseShiftModalOpen(false)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={handleCloseRegisterShift}>
                {t.closeShiftBtn}
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          MODAL 5: PRINTABLE / VIEWABLE THERMAL POS RECEIPT
      ===================================================================== */}
      <Modal
        open={Boolean(activeReceipt)}
        onClose={() => setActiveReceipt(null)}
        title={t.receiptTitle}
      >
        {activeReceipt && (
          <div dir={isRtl ? "rtl" : "ltr"} className="space-y-4">
            <div className="p-5 rounded-xl bg-white text-black font-mono text-xs space-y-3">
              <div className="text-center border-b border-dashed border-gray-400 pb-3">
                <div className="text-base font-black">VESCIO NEXUS POS</div>
                <div className="text-[11px]">{activeReceipt.branch}</div>
                <div className="text-[10px] text-gray-600">
                  {activeReceipt.receiptNumber} · {activeReceipt.date} {activeReceipt.time}
                </div>
                <div className="text-[10px] text-gray-600">
                  Customer: {activeReceipt.customerName} ({activeReceipt.customerType})
                </div>
              </div>

              <div className="space-y-1.5 border-b border-dashed border-gray-400 pb-3">
                {activeReceipt.items.map((item, i) => (
                  <div key={i} className="flex justify-between">
                    <span>
                      {item.quantity}x {getItemDisplayName(item)}
                    </span>
                    <span className="font-bold">{money(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <span>{t.subtotal}:</span>
                  <span>{money(activeReceipt.subtotal)}</span>
                </div>
                {activeReceipt.discount > 0 && (
                  <div className="flex justify-between">
                    <span>{t.cartDiscount}:</span>
                    <span>-{money(activeReceipt.discount)}</span>
                  </div>
                )}
                {(activeReceipt.taxTotal || 0) > 0 && (
                  <div className="flex justify-between">
                    <span>{t.taxVat}:</span>
                    <span>{money(activeReceipt.taxTotal || 0)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-black border-t border-gray-400 pt-1.5">
                  <span>{t.grandTotal}:</span>
                  <span>{money(activeReceipt.total)}</span>
                </div>
                <div className="flex justify-between pt-1">
                  <span>{t.paymentMethod}:</span>
                  <span>{activeReceipt.paymentMethod}</span>
                </div>
                {activeReceipt.changeDue !== undefined && activeReceipt.changeDue > 0 && (
                  <div className="flex justify-between">
                    <span>{t.changeDue}:</span>
                    <span>{money(activeReceipt.changeDue)}</span>
                  </div>
                )}
              </div>

              <div className="text-center pt-2 border-t border-dashed border-gray-400 text-[10px] text-gray-600">
                ||| |||| || ||||| |||| ||| ||||
                <div>{activeReceipt.receiptNumber}</div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Btn variant="secondary" onClick={() => setActiveReceipt(null)}>
                Close
              </Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  window.print();
                }}
              >
                <Printer className="w-3.5 h-3.5" /> {t.printReceipt}
              </Btn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
