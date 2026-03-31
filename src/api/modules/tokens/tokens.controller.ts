import { Controller, Get, Post, Param, Query } from "@nestjs/common";
import { TokensService } from "./tokens.service";

@Controller("tokens")
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  /** GET /api/v1/tokens */
  @Get()
  list(@Query() query: Record<string, string>) {
    return this.tokens.list(query);
  }

  /** GET /api/v1/tokens/:address */
  @Get(":address")
  findOne(@Param("address") address: string) {
    return this.tokens.findOne(address);
  }

  /** GET /api/v1/tokens/:address/trades */
  @Get(":address/trades")
  trades(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.tokens.trades(address, query);
  }

  /** GET /api/v1/tokens/:address/traders */
  @Get(":address/traders")
  traders(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.tokens.traders(address, query);
  }

  /** GET /api/v1/tokens/:address/holders */
  @Get(":address/holders")
  holders(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.tokens.holders(address, query);
  }

  /** GET /api/v1/tokens/:address/migration */
  @Get(":address/migration")
  migration(@Param("address") address: string) {
    return this.tokens.migration(address);
  }

  /** GET /api/v1/tokens/:address/snapshots — per-block bonding-curve history */
  @Get(":address/snapshots")
  snapshots(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.tokens.snapshots(address, query);
  }

  /**
   * POST /api/v1/tokens/:address/metadata/refresh
   * Re-reads metaURI() from the chain and re-fetches the IPFS metadata JSON,
   * updating the stored name, symbol, description, image, and socials.
   * Use when metaURI was null at index time or when the creator calls setMetaURI().
   */
  @Post(":address/metadata/refresh")
  refreshMetadata(@Param("address") address: string) {
    return this.tokens.refreshMetadata(address as `0x${string}`);
  }
}

/** Separate controller so /creators/:address/tokens doesn't conflict. */
@Controller("creators")
export class CreatorsController {
  constructor(private readonly tokens: TokensService) {}

  /** GET /api/v1/creators/:address/tokens */
  @Get(":address/tokens")
  byCreator(
    @Param("address") address: string,
    @Query() query: Record<string, string>,
  ) {
    return this.tokens.byCreator(address, query);
  }
}
