import { randomBytes }                       from "crypto";
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  createPublicClient,
  defineChain,
  encodeFunctionData,
  http,
  parseAbi,
  type Address,
  type PublicClient,
} from "viem";
import {
  detectToken,
  NATIVE,
  ONEDEX,
  PERMIT2,
  QuoteAggregator,
  RouteOptimizer,
  type Quote,
  type Route,
  type SinglePath,
  type RouteStep,
} from "@1swap/sdk";
import type { TokenDetectionResult } from "@1swap/sdk/dist/detector/index.js";
import { isAddress } from "../../helpers";

// ── ABIs ──────────────────────────────────────────────────────────────────────

const ONEDEX_EXECUTE_ABI = parseAbi([
  "function execute(address tokenIn, uint256 amountIn, address tokenOut, uint256 minAmountOut, address recipient, uint256 deadline, bytes executionData) external payable returns (uint256 amountOut)",
]);

// executeWithPermit2 uses a tuple — parseAbi doesn't support nested tuples cleanly,
// so we define this as a const ABI object.
const ONEDEX_EXECUTE_PERMIT2_ABI = [
  {
    inputs: [
      { name: "tokenIn",       type: "address" },
      { name: "amountIn",      type: "uint256" },
      { name: "tokenOut",      type: "address" },
      { name: "minAmountOut",  type: "uint256" },
      { name: "recipient",     type: "address" },
      { name: "deadline",      type: "uint256" },
      { name: "executionData", type: "bytes"   },
      {
        name: "permit", type: "tuple",
        components: [
          {
            name: "permitted", type: "tuple",
            components: [
              { name: "token",  type: "address" },
              { name: "amount", type: "uint256" },
            ],
          },
          { name: "nonce",    type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      { name: "signature", type: "bytes" },
    ],
    name:            "executeWithPermit2",
    outputs:         [{ name: "amountOut", type: "uint256" }],
    stateMutability: "nonpayable",
    type:            "function",
  },
] as const;

// ── Constants ─────────────────────────────────────────────────────────────────

const BSC_CHAIN_ID = 56;

// ── Permit2 EIP-712 ───────────────────────────────────────────────────────────

function buildPermit2TypedData(
  token:    Address,
  amount:   bigint,
  nonce:    bigint,
  deadline: bigint,
  spender:  Address,
) {
  return {
    domain: {
      name:              "Permit2",
      chainId:           BSC_CHAIN_ID,
      verifyingContract: PERMIT2,
    },
    types: {
      PermitTransferFrom: [
        { name: "permitted", type: "TokenPermissions" },
        { name: "spender",   type: "address"          },
        { name: "nonce",     type: "uint256"           },
        { name: "deadline",  type: "uint256"           },
      ],
      TokenPermissions: [
        { name: "token",  type: "address" },
        { name: "amount", type: "uint256" },
      ],
    },
    primaryType: "PermitTransferFrom" as const,
    message: {
      permitted: { token, amount },
      spender,
      nonce,
      deadline,
    },
  };
}

function secureNonce(): bigint {
  return BigInt("0x" + randomBytes(32).toString("hex"));
}

@Injectable()
export class OneswapService {
  private _client:     PublicClient | null    = null;
  private _aggregator: QuoteAggregator | null = null;
  private _optimizer:  RouteOptimizer | null  = null;

  // ── RPC client ───────────────────────────────────────────────────────────────

  private getClient(): PublicClient {
    if (!process.env.BSC_RPC_URL) {
      throw new ServiceUnavailableException("BSC_RPC_URL is not configured.");
    }
    if (!this._client) {
      // Override the SDK's hardcoded ONEMEME_BONDING_CURVE address with the
      // one from env so detectToken() and the OneMeme adapter hit the correct
      // contract. All SDK modules reference this property at call-time via the
      // CommonJS exports object, so patching it here is safe.
      if (process.env.BONDING_CURVE_ADDRESS) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sdkConst = require("@1swap/sdk/dist/constants.js") as Record<string, string>;
        sdkConst["ONEMEME_BONDING_CURVE"] = process.env.BONDING_CURVE_ADDRESS;
      }

      const chainId = parseInt(process.env.CHAIN_ID ?? "56");
      const chain = defineChain({
        id:             chainId,
        name:           "EVM",
        nativeCurrency: { name: "Native", symbol: "ETH", decimals: 18 },
        rpcUrls:        { default: { http: [process.env.BSC_RPC_URL] } },
      });
      this._client    = createPublicClient({
        chain,
        transport: http(process.env.BSC_RPC_URL, { timeout: 15_000, retryCount: 2, retryDelay: 500 }),
      });
      this._aggregator = new QuoteAggregator(this._client);
      this._optimizer  = new RouteOptimizer(this._client);
    }
    return this._client;
  }

  // ── Input parsers ────────────────────────────────────────────────────────────

  private resolveToken(input: string | undefined, paramName: string): Address {
    if (!input) throw new BadRequestException(`${paramName} is required`);
    const lower = input.toLowerCase();
    if (lower === "native" || lower === "bnb" || lower === NATIVE.toLowerCase()) {
      return NATIVE;
    }
    if (!isAddress(input)) {
      throw new BadRequestException(`${paramName} must be a valid EVM address or "native"`);
    }
    return lower as Address;
  }

  private parseDeadline(raw: string | undefined): bigint {
    if (!raw) return BigInt(Math.floor(Date.now() / 1000) + 300);
    let d: bigint;
    try   { d = BigInt(raw); }
    catch { throw new BadRequestException("deadline must be a valid unix timestamp"); }
    if (d <= BigInt(Math.floor(Date.now() / 1000))) {
      throw new BadRequestException("deadline is in the past");
    }
    return d;
  }

  // ── Route builder ────────────────────────────────────────────────────────────

  private async buildRouteOrThrow(
    tokenIn:     Address,
    tokenOut:    Address,
    amountIn:    bigint,
    recipient:   Address,
    slippageBps: bigint,
  ): Promise<Route> {
    this.getClient();
    let route: Route | null;
    try {
      route = await this._optimizer!.buildRoute({ tokenIn, tokenOut, amountIn, recipient, slippageBps });
    } catch (err: unknown) {
      throw new ServiceUnavailableException(`Routing failed: ${String(err)}`);
    }
    if (!route) {
      throw new NotFoundException("No route found for this token pair");
    }
    return route;
  }

  // ── Serialisers ──────────────────────────────────────────────────────────────

  private serializeStep(s: RouteStep) {
    return {
      protocol:  s.protocol,
      tokenIn:   s.tokenIn,
      tokenOut:  s.tokenOut,
      amountIn:  s.amountIn.toString(),
      amountOut: s.amountOut.toString(),
    };
  }

  private serializePath(p: SinglePath) {
    return {
      splitBps:  p.splitBps.toString(),
      amountIn:  p.amountIn.toString(),
      amountOut: p.amountOut.toString(),
      steps:     p.steps.map(s => this.serializeStep(s)),
    };
  }

  private buildSummary(
    route:        Route,
    tokenIn:      Address,
    tokenOut:     Address,
    amountIn:     bigint,
    minAmountOut: bigint,
    slippageBps:  bigint,
    deadline:     bigint,
  ) {
    return {
      tokenIn,
      tokenOut,
      amountIn:      amountIn.toString(),
      amountOut:     route.amountOut.toString(),
      minAmountOut:  minAmountOut.toString(),
      kind:          route.kind,
      slippageBps:   slippageBps.toString(),
      deadline:      deadline.toString(),
      oneDex:        ONEDEX,
      permit2:       PERMIT2,
      paths:         route.paths.map(p => this.serializePath(p)),
    };
  }

  private serializeQuote(q: Quote) {
    // meta is intentionally omitted — adapters can store bigints there which
    // are not JSON-serializable and are internal routing detail only.
    return {
      protocol:  q.protocol,
      amountOut: q.amountOut.toString(),
      fee:       q.fee.toString(),
    };
  }

  private serializeDetection(result: TokenDetectionResult, token: Address) {
    return {
      token,
      bondingCurve: result.bondingCurve,
      graduated:    result.graduated,
      isTaxToken:   result.isTaxToken,
      ammProtocols: result.ammProtocols,
    };
  }

  // ── Endpoints ────────────────────────────────────────────────────────────────

  async quotes(query: Record<string, string>) {
    const tokenIn  = this.resolveToken(query["tokenIn"],  "tokenIn");
    const tokenOut = this.resolveToken(query["tokenOut"], "tokenOut");

    if (!query["amountIn"]) throw new BadRequestException("amountIn is required (wei)");
    let amountIn: bigint;
    try   { amountIn = BigInt(query["amountIn"]); }
    catch { throw new BadRequestException("amountIn must be a valid integer (wei)"); }
    if (amountIn <= 0n) throw new BadRequestException("amountIn must be greater than 0");
    if (tokenIn === tokenOut) throw new BadRequestException("tokenIn and tokenOut must be different");

    const client     = this.getClient();
    const aggregator = this._aggregator!;
    let quotes: Quote[];
    try {
      quotes = await aggregator.getQuotes(client, { tokenIn, tokenOut, amountIn });
    } catch (err: unknown) {
      throw new ServiceUnavailableException(`Quote fetch failed: ${String(err)}`);
    }

    return {
      data: {
        tokenIn,
        tokenOut,
        amountIn: amountIn.toString(),
        quotes:   quotes.map(q => this.serializeQuote(q)),
      },
    };
  }

  async route(query: Record<string, string>) {
    const tokenIn   = this.resolveToken(query["tokenIn"],  "tokenIn");
    const tokenOut  = this.resolveToken(query["tokenOut"], "tokenOut");
    const recipient = this.resolveToken(query["recipient"], "recipient");

    if (!query["amountIn"]) throw new BadRequestException("amountIn is required (wei)");
    let amountIn: bigint, slippageBps: bigint;
    try   { amountIn = BigInt(query["amountIn"]); }
    catch { throw new BadRequestException("amountIn must be a valid integer (wei)"); }
    try   { slippageBps = BigInt(query["slippageBps"] ?? "50"); }
    catch { throw new BadRequestException("slippageBps must be a valid integer"); }

    if (amountIn <= 0n)                          throw new BadRequestException("amountIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 1000n) throw new BadRequestException("slippageBps must be between 0 and 1000");
    if (tokenIn === tokenOut)                    throw new BadRequestException("tokenIn and tokenOut must be different");

    const r            = await this.buildRouteOrThrow(tokenIn, tokenOut, amountIn, recipient, slippageBps);
    const minAmountOut = (r.amountOut * (10_000n - slippageBps)) / 10_000n;

    return {
      data: {
        tokenIn:       r.tokenIn,
        tokenOut:      r.tokenOut,
        amountIn:      r.amountIn.toString(),
        amountOut:     r.amountOut.toString(),
        minAmountOut:  minAmountOut.toString(),
        kind:          r.kind,
        slippageBps:   slippageBps.toString(),
        totalFee:      r.totalFee.toString(),
        oneDex:        ONEDEX,
        executionData: r.executionData,
        paths:         r.paths.map(p => this.serializePath(p)),
      },
    };
  }

  async execute(query: Record<string, string>) {
    const tokenIn   = this.resolveToken(query["tokenIn"],  "tokenIn");
    const tokenOut  = this.resolveToken(query["tokenOut"], "tokenOut");
    const recipient = this.resolveToken(query["recipient"], "recipient");

    if (!query["amountIn"]) throw new BadRequestException("amountIn is required (wei)");
    let amountIn: bigint, slippageBps: bigint;
    try   { amountIn = BigInt(query["amountIn"]); }
    catch { throw new BadRequestException("amountIn must be a valid integer (wei)"); }
    try   { slippageBps = BigInt(query["slippageBps"] ?? "50"); }
    catch { throw new BadRequestException("slippageBps must be a valid integer"); }

    if (amountIn <= 0n)                          throw new BadRequestException("amountIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 1000n) throw new BadRequestException("slippageBps must be between 0 and 1000");
    if (tokenIn === tokenOut)                    throw new BadRequestException("tokenIn and tokenOut must be different");

    const deadline     = this.parseDeadline(query["deadline"]);
    const r            = await this.buildRouteOrThrow(tokenIn, tokenOut, amountIn, recipient, slippageBps);
    const minAmountOut = (r.amountOut * (10_000n - slippageBps)) / 10_000n;
    const isNativeIn   = tokenIn === NATIVE;

    const txData = encodeFunctionData({
      abi:          ONEDEX_EXECUTE_ABI,
      functionName: "execute",
      args:         [tokenIn, amountIn, tokenOut, minAmountOut, recipient, deadline, r.executionData],
    });

    return {
      data: {
        tx: {
          to:    ONEDEX,
          data:  txData,
          value: isNativeIn ? amountIn.toString() : "0",
          from:  recipient,
        },
        approval: isNativeIn ? null : {
          token:   tokenIn,
          spender: ONEDEX,
          amount:  amountIn.toString(),
        },
        ...this.buildSummary(r, tokenIn, tokenOut, amountIn, minAmountOut, slippageBps, deadline),
      },
    };
  }

  async executePermit2(query: Record<string, string>) {
    const tokenIn   = this.resolveToken(query["tokenIn"],  "tokenIn");
    const tokenOut  = this.resolveToken(query["tokenOut"], "tokenOut");
    const recipient = this.resolveToken(query["recipient"], "recipient");

    if (tokenIn === NATIVE) {
      throw new BadRequestException("Permit2 is not needed for native BNB — use GET /execute");
    }

    if (!query["amountIn"]) throw new BadRequestException("amountIn is required (wei)");
    let amountIn: bigint, slippageBps: bigint;
    try   { amountIn = BigInt(query["amountIn"]); }
    catch { throw new BadRequestException("amountIn must be a valid integer (wei)"); }
    try   { slippageBps = BigInt(query["slippageBps"] ?? "50"); }
    catch { throw new BadRequestException("slippageBps must be a valid integer"); }

    if (amountIn <= 0n)                          throw new BadRequestException("amountIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 1000n) throw new BadRequestException("slippageBps must be between 0 and 1000");
    if (tokenIn === tokenOut)                    throw new BadRequestException("tokenIn and tokenOut must be different");

    const deadline = this.parseDeadline(query["deadline"]);
    let nonce: bigint;
    if (query["nonce"]) {
      try   { nonce = BigInt(query["nonce"]); }
      catch { throw new BadRequestException("nonce must be a valid integer"); }
    } else {
      nonce = secureNonce();
    }

    const r            = await this.buildRouteOrThrow(tokenIn, tokenOut, amountIn, recipient, slippageBps);
    const minAmountOut = (r.amountOut * (10_000n - slippageBps)) / 10_000n;
    const typedData    = buildPermit2TypedData(tokenIn, amountIn, nonce, deadline, ONEDEX);

    return {
      data: {
        typedData,
        nonce:    nonce.toString(),
        nextStep: "POST /oneswap/execute/permit2/submit",
        ...this.buildSummary(r, tokenIn, tokenOut, amountIn, minAmountOut, slippageBps, deadline),
      },
    };
  }

  async executePermit2Submit(body: Record<string, string>) {
    const tokenIn   = this.resolveToken(body["tokenIn"],  "tokenIn");
    const tokenOut  = this.resolveToken(body["tokenOut"], "tokenOut");
    const recipient = this.resolveToken(body["recipient"], "recipient");

    if (tokenIn === NATIVE) {
      throw new BadRequestException("Permit2 is not needed for native BNB — use GET /execute");
    }
    if (tokenIn === tokenOut) throw new BadRequestException("tokenIn and tokenOut must be different");

    if (!body["amountIn"]) throw new BadRequestException("amountIn is required (wei)");
    let amountIn: bigint, slippageBps: bigint, permit2Nonce: bigint;
    try   { amountIn = BigInt(body["amountIn"]); }
    catch { throw new BadRequestException("amountIn must be a valid integer (wei)"); }
    try   { slippageBps = BigInt(body["slippageBps"] ?? "50"); }
    catch { throw new BadRequestException("slippageBps must be a valid integer"); }
    try   { permit2Nonce = BigInt(body["permit2Nonce"]); }
    catch { throw new BadRequestException("permit2Nonce is required and must be a valid integer"); }

    if (amountIn <= 0n)                          throw new BadRequestException("amountIn must be greater than 0");
    if (slippageBps < 0n || slippageBps > 1000n) throw new BadRequestException("slippageBps must be between 0 and 1000");

    const deadline  = this.parseDeadline(body["deadline"]);
    const signature = body["signature"];
    if (!signature) throw new BadRequestException("signature is required");
    if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new BadRequestException("signature must be a 0x-prefixed 65-byte ECDSA signature (130 hex chars)");
    }

    const r            = await this.buildRouteOrThrow(tokenIn, tokenOut, amountIn, recipient, slippageBps);
    const minAmountOut = (r.amountOut * (10_000n - slippageBps)) / 10_000n;

    const permit = {
      permitted: { token: tokenIn, amount: amountIn },
      nonce:     permit2Nonce,
      deadline,
    };

    const txData = encodeFunctionData({
      abi:          ONEDEX_EXECUTE_PERMIT2_ABI,
      functionName: "executeWithPermit2",
      args:         [tokenIn, amountIn, tokenOut, minAmountOut, recipient, deadline, r.executionData, permit, signature as `0x${string}`],
    });

    return {
      data: {
        tx: {
          to:    ONEDEX,
          data:  txData,
          value: "0",
          from:  recipient,
        },
        approval:    null,
        usedPermit2: true,
        ...this.buildSummary(r, tokenIn, tokenOut, amountIn, minAmountOut, slippageBps, deadline),
      },
    };
  }

  async token(address: string) {
    if (!isAddress(address)) throw new BadRequestException("address must be a valid EVM address");

    const client = this.getClient();
    const token  = address.toLowerCase() as Address;
    let result: Awaited<ReturnType<typeof detectToken>>;
    try {
      result = await detectToken(client, token);
    } catch (err: unknown) {
      throw new ServiceUnavailableException(`Token detection failed: ${String(err)}`);
    }

    return { data: this.serializeDetection(result, token) };
  }
}
