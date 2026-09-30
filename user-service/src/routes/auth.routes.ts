/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Authentication, current-user, profile-update, and bootstrap routes
    Author review: Done
**/
import { Router } from "express";

import {
  getCurrentUser,
  getBootstrapAvailability,
  patchCurrentUser,
  postBootstrapAdministrator,
  postLogin,
  postRegister,
} from "../controllers/auth.controller";
import { requireAuthentication } from "../middleware/authentication";

const router = Router();

router.post("/login", postLogin);
router.post("/register", postRegister);
router.post("/bootstrap", postBootstrapAdministrator);
router.get("/bootstrap", getBootstrapAvailability);
router.get("/me", requireAuthentication, getCurrentUser);
router.patch("/me", requireAuthentication, patchCurrentUser);

export default router;
