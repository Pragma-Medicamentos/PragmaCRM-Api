import { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApiResponse } from '../../domain/interfaces';

// The version is read from package.json at runtime from the cwd (rootDir is
// src, which is why the file is not imported directly).
const { version } = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
) as { version: string };

interface HealthPayload {
  uptime: number;
  version: string;
}

export class HealthController {
  // GET /api/health
  public async getStatus(_req: Request, res: Response) {
    const response: ApiResponse<HealthPayload> = {
      success: true,
      message: 'API is healthy',
      data: { uptime: process.uptime(), version },
    };

    res.status(200).json(response);
  }
}
