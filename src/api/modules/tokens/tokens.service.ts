import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { subgraphFetch, subgraphFetchAll, subgraphCount, tradeSourceId } from "../../subgraph";
import { SubgraphToken, TOKEN_FIELDS, FROM_API_TYPE, normalizeToken, SCALE18 } from "../../token-utils";
import { formatBigDecimal } from "../../subgraph";
import { getPairPrice, readMetaURI } from "../../rpc";
import { fetchMetadata } from "../../metadata";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";
import { PriceService } from "../price/price.service";

// ─── Local constants ──────────────────────────────────────────────────────────

const TOKEN_ORDER_MAP: Record<string, string> = {
  created_at_block: "createdAtBlockNumber",
  volume_bnb:       "raisedBNB",
  buy_count:        "buysCount",
  sell_count:       "sellsCount",
  raised_bnb:       "raisedBNB",
  total_supply:     "totalSupply",
};

const TRADE_ORDER_MAP: Record<string, string> = {
  timestamp:    "timestamp",
  bnb_amount:   "bnbAmount",
  token_amount: "tokenAmount",
  block_number: "blockNumber",
};

interface SubgraphTrade {
  id:           string;
  token:        { id: string };
  trader:       string;
  type:         "BUY" | "SELL";
  bnbAmount:    string;
  tokenAmount:  string;
  tokensToDead: string;
  blockNumber:  string;
  timestamp:    string;
  txHash:       string;
}

interface SubgraphMigration {
  txHash:          string;
  pair:            string;
  liquidityBNB:    string;
  liquidityTokens: string;
  blockNumber:     string;
  timestamp:       string;
  token:           { id: string; creator: string };
}

interface SubgraphHolder {
  address:              string;
  balance:              string;
  lastUpdatedBlock:     string;
  lastUpdatedTimestamp: string;
}

interface SubgraphSnapshot {
  blockNumber:  string;
  timestamp:    string;
  openRaisedBNB:  string;
  closeRaisedBNB: string;
  volumeBNB:    string;
  buyCount:     string;
  sellCount:    string;
  token:        { virtualBNB: string; totalSupply: string };
}

// ─── GraphQL queries ──────────────────────────────────────────────────────────

const TOKENS_LIST_QUERY = /* GraphQL */ `
  query TokenList(
    $first: Int!, $skip: Int!
    $orderBy: Token_orderBy!, $orderDirection: OrderDirection!
    $where: Token_filter
  ) {
    tokens(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      ${TOKEN_FIELDS}
    }
  }
`;

const TOKENS_COUNT_QUERY = /* GraphQL */ `
  query TokenCount($where: Token_filter, $first: Int!, $skip: Int!) {
    tokens(first: $first, skip: $skip, where: $where) { id }
  }
`;

const TOKEN_QUERY = /* GraphQL */ `
  query Token($id: ID!) {
    token(id: $id) { ${TOKEN_FIELDS} }
  }
`;

const TRADES_FOR_TOKEN_QUERY = /* GraphQL */ `
  query TradesForToken(
    $token: String!, $first: Int!, $skip: Int!
    $orderBy: Trade_orderBy!, $orderDirection: OrderDirection!
    $where: Trade_filter
  ) {
    trades(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      id trader type bnbAmount tokenAmount tokensToDead blockNumber timestamp txHash
      token { id }
    }
  }
`;

const TRADES_COUNT_QUERY = /* GraphQL */ `
  query TradesCount($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where) { id }
  }
`;

const ALL_TRADES_FOR_TOKEN_QUERY = /* GraphQL */ `
  query AllTradesForToken($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where, orderBy: timestamp, orderDirection: asc) {
      id trader type bnbAmount token { id }
    }
  }
`;

const MIGRATION_FOR_TOKEN_QUERY = /* GraphQL */ `
  query MigrationForToken($token: String!) {
    migrations(first: 1, where: { token: $token }) {
      txHash pair liquidityBNB liquidityTokens blockNumber timestamp
      token { id creator }
    }
  }
`;

