/**
 * Quote routes — real-time bonding-curve price simulation
 *
 * All quotes are fetched live from the LaunchpadFactory contract via RPC,
 * so they reflect the exact on-chain state at the time of the request.
 *
 * GET /tokens/:address/quote/price         Current spot price
 * GET /tokens/:address/quote/buy           Simulate a buy (BNB → tokens)
 * GET /tokens/:address/quote/sell          Simulate a sell (tokens → BNB)
 *
 * Rate limit: 20 req/min per IP (each request triggers an RPC call to BSC).
 */

import { Hono } from "hono";
import { sql } from "../db";
import {
  applySlippage,
  getSpotPrice,
  priceImpactBps,
  quoteBuy,
  quoteSell,
} from "../rpc";
import { badRequest, isAddress, notFound, serverError } from "../helpers";

const app = new Hono();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formats a wei bigint as a human-readable decimal string (18 decimals). */
function formatWei(wei: bigint): string {
  const s      = wei.toString().padStart(19, "0");
  const intPart = s.slice(0, -18) || "0";
  const decPart = s.slice(-18).replace(/0+$/, "") || "0";
  return `${intPart}.${decPart}`;
}

/** Returns a 503 when RPC env vars are not configured. */
function rpcUnconfigured(c: ReturnType<Hono["route"]> extends never ? never : Parameters<Parameters<Hono["get"]>[1]>[0]) {
  return c.json(
    {
      error:   "Service Unavailable",
      message: "Quote simulation requires BSC_RPC_URL and FACTORY_ADDRESS to be configured.",
    },
    503
  );
}

/**
 * Fetches the token from the DB and validates it exists and is not migrated.
 * Returns { row } on success or an early Response on failure.
 */
async function requireActiveBondingCurve(
  c: Parameters<Parameters<Hono["get"]>[1]>[0],
  address: string
) {
  const [row] = await sql`SELECT "id", "migrated", "tokenType", "tradingBlock", "antibotEnabled" FROM token WHERE id = ${address.toLowerCase()}`;
  if (!row) {
    return { error: notFound(c, `Token ${address} not found in index`) };
  }
  return { row };
}

// ─── Spot price ───────────────────────────────────────────────────────────────

/**
 * GET /tokens/:address/quote/price
 *
 * Returns the current spot price of a token on the bonding curve, fetched
 * live from the contract.
 *
 * Response:
 *   spotPriceWei       BNB per token, scaled to 1e18 (raw contract value)
 *   spotPriceBNB       Human-readable BNB per token (e.g. "0.000081")
 *   tokensPerBNB       Inverse: how many tokens 1 BNB buys at spot (approx)
 *   migrated           Whether the token has left the bonding curve
 */
