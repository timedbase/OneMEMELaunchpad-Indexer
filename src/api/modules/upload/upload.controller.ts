/**
 * Metadata upload controller
 *
 * POST /api/v1/metadata/upload
 *
 * Accepts multipart/form-data, pins the token metadata (and optional image)
 * to IPFS via Pinata, and returns the IPFS hash the creator passes to
 * setMetaURI() on their token contract.
 *
 * Creation flow:
 *   1. Token creator calls POST /api/v1/metadata/upload with their metadata
 *   2. API pins image + JSON to IPFS, returns { metaURI, ipfsHash, gatewayUrl }
 *   3. Creator calls tokenContract.setMetaURI(metaURI) on-chain
 *   4. Future GET /tokens/:address requests resolve metadata from that URI
 */

import {
  BadRequestException,
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { UploadService, UploadMetadataDto } from "./upload.service";

// 3 MB max image size.
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

@Controller("metadata")
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  /**
   * POST /api/v1/metadata/upload
   *
   * Form fields:
   *   image        File    Required image (jpeg/png/gif/webp/svg, max 3 MB)
   *   name         string  Required — token display name
   *   symbol       string  Optional — token ticker symbol (e.g. "PEPE")
   *   description  string  Optional — short token description
   *   website      string  Optional — project website URL
   *   x            string  Optional — Twitter/X URL or handle
   *   telegram     string  Optional — Telegram link
   *
   * Response:
   *   metaURI      "ipfs://<hash>"  — pass directly to setMetaURI()
   *   ipfsHash     raw CID
   *   gatewayUrl   https://ipfs.io/ipfs/<hash>  — public preview link
   *   imageUri     "ipfs://<imageHash>" or null
   */
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("image", {
      limits: { fileSize: MAX_IMAGE_BYTES },
      fileFilter: (_req, file, cb) => {
        const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml"];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new BadRequestException(`Unsupported file type: ${file.mimetype}`), false);
      },
    })
  )
  async uploadMetadata(
    @UploadedFile() image: Express.Multer.File,
    @Body() body: Record<string, string>,
  ) {
    if (!image) {
      throw new BadRequestException("image is required");
    }
    const fields: UploadMetadataDto = {
      name:        body["name"],
      symbol:      body["symbol"],
      description: body["description"],
      website:     body["website"],
      x:           body["x"],
      telegram:    body["telegram"],
    };

    const result = await this.upload.upload(fields, image);

    return {
      data: {
        ...result,
        instructions: {
          nextStep: "Call setMetaURI(metaURI) on your token contract with the metaURI value above.",
          example:  `tokenContract.setMetaURI("${result.metaURI}")`,
        },
      },
    };
  }
}