const HOLDERS_QUERY = /* GraphQL */ `
  query Holders(
    $token: String!, $first: Int!, $skip: Int!
    $orderDirection: OrderDirection!
  ) {
    holders(
      first: $first, skip: $skip
      orderBy: balance, orderDirection: $orderDirection
      where: { token: $token, balance_gt: "0" }
    ) {
      address balance lastUpdatedBlock lastUpdatedTimestamp
    }
  }
`;

const HOLDERS_COUNT_QUERY = /* GraphQL */ `
  query HoldersCount($token: String!, $first: Int!, $skip: Int!) {
    holders(first: $first, skip: $skip, where: { token: $token, balance_gt: "0" }) { id }
  }
`;

const SNAPSHOTS_QUERY = /* GraphQL */ `
  query Snapshots($first: Int!, $skip: Int!, $where: TokenSnapshot_filter) {
    tokenSnapshots(
      first: $first, skip: $skip
      orderBy: blockNumber, orderDirection: desc
      where: $where
    ) {
      blockNumber timestamp openRaisedBNB closeRaisedBNB volumeBNB buyCount sellCount
      token { virtualBNB totalSupply }
    }
  }
`;

const SNAPSHOTS_COUNT_QUERY = /* GraphQL */ `
  query SnapshotsCount($where: TokenSnapshot_filter, $first: Int!, $skip: Int!) {
    tokenSnapshots(first: $first, skip: $skip, where: $where) { id }
  }
`;

const TOKEN_EXISTS_QUERY = /* GraphQL */ `
  query TokenExists($id: ID!) {
    token(id: $id) { id }
  }
`;

// ─── Trade normalizer ─────────────────────────────────────────────────────────

function normalizeTrade(t: SubgraphTrade) {
  return {
    id:           tradeSourceId(t.id),
    token:        t.token.id,
    trader:       t.trader,
    tradeType:    t.type === "BUY" ? "buy" : "sell",
    bnbAmount:    t.bnbAmount,
    tokenAmount:  t.tokenAmount,
    tokensToDead: t.tokensToDead,
    blockNumber:  t.blockNumber,
    timestamp:    parseInt(t.timestamp),
    txHash:       t.txHash,
  };
}

