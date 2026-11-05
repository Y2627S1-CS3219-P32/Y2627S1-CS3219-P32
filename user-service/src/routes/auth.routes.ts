/**
    AI Assistance Disclosure:
    Tool: ChatGPT (model: GPT-6), date: 2026-09-29
    Scope: Authentication, current-user, profile-update, and bootstrap routes
    Author review: Done
    Tool: ChatGPT (GPT-6), date: 2026-11-04
    Scope: Register public account verification route
    Author review: Pending
**/
import { Router } from "express";

import {
  getCurrentUser,
  getBootstrapAvailability,
  patchCurrentUser,
  postBootstrapAdministrator,
  postLogin,
  postRegister,
  postVerifyUser,
} from "../controllers/auth.controller";
import { requireAuthentication } from "../middleware/authentication";

const router = Router();

router.post("/login", postLogin);
router.post("/register", postRegister);
router.post("/verify", postVerifyUser);
router.post("/bootstrap", postBootstrapAdministrator);
router.get("/bootstrap", getBootstrapAvailability);
router.get("/me", requireAuthentication, getCurrentUser);
router.patch("/me", requireAuthentication, patchCurrentUser);

export default router;