app.get("/:address/quote/price", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const result = await requireActiveBondingCurve(c, address);
    if ("error" in result) return result.error;
    const { row } = result;

    if (row.migrated) {
      return c.json({
        data: {
          token:    address.toLowerCase(),
          migrated: true,
          message:  "Token has migrated to PancakeSwap. Fetch price from the DEX pair instead.",
          pair:     null,
        },
      });
    }

    let spotPriceWei: bigint;
    try {
      spotPriceWei = await getSpotPrice(address.toLowerCase() as `0x${string}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) return rpcUnconfigured(c as any);
      throw err;
    }

    // tokensPerBNB ≈ 1e18 / spotPriceWei  (rough inverse at current price)
    const tokensPerBNB =
      spotPriceWei > 0n ? (BigInt(1e18) * BigInt(1e18)) / spotPriceWei : 0n;

    return c.json({
      data: {
        token:         address.toLowerCase(),
        migrated:      false,
        spotPriceWei:  spotPriceWei.toString(),
        spotPriceBNB:  formatWei(spotPriceWei),
        tokensPerBNB:  formatWei(tokensPerBNB),
        antibotEnabled: row.antibotEnabled,
        tradingBlock:   row.tradingBlock?.toString() ?? null,
      },
    });
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Buy quote ────────────────────────────────────────────────────────────────

/**
 * GET /tokens/:address/quote/buy?bnbIn=<wei>
 *
 * Simulates purchasing tokens with a given amount of BNB on the bonding curve.
 * Calls `getAmountOut` on the live contract — includes trade fee and any
 * active antibot penalty.
 *
 * Query params:
 *   bnbIn      required  BNB input in wei (e.g. "1000000000000000000" = 1 BNB)
 *   slippage   optional  Slippage tolerance in basis points (default 100 = 1%)
 *
 * Response:
 *   bnbIn              Input BNB in wei
 *   tokensOut          Estimated gross token output in wei
 *   tokensOutFormatted Human-readable token amount
 *   spotPriceWei       Spot price before trade (BNB / token)
 *   effectivePriceWei  Effective execution price (bnbIn / tokensOut)
 *   priceImpactBps     Price impact in basis points
 *   priceImpactPct     Price impact as percentage string
 *   slippageBps        Applied slippage tolerance
 *   minimumOutput      Minimum tokens to receive after slippage
 *   migrated           Whether token has left the bonding curve
 */
app.get("/:address/quote/buy", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const bnbInStr   = c.req.query("bnbIn");
    const slippageStr = c.req.query("slippage") ?? "100"; // default 1%

    if (!bnbInStr) return badRequest(c, "bnbIn query parameter is required (wei)");

    let bnbIn: bigint;
    let slippageBps: bigint;
    try {
      bnbIn       = BigInt(bnbInStr);
      slippageBps = BigInt(slippageStr);
    } catch {
      return badRequest(c, "bnbIn and slippage must be valid integers");
    }

    if (bnbIn <= 0n)      return badRequest(c, "bnbIn must be greater than 0");
    if (slippageBps > 5_000n) return badRequest(c, "slippage cannot exceed 5000 bps (50%)");

    const result = await requireActiveBondingCurve(c, address);
    if ("error" in result) return result.error;
    const { row } = result;

    if (row.migrated) {
      return c.json({
        data: {
          token:    address.toLowerCase(),
          migrated: true,
          message:  "Token has migrated to PancakeSwap. Use the DEX router for swaps.",
        },
      });
    }

    const token = address.toLowerCase() as `0x${string}`;

    let tokensOut: bigint;
    let spot: bigint;
    try {
      [tokensOut, spot] = await Promise.all([
        quoteBuy(token, bnbIn),
        getSpotPrice(token),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) return rpcUnconfigured(c as any);
      throw err;
    }

    const impact      = priceImpactBps(spot, bnbIn, tokensOut, "buy");
    const minOutput   = applySlippage(tokensOut, slippageBps);
    const effectiveP  = tokensOut > 0n ? (bnbIn * BigInt(1e18)) / tokensOut : 0n;
    const impactPct   = Number(impact) / 100;

    return c.json({
      data: {
        token:               token,
        type:                "buy",
        migrated:            false,
        // Input
        bnbIn:               bnbIn.toString(),
        bnbInFormatted:      formatWei(bnbIn),
        // Output
        tokensOut:           tokensOut.toString(),
        tokensOutFormatted:  formatWei(tokensOut),
        // Pricing
        spotPriceWei:        spot.toString(),
        spotPriceBNB:        formatWei(spot),
        effectivePriceWei:   effectiveP.toString(),
        effectivePriceBNB:   formatWei(effectiveP),
        priceImpactBps:      impact.toString(),
        priceImpactPct:      `${impactPct.toFixed(2)}%`,
        // Slippage
        slippageBps:         slippageBps.toString(),
        minimumOutput:       minOutput.toString(),
        minimumOutputFormatted: formatWei(minOutput),
        // Token metadata
        antibotEnabled:      row.antibotEnabled,
        tradingBlock:        row.tradingBlock?.toString() ?? null,
      },
    });
  } catch (err) {
    return serverError(c, err);
  }
});

// ─── Sell quote ───────────────────────────────────────────────────────────────

/**
 * GET /tokens/:address/quote/sell?tokensIn=<wei>
 *
 * Simulates selling a given amount of tokens back to the bonding curve.
 * Calls `getAmountOutSell` on the live contract — includes trade fee.
 *
 * Query params:
 *   tokensIn   required  Token input in wei (e.g. "1000000000000000000000" = 1000 tokens)
 *   slippage   optional  Slippage tolerance in basis points (default 100 = 1%)
 *
 * Response:
 *   tokensIn             Input tokens in wei
 *   bnbOut               Estimated BNB output in wei
 *   bnbOutFormatted      Human-readable BNB amount
 *   spotPriceWei         Spot price before trade (BNB / token)
 *   effectivePriceWei    Effective execution price (bnbOut / tokensIn)
 *   priceImpactBps       Price impact in basis points
 *   priceImpactPct       Price impact as percentage string
 *   slippageBps          Applied slippage tolerance
 *   minimumOutput        Minimum BNB to receive after slippage
 *   migrated             Whether token has left the bonding curve
 */
app.get("/:address/quote/sell", async (c) => {
  try {
    const { address } = c.req.param();
    if (!isAddress(address)) return badRequest(c, "Invalid token address");

    const tokensInStr = c.req.query("tokensIn");
    const slippageStr = c.req.query("slippage") ?? "100";

    if (!tokensInStr) return badRequest(c, "tokensIn query parameter is required (wei)");

    let tokensIn: bigint;
    let slippageBps: bigint;
    try {
      tokensIn    = BigInt(tokensInStr);
      slippageBps = BigInt(slippageStr);
    } catch {
      return badRequest(c, "tokensIn and slippage must be valid integers");
    }

    if (tokensIn <= 0n)       return badRequest(c, "tokensIn must be greater than 0");
    if (slippageBps > 5_000n) return badRequest(c, "slippage cannot exceed 5000 bps (50%)");

    const result = await requireActiveBondingCurve(c, address);
    if ("error" in result) return result.error;
    const { row } = result;

    if (row.migrated) {
      return c.json({
        data: {
          token:    address.toLowerCase(),
          migrated: true,
          message:  "Token has migrated to PancakeSwap. Use the DEX router for swaps.",
        },
      });
    }

    const token = address.toLowerCase() as `0x${string}`;

    let bnbOut: bigint;
    let spot: bigint;
    try {
      [bnbOut, spot] = await Promise.all([
        quoteSell(token, tokensIn),
        getSpotPrice(token),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) return rpcUnconfigured(c as any);
      throw err;
    }

    const impact     = priceImpactBps(spot, tokensIn, bnbOut, "sell");
    const minOutput  = applySlippage(bnbOut, slippageBps);
    const effectiveP = tokensIn > 0n ? (bnbOut * BigInt(1e18)) / tokensIn : 0n;
    const impactPct  = Number(impact) / 100;

    return c.json({
      data: {
        token:               token,
        type:                "sell",
        migrated:            false,
        // Input
        tokensIn:            tokensIn.toString(),
        tokensInFormatted:   formatWei(tokensIn),
        // Output
        bnbOut:              bnbOut.toString(),
        bnbOutFormatted:     formatWei(bnbOut),
        // Pricing
        spotPriceWei:        spot.toString(),
        spotPriceBNB:        formatWei(spot),
        effectivePriceWei:   effectiveP.toString(),
        effectivePriceBNB:   formatWei(effectiveP),
        priceImpactBps:      impact.toString(),
        priceImpactPct:      `${impactPct.toFixed(2)}%`,
        // Slippage
        slippageBps:         slippageBps.toString(),
        minimumOutput:       minOutput.toString(),
        minimumOutputFormatted: formatWei(minOutput),
        // Token metadata
        antibotEnabled:      row.antibotEnabled,
        tradingBlock:        row.tradingBlock?.toString() ?? null,
      },
    });
  } catch (err) {
    return serverError(c, err);
  }
});

export default app;
