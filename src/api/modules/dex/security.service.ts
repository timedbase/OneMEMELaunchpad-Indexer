import { Injectable } from "@nestjs/common";
import { fetchGoPlusTokenSecurity, type GoPlusRawToken } from "./goplus";

// ─── Public types ─────────────────────────────────────────────────────────────

export type RiskLevel = "unknown" | "low" | "medium" | "high" | "critical";

export interface TokenSecurityReport {
  address:               string;
  tokenName:             string | null;
  tokenSymbol:           string | null;
  // Swap-critical flags
  isHoneypot:            boolean;
  cannotBuy:             boolean;
  cannotSellAll:         boolean;
  transferPausable:      boolean;
  // Tax
  buyTax:                string | null;  // decimal string from GoPlus, e.g. "0.05" = 5%
  sellTax:               string | null;
  buyTaxBps:             number | null;  // e.g. 500 = 5%
  sellTaxBps:            number | null;
  // Ownership / admin risks
  isBlacklisted:         boolean;
  isMintable:            boolean;
  isProxy:               boolean;
  isOpenSource:          boolean;
  canTakeBackOwnership:  boolean;
  ownerChangeBalance:    boolean;
  hiddenOwner:           boolean;
  selfDestruct:          boolean;
  externalCall:          boolean;
  isFakeToken:           boolean;
  // Trading restrictions
  isAntiWhale:           boolean;
  antiWhaleModifiable:   boolean;
  tradingCooldown:       boolean;
  slippageModifiable:    boolean;
  // Supply / holders
  holderCount:           string | null;
  totalSupply:           string | null;
  ownerAddress:          string | null;
  creatorAddress:        string | null;
  isInDex:               boolean;
  dex:                   GoPlusRawToken["dex"];
  holders:               GoPlusRawToken["holders"];
  // Summary
  riskLevel:             RiskLevel;
  warnings:              string[];
  note:                  string | null;
  dataAvailable:         boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function flag(v?: string): boolean {
  return v === "1";
}

/**
 * Converts a GoPlus tax string ("0.05" = 5%) to basis points (500).
 * Returns null when the value is absent, zero, or not a positive number.
 */
function toBps(taxStr?: string): number | null {
  if (!taxStr || taxStr === "" || taxStr === "0") return null;
  const n = parseFloat(taxStr);
  if (isNaN(n) || n <= 0) return null;
  // GoPlus returns a decimal fraction: "0.05" → 0.05 * 10000 = 500 bps.
  // Math.round handles floating-point imprecision (e.g. 0.3 * 10000 = 3000.0000000000003).
  return Math.round(n * 10_000);
}

function deriveRiskLevel(r: TokenSecurityReport): RiskLevel {
  if (!r.dataAvailable)                                          return "unknown";
  if (r.isHoneypot || r.isFakeToken)                            return "critical";
  if (r.hiddenOwner || r.transferPausable || r.canTakeBackOwnership ||
      r.isBlacklisted || r.cannotBuy || r.cannotSellAll)        return "high";
  const maxTaxBps = Math.max(r.sellTaxBps ?? 0, r.buyTaxBps ?? 0);
  if (maxTaxBps > 1_000 || r.isMintable || r.isProxy ||
      r.ownerChangeBalance || r.slippageModifiable)             return "medium";
  if (maxTaxBps > 0 || r.isAntiWhale || r.tradingCooldown ||
      r.selfDestruct || r.externalCall || !r.isOpenSource)      return "low";
  return "low";
}

function buildWarnings(r: TokenSecurityReport): string[] {
  const w: string[] = [];
  if (r.isHoneypot)            w.push("Honeypot — cannot sell");
  if (r.isFakeToken)           w.push("Token is flagged as a fake/imitation");
  if (r.cannotBuy)             w.push("Buying is currently disabled");
  if (r.cannotSellAll)         w.push("Cannot sell 100% of tokens in one transaction");
  if (r.transferPausable)      w.push("Transfers can be paused by owner");
  if (r.hiddenOwner)           w.push("Hidden owner detected");
  if (r.canTakeBackOwnership)  w.push("Owner can reclaim contract ownership");
  if (r.ownerChangeBalance)    w.push("Owner can modify holder balances");
  if (r.isBlacklisted)         w.push("Contract has a blacklist function");
  if (r.isMintable)            w.push("Token supply is mintable");
  if (r.isProxy)               w.push("Contract is upgradeable (proxy)");
  if (r.slippageModifiable)    w.push("Owner can modify slippage/tax");
  if (r.isAntiWhale)           w.push("Anti-whale limits apply");
  if (r.antiWhaleModifiable)   w.push("Anti-whale limit can be changed by owner");
  if (r.tradingCooldown)       w.push("Trading cooldown enforced");
  if (r.selfDestruct)          w.push("Contract has self-destruct");
  if (r.externalCall)          w.push("Contract makes external calls during transfer");
  if (!r.isOpenSource)         w.push("Contract source code is not verified");
  if (r.buyTaxBps  && r.buyTaxBps  > 0) w.push(`Buy tax: ${(r.buyTaxBps  / 100).toFixed(2)}%`);
  if (r.sellTaxBps && r.sellTaxBps > 0) w.push(`Sell tax: ${(r.sellTaxBps / 100).toFixed(2)}%`);
  return w;
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class SecurityService {
  private readonly chainId: number;

  constructor() {
    this.chainId = parseInt(process.env.CHAIN_ID ?? "56");
  }

  /** Full security report for a token (endpoint response). */
  async getTokenSecurity(address: string): Promise<TokenSecurityReport> {
    const raw = await fetchGoPlusTokenSecurity(this.chainId, address);
    return this.normalise(address, raw);
  }

  /**
   * Returns buy/sell tax in basis points for use in route-quote adjustment.
   * Returns zeros when GoPlus is unavailable or the token has no recorded tax.
   */
  async getTokenTaxBps(address: string): Promise<{ buyBps: bigint; sellBps: bigint }> {
    const raw = await fetchGoPlusTokenSecurity(this.chainId, address);
    if (!raw) return { buyBps: 0n, sellBps: 0n };
    return {
      buyBps:  BigInt(toBps(raw.buy_tax)  ?? 0),
      sellBps: BigInt(toBps(raw.sell_tax) ?? 0),
    };
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private normalise(address: string, raw: GoPlusRawToken | null): TokenSecurityReport {
    if (!raw) {
      return {
        address,
        tokenName: null, tokenSymbol: null,
        isHoneypot: false, cannotBuy: false, cannotSellAll: false,
        transferPausable: false, isBlacklisted: false, isMintable: false,
        isProxy: false, isOpenSource: false, canTakeBackOwnership: false,
        ownerChangeBalance: false, hiddenOwner: false, selfDestruct: false,
        externalCall: false, isFakeToken: false, isAntiWhale: false,
        antiWhaleModifiable: false, tradingCooldown: false, slippageModifiable: false,
        buyTax: null, sellTax: null, buyTaxBps: null, sellTaxBps: null,
        holderCount: null, totalSupply: null, ownerAddress: null, creatorAddress: null,
        isInDex: false, dex: [], holders: [],
        riskLevel: "unknown", warnings: [], note: null, dataAvailable: false,
      };
    }

    const r: TokenSecurityReport = {
      address,
      tokenName:            raw.token_name     ?? null,
      tokenSymbol:          raw.token_symbol   ?? null,
      isHoneypot:           flag(raw.is_honeypot),
      cannotBuy:            flag(raw.cannot_buy),
      cannotSellAll:        flag(raw.cannot_sell_all),
      transferPausable:     flag(raw.transfer_pausable),
      isBlacklisted:        flag(raw.is_blacklisted),
      isMintable:           flag(raw.is_mintable),
      isProxy:              flag(raw.is_proxy),
      isOpenSource:         flag(raw.is_open_source),
      canTakeBackOwnership: flag(raw.can_take_back_ownership),
      ownerChangeBalance:   flag(raw.owner_change_balance),
      hiddenOwner:          flag(raw.hidden_owner),
      selfDestruct:         flag(raw.selfdestruct),
      externalCall:         flag(raw.external_call),
      isFakeToken:          flag(raw.fake_token),
      isAntiWhale:          flag(raw.is_anti_whale),
      antiWhaleModifiable:  flag(raw.anti_whale_modifiable),
      tradingCooldown:      flag(raw.trading_cooldown),
      slippageModifiable:   flag(raw.slippage_modifiable) || flag(raw.personal_slippage_modifiable),
      buyTax:               raw.buy_tax  ?? null,
      sellTax:              raw.sell_tax ?? null,
      buyTaxBps:            toBps(raw.buy_tax),
      sellTaxBps:           toBps(raw.sell_tax),
      holderCount:          raw.holder_count    ?? null,
      totalSupply:          raw.total_supply    ?? null,
      ownerAddress:         raw.owner_address   ?? null,
      creatorAddress:       raw.creator_address ?? null,
      isInDex:              flag(raw.is_in_dex),
      dex:                  raw.dex     ?? [],
      holders:              raw.holders ?? [],
      riskLevel:            "low",
      warnings:             [],
      note:                 raw.note ?? null,
      dataAvailable:        true,
    };

    r.riskLevel = deriveRiskLevel(r);
    r.warnings  = buildWarnings(r);
    return r;
  }
}
