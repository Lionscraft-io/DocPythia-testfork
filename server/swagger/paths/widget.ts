/**
 * @swagger
 * /widget/ask:
 *   post:
 *     summary: Ask a documentation question
 *     description: Submit a question to the AI-powered documentation assistant
 *     tags: [Widget]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WidgetAskRequest'
 *     responses:
 *       200:
 *         description: Answer generated
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WidgetAskResponse'
 *       400:
 *         description: Invalid request
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       500:
 *         description: AI service error
 */

/**
 * @swagger
 * /config:
 *   get:
 *     summary: Get public configuration
 *     description: Returns the public configuration for the current instance
 *     tags: [Widget]
 *     parameters:
 *       - in: query
 *         name: instance
 *         schema:
 *           type: string
 *         description: Instance identifier (optional)
 *     responses:
 *       200:
 *         description: Configuration
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 project:
 *                   type: object
 *                   properties:
 *                     name:
 *                       type: string
 *                     description:
 *                       type: string
 *                 branding:
 *                   type: object
 *                 widget:
 *                   type: object
 *                   properties:
 *                     enabled:
 *                       type: boolean
 *                     title:
 *                       type: string
 *                     welcomeMessage:
 *                       type: string
 *                     suggestedQuestions:
 *                       type: array
 *                       items:
 *                         type: string
 *                     position:
 *                       type: string
 *                     theme:
 *                       type: string
 *                     primaryColor:
 *                       type: string
 *                 features:
 *                   type: object
 *                   properties:
 *                     chatEnabled:
 *                       type: boolean
 *                     versionHistoryEnabled:
 *                       type: boolean
 *                 repository:
 *                   type: object
 *                   properties:
 *                     targetRepo:
 *                       type: string
 *                     sourceRepo:
 *                       type: string
 *                     baseBranch:
 *                       type: string
 */

export {};