function normalizeMigration(m: SubgraphMigration) {
  return {
    id:              m.token.id,   // backward compat: Ponder keyed migration by token address
    txHash:          m.txHash,
    pair:            m.pair,
    liquidityBnb:    m.liquidityBNB,
    liquidityTokens: m.liquidityTokens,
    blockNumber:     m.blockNumber,
    timestamp:       parseInt(m.timestamp),
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class TokensService {
  constructor(private readonly price: PriceService) {}

  private withUsd<T extends Record<string, unknown>>(
    row: T,
  ): T & { priceUsd: string | null; marketCapUsd: string | null } {
    const bnbPrice = this.price.getPrice()?.bnbUsdt ?? null;
    const priceBnb = row["priceBnb"]     as string | null;
    const mcBnb    = row["marketCapBnb"] as string | null;
    return {
      ...row,
      priceUsd:     bnbPrice !== null && priceBnb !== null ? (parseFloat(priceBnb) * bnbPrice).toFixed(10) : null,
      marketCapUsd: bnbPrice !== null && mcBnb    !== null ? (parseFloat(mcBnb)    * bnbPrice).toFixed(2)  : null,
    };
  }

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const type     = query["type"];
    const migrated = query["migrated"];

    const ALLOWED_ORDER = ["created_at_block", "volume_bnb", "buy_count", "sell_count", "raised_bnb", "total_supply"] as const;
    const orderBy  = TOKEN_ORDER_MAP[parseOrderBy(query, ALLOWED_ORDER, "created_at_block")] ?? "createdAtBlockNumber";
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const ALLOWED_TYPES = new Set(["Standard", "Tax", "Reflection"]);
    if (type && !ALLOWED_TYPES.has(type)) {
      throw new BadRequestException(`Invalid type "${type}". Must be Standard, Tax, or Reflection.`);
    }

    const where: Record<string, unknown> = {};
    if (type)     where["tokenType"] = FROM_API_TYPE[type] ?? type;
    if (migrated === "true")  where["migrated"] = true;
    if (migrated === "false") where["migrated"] = false;

    const [{ tokens }, total] = await Promise.all([
      subgraphFetch<{ tokens: SubgraphToken[] }>(TOKENS_LIST_QUERY, {
        first: limit, skip: offset, orderBy, orderDirection: orderDir,
        where: Object.keys(where).length ? where : undefined,
      }),
      subgraphCount("tokens", TOKENS_COUNT_QUERY, {
        where: Object.keys(where).length ? where : undefined,
      }),
    ]);

    return paginated(tokens.map(t => this.withUsd(normalizeToken(t))), total, page, limit);
  }

  async findOne(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const addr = normalizeAddress(address);
    const { token } = await subgraphFetch<{ token: SubgraphToken | null }>(TOKEN_QUERY, { id: addr });
    if (!token) throw new NotFoundException(`Token ${address} not found`);

    const row = normalizeToken(token) as Record<string, unknown>;

    // Subgraph resolves metadata via ipfs.cat() at index time.
    // Fall back to a direct IPFS fetch only if the subgraph fields are all null
    // (e.g. ipfs.cat() failed or timed out during indexing).
    if (token.metaUri && !token.description && !token.image && !token.website) {
      const meta = await fetchMetadata(token.metaUri);
      if (meta) {
        if (meta.description)          row["description"] = meta.description;
        if (meta.image)                row["image"]       = meta.image;
        if (meta.website)              row["website"]     = meta.website;
        if (meta.socials?.twitter)     row["twitter"]     = meta.socials.twitter;
        if (meta.socials?.telegram)    row["telegram"]    = meta.socials.telegram;
      }
    }

    // Override with live PancakeSwap price for migrated tokens.
    if (token.migrated && token.pair) {
      const live = await getPairPrice(
        token.pair as `0x${string}`,
        addr       as `0x${string}`,
        BigInt(token.totalSupply),
      );
      if (live) {
        row["priceBnb"]     = live.priceBnb;
        row["marketCapBnb"] = live.marketCapBnb;
      }
    }

    return { data: this.withUsd(row) };
  }

  async trades(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const type = query["type"];
    const from = query["from"];
    const to   = query["to"];

    if (type && type !== "buy" && type !== "sell") throw new BadRequestException('type must be "buy" or "sell"');
    const fromInt = from ? parseInt(from, 10) : null;
    const toInt   = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");

    const ALLOWED_ORDER = ["timestamp", "bnb_amount", "token_amount", "block_number"] as const;
    const orderBy  = TRADE_ORDER_MAP[parseOrderBy(query, ALLOWED_ORDER, "timestamp")] ?? "timestamp";
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const addr  = normalizeAddress(address);
    const where: Record<string, unknown> = { token: addr };
    if (type)              where["type"]              = type.toUpperCase();
    if (fromInt !== null)  where["timestamp_gte"]     = fromInt.toString();
    if (toInt   !== null)  where["timestamp_lte"]     = toInt.toString();

    const [{ trades }, total] = await Promise.all([
      subgraphFetch<{ trades: SubgraphTrade[] }>(TRADES_FOR_TOKEN_QUERY, {
        token: addr, first: limit, skip: offset, orderBy, orderDirection: orderDir, where,
      }),
      subgraphCount("trades", TRADES_COUNT_QUERY, { where }),
    ]);

    return paginated(trades.map(normalizeTrade), total, page, limit);
  }

  async migration(address: string) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const addr = normalizeAddress(address);
    const { migrations } = await subgraphFetch<{ migrations: SubgraphMigration[] }>(
      MIGRATION_FOR_TOKEN_QUERY,
      { token: addr },
    );
    if (!migrations.length) throw new NotFoundException(`Token ${address} has not migrated yet`);

    return { data: normalizeMigration(migrations[0]) };
  }

  async traders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const ALLOWED_ORDER = ["totalVolumeBNB", "totalTrades", "buyCount", "sellCount", "netBNB"] as const;
    const orderBy  = parseOrderBy(query, ALLOWED_ORDER, "totalVolumeBNB");
    const orderDir = parseOrderDir(query);
    const addr     = normalizeAddress(address);

    // Fetch all trades for this token and aggregate per-trader in JS.
    const allTrades = await subgraphFetchAll<{ trader: string; type: "BUY" | "SELL"; bnbAmount: string }>(
      "trades",
      ALL_TRADES_FOR_TOKEN_QUERY,
      { where: { token: addr } },
    );

    // Aggregate
    const map = new Map<string, { buys: bigint[]; sells: bigint[] }>();
    for (const t of allTrades) {
      const entry = map.get(t.trader) ?? { buys: [], sells: [] };
      if (t.type === "BUY") entry.buys.push(BigInt(t.bnbAmount));
      else                   entry.sells.push(BigInt(t.bnbAmount));
      map.set(t.trader, entry);
    }

    const rows = Array.from(map.entries()).map(([trader, { buys, sells }]) => {
      const totalBNBIn  = buys.reduce((a, b) => a + b, 0n);
      const totalBNBOut = sells.reduce((a, b) => a + b, 0n);
      return {
        trader,
        buyCount:       buys.length,
        sellCount:      sells.length,
        totalTrades:    buys.length + sells.length,
        totalBNBIn:     totalBNBIn.toString(),
        totalBNBOut:    totalBNBOut.toString(),
        totalVolumeBNB: (totalBNBIn + totalBNBOut).toString(),
        netBNB:         (totalBNBOut - totalBNBIn).toString(),
      };
    });

    // Sort
    const numericFields = new Set(["totalBNBIn", "totalBNBOut", "totalVolumeBNB", "netBNB"]);
    rows.sort((a, b) => {
      const av = numericFields.has(orderBy)
        ? (BigInt(a[orderBy as keyof typeof a] as string))
        : BigInt(a[orderBy as keyof typeof a] as number);
      const bv = numericFields.has(orderBy)
        ? (BigInt(b[orderBy as keyof typeof b] as string))
        : BigInt(b[orderBy as keyof typeof b] as number);
      return orderDir === "ASC" ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
    });

    return paginated(rows.slice(offset, offset + limit), rows.length, page, limit);
  }

  async holders(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";
    const addr     = normalizeAddress(address);

    const [{ holders }, total] = await Promise.all([
      subgraphFetch<{ holders: SubgraphHolder[] }>(HOLDERS_QUERY, {
        token: addr, first: limit, skip: offset, orderDirection: orderDir,
      }),
      subgraphCount("holders", HOLDERS_COUNT_QUERY, { token: addr }),
    ]);

    return paginated(
      holders.map(h => ({
        address:              h.address,
        balance:              h.balance,
        lastUpdatedBlock:     h.lastUpdatedBlock,
        lastUpdatedTimestamp: parseInt(h.lastUpdatedTimestamp),
      })),
      total,
      page,
      limit,
    );
  }

  async snapshots(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const { page, limit, offset } = parsePagination(query);
    const addr = normalizeAddress(address);

    const fromTs = query["from"] ? parseInt(query["from"], 10) : null;
    const toTs   = query["to"]   ? parseInt(query["to"],   10) : null;
    if (fromTs !== null && isNaN(fromTs)) throw new BadRequestException("from must be a unix timestamp");
    if (toTs   !== null && isNaN(toTs))   throw new BadRequestException("to must be a unix timestamp");

    // Verify token exists
    const { token: exists } = await subgraphFetch<{ token: { id: string } | null }>(TOKEN_EXISTS_QUERY, { id: addr });
    if (!exists) throw new NotFoundException(`Token ${address} not found`);

    const where: Record<string, unknown> = { token: addr };
    if (fromTs !== null) where["timestamp_gte"] = fromTs.toString();
    if (toTs   !== null) where["timestamp_lte"] = toTs.toString();

    const [{ tokenSnapshots: snaps }, total] = await Promise.all([
      subgraphFetch<{ tokenSnapshots: SubgraphSnapshot[] }>(SNAPSHOTS_QUERY, {
        first: limit, skip: offset, where,
      }),
      subgraphCount("tokenSnapshots", SNAPSHOTS_COUNT_QUERY, { where }),
    ]);

    const rows = snaps.map(s => {
      const vBNB     = BigInt(s.token.virtualBNB);
      const closeRBN = BigInt(s.closeRaisedBNB);
      const supply   = BigInt(s.token.totalSupply);
      const vl       = vBNB + closeRBN;
      const priceBnb = vBNB === 0n || supply === 0n
        ? "0.0"
        : formatBigDecimal((vl * vl * SCALE18) / (vBNB * supply), 18);

      return {
        blockNumber:        s.blockNumber,
        timestamp:          parseInt(s.timestamp),
        openRaisedBNB:      s.openRaisedBNB,
        closeRaisedBNB:     s.closeRaisedBNB,
        virtualLiquidityBnb: formatBigDecimal(vl, 18),
        volumeBNB:          s.volumeBNB,
        buyCount:           parseInt(s.buyCount),
        sellCount:          parseInt(s.sellCount),
        priceBnb,
      };
    });

    return paginated(rows, total, page, limit);
  }

  async byCreator(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid creator address");

    const { page, limit, offset } = parsePagination(query);
    const addr = normalizeAddress(address);

    const where = { creator: addr };
    const [{ tokens }, total] = await Promise.all([
      subgraphFetch<{ tokens: SubgraphToken[] }>(TOKENS_LIST_QUERY, {
        first: limit, skip: offset,
        orderBy: "createdAtBlockNumber", orderDirection: "desc",
        where,
      }),
      subgraphCount("tokens", TOKENS_COUNT_QUERY, { where }),
    ]);

    return paginated(tokens.map(t => this.withUsd(normalizeToken(t))), total, page, limit);
  }

  /**
   * Returns the current metadata for a token.
   *
   * If the subgraph has already resolved the metadata via ipfs.cat(), returns
   * it immediately. Otherwise fetches from IPFS directly using the stored metaUri,
   * falling back to readMetaURI() RPC for tokens whose metaUri was set after
   * creation (no event for the subgraph to re-index from).
   */
  async refreshMetadata(address: string): Promise<Record<string, unknown>> {
    if (!isAddress(address)) throw new BadRequestException("Invalid token address");

    const addr = normalizeAddress(address);
    const { token } = await subgraphFetch<{ token: SubgraphToken | null }>(TOKEN_QUERY, { id: addr });
    if (!token) throw new NotFoundException(`Token ${address} not found`);

    // Subgraph already resolved via ipfs.cat() — return immediately.
    if (token.metaUri && (token.description || token.image || token.website || token.twitter || token.telegram)) {
      return {
        address,
        metaUri:     token.metaUri,
        name:        token.name        ?? null,
        symbol:      token.symbol      ?? null,
        description: token.description ?? null,
        image:       token.image       ?? null,
        website:     token.website     ?? null,
        twitter:     token.twitter     ?? null,
        telegram:    token.telegram    ?? null,
        source: "subgraph",
      };
    }

    // ipfs.cat() failed at index time or metaUri was set post-creation.
    // Resolve metaUri — prefer subgraph value, fall back to RPC.
    const metaUri = token.metaUri ?? await readMetaURI(addr as `0x${string}`);
    if (!metaUri) return { address: addr, metaUri: null, refreshed: false, reason: "metaURI not set on-chain" };

    const meta = await fetchMetadata(metaUri);

    const extractCid = (uri: string): string => {
      if (uri.startsWith("ipfs://")) return uri.slice(7).split("?")[0];
      if (uri.startsWith("ipfs/"))   return uri.slice(5).split("?")[0];
      const m = uri.match(/\/ipfs\/([A-Za-z0-9]+)/);
      return m ? m[1] : uri;
    };
    const imageRaw = meta?.imageRaw ?? null;

    return {
      address:     addr,
      metaUri,
      name:        meta?.name        ?? null,
      symbol:      meta?.symbol      ?? null,
      description: meta?.description ?? null,
      image:       imageRaw ? extractCid(imageRaw) : null,
      website:     meta?.website               ?? null,
      twitter:     meta?.socials?.twitter      ?? null,
      telegram:    meta?.socials?.telegram     ?? null,
      source:      token.metaUri ? "ipfs" : "rpc+ipfs",
    };
  }
}
