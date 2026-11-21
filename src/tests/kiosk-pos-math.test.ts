import { describe, it, expect } from "vitest";
import {
  calculatePosCartTotals,
  convertPosCurrency,
  calculatePosStockDeduction,
  DEFAULT_LBP_PER_USD_RATE,
} from "../components/nexus-pos-module";
import type { PosCartLineItem, PosCatalogItem } from "../lib/data-store";

const makeCatalogItem = (overrides: Partial<PosCatalogItem> = {}): PosCatalogItem => ({
  id: "pos-drink-1",
  name: "Isotonic Sports Drink",
  nameAr: "مشروب رياضي",
  category: "Hydration & Drinks",
  sku: "DRK-001",
  barcode: "6281000001",
  costPrice: 1.2,
  price: 3.5,
  taxRatePct: 10,
  stock: 20,
  lowStockThreshold: 5,
  active: true,
  ...overrides,
});

describe("Kiosk POS Cart Totals, Discounts, Stock Deduction & LBP/USD Conversion Math", () => {
  it("calculates cart subtotal, item-level and cart-level discounts, VAT tax, and cash change due in USD and LBP", () => {
    const line1: PosCartLineItem = {
      itemId: "pos-drink-1",
      name: "Isotonic Sports Drink",
      category: "Hydration & Drinks",
      quantity: 2,
      unitPrice: 5,
      itemDiscount: 1, // Line subtotal = 2*5 - 1 = 9
      taxRatePct: 10,
      taxAmount: 0.9,
      subtotal: 9,
    };
    const line2: PosCartLineItem = {
      itemId: "pos-snack-1",
      name: "Protein Bar",
      category: "Snacks & Nutrition",
      quantity: 3,
      unitPrice: 4,
      itemDiscount: 0, // Line subtotal = 12
      taxRatePct: 0,
      taxAmount: 0,
      subtotal: 12,
    };

    // Raw subtotal = 9 + 12 = 21; cartDiscount = 3; taxTotal = 0.9 -> Grand Total = 18.90
    const totals = calculatePosCartTotals({
      cart: [line1, line2],
      cartDiscount: 3,
      amountTendered: 20,
      paymentMethod: "Cash",
      lbpRate: 89500,
    });

    expect(totals.subtotal).toBe(21);
    expect(totals.discount).toBe(3);
    expect(totals.taxTotal).toBe(0.9);
    expect(totals.total).toBe(18.9);
    expect(totals.totalLbp).toBe(Math.round(18.9 * 89500));
    expect(totals.changeDue).toBe(1.1);
    expect(totals.changeDueLbp).toBe(Math.round(1.1 * 89500));
  });

  it("converts bidirectionally between USD and LBP using the configured exchange rate", () => {
    const usdToLbp = convertPosCurrency({ amountUsd: 10, lbpRate: 89500 });
    expect(usdToLbp.usd).toBe(10);
    expect(usdToLbp.lbp).toBe(895000);

    const lbpToUsd = convertPosCurrency({ amountLbp: 179000, lbpRate: 89500 });
    expect(lbpToUsd.lbp).toBe(179000);
    expect(lbpToUsd.usd).toBe(2);

    const defaultRateConv = convertPosCurrency({ amountUsd: 1 });
    expect(defaultRateConv.lbp).toBe(DEFAULT_LBP_PER_USD_RATE);
  });

  it("deducts physical inventory stock accurately, leaves unlimited pass items (>= 999) untouched, and throws on insufficient stock", () => {
    const drink = makeCatalogItem({ id: "pos-drink-1", stock: 15 });
    const dayPass = makeCatalogItem({
      id: "pos-pass-1",
      name: "Walk-In Day Pass",
      stock: 999,
      price: 15,
    });

    const cart: PosCartLineItem[] = [
      {
        itemId: "pos-drink-1",
        name: drink.name,
        category: drink.category,
        quantity: 4,
        unitPrice: drink.price,
        subtotal: 14,
      },
      {
        itemId: "pos-pass-1",
        name: dayPass.name,
        category: dayPass.category,
        quantity: 2,
        unitPrice: dayPass.price,
        subtotal: 30,
      },
    ];

    const res = calculatePosStockDeduction({
      catalogItems: [drink, dayPass],
      cart,
    });

    expect(res.updatedCatalog.find((i) => i.id === "pos-drink-1")?.stock).toBe(11);
    expect(res.updatedCatalog.find((i) => i.id === "pos-pass-1")?.stock).toBe(999);

    expect(() =>
      calculatePosStockDeduction({
        catalogItems: [makeCatalogItem({ id: "pos-drink-1", stock: 2 })],
        cart,
      }),
    ).toThrow(/Insufficient stock/);
  });
});
