/**
 * @swagger
 * /docs:
 *   get:
 *     summary: Get all documentation sections
 *     description: Returns all documentation sections from the database
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: List of documentation sections
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/DocumentationSection'
 *       500:
 *         description: Server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @swagger
 * /docs/{sectionId}:
 *   get:
 *     summary: Get a specific documentation section
 *     description: Returns a single documentation section by its ID
 *     tags: [Documentation]
 *     parameters:
 *       - in: path
 *         name: sectionId
 *         required: true
 *         schema:
 *           type: string
 *         description: The section identifier
 *     responses:
 *       200:
 *         description: Documentation section
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DocumentationSection'
 *       404:
 *         description: Section not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */

/**
 * @swagger
 * /docs/git-stats:
 *   get:
 *     summary: Get Git sync statistics
 *     description: Returns statistics about the Git documentation synchronization
 *     tags: [Documentation]
 *     responses:
 *       200:
 *         description: Git sync statistics
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 gitUrl:
 *                   type: string
 *                 branch:
 *                   type: string
 *                 lastSyncAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 lastCommitHash:
 *                   type: string
 *                   nullable: true
 *                 status:
 *                   type: string
 *                   enum: [idle, syncing, success, error]
 *                 totalDocuments:
 *                   type: integer
 *                 documentsWithEmbeddings:
 *                   type: integer
 */

/**
 * @swagger
 * /docs/sync:
 *   post:
 *     summary: Trigger documentation sync
 *     description: Triggers a synchronization of documentation from the Git repository
 *     tags: [Documentation]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               force:
 *                 type: boolean
 *                 default: false
 *                 description: Force sync even if no changes detected
 *     responses:
 *       200:
 *         description: Sync completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 hadUpdates:
 *                   type: boolean
 *                 currentHash:
 *                   type: string
 *                 previousHash:
 *                   type: string
 *                   nullable: true
 *                 summary:
 *                   type: object
 *                   properties:
 *                     added:
 *                       type: integer
 *                     modified:
 *                       type: integer
 *                     deleted:
 *                       type: integer
 *                     filesProcessed:
 *                       type: array
 *                       items:
 *                         type: string
 *                 totalDocuments:
 *                   type: integer
 *                 duration:
 *                   type: integer
 *                   description: Duration in milliseconds
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Sync failed
 */

/**
 * @swagger
 * /docs/sync/status:
 *   get:
 *     summary: Get sync status
 *     description: Returns the current status of documentation synchronization
 *     tags: [Documentation]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sync status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   enum: [idle, syncing, success, error]
 *                 lastSyncAt:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 lastCommitHash:
 *                   type: string
 *                   nullable: true
 *                 branch:
 *                   type: string
 *                 gitUrl:
 *                   type: string
 *                 errorMessage:
 *                   type: string
 *                   nullable: true
 *                 totalDocuments:
 *                   type: integer
 *                 documentsWithEmbeddings:
 *                   type: integer
 */

/**
 * @swagger
 * /docs-index:
 *   get:
 *     summary: Get documentation index
 *     description: Returns an index of all documentation pages with categories
 *     tags: [Documentation]
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, compact, formatted]
 *           default: json
 *         description: Output format
 *     responses:
 *       200:
 *         description: Documentation index
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 totalPages:
 *                   type: integer
 *                 totalCategories:
 *                   type: integer
 *                 generatedAt:
 *                   type: string
 *                   format: date-time
 *                 categories:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                       pageCount:
 *                         type: integer
 *                       paths:
 *                         type: array
 *                         items:
 *                           type: string
 *                 pages:
 *                   type: array
 *                   items:
 *                     type: object
 */

export {};
