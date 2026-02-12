/**
 * @swagger
 * /health:
 *   get:
 *     summary: Health check
 *     description: Returns the health status of the API server
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Server is healthy
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/HealthResponse'
 */

/**
 * @swagger
 * /diagnostics:
 *   get:
 *     summary: System diagnostics
 *     description: Returns detailed diagnostic information about the system
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Diagnostic information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *                 environment:
 *                   type: object
 *                   properties:
 *                     NODE_ENV:
 *                       type: string
 *                     DATABASE_URL:
 *                       type: string
 *                     WIDGET_DOMAIN:
 *                       type: string
 *                     PORT:
 *                       type: string
 *                 database:
 *                   type: string
 *                 static_files:
 *                   type: string
 */

export {};
