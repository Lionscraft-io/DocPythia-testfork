/**
 * @swagger
 * /updates:
 *   get:
 *     summary: Get pending updates
 *     description: Returns all pending documentation updates awaiting review
 *     tags: [Updates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of pending updates
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/PendingUpdate'
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /updates/{id}/approve:
 *   post:
 *     summary: Approve an update
 *     description: Approve a pending update and apply it to documentation
 *     tags: [Updates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Update ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reviewedBy:
 *                 type: string
 *                 description: Name of the reviewer
 *     responses:
 *       200:
 *         description: Update approved
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PendingUpdate'
 *       404:
 *         description: Update not found
 *       409:
 *         description: Update already processed
 */

/**
 * @swagger
 * /updates/{id}/reject:
 *   post:
 *     summary: Reject an update
 *     description: Reject a pending update
 *     tags: [Updates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Update ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reviewedBy:
 *                 type: string
 *                 description: Name of the reviewer
 *     responses:
 *       200:
 *         description: Update rejected
 *       404:
 *         description: Update not found
 *       409:
 *         description: Update already processed
 */

/**
 * @swagger
 * /updates/{id}:
 *   patch:
 *     summary: Edit a pending update
 *     description: Modify the summary or content of a pending update
 *     tags: [Updates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         description: Update ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               summary:
 *                 type: string
 *               diffAfter:
 *                 type: string
 *     responses:
 *       200:
 *         description: Update modified
 *       404:
 *         description: Update not found
 */

/**
 * @swagger
 * /history:
 *   get:
 *     summary: Get update history
 *     description: Returns the history of all processed updates
 *     tags: [Updates]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Update history
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: string
 *                     format: uuid
 *                   updateId:
 *                     type: string
 *                     format: uuid
 *                   action:
 *                     type: string
 *                   performedBy:
 *                     type: string
 *                   createdAt:
 *                     type: string
 *                     format: date-time
 */

/**
 * @swagger
 * /messages:
 *   get:
 *     summary: Get scraped messages
 *     description: Returns all scraped messages from community channels
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ScrapedMessage'
 */

/**
 * @swagger
 * /messages/unanalyzed:
 *   get:
 *     summary: Get unanalyzed messages
 *     description: Returns messages that have not been analyzed yet
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of unanalyzed messages
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ScrapedMessage'
 */

/**
 * @swagger
 * /scrape:
 *   post:
 *     summary: Trigger message scraping
 *     description: Scrape messages from a community channel
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               channel:
 *                 type: string
 *                 default: community-support
 *               numMessages:
 *                 type: integer
 *                 default: 100
 *     responses:
 *       200:
 *         description: Scraping completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 channel:
 *                   type: string
 *                 requestedMessages:
 *                   type: integer
 *                 storedMessages:
 *                   type: integer
 *                 message:
 *                   type: string
 *       500:
 *         description: Scraper not configured
 */

/**
 * @swagger
 * /analyze:
 *   post:
 *     summary: Trigger message analysis
 *     description: Analyze unanalyzed messages for documentation relevance
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               limit:
 *                 type: integer
 *                 default: 10
 *                 description: Maximum number of messages to analyze
 *     responses:
 *       200:
 *         description: Analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 analyzed:
 *                   type: integer
 *                 relevant:
 *                   type: integer
 *                 updatesCreated:
 *                   type: integer
 *                 message:
 *                   type: string
 *       500:
 *         description: Analyzer not configured
 */

/**
 * @swagger
 * /trigger-job:
 *   post:
 *     summary: Trigger scheduled job
 *     description: Manually trigger the scrape and analyze job
 *     tags: [Messages]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               scrapeLimit:
 *                 type: integer
 *                 default: 100
 *               analysisLimit:
 *                 type: integer
 *                 default: 50
 *               channelName:
 *                 type: string
 *                 default: community-support
 *     responses:
 *       200:
 *         description: Job triggered
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 config:
 *                   type: object
 */

/**
 * @swagger
 * /admin/llm-cache/stats:
 *   get:
 *     summary: Get LLM cache statistics
 *     description: Returns statistics about the LLM response cache
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache statistics
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CacheStats'
 */

/**
 * @swagger
 * /admin/llm-cache:
 *   get:
 *     summary: List all cached LLM requests
 *     description: Returns all entries in the LLM cache
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache entries
 *   delete:
 *     summary: Clear all LLM cache
 *     description: Removes all entries from the LLM cache
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Cache cleared
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 deletedCount:
 *                   type: integer
 */

/**
 * @swagger
 * /admin/llm-cache/{purpose}:
 *   get:
 *     summary: List cached LLM requests by purpose
 *     description: Returns cache entries filtered by purpose
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purpose
 *         required: true
 *         schema:
 *           type: string
 *           enum: [index, embeddings, analysis, changegeneration, general]
 *     responses:
 *       200:
 *         description: Cache entries
 *   delete:
 *     summary: Clear cache by purpose
 *     description: Removes cache entries for a specific purpose
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: purpose
 *         required: true
 *         schema:
 *           type: string
 *           enum: [index, embeddings, analysis, changegeneration, general]
 *     responses:
 *       200:
 *         description: Cache entries cleared
 */

/**
 * @swagger
 * /admin/llm-cache/cleanup/{days}:
 *   delete:
 *     summary: Clean up old cache entries
 *     description: Removes cache entries older than specified number of days
 *     tags: [Cache]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: days
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *     responses:
 *       200:
 *         description: Old entries cleaned up
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 days:
 *                   type: integer
 *                 deletedCount:
 *                   type: integer
 */

export {};
