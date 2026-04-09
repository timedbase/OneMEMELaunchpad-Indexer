/**
 * Shared token types, price computation, and normalization helpers used by
 * tokens.service.ts and discover.service.ts.
 *
 * Price formulae (all values in wei / 18-decimal BigInt):
 *   virtualLiquidity   = virtualBNB + raisedBNB
 *   price (BNB/token)  = virtualLiquidity² / (virtualBNB × totalSupply) × 1e18
 *   marketCap (BNB)    = virtualLiquidity² / virtualBNB  (already in wei → divide by 1e18)
 */

import { formatBigDecimal } from "./subgraph";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCALE18 = 10n ** 18n;

// ─── Type maps ────────────────────────────────────────────────────────────────

export const TO_API_TYPE: Record<string, string> = {
  STANDARD:   "Standard",
  TAX:        "Tax",
  REFLECTION: "Reflection",
  UNKNOWN:    "Unknown",
};

export const FROM_API_TYPE: Record<string, string> = {
  Standard:   "STANDARD",
  Tax:        "TAX",
  Reflection: "REFLECTION",
};

// ─── Subgraph type ────────────────────────────────────────────────────────────

export interface SubgraphToken {
  id:                       string;
  creator:                  string;
  name:                     string | null;
  symbol:                   string | null;
  totalSupply:              string;
  tokenType:                string;
  virtualBNB:               string;
  migrationTarget:          string;
  antibotEnabled:           boolean;
  tradingBlock:             string;
  raisedBNB:                string;
  migrated:                 boolean;
  pair:                     string | null;
  migrationBNB:             string | null;
  migrationLiquidityTokens: string | null;
  migratedAtTimestamp:      string | null;
  migratedAtBlockNumber:    string | null;
  buysCount:                string;
  sellsCount:               string;
  totalVolumeBNBBuy:        string;
  totalVolumeBNBSell:       string;
  createdAtTimestamp:       string;
  createdAtBlockNumber:     string;
  txHash:                   string;
  metaUri:                  string | null;
  description:              string | null;
  image:                    string | null;
  website:                  string | null;
  twitter:                  string | null;
  telegram:                 string | null;
}

// ─── Shared GraphQL field list ────────────────────────────────────────────────

export const TOKEN_FIELDS = `
  id creator name symbol totalSupply tokenType
  virtualBNB migrationTarget antibotEnabled tradingBlock
  raisedBNB migrated pair migrationBNB migrationLiquidityTokens
  migratedAtTimestamp migratedAtBlockNumber
  buysCount sellsCount totalVolumeBNBBuy totalVolumeBNBSell
  createdAtTimestamp createdAtBlockNumber txHash
  metaUri description image website twitter telegram
`;

// ─── Price computation ────────────────────────────────────────────────────────

export function computeTokenPrice(t: SubgraphToken) {
  if (t.migrated && t.migrationBNB && t.migrationLiquidityTokens) {
    const liqBNB    = BigInt(t.migrationBNB);
    const liqTokens = BigInt(t.migrationLiquidityTokens);
    const supply    = BigInt(t.totalSupply);
    if (liqTokens === 0n) {
      return { priceBnb: "0.0", marketCapBnb: "0.0", virtualLiquidityBnb: formatBigDecimal(liqBNB, 18) };
    }
    return {
      priceBnb:            formatBigDecimal((liqBNB * SCALE18) / liqTokens, 18),
      marketCapBnb:        formatBigDecimal((liqBNB * supply) / liqTokens, 18),
      virtualLiquidityBnb: formatBigDecimal(liqBNB, 18),
    };
  }
  const vBNB   = BigInt(t.virtualBNB);
  const rBNB   = BigInt(t.raisedBNB);
  const supply = BigInt(t.totalSupply);
  const vl     = vBNB + rBNB;
  if (vBNB === 0n || supply === 0n) {
    return { priceBnb: "0.0", marketCapBnb: "0.0", virtualLiquidityBnb: formatBigDecimal(vl, 18) };
  }
  return {
    priceBnb:            formatBigDecimal((vl * vl * SCALE18) / (vBNB * supply), 18),
    marketCapBnb:        formatBigDecimal((vl * vl) / vBNB, 18),
    virtualLiquidityBnb: formatBigDecimal(vl, 18),
  };
}

// ─── Normalizer ───────────────────────────────────────────────────────────────

export function normalizeToken(t: SubgraphToken) {
  return {
    id:              t.id,
    creator:         t.creator,
    name:            t.name ?? null,
    symbol:          t.symbol ?? null,
    totalSupply:     t.totalSupply,
    tokenType:       TO_API_TYPE[t.tokenType] ?? t.tokenType,
    virtualBnb:      t.virtualBNB,
    migrationTarget: t.migrationTarget,
    antibotEnabled:  t.antibotEnabled,
    tradingBlock:    t.tradingBlock,
    raisedBnb:       t.raisedBNB,
    migrated:        t.migrated,
    pairAddress:     t.pair ?? null,
    buyCount:        t.buysCount,
    sellCount:       t.sellsCount,
    volumeBnb:       (BigInt(t.totalVolumeBNBBuy) + BigInt(t.totalVolumeBNBSell)).toString(),
    createdAtBlock:      t.createdAtBlockNumber,
    createdAtTimestamp:  t.createdAtTimestamp,
    creationTxHash:      t.txHash,
    metaUri:     t.metaUri     ?? null,
    description: t.description ?? null,
    image:       t.image       ?? null,
    website:     t.website     ?? null,
    twitter:     t.twitter     ?? null,
    telegram:    t.telegram    ?? null,
    ...computeTokenPrice(t),
  };
}
