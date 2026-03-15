import { SetMetadata } from "@nestjs/common";

/** Mark a route as public — skips the global OriginGuard. */
export const Public = () => SetMetadata("isPublic", true);
