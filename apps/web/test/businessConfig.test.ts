/**
 * Port of `test/business_config_test.dart`, plus the BackendException contract.
 */
import { describe, expect, it } from "vitest";
import {
  BackendException,
  DEFAULT_BUSINESS_CONFIG,
  businessConfigFromMap,
  isBackendException,
} from "../lib/backend/types";

describe("BusinessConfig.fromMap", () => {
  it("BusinessConfig membaca nilai server yang valid", () => {
    const config = businessConfigFromMap({
      service_fee: 1500,
      merchant_commission_bps: 1250,
      withdrawal_fee: 3000,
      minimum_withdrawal: 75000,
      payments_enabled: true,
      payouts_enabled: true,
    });

    expect(config.serviceFee).toBe(1500);
    expect(config.merchantCommissionBps).toBe(1250);
    expect(config.withdrawalFee).toBe(3000);
    expect(config.minimumWithdrawal).toBe(75000);
    expect(config.paymentsEnabled).toBe(true);
    expect(config.payoutsEnabled).toBe(true);
  });

  it("BusinessConfig menolak nilai negatif dan membatasi komisi", () => {
    const config = businessConfigFromMap({
      service_fee: -1,
      merchant_commission_bps: 25000,
      withdrawal_fee: -10,
      minimum_withdrawal: -50,
    });

    expect(config.serviceFee).toBe(1000);
    expect(config.merchantCommissionBps).toBe(10000);
    expect(config.withdrawalFee).toBe(2500);
    expect(config.minimumWithdrawal).toBe(50000);
    expect(config.paymentsEnabled).toBe(false);
    expect(config.payoutsEnabled).toBe(false);
  });

  it("missing keys fall back to the const constructor defaults", () => {
    expect(businessConfigFromMap({})).toEqual(DEFAULT_BUSINESS_CONFIG);
  });

  it("fractional values are truncated like num.toInt()", () => {
    expect(businessConfigFromMap({ service_fee: 1500.9, minimum_withdrawal: 60000.4 })).toMatchObject({
      serviceFee: 1500,
      minimumWithdrawal: 60000,
    });
  });

  it("feature flags are only on for a literal true", () => {
    const config = businessConfigFromMap({ payments_enabled: "true", payouts_enabled: 1 });
    expect(config.paymentsEnabled).toBe(false);
    expect(config.payoutsEnabled).toBe(false);
  });

  it("the default config matches `const BusinessConfig()` and cannot be mutated", () => {
    expect(DEFAULT_BUSINESS_CONFIG).toEqual({
      serviceFee: 1000,
      merchantCommissionBps: 1000,
      withdrawalFee: 2500,
      minimumWithdrawal: 50000,
      paymentsEnabled: false,
      payoutsEnabled: false,
    });
    expect(Object.isFrozen(DEFAULT_BUSINESS_CONFIG)).toBe(true);
  });
});

describe("BackendException", () => {
  it("carries a code and a user-facing message", () => {
    const error = new BackendException("insufficient_stock", "Stok bag sudah berubah. Silakan cek kembali.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("BackendException");
    expect(error.code).toBe("insufficient_stock");
    expect(error.message).toBe("Stok bag sudah berubah. Silakan cek kembali.");
    expect(isBackendException(error)).toBe(true);
    expect(isBackendException(new Error("x"))).toBe(false);
    expect(isBackendException({ code: "x", message: "y" })).toBe(false);
  });
});
