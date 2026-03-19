import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { sql } from "../../db";
import { applySlippage, getSpotPrice, priceImpactBps, quoteBuy, quoteSell } from "../../rpc";
import { isAddress, normalizeAddress } from "../../helpers";

function formatWei(wei: bigint): string {
  const s       = wei.toString().padStart(19, "0");
  const intPart = s.slice(0, -18) || "0";
  const decPart = s.slice(-18).replace(/0+$/, "") || "0";
  return `${intPart}.${decPart}`;
}

@Injectable()
export class QuotesService {

  private async requireActiveBondingCurve(address: string) {
    const [row] = await sql`
      SELECT "id", "migrated", "tokenType", "tradingBlock", "antibotEnabled"
      FROM token
      WHERE id = ${normalizeAddress(address)}
    `;
    if (!row) throw new NotFoundException(`Token ${address} not found in index`);
    return row;
  }

  async spotPrice(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const row = await this.requireActiveBondingCurve(address);

    if (row.migrated) {
      return {
        data: {
          token:    normalizeAddress(address),
          migrated: true,
          message:  "Token has migrated to PancakeSwap. Fetch price from the DEX pair instead.",
          pair:     null,
        },
      };
    }

    let spotPriceWei: bigint;
    try {
      spotPriceWei = await getSpotPrice(normalizeAddress(address) as `0x${string}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) {
        throw new ServiceUnavailableException("Quote simulation requires BSC_RPC_URL and FACTORY_ADDRESS.");
      }
      throw err;
    }

    const tokensPerBNB = spotPriceWei > 0n ? (BigInt(1e18) * BigInt(1e18)) / spotPriceWei : 0n;

    return {
      data: {
        token:           normalizeAddress(address),
        migrated:        false,
        spotPriceWei:    spotPriceWei.toString(),
        spotPriceBNB:    formatWei(spotPriceWei),
        tokensPerBNB:    formatWei(tokensPerBNB),
        antibotEnabled:  row.antibotEnabled,
        tradingBlock:    row.tradingBlock?.toString() ?? null,
      },
    };
  }

  async buy(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const bnbInStr    = query["bnbIn"];
    const slippageStr = query["slippage"] ?? "100";

    if (!bnbInStr) throw new BadRequestException("bnbIn query parameter is required (wei)");

    let bnbIn: bigint, slippageBps: bigint;
    try {
      bnbIn       = BigInt(bnbInStr);
      slippageBps = BigInt(slippageStr);
    } catch {
      throw new BadRequestException("bnbIn and slippage must be valid integers");
    }

    if (bnbIn <= 0n) throw new BadRequestException("bnbIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 500n) {
      throw new BadRequestException("slippage must be between 0 and 500 basis points (5%)");
    }

    const row = await this.requireActiveBondingCurve(address);

    if (row.migrated) {
      return { data: { token: normalizeAddress(address), migrated: true, message: "Token has migrated to PancakeSwap. Use the DEX router for swaps." } };
    }

    const token = normalizeAddress(address) as `0x${string}`;

    let tokensOut: bigint, spot: bigint;
    try {
      [tokensOut, spot] = await Promise.all([quoteBuy(token, bnbIn), getSpotPrice(token)]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) throw new ServiceUnavailableException("Quote simulation requires BSC_RPC_URL and FACTORY_ADDRESS.");
      throw err;
    }

    const impact     = priceImpactBps(spot, bnbIn, tokensOut, "buy");
    const minOutput  = applySlippage(tokensOut, slippageBps);
    const effectiveP = tokensOut > 0n ? (bnbIn * BigInt(1e18)) / tokensOut : 0n;

    return {
      data: {
        token, type: "buy", migrated: false,
        bnbIn: bnbIn.toString(), bnbInFormatted: formatWei(bnbIn),
        tokensOut: tokensOut.toString(), tokensOutFormatted: formatWei(tokensOut),
        spotPriceWei: spot.toString(), spotPriceBNB: formatWei(spot),
        effectivePriceWei: effectiveP.toString(), effectivePriceBNB: formatWei(effectiveP),
        priceImpactBps: impact.toString(), priceImpactPct: `${(Number(impact) / 100).toFixed(2)}%`,
        slippageBps: slippageBps.toString(),
        minimumOutput: minOutput.toString(), minimumOutputFormatted: formatWei(minOutput),
        antibotEnabled: row.antibotEnabled, tradingBlock: row.tradingBlock?.toString() ?? null,
      },
    };
  }

  async sell(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const tokensInStr = query["tokensIn"];
    const slippageStr = query["slippage"] ?? "100";

    if (!tokensInStr) throw new BadRequestException("tokensIn query parameter is required (wei)");

    let tokensIn: bigint, slippageBps: bigint;
    try {
      tokensIn    = BigInt(tokensInStr);
      slippageBps = BigInt(slippageStr);
    } catch {
      throw new BadRequestException("tokensIn and slippage must be valid integers");
    }

    if (tokensIn <= 0n) throw new BadRequestException("tokensIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 500n) {
      throw new BadRequestException("slippage must be between 0 and 500 basis points (5%)");
    }

    const row = await this.requireActiveBondingCurve(address);

    if (row.migrated) {
      return { data: { token: normalizeAddress(address), migrated: true, message: "Token has migrated to PancakeSwap. Use the DEX router for swaps." } };
    }

    const token = normalizeAddress(address) as `0x${string}`;

    let bnbOut: bigint, spot: bigint;
    try {
      [bnbOut, spot] = await Promise.all([quoteSell(token, tokensIn), getSpotPrice(token)]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not configured")) throw new ServiceUnavailableException("Quote simulation requires BSC_RPC_URL and FACTORY_ADDRESS.");
      throw err;
    }

    const impact     = priceImpactBps(spot, tokensIn, bnbOut, "sell");
    const minOutput  = applySlippage(bnbOut, slippageBps);
    const effectiveP = tokensIn > 0n ? (bnbOut * BigInt(1e18)) / tokensIn : 0n;

    return {
      data: {
        token, type: "sell", migrated: false,
        tokensIn: tokensIn.toString(), tokensInFormatted: formatWei(tokensIn),
        bnbOut: bnbOut.toString(), bnbOutFormatted: formatWei(bnbOut),
        spotPriceWei: spot.toString(), spotPriceBNB: formatWei(spot),
        effectivePriceWei: effectiveP.toString(), effectivePriceBNB: formatWei(effectiveP),
        priceImpactBps: impact.toString(), priceImpactPct: `${(Number(impact) / 100).toFixed(2)}%`,
        slippageBps: slippageBps.toString(),
        minimumOutput: minOutput.toString(), minimumOutputFormatted: formatWei(minOutput),
        antibotEnabled: row.antibotEnabled, tradingBlock: row.tradingBlock?.toString() ?? null,
      },
    };
  }
}
