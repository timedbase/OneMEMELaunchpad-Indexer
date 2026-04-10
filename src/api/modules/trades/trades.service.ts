import { Injectable, BadRequestException } from "@nestjs/common";
import { subgraphFetch, subgraphCount, tradeSourceId } from "../../subgraph";
import { isAddress, normalizeAddress, paginated, parsePagination, parseOrderBy, parseOrderDir } from "../../helpers";

interface SubgraphTrade {
  id:           string;
  token:        { id: string; name: string | null; symbol: string | null };
  trader:       string;
  type:         "BUY" | "SELL";
  bnbAmount:    string;
  tokenAmount:  string;
  tokensToDead: string;
  blockNumber:  string;
  timestamp:    string;
  txHash:       string;
}

function normalizeTrade(t: SubgraphTrade) {
  return {
    id:           tradeSourceId(t.id),
    token:        t.token.id,
    tokenName:    t.token.name   ?? null,
    tokenSymbol:  t.token.symbol ?? null,
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

const TRADE_FIELDS = `
  id trader type bnbAmount tokenAmount tokensToDead blockNumber timestamp txHash
  token { id name symbol }
`;

const TRADE_ORDER_MAP: Record<string, string> = {
  timestamp:    "timestamp",
  bnb_amount:   "bnbAmount",
  token_amount: "tokenAmount",
  block_number: "blockNumber",
};

const TRADES_QUERY = /* GraphQL */ `
  query Trades(
    $first: Int!, $skip: Int!
    $orderBy: Trade_orderBy!, $orderDirection: OrderDirection!
    $where: Trade_filter
  ) {
    trades(first: $first, skip: $skip, orderBy: $orderBy, orderDirection: $orderDirection, where: $where) {
      ${TRADE_FIELDS}
    }
  }
`;

const TRADES_COUNT_QUERY = /* GraphQL */ `
  query TradesCount($where: Trade_filter, $first: Int!, $skip: Int!) {
    trades(first: $first, skip: $skip, where: $where) { id }
  }
`;

@Injectable()
export class TradesService {

  async list(query: Record<string, string | undefined>) {
    const { page, limit, offset } = parsePagination(query);
    const tokenFilter  = query["token"];
    const traderFilter = query["trader"];
    const typeFilter   = query["type"];
    const from         = query["from"];
    const to           = query["to"];

    if (tokenFilter  && !isAddress(tokenFilter))  throw new BadRequestException("Invalid token address");
    if (traderFilter && !isAddress(traderFilter)) throw new BadRequestException("Invalid trader address");
    if (typeFilter   && typeFilter !== "buy" && typeFilter !== "sell") {
      throw new BadRequestException('type must be "buy" or "sell"');
    }

    const ALLOWED_ORDER = ["timestamp", "bnb_amount", "token_amount", "block_number"] as const;
    const orderBy  = TRADE_ORDER_MAP[parseOrderBy(query, ALLOWED_ORDER, "timestamp")] ?? "timestamp";
    const orderDir = parseOrderDir(query).toLowerCase() as "asc" | "desc";

    const fromInt = from ? parseInt(from, 10) : null;
    const toInt   = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");

    const where: Record<string, unknown> = {};
    if (tokenFilter)          where["token"]          = normalizeAddress(tokenFilter);
    if (traderFilter)         where["trader"]         = normalizeAddress(traderFilter);
    if (typeFilter)           where["type"]           = typeFilter.toUpperCase();
    if (fromInt !== null)     where["timestamp_gte"]  = fromInt.toString();
    if (toInt   !== null)     where["timestamp_lte"]  = toInt.toString();

    const [{ trades }, total] = await Promise.all([
      subgraphFetch<{ trades: SubgraphTrade[] }>(TRADES_QUERY, {
        first: limit, skip: offset, orderBy, orderDirection: orderDir,
        where: Object.keys(where).length ? where : undefined,
      }),
      subgraphCount("trades", TRADES_COUNT_QUERY, {
        where: Object.keys(where).length ? where : undefined,
      }),
    ]);

    return paginated(trades.map(normalizeTrade), total, page, limit);
  }

  async byTrader(address: string, query: Record<string, string | undefined>) {
    if (!isAddress(address)) throw new BadRequestException("Invalid trader address");

    const { page, limit, offset } = parsePagination(query);
    const typeFilter = query["type"];
    const from       = query["from"];
    const to         = query["to"];

    if (typeFilter && typeFilter !== "buy" && typeFilter !== "sell") {
      throw new BadRequestException('type must be "buy" or "sell"');
    }
    const fromInt = from ? parseInt(from, 10) : null;
    const toInt   = to   ? parseInt(to,   10) : null;
    if (fromInt !== null && isNaN(fromInt)) throw new BadRequestException("from must be a unix timestamp");
    if (toInt   !== null && isNaN(toInt))   throw new BadRequestException("to must be a unix timestamp");

    const addr  = normalizeAddress(address);
    const where: Record<string, unknown> = { trader: addr };
    if (typeFilter)       where["type"]           = typeFilter.toUpperCase();
    if (fromInt !== null) where["timestamp_gte"]  = fromInt.toString();
    if (toInt   !== null) where["timestamp_lte"]  = toInt.toString();

    const [{ trades }, total] = await Promise.all([
      subgraphFetch<{ trades: SubgraphTrade[] }>(TRADES_QUERY, {
        first: limit, skip: offset,
        orderBy: "timestamp", orderDirection: "desc",
        where,
      }),
      subgraphCount("trades", TRADES_COUNT_QUERY, { where }),
    ]);

    return paginated(trades.map(normalizeTrade), total, page, limit);
  }
}
