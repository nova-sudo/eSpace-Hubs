/**
 * /api/v1/grading-verdicts/* router.
 *
 *   GET     /lookup?prId=&rubricHash=   authed — cache lookup, returns
 *                                                {cached, verdict?, ...}
 *   GET     /                            authed — list, optional ?prId
 *   POST    /                            authed — upsert one verdict
 *   POST    /prune                       authed — drop verdicts whose
 *                                                (prId, rubricHash) no
 *                                                longer matches caller's map
 *   DELETE  /                            authed — wipe all (rare)
 */

import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import {
  deleteAllVerdictsHandler,
  listVerdictsHandler,
  lookupVerdictHandler,
  pruneVerdictsHandler,
  upsertVerdictHandler,
} from "./controller.js";

export const gradingVerdictsRouter: Router = Router();

// Order matters here: /lookup and /prune must come before /:something
// catchalls. Keeping them as POST/GET literal paths keeps the routing
// table unambiguous.
gradingVerdictsRouter.get("/lookup", requireAuth(), lookupVerdictHandler);
gradingVerdictsRouter.post("/prune", requireAuth(), pruneVerdictsHandler);
gradingVerdictsRouter.get("/", requireAuth(), listVerdictsHandler);
gradingVerdictsRouter.post("/", requireAuth(), upsertVerdictHandler);
gradingVerdictsRouter.delete("/", requireAuth(), deleteAllVerdictsHandler);
