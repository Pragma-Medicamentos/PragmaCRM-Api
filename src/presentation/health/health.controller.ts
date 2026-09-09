import { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ApiResponse } from '../../domain/interfaces';

// La version se lee de package.json en runtime desde el cwd (rootDir es src,
// por eso no se importa el archivo directamente).
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
