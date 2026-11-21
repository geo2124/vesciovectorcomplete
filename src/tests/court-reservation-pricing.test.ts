import { describe, it, expect } from "vitest";
import {
  calculateCourtReservationPricing,
  calculateCourtCashInMath,
} from "../components/nexus-court-reservations";

describe("Court Reservation Pricing, Snapshot Rates, Discounts & Cash-In Math", () => {
  it("calculates Private Rate base fee for 1 player plus extraPlayerRate for additional players", () => {
    // Private Rate: unitRate (1 client base) = $40, extraPlayerRate = $15
    // For 3 players (1 base + 2 extra): 40 + 2 * 15 = $70
    const pricing = calculateCourtReservationPricing({
      startTime: "16:00",
      endTime: "17:30",
      rateType: "Private Rate",
      unitRate: 40,
      extraPlayerRate: 15,
      playerCount: 3,
      freePass: false,
      discountPercent: 0,
      discountFixedAmount: 0,
    });

    expect(pricing.isTimeValid).toBe(true);
    expect(pricing.durationHours).toBe(1.5);
    expect(pricing.playerCount).toBe(3);
    expect(pricing.baseCalculatedAmount).toBe(70);
    expect(pricing.finalPayable).toBe(70);
  });

  it("preserves snapshot unitRate & extraPlayerRate on historical reservations", () => {
    const snapshotPricing = calculateCourtReservationPricing({
      startTime: "10:00",
      endTime: "11:00",
      rateType: "Private Rate",
      unitRate: 40,
      extraPlayerRate: 10,
      playerCount: 2,
    });

    // Uses snapshot (40 + 1*10 = 50)
    expect(snapshotPricing.unitRate).toBe(40);
    expect(snapshotPricing.extraPlayerRate).toBe(10);
    expect(snapshotPricing.baseCalculatedAmount).toBe(50);
    expect(snapshotPricing.finalPayable).toBe(50);
  });

  it("accurately applies Free Pass, Discount %, and Fixed Discount Amount", () => {
    // Full Court Rate = $60/hr -> 2 hours = $120 baseCalculatedAmount
    const freePass = calculateCourtReservationPricing({
      startTime: "18:00",
      endTime: "20:00",
      rateType: "Full Court Rate",
      unitRate: 60,
      freePass: true,
    });
    expect(freePass.baseCalculatedAmount).toBe(120);
    expect(freePass.finalPayable).toBe(0);

    const pctDiscount = calculateCourtReservationPricing({
      startTime: "18:00",
      endTime: "20:00",
      rateType: "Full Court Rate",
      unitRate: 60,
      discountPercent: 25,
    });
    expect(pctDiscount.baseCalculatedAmount).toBe(120);
    expect(pctDiscount.pctDeduction).toBe(30);
    expect(pctDiscount.finalPayable).toBe(90);

    const fixedDiscount = calculateCourtReservationPricing({
      startTime: "18:00",
      endTime: "20:00",
      rateType: "Full Court Rate",
      unitRate: 60,
      discountFixedAmount: 35,
    });
    expect(fixedDiscount.baseCalculatedAmount).toBe(120);
    expect(fixedDiscount.finalPayable).toBe(85);
  });

  it("computes partial vs full cash-in math and paymentStatus transitions", () => {
    const partial = calculateCourtCashInMath({
      totalAmount: 100,
      alreadyPaidAmount: 0,
      collectAmountInput: 40,
      paymentMethod: "Cash",
    });
    expect(partial.confirmedCollectAmount).toBe(40);
    expect(partial.newTotalPaid).toBe(40);
    expect(partial.remainingBalance).toBe(60);
    expect(partial.paymentStatus).toBe("Partial");

    const settled = calculateCourtCashInMath({
      totalAmount: 100,
      alreadyPaidAmount: 40,
      collectAmountInput: 60,
      paymentMethod: "Cash",
    });
    expect(settled.confirmedCollectAmount).toBe(60);
    expect(settled.newTotalPaid).toBe(100);
    expect(settled.remainingBalance).toBe(0);
    expect(settled.paymentStatus).toBe("Paid");
  });
});
