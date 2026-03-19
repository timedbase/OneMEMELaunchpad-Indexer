import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { sql } from "../../db";
import { isAddress, normalizeAddress, paginated, parsePagination } from "../../helpers";

const VESTING_DURATION = 365 * 24 * 60 * 60; // 365 days in seconds

function computeClaimable(amount: string, start: number, claimed: string, voided: boolean): string {
  if (voided) return "0";
  const now     = Math.floor(Date.now() / 1000);
  const elapsed = now - start;
  if (elapsed <= 0) return "0";
  const amountBig  = BigInt(amount);
  const claimedBig = BigInt(claimed);
  if (elapsed >= VESTING_DURATION) return (amountBig - claimedBig).toString();
  const unlocked = (amountBig * BigInt(elapsed)) / BigInt(VESTING_DURATION);
  const claimable = unlocked - claimedBig;
  return claimable > 0n ? claimable.toString() : "0";
}

@Injectable()
export class VestingService {

  async getByToken(tokenAddress: string) {
    if (!isAddress(tokenAddress)) throw new BadRequestException("Invalid token address");
    const token = normalizeAddress(tokenAddress);

    const rows = await sql`
      SELECT * FROM vesting WHERE token = ${token}
    `;
    if (!rows.length) throw new NotFoundException(`No vesting schedule found for token ${tokenAddress}`);

    return {
      data: rows.map((r) => ({
        token:       r.token,
        beneficiary: r.beneficiary,
        amount:      r.amount,
        start:       r.start,
        claimed:     r.claimed,
        voided:      r.voided,
        burned:      r.burned,
        claimable:   computeClaimable(r.amount, r.start, r.claimed, r.voided),
        vestingEnds: r.start + VESTING_DURATION,
        progressPct: r.start > 0
          ? Math.min(100, Math.floor(((Date.now() / 1000 - r.start) / VESTING_DURATION) * 100))
          : 0,
      })),
    };
  }

  async getByBeneficiary(beneficiaryAddress: string, query: Record<string, string | undefined>) {
    if (!isAddress(beneficiaryAddress)) throw new BadRequestException("Invalid beneficiary address");
    const beneficiary = normalizeAddress(beneficiaryAddress);
    const { page, limit, offset } = parsePagination(query);

    const [rows, [{ count }]] = await Promise.all([
      sql`
        SELECT v.*, t.token_type, t.total_supply, t.migrated
        FROM vesting v
        LEFT JOIN token t ON t.id = v.token
        WHERE v.beneficiary = ${beneficiary}
        ORDER BY v.start DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int AS count FROM vesting WHERE beneficiary = ${beneficiary}`,
    ]);

    return {
      ...paginated(
        rows.map((r) => ({
          token:       r.token,
          beneficiary: r.beneficiary,
          amount:      r.amount,
          start:       r.start,
          claimed:     r.claimed,
          voided:      r.voided,
          burned:      r.burned,
          claimable:   computeClaimable(r.amount, r.start, r.claimed, r.voided),
          vestingEnds: r.start + VESTING_DURATION,
          progressPct: r.start > 0
            ? Math.min(100, Math.floor(((Date.now() / 1000 - r.start) / VESTING_DURATION) * 100))
            : 0,
          tokenType:   r.token_type   ?? null,
          totalSupply: r.total_supply ?? null,
          migrated:    r.migrated      ?? null,
        })),
        count,
        page,
        limit,
      ),
    };
  }
}
