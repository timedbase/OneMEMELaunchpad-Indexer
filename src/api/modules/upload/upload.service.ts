/**
 * Metadata upload service — pins token metadata to IPFS via Pinata.
 *
 * Flow:
 *   1. If an image file is provided, upload it to Pinata → imageIpfsHash
 *   2. Build the metadata JSON (name, description, image, website, socials)
 *   3. Upload the metadata JSON to Pinata → metadataIpfsHash
 *   4. Return { metaURI, ipfsHash, gatewayUrl }
 *
 * The caller (token creator) then calls setMetaURI("ipfs://<metadataIpfsHash>")
 * on their token contract to link the metadata on-chain.
 *
 * Required env var:
 *   PINATA_JWT   — Pinata API JWT (from https://app.pinata.cloud/keys)
 */

import { Injectable, ServiceUnavailableException, BadRequestException } from "@nestjs/common";

const PINATA_FILE_URL = "https://api.pinata.cloud/pinning/pinFileToIPFS";
const PINATA_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export interface UploadMetadataDto {
  name:        string;
  symbol?:     string;
  description?: string;
  website?:    string;
  x?:          string;   // Twitter / X
  telegram?:   string;
}

export interface UploadResult {
  metaURI:    string;   // "ipfs://<hash>"  — pass to setMetaURI()
  ipfsHash:   string;   // raw CIDv1 hash
  gatewayUrl: string;   // https://ipfs.io/ipfs/<hash>
  imageUri:   string;   // "ipfs://<imageHash>"
}

@Injectable()
export class UploadService {

  private jwt(): string {
    const jwt = process.env.PINATA_JWT;
    if (!jwt) {
      throw new ServiceUnavailableException(
        "IPFS upload is not configured. Set PINATA_JWT in your environment."
      );
    }
    return jwt;
  }

  private gateway(): string {
    return (process.env.IPFS_GATEWAY ?? "https://ipfs.io/ipfs/").replace(/\/$/, "");
  }

  /** Upload a raw file buffer to Pinata and return its IPFS CID. */
  private async pinFile(
    buffer:   Buffer,
    mimetype: string,
    filename: string,
    name:     string,
  ): Promise<string> {
    const blob = new Blob([buffer], { type: mimetype });
    const form = new FormData();
    form.append("file", blob, filename);
    form.append(
      "pinataMetadata",
      JSON.stringify({ name: `onememe-image-${name}` })
    );
    form.append(
      "pinataOptions",
      JSON.stringify({ cidVersion: 1 })
    );

    const res = await fetch(PINATA_FILE_URL, {
      method:  "POST",
      headers: { Authorization: `Bearer ${this.jwt()}` },
      body:    form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new ServiceUnavailableException(`Pinata file upload failed: ${res.status} — ${text}`);
    }

    const json = await res.json() as { IpfsHash: string };
    return json.IpfsHash;
  }

  /** Upload a JSON object to Pinata and return its IPFS CID. */
  private async pinJson(
    content: Record<string, unknown>,
    name:    string,
  ): Promise<string> {
    const res = await fetch(PINATA_JSON_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${this.jwt()}`,
      },
      body: JSON.stringify({
        pinataContent:  content,
        pinataMetadata: { name: `onememe-meta-${name}` },
        pinataOptions:  { cidVersion: 1 },
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new ServiceUnavailableException(`Pinata JSON upload failed: ${res.status} — ${text}`);
    }

    const json = await res.json() as { IpfsHash: string };
    return json.IpfsHash;
  }

  async upload(
    fields: UploadMetadataDto,
    imageFile: Express.Multer.File,
  ): Promise<UploadResult> {
    if (!fields.name?.trim()) {
      throw new BadRequestException("name is required");
    }

    // ── Validate image MIME type ─────────────────────────────────────────────
    if (!ALLOWED_MIME_TYPES.has(imageFile.mimetype)) {
      throw new BadRequestException(
        `Unsupported image type: ${imageFile.mimetype}. Allowed: jpeg, png, gif, webp, svg (max 3 MB)`
      );
    }

    // ── Step 1: Upload image ─────────────────────────────────────────────────
    const imageHash = await this.pinFile(
      imageFile.buffer,
      imageFile.mimetype,
      imageFile.originalname,
      fields.name.trim(),
    );

    // ── Step 2: Build metadata JSON ──────────────────────────────────────────
    const socials: Record<string, string | null> = {
      x:        fields.x        || null,
      telegram: fields.telegram || null,
    };

    // Strip null socials to keep the JSON clean.
    const filteredSocials = Object.fromEntries(
      Object.entries(socials).filter(([, v]) => v !== null)
    );

    const metadata: Record<string, unknown> = {
      name:        fields.name.trim(),
      symbol:      fields.symbol?.trim() || undefined,
      description: fields.description?.trim() || undefined,
      image:       `ipfs://${imageHash}`,
      website:     fields.website?.trim() || undefined,
    };

    if (Object.keys(filteredSocials).length > 0) {
      metadata["socials"] = filteredSocials;
    }

    // Strip undefined fields.
    const cleanMetadata = Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v !== undefined)
    ) as Record<string, unknown>;

    // ── Step 3: Upload metadata JSON ─────────────────────────────────────────
    const metaHash = await this.pinJson(cleanMetadata, fields.name.trim());

    return {
      metaURI:    `ipfs://${metaHash}`,
      ipfsHash:   metaHash,
      gatewayUrl: `${this.gateway()}/${metaHash}`,
      imageUri:   `ipfs://${imageHash}`,
    };
  }
}
