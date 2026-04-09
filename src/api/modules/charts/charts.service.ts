import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { subgraphFetch, subgraphFetchAll, formatBigDecimal } from "../../subgraph";
import { SCALE18 } from "../../token-utils";

// TradingView resolution → seconds
const RESOLUTION_MAP: Record<string, number> = {
  "1":   60,    "3":   180,   "5":   300,
  "15":  900,   "30":  1_800, "60":  3_600,
  "120": 7_200, "240": 14_400,"360": 21_600,
  "720": 43_200,"D":   86_400,"1D":  86_400,
  "W":   604_800,"1W": 604_800,
};

// ─── Queries ──────────────────────────────────────────────────────────────────

const TOKEN_SYMBOL_QUERY = /* GraphQL */ `
  query TokenSymbol($id: ID!) {
    token(id: $id) { name symbol tokenType totalSupply createdAtTimestamp }
  }
`;

const SNAPSHOTS_HISTORY_QUERY = /* GraphQL */ `
  query SnapshotsHistory($first: Int!, $skip: Int!, $where: TokenSnapshot_filter) {
    tokenSnapshots(
      first: $first, skip: $skip
      orderBy: blockNumber, orderDirection: asc
      where: $where
    ) {
      blockNumber timestamp openRaisedBNB closeRaisedBNB volumeBNB
      token { virtualBNB totalSupply }
    }
  }
`;

const EARLIEST_SNAPSHOT_QUERY = /* GraphQL */ `
  query EarliestSnapshot($token: String!) {
    tokenSnapshots(first: 1, where: { token: $token }, orderBy: timestamp, orderDirection: asc) {
      timestamp
    }
  }
`;

const TOKEN_EXISTS_QUERY = /* GraphQL */ `
  query TokenExists($id: ID!) { token(id: $id) { id migrated } }
`;

