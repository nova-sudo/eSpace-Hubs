/**
 * My-manager-notes controller — the REPORT's side of a manager's 1:1
 * notes. Returns only notes about the caller whose author marked them
 * "shared-with-report"; private notes never leave the manager module.
 * The logic (and its test) lives with the rest of the notes in
 * ../manager/report-surfaces.ts.
 */

import type { NextFunction, Request, Response } from "express";
import { getManagerReportNotesCollection } from "../../db/collections.js";
import { asMini, listMyManagerNotes } from "../manager/report-surfaces.js";

export async function listMyManagerNotesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const notes = await getManagerReportNotesCollection();
    res.json(await listMyManagerNotes(req.session, { notes: asMini(notes) }));
  } catch (err) {
    next(err);
  }
}
