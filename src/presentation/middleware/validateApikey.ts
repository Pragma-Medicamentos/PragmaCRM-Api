import { NextFunction, Request, Response } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { CustomError } from '../../domain/errors/CustomError';
import { envs } from '../../config/envs';

import { logger } from '../../lib/adapters/logger';

const hashKey = (key: string) => createHash('sha256').update(key).digest();

export const validateApiKey = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    try {
        const apiKey = req.headers['x-api-key'] as string;

        // // Validar que el header exista
        // if (!apiKey || apiKey.trim() === '') {
        //   throw CustomError.unauthorized('Missing x-api-key header');
        // }

        // // Validar que coincida con la API Key del backend
        // if (apiKey !== envs.API_KEY) {
        //   throw CustomError.unauthorized('Invalid API Key');
        // }

        if (!apiKey || apiKey.trim() === '' || !timingSafeEqual(hashKey(apiKey), hashKey(envs.API_KEY))) {
            logger.warn('Auth rejected: invalid or missing API key', { ip: req.ip });
            throw CustomError.unauthorized('Unauthorized');
        }

        // Si es válida, pasar al siguiente middleware
        next();
    } catch (error) {
        if (error instanceof CustomError) {
            res.status(error.statusCode).json({ error: error.message });
            return;
        }

        logger.error('Unexpected error in validateApiKey', { error });
        res.status(500).json({ error: 'Internal server error' });
    }
};