const TOKENS_SEARCH_QUERY = /* GraphQL */ `
  query TokenSearch($first: Int!) {
    tokens(first: $first, orderBy: createdAtTimestamp, orderDirection: desc) {
      id name symbol tokenType
    }
  }
`;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ChartsService {

  config() {
    return {
      supported_resolutions: ["1", "5", "15", "30", "60", "240", "D"],
      supports_group_request: false,
      supports_marks: false,
      supports_search: true,
      supports_timescale_marks: false,
    };
  }

  time() {
    return Math.floor(Date.now() / 1000);
  }

  async symbols(symbolParam: string | undefined) {
    if (!symbolParam) throw new BadRequestException("symbol is required");

    const addr = symbolParam.toLowerCase();
    const { token } = await subgraphFetch<{ token: {
      name: string; symbol: string; tokenType: string;
      totalSupply: string; createdAtTimestamp: string;
    } | null }>(TOKEN_SYMBOL_QUERY, { id: addr });

    if (!token) return { s: "error", errmsg: "Symbol not found" };

    return {
      name:                   token.name,
      ticker:                 token.symbol,
      description:            `${token.name} (${token.symbol}) — OneMEME ${token.tokenType}`,
      type:                   "crypto",
      session:                "24x7",
      timezone:               "Etc/UTC",
      exchange:               "OneMEME",
      listed_exchange:        "OneMEME",
      format:                 "price",
      pricescale:             1_000_000_000,
      minmov:                 1,
      has_intraday:           true,
      has_daily:              true,
      has_weekly_and_monthly: false,
      supported_resolutions:  ["1", "5", "15", "30", "60", "240", "D"],
      volume_precision:       4,
      data_status:            "streaming",
    };
  }

  async history(query: Record<string, string | undefined>) {
    const symbol     = query["symbol"];
    const resolution = query["resolution"] ?? "60";
    const toRaw        = query["to"]        ? parseInt(query["to"],        10) : null;
    const countbackRaw = query["countback"] ? parseInt(query["countback"], 10) : null;
    const fromRaw      = query["from"]      ? parseInt(query["from"],      10) : null;

    if (!symbol) throw new BadRequestException("symbol is required");
    const resSecs = RESOLUTION_MAP[resolution];
    if (!resSecs) throw new BadRequestException(`Unsupported resolution: ${resolution}`);
    if (toRaw        !== null && isNaN(toRaw))        throw new BadRequestException("to must be a unix timestamp");
    if (countbackRaw !== null && isNaN(countbackRaw)) throw new BadRequestException("countback must be an integer");
    if (fromRaw      !== null && isNaN(fromRaw))      throw new BadRequestException("from must be a unix timestamp");

    const toTs      = toRaw       ?? Math.floor(Date.now() / 1000);
    const countback = countbackRaw ?? null;
    const fromTs    = fromRaw      ?? null;
    const addr      = symbol.toLowerCase();

    const effectiveFrom = countback !== null
      ? toTs - countback * resSecs
      : (fromTs ?? toTs - 300 * resSecs);

    const { token } = await subgraphFetch<{ token: { id: string; migrated: boolean } | null }>(
      TOKEN_EXISTS_QUERY, { id: addr },
    );
    if (!token) throw new NotFoundException(`Token ${addr} not found`);

    // Fetch all snapshots in the time range (up to 5000 — sufficient for small platforms)
    const snaps = await subgraphFetchAll<{
      blockNumber: string; timestamp: string;
      openRaisedBNB: string; closeRaisedBNB: string; volumeBNB: string;
      token: { virtualBNB: string; totalSupply: string };
    }>("tokenSnapshots", SNAPSHOTS_HISTORY_QUERY, {
      where: {
        token:          addr,
        timestamp_gte:  effectiveFrom.toString(),
        timestamp_lte:  toTs.toString(),
      },
    }, 1000);

    if (snaps.length === 0) {
      const { tokenSnapshots } = await subgraphFetch<{ tokenSnapshots: { timestamp: string }[] }>(
        EARLIEST_SNAPSHOT_QUERY, { token: addr },
      );
      const nextTime = tokenSnapshots[0] ? parseInt(tokenSnapshots[0].timestamp) : undefined;
      return {
        bars:     [],
        migrated: token.migrated,
        ...(nextTime !== undefined ? { nextTime } : {}),
      };
    }

    // Time-bucket the snapshots in JS
    const bucketMap = new Map<number, typeof snaps>();
    for (const s of snaps) {
      const bucket = Math.floor(parseInt(s.timestamp) / resSecs) * resSecs;
      const arr = bucketMap.get(bucket) ?? [];
      arr.push(s);
      bucketMap.set(bucket, arr);
    }

    const priceFromRaised = (raisedBNB: bigint, vBNB: bigint, totalSupply: bigint): number => {
      if (vBNB === 0n || totalSupply === 0n) return 0;
      const vl = vBNB + raisedBNB;
      return parseFloat(formatBigDecimal((vl * vl * SCALE18) / (vBNB * totalSupply), 18));
    };

    const bars = [...bucketMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([bucketTime, group]) => {
        // group is already sorted asc by blockNumber (fetched asc)
        const vBNB        = BigInt(group[0].token.virtualBNB);
        const totalSupply = BigInt(group[0].token.totalSupply);

        const openRaised  = BigInt(group[0].openRaisedBNB);
        const closeRaised = BigInt(group[group.length - 1].closeRaisedBNB);
        const highRaised  = group.reduce((m, s) => { const v = BigInt(s.closeRaisedBNB); return v > m ? v : m; }, 0n);
        const lowRaised   = group.reduce((m, s) => { const v = BigInt(s.closeRaisedBNB); return v < m ? v : m; }, BigInt("999999999999999999999999999999999999"));
        const volumeWei   = group.reduce((s, r) => s + BigInt(r.volumeBNB), 0n);

        return {
          time:   bucketTime,
          open:   priceFromRaised(openRaised,  vBNB, totalSupply),
          close:  priceFromRaised(closeRaised, vBNB, totalSupply),
          high:   priceFromRaised(highRaised,  vBNB, totalSupply),
          low:    priceFromRaised(lowRaised,   vBNB, totalSupply),
          volume: parseFloat(formatBigDecimal(volumeWei, 18)),
        };
      })
      .filter(b => b.open > 0 && b.close > 0);

    return { bars, migrated: token.migrated };
  }

  async search(query: Record<string, string | undefined>) {
    const q        = (query["query"] ?? "").toLowerCase();
    const limitRaw = parseInt(query["limit"] ?? "10", 10);
    const limit    = isNaN(limitRaw) ? 10 : Math.min(limitRaw, 30);

    // Fetch a reasonable number of recent tokens and filter by address prefix in JS.
    // This is sufficient for small platforms with few tokens.
    const { tokens } = await subgraphFetch<{ tokens: { id: string; name: string; symbol: string; tokenType: string }[] }>(
      TOKENS_SEARCH_QUERY, { first: 200 },
    );

    const matches = q
      ? tokens.filter(t => t.id.startsWith(q) || t.name?.toLowerCase().includes(q) || t.symbol?.toLowerCase().includes(q))
      : tokens;

    return matches.slice(0, limit).map(t => ({
      symbol:      t.symbol,
      full_name:   `${t.name} (${t.symbol})`,
      description: `${t.name} — OneMEME ${t.tokenType}`,
      exchange:    "OneMEME",
      ticker:      t.symbol,
      type:        "crypto",
    }));
  }
}
