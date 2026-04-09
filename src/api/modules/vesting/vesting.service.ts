import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { subgraphFetch, subgraphCount } from "../../subgraph";
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
  const unlocked  = (amountBig * BigInt(elapsed)) / BigInt(VESTING_DURATION);
  const claimable = unlocked - claimedBig;
  return claimable > 0n ? claimable.toString() : "0";
}

interface SubgraphVesting {
  id:                   string;
  token:                { id: string; tokenType: string; totalSupply: string; migrated: boolean };
  beneficiary:          string;
  amount:               string;
  claimed:              string;
  voided:               boolean;
  burnedOnVoid:         string;
  createdAtTimestamp:   string;
  createdAtBlockNumber: string;
}

const VESTING_FIELDS = `
  id
  token { id tokenType totalSupply migrated }
  beneficiary amount claimed voided burnedOnVoid
  createdAtTimestamp createdAtBlockNumber
`;

const VESTING_BY_TOKEN_QUERY = /* GraphQL */ `
  query VestingByToken($token: String!) {
    vestingSchedules(where: { token: $token }) { ${VESTING_FIELDS} }
  }
`;

const VESTING_BY_BENEFICIARY_QUERY = /* GraphQL */ `
  query VestingByBeneficiary($beneficiary: String!, $first: Int!, $skip: Int!) {
    vestingSchedules(
      first: $first, skip: $skip
      where: { beneficiary: $beneficiary }
      orderBy: createdAtTimestamp, orderDirection: desc
    ) { ${VESTING_FIELDS} }
  }
`;

const VESTING_COUNT_QUERY = /* GraphQL */ `
  query VestingCount($where: VestingSchedule_filter, $first: Int!, $skip: Int!) {
    vestingSchedules(first: $first, skip: $skip, where: $where) { id }
  }
`;

function normalizeVesting(v: SubgraphVesting) {
  const start = parseInt(v.createdAtTimestamp);
  return {
    token:        v.token.id,
    beneficiary:  v.beneficiary,
    amount:       v.amount,
    blockNumber:  v.createdAtBlockNumber,
    start,
    claimed:      v.claimed,
    voided:       v.voided,
    burned:       v.burnedOnVoid,
    claimable:    computeClaimable(v.amount, start, v.claimed, v.voided),
    vestingEnds:  start + VESTING_DURATION,
    progressPct:  start > 0
      ? Math.min(100, Math.floor(((Date.now() / 1000 - start) / VESTING_DURATION) * 100))
      : 0,
    tokenType:   v.token.tokenType  ?? null,
    totalSupply: v.token.totalSupply ?? null,
    migrated:    v.token.migrated    ?? null,
  };
}

@Injectable()
export class VestingService {

  async getByToken(tokenAddress: string) {
    if (!isAddress(tokenAddress)) throw new BadRequestException("Invalid token address");
    const token = normalizeAddress(tokenAddress);

    const { vestingSchedules } = await subgraphFetch<{ vestingSchedules: SubgraphVesting[] }>(
      VESTING_BY_TOKEN_QUERY, { token },
    );
    if (!vestingSchedules.length) throw new NotFoundException(`No vesting schedule found for token ${tokenAddress}`);

    return { data: vestingSchedules.map(normalizeVesting) };
  }

  async getByBeneficiary(beneficiaryAddress: string, query: Record<string, string | undefined>) {
    if (!isAddress(beneficiaryAddress)) throw new BadRequestException("Invalid beneficiary address");
    const beneficiary = normalizeAddress(beneficiaryAddress);
    const { page, limit, offset } = parsePagination(query);

    const where = { beneficiary };
    const [{ vestingSchedules }, total] = await Promise.all([
      subgraphFetch<{ vestingSchedules: SubgraphVesting[] }>(
        VESTING_BY_BENEFICIARY_QUERY, { beneficiary, first: limit, skip: offset },
      ),
      subgraphCount("vestingSchedules", VESTING_COUNT_QUERY, { where }),
    ]);

    return paginated(vestingSchedules.map(normalizeVesting), total, page, limit);
  }
}
