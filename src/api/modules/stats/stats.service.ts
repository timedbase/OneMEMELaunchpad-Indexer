import { Injectable } from "@nestjs/common";
import { subgraphFetch, subgraphFetchAll } from "../../subgraph";
import { TO_API_TYPE } from "../../token-utils";

// ─── Queries ──────────────────────────────────────────────────────────────────

const FACTORY_QUERY = /* GraphQL */ `
  query Factory($id: ID!) {
    factory(id: $id) {
      totalTokensCreated totalStandardTokens totalTaxTokens totalReflectionTokens
      totalBuys totalSells totalMigrations
    }
  }
`;

const TOP_TOKEN_QUERY = /* GraphQL */ `
  query TopToken {
    tokens(first: 1, orderBy: raisedBNB, orderDirection: desc) {
      id tokenType creator buysCount sellsCount raisedBNB
      totalVolumeBNBBuy totalVolumeBNBSell migrated
    }
  }
`;

// For totalLiquidityBNB: sum across all migrations
const MIGRATION_LIQUIDITY_QUERY = /* GraphQL */ `
  query MigrationLiquidity($first: Int!, $skip: Int!) {
    migrations(first: $first, skip: $skip) { liquidityBNB }
  }
`;

// For totalVolumeBNB: sum across all tokens
const TOKEN_VOLUME_QUERY = /* GraphQL */ `
  query TokenVolumes($first: Int!, $skip: Int!) {
    tokens(first: $first, skip: $skip) { totalVolumeBNBBuy totalVolumeBNBSell }
  }
`;

// For uniqueTraders: fetch all trader addresses
const ALL_TRADERS_QUERY = /* GraphQL */ `
  query AllTraders($first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip) { trader }
  }
`;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StatsService {
  async platform() {
    // Subgraph uses Bytes.fromUTF8("factory") as the singleton Factory ID.
    const factoryId = "0x666163746f7279";

    const [
      { factory },
      { tokens: [topToken] },
      migrations,
      tokenVolumes,
      allTraders,
    ] = await Promise.all([
      subgraphFetch<{ factory: {
        totalTokensCreated: string;
        totalStandardTokens: string;
        totalTaxTokens: string;
        totalReflectionTokens: string;
        totalBuys: string;
        totalSells: string;
        totalMigrations: string;
      } | null }>(FACTORY_QUERY, { id: factoryId }),

      subgraphFetch<{ tokens: {
        id: string; tokenType: string; creator: string;
        buysCount: string; sellsCount: string; raisedBNB: string;
        totalVolumeBNBBuy: string; totalVolumeBNBSell: string; migrated: boolean;
      }[] }>(TOP_TOKEN_QUERY),

      subgraphFetchAll<{ liquidityBNB: string }>("migrations", MIGRATION_LIQUIDITY_QUERY),
      subgraphFetchAll<{ totalVolumeBNBBuy: string; totalVolumeBNBSell: string }>("tokens", TOKEN_VOLUME_QUERY),
      subgraphFetchAll<{ trader: string }>("trades", ALL_TRADERS_QUERY),
    ]);

    const totalLiquidityBNBWei = migrations.reduce(
      (sum, m) => sum + BigInt(m.liquidityBNB), 0n,
    );
    const totalVolumeBNBWei = tokenVolumes.reduce(
      (sum, t) => sum + BigInt(t.totalVolumeBNBBuy) + BigInt(t.totalVolumeBNBSell), 0n,
    );
    const uniqueTraders = new Set(allTraders.map(t => t.trader)).size;

    const f = factory;
    const totalTokens    = parseInt(f?.totalTokensCreated  ?? "0");
    const migratedTokens = parseInt(f?.totalMigrations     ?? "0");

    return {
      data: {
        totalTokens,
        migratedTokens,
        activeTokens: totalTokens - migratedTokens,
        tokensByType: {
          Standard:   parseInt(f?.totalStandardTokens   ?? "0"),
          Tax:        parseInt(f?.totalTaxTokens         ?? "0"),
          Reflection: parseInt(f?.totalReflectionTokens  ?? "0"),
        },
        totalTrades:   parseInt(f?.totalBuys ?? "0") + parseInt(f?.totalSells ?? "0"),
        totalBuys:     parseInt(f?.totalBuys  ?? "0"),
        totalSells:    parseInt(f?.totalSells ?? "0"),
        uniqueTraders,
        totalVolumeBNB:    (totalVolumeBNBWei / BigInt(1e18)).toString(),
        totalLiquidityBNB: (totalLiquidityBNBWei / BigInt(1e18)).toString(),
        topTokenByVolume: topToken
          ? {
              id:         topToken.id,
              tokenType:  TO_API_TYPE[topToken.tokenType] ?? topToken.tokenType,
              creator:    topToken.creator,
              buyCount:   topToken.buysCount,
              sellCount:  topToken.sellsCount,
              volumeBNB:  (BigInt(topToken.totalVolumeBNBBuy) + BigInt(topToken.totalVolumeBNBSell)).toString(),
              migrated:   topToken.migrated,
            }
          : null,
      },
    };
  }
}
